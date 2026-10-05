// POST /.netlify/functions/narration-background
//   { episode_id }               → genera la narración (voz fija) de las tomas que no la tienen
//                                  o cuyo texto/voz cambió
//   { episode_id, shot: n }      → (re)genera solo esa toma, aunque ya exista
// Cada frase ~$0.004 (Gemini TTS). Guarda en episodes.shots[n].narration =
//   { url, text, voice, model, seconds, at } y el resultado de la corrida en
//   episodes.validator_report.last_narration_run (el dashboard hace polling).
const { getSupabaseClient } = require('./_supabase');
const { synthesize, DEFAULT_VOICE, DEFAULT_STYLE, TTS_MODEL_DEFAULT } = require('./_tts');
const { narrationConfig, narrationLines } = require('./_series');
const { ensureMediaBucket, uploadFile, removeByPublicUrl } = require('./_storage');
const { logSpend } = require('./_spend');

const LOG = '[narration]';
const MAX_COMFORT_S = 7.4;
const FASTER = 'IMPORTANTE: ritmo más ágil y continuo, sin pausas entre palabras; la frase completa debe durar como máximo 6 segundos.';

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
      .select('id, episode_number, shots, series:series_id(id, slug, story_bible)')
      .eq('id', episodeId || '')
      .single();
    if (error || !ep) throw error || new Error('Episodio no encontrado.');
    const sb = (ep.series && ep.series.story_bible) || {};
    const cfg = narrationConfig(sb);
    if (!cfg) throw new Error('Esta serie no tiene narrador con voz fija activado (story_bible.narration).');
    const voice = cfg.voice || DEFAULT_VOICE;
    const model = cfg.model || TTS_MODEL_DEFAULT;
    const style = cfg.style || DEFAULT_STYLE;

    const only = body.shot ? Number(body.shot) : null;
    const targets = (ep.shots || []).filter((s) => {
      if (only) return s.n === only;
      const text = narrationLines(s, sb).map((d) => d.line).join(' ').trim();
      if (!text) return false;
      const n = s.narration;
      return !(n && n.url && n.text === text && n.voice === voice);
    });
    if (only && !targets.length) throw new Error(`El episodio no tiene la toma ${only}.`);
    console.log(LOG, `EP${ep.episode_number}: ${targets.length} narraciones por generar (voz ${voice}).`);
    await report({ status: 'running', total: targets.length, done: 0, voice });
    await ensureMediaBucket(supabase);

    const created = [];
    const failed = [];
    for (const shot of targets) {
      const text = narrationLines(shot, sb).map((d) => d.line).join(' ').trim();
      if (!text) { failed.push({ shot: shot.n, error: 'La toma no tiene línea del narrador.' }); continue; }
      try {
        let r = await synthesize({ text, voice, style, model, log: (...a) => console.log(LOG, ...a) });
        await logSpend(supabase, { seriesId: ep.series.id, episodeId: ep.id, shotNumber: shot.n, kind: 'narration', model: 'tts_' + model, costUsd: r.costUsd, note: voice });
        // Si no cabe cómodo en la toma (8 s), un reintento con ritmo más ágil (~$0.004 más).
        if (r.seconds > MAX_COMFORT_S) {
          console.log(LOG, `toma ${shot.n}: ${r.seconds.toFixed(1)} s es largo; reintento con ritmo más ágil...`);
          const r2 = await synthesize({ text, voice, style: style + ' ' + FASTER, model, log: (...a) => console.log(LOG, ...a) });
          await logSpend(supabase, { seriesId: ep.series.id, episodeId: ep.id, shotNumber: shot.n, kind: 'narration', model: 'tts_' + model, costUsd: r2.costUsd, note: voice + ' (reintento ritmo)' });
          if (r2.seconds < r.seconds) r = r2;
        }
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
        shots[idx] = Object.assign({}, shots[idx], { narration: { url, text, voice, model, seconds: Math.round(r.seconds * 100) / 100, at: new Date().toISOString() } });
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
