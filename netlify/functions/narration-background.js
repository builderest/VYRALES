// POST /.netlify/functions/narration-background
//   { episode_id }               → genera la narración (voz fija) de las tomas que no la tienen
//                                  o cuyo texto/voz cambió
//   { episode_id, shot: n }      → (re)genera solo esa toma, aunque ya exista
// Con story_bible.narration.cast = true dobla TODAS las líneas (personajes, extras y narrador),
// cada quien con su voz fija de story_bible.voice_cast (si falta alguna, se asigna sola).
// Cada frase ~$0.004 (Gemini TTS). Guarda en episodes.shots[n].narration =
//   { url, text, voice, model, seconds, at } y el resultado de la corrida en
//   episodes.validator_report.last_narration_run (el dashboard hace polling).
const { getSupabaseClient } = require('./_supabase');
const { energyScore, synthesize, concatWavs, tightenSpeech, applyVoiceFx, wavSeconds, DEFAULT_VOICE, DEFAULT_STYLE, TTS_MODEL_DEFAULT } = require('./_tts');
const { narrationConfig, narrationLines, castMode } = require('./_series');
const { assignVoices, seriesSpeakers, speakerInfo, actingStyle, fxFor } = require('./_voices');
const { ensureMediaBucket, uploadFile, removeByPublicUrl } = require('./_storage');
const { logSpend } = require('./_spend');

const LOG = '[narration]';
const MAX_COMFORT_S = 7.4;
const FASTER = 'IMPORTANTE: ritmo más ágil y continuo, sin pausas entre palabras; la frase completa debe durar como máximo 6 segundos.';

const TRIM_V = 4; // v4: primera palabra clara (instrucción al TTS); v3: voz más pareja (2 tomas)
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const supabase = getSupabaseClient();
  let episodeId = null;
  const report = async (patch) => {
    if (!episodeId) return;
    const { data: cur } = await supabase.from('episodes').select('validator_report').eq('id', episodeId).single();
    const vr = Object.assign({}, (cur && cur.validator_report) || {}, { last_narration_run: Object.assign({ at: new Date().toISOString() }, patch) });
    await supabase.from('episodes').update({ validator_report: vr }).eq('id', episodeId);
  };
  try {
    const body = JSON.parse(event.body || '{}');
    episodeId = body.episode_id || null;
    const { data: ep, error } = await supabase
      .from('episodes')
      .select('id, episode_number, shots, series_id, series:series_id(id, slug, story_bible)')
      .eq('id', episodeId || '')
      .single();
    if (error || !ep) throw error || new Error('Episodio no encontrado.');
    const sb = (ep.series && ep.series.story_bible) || {};
    const cfg = narrationConfig(sb);
    if (!cfg) throw new Error('Esta serie no tiene narrador con voz fija activado (story_bible.narration).');
    const voice = cfg.voice || DEFAULT_VOICE;
    const model = cfg.model || TTS_MODEL_DEFAULT;
    const style = cfg.style || DEFAULT_STYLE;
    const cast = castMode(sb);
    let characters = [];
    if (cast) {
      // Voces fijas para todos: se asegura que cada hablante tenga voz (se asigna sola, gratis).
      const { data: chars } = await supabase.from('characters').select('name, role, fixed_prompt_tag, profile').eq('series_id', ep.series.id);
      characters = chars || [];
      const { data: allEps } = await supabase.from('episodes').select('shots').eq('series_id', ep.series.id);
      const speakers = seriesSpeakers({ episodes: allEps || [], characters, storyBible: sb });
      const vc = Object.assign({}, sb.voice_cast || {});
      const missing = speakers.filter((x) => !vc[x.key]);
      if (missing.length) {
        const assigned = assignVoices(speakers, vc);
        missing.forEach((x) => { vc[x.key] = { voice: assigned[x.key], auto: true, fx: fxFor(x.key, x) }; });
        const { data: freshSeries } = await supabase.from('series').select('story_bible').eq('id', ep.series.id).single();
        const nsb = Object.assign({}, (freshSeries && freshSeries.story_bible) || sb, { voice_cast: vc });
        await supabase.from('series').update({ story_bible: nsb }).eq('id', ep.series.id);
        console.log(LOG, 'voces asignadas:', missing.map((x) => x.key + '→' + vc[x.key].voice).join(', '));
      }
      sb.voice_cast = vc;
    }
    // Voz de cada línea: la del personaje (modo doblaje) o la única del narrador.
    const voiceFor = (speaker) => (cast && sb.voice_cast && sb.voice_cast[speaker] && sb.voice_cast[speaker].voice) || voice;
    const lineKey = (s) => narrationLines(s, sb).map((d) => (cast ? d.speaker + ': ' : '') + d.line).join(' | ').trim();
    const fxOf = (speaker) => (cast && sb.voice_cast && sb.voice_cast[speaker] && sb.voice_cast[speaker].fx) || '';
    const voiceKey = (s) => cast ? narrationLines(s, sb).map((d) => voiceFor(d.speaker) + (fxOf(d.speaker) ? ':' + fxOf(d.speaker) : '')).join('+') : voice;

    const only = body.shot ? Number(body.shot) : null;
    const targets = (ep.shots || []).filter((s) => {
      if (only && s.n !== only) return false;
      if (only && !body.if_stale) return true;
      const text = lineKey(s);
      if (!text) return false;
      const n = s.narration;
      // trim: versión del recorte de silencios (v2, oct-2026: ya no se come la primera sílaba).
      return !(n && n.url && n.text === text && n.voice === voiceKey(s) && n.trim === TRIM_V);
    });
    if (only && !targets.length && !body.if_stale) throw new Error(`El episodio no tiene la toma ${only}.`);
    console.log(LOG, `EP${ep.episode_number}: ${targets.length} narraciones por generar (voz ${voice}).`);
    await report({ status: 'running', total: targets.length, done: 0, voice });
    await ensureMediaBucket(supabase);

    const created = [];
    const failed = [];
    for (const shot of targets) {
      const text = lineKey(shot);
      const lines = narrationLines(shot, sb);
      if (!text) { failed.push({ shot: shot.n, error: 'La toma no tiene línea para doblar.' }); continue; }
      try {
        // Una síntesis por línea (cada personaje con su voz y su actuación); si hay dos
        // líneas en la toma se unen con una pausa corta.
        const synthLine = async (d, extra) => {
          const v = voiceFor(d.speaker);
          const st = cast
            ? actingStyle({ info: speakerInfo(d.speaker, characters, sb), shot, override: sb.voice_cast[d.speaker] && sb.voice_cast[d.speaker].style })
            : style;
          const r = await synthesize({ text: d.line, voice: v, style: st + (extra ? ' ' + extra : ''), model, log: (...a) => console.log(LOG, ...a) });
          await logSpend(supabase, { seriesId: ep.series.id, episodeId: ep.id, shotNumber: shot.n, kind: 'narration', model: 'tts_' + model, costUsd: r.costUsd, note: v + (cast ? ' · ' + d.speaker : '') + (extra ? ' (reintento ritmo)' : '') });
          return r;
        };
        const parts = [];
        for (const d of (cast ? lines : [{ speaker: 'Narrador', line: lines.map((x) => x.line).join(' ') }])) {
          let r1 = await synthLine(d);
          const tightSecs = (r) => wavSeconds(tightenSpeech(r.wav, () => {}));
          // Videos narrados (curiosidades…): el TTS da una energía distinta en cada llamada y algunas frases
          // "perdían el estilo". Se hacen 2 tomas y se queda la más intensa y pareja (~$0.003 más por frase).
          // La toma de video se alarga sola hasta 16 s, así que aquí no se pide ritmo más rápido.
          if (sb.format === 'narrado_unico') {
            const r2 = await synthLine(d);
            const s1 = energyScore(r1.wav), s2 = energyScore(r2.wav);
            console.log(LOG, `toma ${shot.n}: energía de la voz ${s1.toFixed(1)} vs ${s2.toFixed(1)} → se queda la ${s2 > s1 ? '2ª' : '1ª'}`);
            if (s2 > s1) r1 = r2;
            parts.push(r1);
            continue;
          }
          // Si aun sin pausas no cabe cómodo (diálogo: ~6.5 s de boca; narrador: 7.4 s), un
          // reintento con ritmo más ágil (~$0.004 más).
          const limit = (cast ? 6.6 : MAX_COMFORT_S) / (cast ? lines.length : 1);
          if (tightSecs(r1) > limit) {
            console.log(LOG, `toma ${shot.n}: ${r1.seconds.toFixed(1)} s es largo; reintento con ritmo más ágil...`);
            const r2 = await synthLine(d, FASTER);
            if (tightSecs(r2) < tightSecs(r1)) r1 = r2;
          }
          parts.push(r1);
        }
        // Cada línea sin pausas largas (el TTS dramatiza con silencios de 0.5–0.7 s) y unidas.
        const lineSpeakers = cast ? lines.map((d) => d.speaker) : [null];
        const wav = concatWavs(parts.map((p, i) => applyVoiceFx(tightenSpeech(p.wav, (...x) => console.log(LOG, ...x)), fxOf(lineSpeakers[i]), (...x) => console.log(LOG, ...x))));
        let r = { wav, seconds: wavSeconds(wav) };
        const url = await uploadFile(supabase, {
          path: `${ep.series.slug}/ep${ep.episode_number}/narr-${String(shot.n).padStart(2, '0')}-v${Date.now()}.wav`,
          buffer: r.wav,
          contentType: 'audio/wav'
        });
        // Se relee el episodio justo antes de escribir: solo se toca la narración de ESTA toma
        // (otra corrida o el editor de prompts pudieron cambiar otras tomas mientras tanto).
        const { data: fresh } = await supabase.from('episodes').select('shots').eq('id', ep.id).single();
        const shots = (fresh && fresh.shots) || [];
        const idx = shots.findIndex((s) => s.n === shot.n);
        if (idx === -1) throw new Error('La toma desapareció del episodio.');
        const old = shots[idx].narration && shots[idx].narration.url;
        shots[idx] = Object.assign({}, shots[idx], { narration: { url, text, voice: voiceKey(shot), trim: TRIM_V, model, seconds: Math.round(r.seconds * 100) / 100, speakers: cast ? lines.map((d) => d.speaker) : undefined, at: new Date().toISOString() } });
        const { error: uErr } = await supabase.from('episodes').update({ shots }).eq('id', ep.id);
        if (uErr) throw uErr;
        if (old && old !== url) await removeByPublicUrl(supabase, old, (...a) => console.log(LOG, ...a));
        created.push({ shot: shot.n, seconds: Math.round(r.seconds * 10) / 10 });
        console.log(LOG, `toma ${shot.n}: ${r.seconds.toFixed(1)} s ✅`);
        await report({ status: 'running', total: targets.length, done: created.length + failed.length, voice });
      } catch (err) {
        console.error(LOG, `toma ${shot.n}: ERROR`, err.message);
        failed.push({ shot: shot.n, error: String(err.message || err).slice(0, 200) });
      }
    }
    // Aviso: más de 7.4 s no cabe cómodo en una toma de 8 s (el render la acelera hasta 1.2x).
    const long = created.filter((c) => c.seconds > 7.4).map((c) => c.shot);
    await report({ status: failed.length && !created.length ? 'error' : 'done', total: targets.length, created, failed, long, voice });
    console.log(LOG, `listo: ${created.length} creadas, ${failed.length} con error.`);
    return { statusCode: 200, body: JSON.stringify({ created, failed, long }) };
  } catch (err) {
    console.error(LOG, 'ERROR:', err.message);
    await report({ status: 'error', error: String(err.message || err).slice(0, 300) }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
