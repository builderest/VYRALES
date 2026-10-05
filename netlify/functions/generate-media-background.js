// Background function (hasta 15 min en producción Netlify): genera las tomas de video de
// un episodio con Veo 3.1 — modo HÍBRIDO LITE/FAST como describe el dashboard: Lite para
// las tomas normales, Fast para la toma del cliffhanger final (la última escena) — y las
// sube a Supabase Storage. Si las 8 tomas salen bien, UNE automáticamente el video final
// (ver _merge.js) antes de dejar el episodio en "en_revision" — así llega listo para el
// filtro humano sin que haya que apretar ningún botón aparte.
//
// IMPORTANTE: esto sí consume la API de Veo de verdad y genera cargos reales en tu cuenta
// de Google Cloud (según el presupuesto que ya configuraste). No es un test gratis como
// los pasos anteriores. La unión final con ffmpeg sí es gratis (procesamiento local).
//
// Cómo probarlo en local con `netlify dev` (toma el episodio #1 que ya sembramos, en
// estado "guion_generado"):
//   http://localhost:8888/.netlify/functions/generate-media-background
// o para un episodio específico:
//   http://localhost:8888/.netlify/functions/generate-media-background?episode_id=<uuid>
const { getSupabaseClient } = require('./_supabase');
const { ensureMediaBucket, uploadClip } = require('./_storage');
const { generateVeoClip, loadReferenceImages } = require('./_veo');
const { mergeEpisodeVideo } = require('./_merge');
const { effectiveShotPrompt, referenceUrlsForShot } = require('./_series');
const { createKeyframe, loadExistingKeyframe } = require('./_keyframe');

// Estilo por defecto SOLO para series viejas sin story_bible.visual_style (dragon_silicio).
// Las novelas nuevas definen su estilo en story_bible.visual_style (ej. animación 3D).
const LEGACY_STYLE = 'Vertical 9:16 cinematic shot, photorealistic, consistent lighting.';

// Las background functions de Netlify cortan a los 15 min. Si se acerca el límite y aún
// faltan tomas, la función se vuelve a llamar a sí misma (las tomas ya hechas se saltan),
// así un episodio lento no se queda a medias.
const TIME_BUDGET_MS = 11 * 60 * 1000;

function parseScenes(script) {
  return (script || '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const match = block.match(/^(\d+)\.\s*([\s\S]*)$/);
      return match ? { number: Number(match[1]), text: match[2].trim() } : null;
    })
    .filter(Boolean);
}

function buildPrompt(sceneText, characters, storyBible) {
  const lowerText = sceneText.toLowerCase();
  const tags = (characters || [])
    .filter((c) => c.name && lowerText.includes(c.name.toLowerCase().split(' ')[0]))
    .map((c) => c.fixed_prompt_tag)
    .filter(Boolean);

  const style = storyBible || {};
  const stylePrefix = [style.setting, style.tone].filter(Boolean).join('. ');

  return [
    stylePrefix ? `${stylePrefix}.` : '',
    tags.length ? `Characters: ${tags.join('; ')}.` : '',
    style.visual_style || LEGACY_STYLE,
    sceneText
  ]
    .filter(Boolean)
    .join(' ');
}

const LOG = '[generate-media]';

function selfUrl(event, params) {
  const headers = event.headers || {};
  const host = headers.host || headers.Host;
  const proto = headers['x-forwarded-proto'] || (host && host.startsWith('localhost') ? 'http' : 'https');
  const base = host ? `${proto}://${host}` : process.env.URL;
  return `${base}/.netlify/functions/generate-media-background?${new URLSearchParams(params).toString()}`;
}

exports.handler = async (event) => {
  const startedAt = Date.now();
  const supabase = getSupabaseClient();
  const qs = event.queryStringParameters || {};
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    body = {};
  }
  const seriesSlug = body.series || qs.series || process.env.DEFAULT_SERIES_SLUG || 'dragon_silicio';
  const episodeId = body.episode_id || qs.episode_id;
  const isContinuation = qs.continue === '1';
  const force = qs.force === '1' || body.force === true;
  // ?shot=N (o body.shot) → genera SOLO esa toma: sirve de "toma de prueba" antes de gastar
  // el episodio completo. La toma queda guardada como parte del episodio (si se aprueba, ya
  // no se vuelve a generar cuando se produzca el resto).
  const onlyShot = Number(body.shot || qs.shot) || null;

  let markedGenerating = null; // id del episodio que ESTA corrida marcó como generando_media
  console.log(LOG, 'arrancó. series=', seriesSlug, 'episode_id=', episodeId || '(ninguno, toma el siguiente en guion_generado)', isContinuation ? '(continuación)' : '');

  try {
    const { data: series, error: seriesError } = await supabase
      .from('series')
      .select('id, slug, title, story_bible, visual_memory')
      .eq('slug', seriesSlug)
      .single();
    if (seriesError || !series) throw seriesError || new Error('Serie no encontrada');
    console.log(LOG, 'serie OK:', series.id);

    let episodeQuery = supabase.from('episodes').select('*').eq('series_id', series.id);
    episodeQuery = episodeId
      ? episodeQuery.eq('id', episodeId)
      : episodeQuery.eq('status', 'guion_generado').order('episode_number', { ascending: true }).limit(1);

    const { data: episodes, error: episodeError } = await episodeQuery;
    if (episodeError) throw episodeError;
    const episode = episodes && episodes[0];
    if (!episode) {
      throw new Error('No hay ningún episodio en estado "guion_generado". Escribe el guion primero.');
    }
    console.log(LOG, 'episodio encontrado: #' + episode.episode_number, episode.id, 'status=', episode.status);

    // Evita gastar doble: si alguien aprieta el botón dos veces, la segunda llamada no
    // arranca otra generación en paralelo. ?force=1 sirve si una corrida anterior se cayó
    // y dejó el episodio trabado en "generando_media".
    if (episode.status === 'generando_media' && !isContinuation && !force) {
      console.warn(LOG, 'el episodio ya se está generando — no arranco otra corrida. Usa ?force=1 si quedó trabado.');
      return { statusCode: 409, body: JSON.stringify({ error: 'El episodio ya se está generando.' }) };
    }

    const { data: characters, error: charactersError } = await supabase
      .from('characters')
      .select('name, fixed_prompt_tag, profile, reference_image_url')
      .eq('series_id', series.id);
    if (charactersError) throw charactersError;

    // Novelas nuevas: tomas estructuradas (episodes.shots). Series viejas: se parsea el
    // texto del guion como antes.
    const structured = Array.isArray(episode.shots) && episode.shots.length > 0;
    const allScenes = structured
      ? episode.shots.map((shot) => ({ number: shot.n, text: shot.scene_es, shot }))
      : parseScenes(episode.script);
    console.log(LOG, structured ? 'usando tomas estructuradas (episodes.shots)' : 'usando guion de texto (modo legacy)');
    console.log(LOG, 'escenas parseadas:', allScenes.length);
    if (allScenes.length === 0) {
      throw new Error('El episodio no tiene un guion con escenas numeradas ("1. ...", "2. ...", etc.).');
    }

    // Si ya hay tomas generadas para este episodio (de un intento anterior que falló a
    // medias), las saltamos — así un reintento solo genera lo que falta, sin gastar de
    // más regenerando lo que ya salió bien.
    const { data: existingAssets } = await supabase
      .from('assets')
      .select('shot_number')
      .eq('episode_id', episode.id)
      .eq('kind', 'video_clip');
    const doneShots = new Set((existingAssets || []).map((a) => a.shot_number));

    if (onlyShot && !allScenes.find((s) => s.number === onlyShot)) {
      throw new Error(`El episodio no tiene la toma ${onlyShot}.`);
    }
    if (onlyShot && doneShots.has(onlyShot)) {
      console.log(LOG, `la toma ${onlyShot} ya existe — usa Regenerar en el dashboard si quieres otra versión.`);
      return { statusCode: 200, body: JSON.stringify({ episode_id: episode.id, note: `la toma ${onlyShot} ya existía` }) };
    }
    const scenes = allScenes.filter((s) => !doneShots.has(s.number) && (!onlyShot || s.number === onlyShot));
    if (doneShots.size > 0) {
      console.log(LOG, `${doneShots.size} toma(s) ya existían de un intento anterior, se saltan:`, [...doneShots].sort((a, b) => a - b).join(', '));
    }
    if (scenes.length === 0) {
      console.log(LOG, 'todas las tomas ya estaban generadas — nada que hacer.');
      await supabase.from('episodes').update({ status: 'en_revision' }).eq('id', episode.id);
      return { statusCode: 200, body: JSON.stringify({ episode_id: episode.id, shots_ok: [], shots_failed: [], note: 'ya estaban todas generadas' }) };
    }

    // Se arman TODOS los prompts antes de llamar a Veo: si alguno falla (personaje sin
    // tag, etc.) se aborta sin haber gastado nada.
    const prompts = {};
    const refUrls = {};
    const useRefs = !!(series.story_bible && series.story_bible.rules && series.story_bible.rules.reference_images);
    const useKeyframes = !!(series.story_bible && series.story_bible.rules && series.story_bible.rules.keyframes);
    for (const scene of scenes) {
      prompts[scene.number] = scene.shot
        ? effectiveShotPrompt(scene.shot, characters, series.story_bible)
        : buildPrompt(scene.text, characters, series.story_bible);
      // Memoria visual: cada toma arranca desde su cuadro inicial, que necesita la foto de
      // cara de cada personaje. Si falta una, se aborta aquí, sin gastar nada.
      if (useKeyframes && scene.shot) {
        (scene.shot.characters || []).forEach((name) => {
          const row = characters.find((c) => c.name === name);
          if (!row || !row.reference_image_url) {
            throw new Error(`Falta la foto de cara de "${name}" (toma ${scene.number}). Súbela en el Elenco: el cuadro inicial la necesita.`);
          }
        });
      }
      // Con fotos de referencia activadas, TODAS las tomas deben tener la foto de cada
      // personaje: si falta una, se aborta aquí, antes de gastar en Veo.
      if (useRefs && scene.shot) refUrls[scene.number] = referenceUrlsForShot(scene.shot, characters);
    }
    if (useRefs) console.log(LOG, 'fotos de referencia ACTIVADAS: cada toma lleva la foto de sus personajes.');
    if (useKeyframes) console.log(LOG, 'memoria visual ACTIVADA: cada toma se anima desde su cuadro inicial.');

    await ensureMediaBucket(supabase);
    console.log(LOG, 'bucket "media" listo.');

    await supabase.from('episodes').update({ status: 'generando_media' }).eq('id', episode.id);
    markedGenerating = episode.id;
    console.log(LOG, 'episodio marcado como generando_media. Arrancando', scenes.length, 'tomas con Veo (esto tarda varios minutos)...');

    const total = allScenes.length; // el total real del episodio, no solo lo que falta por generar
    // Secuencial a propósito (no Promise.all): 8 solicitudes simultáneas chocan con la
    // cuota de "requests por minuto" que Google asigna a cuentas de facturación recién
    // activadas (ver 429 RESOURCE_EXHAUSTED). Una por una es más lento pero confiable.

    // Modelo por toma configurable por serie (story_bible.rules.shot_model /
    // cliffhanger_model). Sin configurar = híbrido de siempre: Lite + Fast en el cliffhanger.
    const rules = (series.story_bible && series.story_bible.rules) || {};
    const shotModel = rules.shot_model || 'veo_lite';
    const cliffhangerModel = rules.cliffhanger_model || 'veo_fast';
    console.log(LOG, 'modelos:', shotModel, '(tomas) /', cliffhangerModel, '(cliffhanger)');

    const results = [];
    for (const scene of scenes) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        console.warn(LOG, 'cerca del límite de 15 min de Netlify — me vuelvo a llamar para seguir con las tomas que faltan...');
        await fetch(selfUrl(event, { series: seriesSlug, episode_id: episode.id, continue: '1' }), { method: 'POST' });
        return { statusCode: 202, body: JSON.stringify({ episode_id: episode.id, continued: true, shots_ok_this_run: results.filter((r) => r.status === 'fulfilled').length }) };
      }
      const isCliffhanger = scene.number === total;
      const modelKey = isCliffhanger ? cliffhangerModel : shotModel;
      const prompt = prompts[scene.number];

      console.log(LOG, `toma ${scene.number}/${total} (${modelKey}): arrancando generación con Veo...`);
      try {
        const referenceImages = refUrls[scene.number] ? await loadReferenceImages(refUrls[scene.number]) : [];
        let startImage = null;
        if (useKeyframes && scene.shot) {
          const existingFrame = await loadExistingKeyframe(supabase, episode.id, scene.number);
          const frame = existingFrame || (await createKeyframe(supabase, { series, episode, shot: scene.shot, characters, log: (...a) => console.log(LOG, ...a) }));
          startImage = frame.startImage;
          console.log(LOG, `toma ${scene.number}/${total}: ${existingFrame ? 'usando el cuadro inicial ya guardado' : 'cuadro inicial creado'}.`);
        }
        const { videoBuffer, costUsd, model } = await generateVeoClip({ modelKey, prompt, referenceImages, startImage });
        console.log(LOG, `toma ${scene.number}/${total}: Veo terminó, subiendo a Supabase Storage...`);

        const storagePath = `${series.slug}/ep${episode.episode_number}/shot-${String(scene.number).padStart(2, '0')}.mp4`;
        const publicUrl = await uploadClip(supabase, { path: storagePath, buffer: videoBuffer });

        const { data: asset, error: assetError } = await supabase
          .from('assets')
          .insert({
            episode_id: episode.id,
            kind: 'video_clip',
            model: modelKey,
            shot_number: scene.number,
            storage_path: publicUrl,
            prompt,
            cost_usd: costUsd,
            approved: false
          })
          .select()
          .single();
        if (assetError) throw assetError;

        console.log(LOG, `toma ${scene.number}/${total}: OK ✅ (asset ${asset.id})`);
        results.push({ status: 'fulfilled', value: { shot: scene.number, model, costUsd, assetId: asset.id } });
      } catch (shotErr) {
        console.error(LOG, `toma ${scene.number}/${total}: FALLÓ ❌`, shotErr);
        results.push({ status: 'rejected', reason: shotErr });
      }
    }

    const failures = results.filter((r) => r.status === 'rejected');
    const succeeded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);

    // El episodio queda "en_revision" solo si YA tiene TODAS sus tomas (las de corridas
    // anteriores + las de esta). Si falta alguna (fallo o toma de prueba suelta), vuelve a
    // "guion_generado" y el botón Producir solo genera las que faltan.
    const allDone = doneShots.size + succeeded.length >= total;
    await supabase
      .from('episodes')
      .update({ status: allDone ? 'en_revision' : 'guion_generado' })
      .eq('id', episode.id);

    console.log(
      LOG,
      'terminado. OK:', succeeded.length, '/', total,
      failures.length ? ('— FALLOS: ' + failures.map((f) => f.reason && f.reason.message).join(' | ')) : ''
    );

    // Si TODAS las tomas salieron bien, unimos el video final automáticamente — así el
    // episodio llega a "en_revision" ya listo para el filtro humano, sin un paso manual
    // aparte. Si falla (ffmpeg, red, etc.), no tiramos todo el resultado: las 8 tomas ya
    // están generadas y guardadas de todas formas — el botón "Unir" del dashboard sirve de
    // respaldo para reintentarlo.
    let finalRender = null;
    let mergeError = null;
    if (allDone && failures.length === 0) {
      try {
        console.log(LOG, 'todas las tomas OK — uniendo automáticamente el video final...');
        const { data: freshEpisode, error: freshError } = await supabase
          .from('episodes')
          .select('*, assets(*)')
          .eq('id', episode.id)
          .single();
        if (freshError || !freshEpisode) throw freshError || new Error('No se pudo releer el episodio para unir el video.');
        const mergeResult = await mergeEpisodeVideo(supabase, {
          episode: freshEpisode,
          series,
          log: (...args) => console.log(LOG, '[merge]', ...args)
        });
        finalRender = mergeResult.asset;
        console.log(LOG, 'video final automático listo ✅:', finalRender.storage_path);
      } catch (err) {
        mergeError = err.message;
        console.error(LOG, 'la unión automática del video final falló (las tomas sí quedaron guardadas — usa el botón "Unir" del dashboard para reintentar):', err, err.stderr || '');
      }
    }

    // Nota: en producción, Netlify no devuelve este body a quien llamó la función (las
    // background functions responden 202 de inmediato) — por eso todo lo importante va
    // también a console.log/console.error, que sí se ve en la terminal de `netlify dev`
    // (y en los logs de función en Netlify una vez desplegado).
    return {
      statusCode: failures.length === 0 ? 200 : 207,
      // (allDone=false con 200 = toma de prueba o parcial, sin fallos)
      body: JSON.stringify({
        episode_id: episode.id,
        shots_ok: succeeded,
        shots_failed: failures.map((f) => f.reason && f.reason.message),
        final_render: finalRender,
        merge_error: mergeError
      })
    };
  } catch (err) {
    console.error(LOG, 'ERROR GENERAL:', err);
    // Nunca dejar el episodio trabado en "generando_media" por un error de esta corrida.
    if (markedGenerating) {
      await supabase.from('episodes').update({ status: 'guion_generado' }).eq('id', markedGenerating).then(() => {}, () => {});
    }
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
