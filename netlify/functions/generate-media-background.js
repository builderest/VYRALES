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
const { ensureMediaBucket, uploadClip, storeClip } = require('./_storage');
const { generateVeoClip, loadReferenceImages } = require('./_veo');
const { mergeEpisodeVideo } = require('./_merge');
const { effectiveShotPrompt, referenceUrlsForShot, videoGeneratesAudio, narrationConfig } = require('./_series');
const { createKeyframe, loadExistingKeyframe } = require('./_keyframe');
const { logSpend } = require('./_spend');
const { ltxPromptFor, ltxNegativeFor } = require('./_king');

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

// Botón "Detener" del dashboard (stop-generation.js): marca validator_report.stop_requested_at.
// Se revisa ANTES de cada toma/cuadro: la que ya está en curso termina (y se cobra), las demás no.
async function stopRequested(supabase, episodeId, startedAt) {
  const { data } = await supabase.from('episodes').select('validator_report').eq('id', episodeId).single();
  const at = data && data.validator_report && data.validator_report.stop_requested_at;
  return !!(at && new Date(at).getTime() >= startedAt - 60000);
}

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
  // frames_only: genera SOLO los cuadros iniciales que falten (sin Veo), para revisarlos
  // todos antes de gastar en video. ~$0.067 por cuadro.
  const framesOnly = body.frames_only === true || qs.frames_only === '1';
  // model: forzar el modelo de Veo SOLO en esta corrida (botón del dashboard), p. ej. usar
  // Fast cuando la cuota diaria de Lite se acabó. No cambia la configuración de la serie.
  const ALLOWED_MODELS = ['veo_lite', 'veo_fast', 'veo_standard'];
  const modelOverride = ALLOWED_MODELS.includes(body.model || qs.model) ? (body.model || qs.model) : null;
  // provider: 'google' (API de Gemini, cuota diaria) o 'fal' (fal.ai, sin cuota diaria).
  const provider = ['google', 'fal', 'king'].includes(body.provider || qs.provider) ? (body.provider || qs.provider) : (process.env.VIDEO_PROVIDER || 'google');

  let markedGenerating = null; // id del episodio que ESTA corrida marcó como generando_media
  console.log(LOG, 'arrancó. series=', seriesSlug, 'episode_id=', episodeId || '(ninguno, toma el siguiente en guion_generado)', isContinuation ? '(continuación)' : '');

  try {
    const { data: series, error: seriesError } = await supabase
      .from('series')
      .select('id, slug, title, genre, story_bible, visual_memory')
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

    if (framesOnly) {
      if (!useKeyframes) throw new Error('Esta serie no usa memoria visual (rules.keyframes = false).');
      await supabase.from('episodes').update({ status: 'generando_media' }).eq('id', episode.id);
      markedGenerating = episode.id;
      let made = 0;
      const failed = [];
      let stoppedByUser = false;
      for (const scene of scenes) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) break;
        if (await loadExistingKeyframe(supabase, episode.id, scene.number)) continue;
        if (await stopRequested(supabase, episode.id, startedAt)) { stoppedByUser = true; console.warn(LOG, 'DETENIDO por el usuario antes del cuadro', scene.number); break; }
        try {
          await createKeyframe(supabase, { series, episode, shot: scene.shot, characters, log: (...a) => console.log(LOG, ...a) });
          made++;
        } catch (err) {
          console.error(LOG, `cuadro de la toma ${scene.number} FALLÓ:`, err.message);
          failed.push({ shot: scene.number, error: String(err.message || err).slice(0, 300) });
        }
      }
      // Resultado de la corrida guardado en el episodio para que el dashboard lo muestre
      // (antes solo quedaba en la terminal de netlify dev).
      const report = Object.assign({}, episode.validator_report || {}, {
        last_frames_run: { at: new Date().toISOString(), created: made, failed, stopped_by_user: stoppedByUser }
      });
      await supabase.from('episodes').update({ status: 'guion_generado', validator_report: report }).eq('id', episode.id);
      markedGenerating = null;
      console.log(LOG, 'cuadros listos:', made, failed.length ? '— fallaron: ' + failed.map((f) => f.shot + ' (' + f.error + ')').join(', ') : '');
      return { statusCode: 200, body: JSON.stringify({ frames_created: made, frames_failed: failed }) };
    }

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
    const shotModel = modelOverride || rules.shot_model || 'veo_lite';
    const cliffhangerModel = modelOverride || rules.cliffhanger_model || 'veo_fast';
    if (modelOverride) console.log(LOG, 'modelo forzado para esta corrida:', modelOverride);
    console.log(LOG, 'proveedor de video:', provider === 'fal' ? 'fal.ai (sin cuota diaria)' : 'Google (API de Gemini)');
    console.log(LOG, 'audio del video:', videoGeneratesAudio(series.story_bible) ? 'con audio de Veo' : 'SIN audio (narrador TTS + música en el render)');
    console.log(LOG, 'modelos:', shotModel, '(tomas) /', cliffhangerModel, '(cliffhanger)');

    // VOZ CONTINUA: primero la voz completa (una sola), y cada toma dura su parte de esa voz.
    const VF = require('./_voice_full');
    const continuous = useKeyframes && VF.continuousMode(series.story_bible);
    let prevEnd = null; // cuadro final de la toma anterior (encadenado)
    let firstStart = null; // primer cuadro del video (ancla del personaje)
    if (continuous) {
      const voice = await VF.ensureFullVoice(supabase, { episode, series, log: (...a) => console.log(LOG, ...a) });
      const ordered = allScenes.filter((x) => x.shot).map((x) => x.shot);
      const secs = VF.shotSecondsFor(voice, ordered);
      const byN = {}; ordered.forEach((sh, i) => { byN[sh.n] = secs[i]; });
      allScenes.forEach((x) => { if (x.shot && byN[x.shot.n]) x.shot.seconds = byN[x.shot.n]; });
      const { data: fr } = await supabase.from('episodes').select('shots').eq('id', episode.id).single();
      await supabase.from('episodes').update({ shots: (fr.shots || []).map((x) => (byN[x.n] ? Object.assign({}, x, { seconds: byN[x.n] }) : x)) }).eq('id', episode.id);
      console.log(LOG, 'voz continua:', voice.seconds, 's → tomas de', ordered.map((x) => byN[x.n] + ' s').join(' + '));
      // Si se retoma una producción a medias: el final de la última toma ya hecha.
      const firstTodo = scenes[0] && scenes[0].number;
      const prevShot = firstTodo ? (allScenes.find((x) => x.number === firstTodo - 1) || {}).shot : null;
      if (prevShot && prevShot.end_frame_url) { const [im] = await require('./_veo').loadReferenceImages([prevShot.end_frame_url]); prevEnd = im || null; }
    }

    const results = [];
    let quotaStop = null;
    let stoppedByUser = false;
    for (const scene of scenes) {
      if (await stopRequested(supabase, episode.id, startedAt)) {
        stoppedByUser = true;
        console.warn(LOG, 'DETENIDO por el usuario antes de la toma', scene.number);
        break;
      }
      if (!process.env.VYRALES_LOCAL_RUN && Date.now() - startedAt > TIME_BUDGET_MS) {
        console.warn(LOG, 'cerca del límite de 15 min de Netlify — me vuelvo a llamar para seguir con las tomas que faltan...');
        await fetch(selfUrl(event, Object.assign({ series: seriesSlug, episode_id: episode.id, continue: '1', provider }, modelOverride ? { model: modelOverride } : {})), { method: 'POST', headers: process.env.DASHBOARD_KEY ? { 'x-vyrales-key': process.env.DASHBOARD_KEY } : {} });
        return { statusCode: 202, body: JSON.stringify({ episode_id: episode.id, continued: true, shots_ok_this_run: results.filter((r) => r.status === 'fulfilled').length }) };
      }
      const isCliffhanger = scene.number === total;
      const modelKey = isCliffhanger ? cliffhangerModel : shotModel;
      const prompt = prompts[scene.number];

      console.log(LOG, `toma ${scene.number}/${total} (${modelKey}): arrancando generación con Veo...`);
      try {
        const referenceImages = refUrls[scene.number] ? await loadReferenceImages(refUrls[scene.number]) : [];
        let startImage = null;
        let endImage = null;
        if (useKeyframes && scene.shot) {
          let existingFrame = await loadExistingKeyframe(supabase, episode.id, scene.number);
          // Voz continua: el cuadro inicial de esta toma ES el final de la anterior (un solo movimiento).
          // shot.chain === false: CORTE a otra escena (otro tema); empieza con su propio cuadro inicial.
          // Documentales (narrado_unico): una toma con su propio start_en es un CORTE, no se encadena.
          const docCut = series.story_bible && series.story_bible.format === 'narrado_unico' && series.story_bible.subtitle_style !== 'poster' && !!(scene.shot.start_en && scene.shot.start_en.trim());
          if (continuous && !existingFrame && prevEnd && scene.shot.chain !== false && !docCut) {
            await require('./_keyframe').storeKeyframeImage(supabase, { series, episode, shotN: scene.number, image: prevEnd, log: (...a) => console.log(LOG, ...a) });
            existingFrame = { startImage: prevEnd, chained: true };
          }
          const frame = existingFrame || (await createKeyframe(supabase, { series, episode, shot: scene.shot, characters, log: (...a) => console.log(LOG, ...a) }));
          startImage = frame.startImage;
          console.log(LOG, `toma ${scene.number}/${total}: ${existingFrame ? 'usando el cuadro inicial ya guardado' : 'cuadro inicial creado'}.`);
          // Cuadro FINAL (solo LTX en king y si la toma trae end_en): la toma termina donde dice el guion.
          if (provider === 'king' && scene.shot.end_en) {
            // Ancla = primer cuadro de ESTA cadena de tomas (se reinicia en cada corte chain:false).
            if (continuous) {
              if (scene.number === 1 || scene.shot.chain === false || docCut) firstStart = startImage;
              else if (!firstStart) {
                // retomando a medias: buscar hacia atrás el inicio de la cadena
                let k = scene.number; while (k > 1 && ((allScenes.find((x) => x.number === k) || {}).shot || {}).chain !== false) k--;
                const fk = await loadExistingKeyframe(supabase, episode.id, k); firstStart = fk && fk.startImage;
              }
            }
            endImage = await require('./_keyframe').endFrameFor(supabase, { series, episode, shot: scene.shot, startImage, anchorImage: continuous && !docCut && scene.number > 1 && scene.shot.chain !== false ? firstStart : null, fresh: !existingFrame || !!existingFrame.chained, log: (...a) => console.log(LOG, ...a) });
          }
        }
        let veo;
        try {
          veo = await generateVeoClip({ modelKey, prompt, durationSeconds: provider === 'king' && scene.shot ? require('./_king').kingSecondsFor(scene.shot) : 8, referenceImages, startImage, endImage, endText: scene.shot && scene.shot.end_en, provider, generateAudio: videoGeneratesAudio(series.story_bible), ltxPrompt: provider === 'king' && scene.shot ? ltxPromptFor(scene.shot, series.story_bible) : null, ltxNegative: provider === 'king' && scene.shot ? ltxNegativeFor(scene.shot, series.story_bible) : null, log: (...a) => console.log(LOG, ...a) });
        } catch (vErr) {
          // Filtro de contenido de fal (Job T13: rechazó 5 veces el mismo cuadro; con un cuadro
          // nuevo de otra composición pasó a la primera). Se rehace el cuadro UNA vez (~$0.067,
          // los rechazos no cobran) con encuadre más abierto y se reintenta.
          const flagged = /content checker|content_policy|did not generate the expected output|unsafe/i.test(String(vErr.message || ''));
          if (!(flagged && useKeyframes && scene.shot)) throw vErr;
          console.warn(LOG, `toma ${scene.number}/${total}: el filtro de contenido rechazó la toma; rehago el cuadro inicial con otra composición y reintento una vez...`);
          const alt = Object.assign({}, scene.shot, { start_en: String(scene.shot.start_en || '').replace(/\.?\s*$/, '.') + ' Alternate composition: a slightly wider, calm framing with the characters a little farther from the camera, modest relaxed poses, clothing neat and covering the body.' });
          const frame2 = await createKeyframe(supabase, { series, episode, shot: alt, characters, log: (...a) => console.log(LOG, ...a) });
          veo = await generateVeoClip({ modelKey, prompt, durationSeconds: provider === 'king' && scene.shot ? require('./_king').kingSecondsFor(scene.shot) : 8, referenceImages, startImage: frame2.startImage, provider, generateAudio: videoGeneratesAudio(series.story_bible), ltxPrompt: provider === 'king' && scene.shot ? ltxPromptFor(scene.shot, series.story_bible) : null, ltxNegative: provider === 'king' && scene.shot ? ltxNegativeFor(scene.shot, series.story_bible) : null, log: (...a) => console.log(LOG, ...a) });
        }
        const { videoBuffer, costUsd, model } = veo;
        await logSpend(supabase, { seriesId: series.id, episodeId: episode.id, shotNumber: scene.number, kind: 'video', model: provider === 'fal' ? 'fal_' + modelKey : provider === 'king' ? 'ltx_king' : modelKey, costUsd, note: provider === 'fal' ? 'fal.ai' : provider === 'king' ? 'PC king (gratis)' : undefined });
        console.log(LOG, `toma ${scene.number}/${total}: Veo terminó, guardando${veo.falUrl ? ' (queda en fal.ai, sin copiar a Supabase)' : ' en Supabase Storage'}...`);

        const storagePath = `${series.slug}/ep${episode.episode_number}/shot-${String(scene.number).padStart(2, '0')}.mp4`;
        const publicUrl = await storeClip(supabase, { veo, path: storagePath });

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
        if (continuous) prevEnd = endImage || await require('./_keyframe').lastFrameOf(videoBuffer).catch(() => null);
        results.push({ status: 'fulfilled', value: { shot: scene.number, model, costUsd, assetId: asset.id } });
        // Voces fijas: la voz de ESTA toma se genera junto con su video (~$0.004), así cada
        // toma ya suena en la vista previa mientras avanza la producción. Un fallo de voz no
        // detiene el video (al unir se reintenta).
        if (narrationConfig(series.story_bible) && !continuous) {
          try {
            const { handler: narrate } = require('./narration-background');
            const nr = await narrate({ httpMethod: 'POST', body: JSON.stringify({ episode_id: episode.id, shot: scene.number, if_stale: true }) });
            console.log(LOG, `toma ${scene.number}/${total}: voz`, nr.statusCode === 200 ? 'lista ✅' : nr.body);
          } catch (err) { console.error(LOG, `toma ${scene.number}/${total}: la voz falló (se reintenta al unir):`, err.message); }
        }
      } catch (shotErr) {
        console.error(LOG, `toma ${scene.number}/${total}: FALLÓ ❌`, shotErr.code === 'VEO_QUOTA' ? shotErr.message : shotErr);
        results.push({ status: 'rejected', reason: shotErr });
        if (shotErr.code === 'VEO_QUOTA') {
          // Sin cuota no tiene sentido seguir: las demás tomas fallarían igual.
          quotaStop = { at: new Date().toISOString(), shot: scene.number, message: shotErr.message };
          console.warn(LOG, 'cuota de Veo agotada: me detengo aquí. Las tomas que faltan se generan con "Producir" más tarde.');
          break;
        }
      }
    }

    const failures = results.filter((r) => r.status === 'rejected');
    const succeeded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);

    // El episodio queda "en_revision" solo si YA tiene TODAS sus tomas (las de corridas
    // anteriores + las de esta). Si falta alguna (fallo o toma de prueba suelta), vuelve a
    // "guion_generado" y el botón Producir solo genera las que faltan.
    const allDone = doneShots.size + succeeded.length >= total;
    // Resultado de la corrida guardado en el episodio para que el dashboard lo muestre.
    const lastRun = {
      at: new Date().toISOString(),
      created: succeeded.length,
      failed: failures.filter((f) => !(f.reason && f.reason.code === 'VEO_QUOTA')).map((f) => String((f.reason && f.reason.message) || f.reason).slice(0, 300)),
      quota_stop: quotaStop,
      stopped_by_user: stoppedByUser
    };
    await supabase
      .from('episodes')
      .update({ status: allDone ? 'en_revision' : 'guion_generado', validator_report: Object.assign({}, episode.validator_report || {}, { last_video_run: lastRun }) })
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
        // Automático: textos de publicación (descripciones, hashtags, título YouTube) y portada
        // (~$0.001). Publicar en las redes sigue siendo un botón: es público y no se deshace.
        try {
          const { handler: makePackage } = require('./publish-package-background');
          const pr = await makePackage({ httpMethod: 'POST', body: JSON.stringify({ episode_id: episode.id }) });
          console.log(LOG, 'paquete de publicación:', pr.statusCode === 200 ? 'listo ✅' : pr.body);
        } catch (err) { console.error(LOG, 'no se pudo preparar el paquete de publicación (usa el botón):', err.message); }
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
