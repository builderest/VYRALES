// VOZ CONTINUA (Franklin, oct-2026): "un video continuo y luego se crea la voz de todo al final; una sola
// voz, no 12 por escenas". Con story_bible.narration.mode = 'continuous':
//   - el texto completo (continuity.voice_text, o las líneas de las tomas unidas) se narra en UNA sola llamada
//     al TTS (2 tomas, se queda la más intensa) → continuity.voice = { url, seconds, text, trim, segments }
//   - segments = tramos de voz reales (silencedetect) emparejados con los pedazos del texto (por puntuación),
//     para poner el texto en pantalla al mismo tiempo que se dice
//   - las tomas se encadenan (el cuadro final de una es el inicial de la siguiente) y duran lo que la voz.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { energyScore, synthesize, tightenSpeech, wavSeconds } = require('./_tts');
const { ensureMediaBucket, uploadFile, removeByPublicUrl } = require('./_storage');
const { logSpend } = require('./_spend');
const VOICE_V = 1;
const LEAD = 0.6; // la voz empieza a los 0.6 s del video
const TAIL = 1.4; // y el video sigue 1.4 s después de la última palabra

const continuousMode = (sb) => !!(sb && sb.narration && sb.narration.engine === 'gemini_tts' && sb.narration.mode === 'continuous');
function voiceText(episode) {
  const c = (episode && episode.continuity) || {};
  if (c.voice_text && String(c.voice_text).trim()) return String(c.voice_text).trim();
  return (episode.shots || []).slice().sort((a, b) => a.n - b.n)
    .flatMap((s) => (Array.isArray(s.dialogue) ? s.dialogue : s.dialogue ? [s.dialogue] : []).map((d) => d && d.line).filter(Boolean))
    .join(' ').replace(/\s*…\s*/g, ' ').replace(/\s+/g, ' ').trim();
}
// Pedazos del texto para la pantalla: se corta en . , ; : ? ! (quedan con su puntuación).
function textChunks(text) {
  return (String(text).match(/[^.,;:?!¿¡]+[.,;:?!]*/g) || [text]).map((x) => x.trim()).filter(Boolean);
}
function ffmpegBin() { try { return require('ffmpeg-static'); } catch (_) { return 'ffmpeg'; } }
function speechSpans(file, seconds) {
  return new Promise((res) => execFile(ffmpegBin(), ['-i', file, '-af', 'silencedetect=noise=-38dB:d=0.12', '-f', 'null', '-'], (e, so, se) => {
    const out = String(se || '');
    const sil = [];
    let st = null;
    for (const line of out.split(/\r?\n/)) {
      const a = /silence_start: ([0-9.]+)/.exec(line); if (a) st = Number(a[1]);
      const b = /silence_end: ([0-9.]+)/.exec(line); if (b && st != null) { sil.push([st, Number(b[1])]); st = null; }
    }
    if (st != null) sil.push([st, seconds]);
    const spans = [];
    let t = 0;
    for (const [s0, s1] of sil) { if (s0 - t > 0.08) spans.push([t, s0]); t = s1; }
    if (seconds - t > 0.08) spans.push([t, seconds]);
    res(spans);
  }));
}
// Empareja pedazos de texto con el tiempo: si hay tantos tramos de voz como pedazos, 1 a 1; si no, el
// tiempo total de voz se reparte según el largo de cada pedazo.
function alignChunks(chunks, spans, seconds) {
  const s0 = spans.length ? spans[0][0] : 0;
  const s1 = spans.length ? spans[spans.length - 1][1] : seconds;
  if (spans.length === chunks.length) return chunks.map((text, i) => ({ text, start: spans[i][0], end: spans[i][1] }));
  const w = chunks.map((c) => c.replace(/[^\p{L}\p{N}]/gu, '').length + 2);
  const tot = w.reduce((a, b) => a + b, 0) || 1;
  let t = s0;
  return chunks.map((text, i) => { const d = (w[i] / tot) * (s1 - s0); const seg = { text, start: t, end: t + d }; t += d; return seg; });
}

async function ensureFullVoice(supabase, { episode, series, log = console.log, force = false }) {
  const sb = series.story_bible || {};
  const cfg = sb.narration || {};
  const text = voiceText(episode);
  if (!text) throw new Error('No hay texto para la voz (continuity.voice_text o líneas de las tomas).');
  const cur = (episode.continuity || {}).voice;
  if (!force && cur && cur.url && cur.text === text && cur.v === VOICE_V && cur.voice === (cfg.voice || '')) return cur;
  log('voz continua: narrando TODO el texto en una sola toma de voz...');
  const style = (cfg.style || '') + ' Es UNA sola frase continua: dila de corrido, con naturalidad, sin cortes ni pausas raras; solo una pausa mínima en cada punto o coma.';
  const takes = [];
  for (let k = 0; k < 2; k++) {
    const r = await synthesize({ text, voice: cfg.voice, style, model: cfg.model, log });
    await logSpend(supabase, { seriesId: series.id, episodeId: episode.id, shotNumber: 0, kind: 'narration', model: 'tts_' + r.model, costUsd: r.costUsd, note: 'voz continua' });
    takes.push(r);
  }
  const best = energyScore(takes[1].wav) > energyScore(takes[0].wav) ? takes[1] : takes[0];
  const wav = tightenSpeech(best.wav, log);
  const seconds = Math.round(wavSeconds(wav) * 100) / 100;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-voice-'));
  const f = path.join(dir, 'v.wav');
  fs.writeFileSync(f, wav);
  const spans = await speechSpans(f, seconds);
  fs.rmSync(dir, { recursive: true, force: true });
  const segments = alignChunks(textChunks(text), spans, seconds).map((x) => ({ text: x.text, start: Math.round(x.start * 100) / 100, end: Math.round(x.end * 100) / 100 }));
  await ensureMediaBucket(supabase);
  const url = await uploadFile(supabase, { path: `${series.slug}/ep${episode.episode_number}/voz-completa-v${Date.now()}.wav`, buffer: wav, contentType: 'audio/wav' });
  const voice = { url, seconds, text, v: VOICE_V, voice: cfg.voice || '', segments, at: new Date().toISOString() };
  const { data: fresh } = await supabase.from('episodes').select('continuity').eq('id', episode.id).single();
  await supabase.from('episodes').update({ continuity: Object.assign({}, (fresh && fresh.continuity) || {}, { voice }) }).eq('id', episode.id);
  episode.continuity = Object.assign({}, episode.continuity || {}, { voice });
  if (cur && cur.url && cur.url !== url) await removeByPublicUrl(supabase, cur.url, log).catch(() => {});
  log(`voz continua lista: ${seconds} s, ${segments.length} pedazos de texto:`, segments.map((s) => `${s.start}-${s.end} "${s.text}"`).join(' | '));
  return voice;
}

// Duración de cada toma para que el video entero dure lo que la voz (+ entrada y salida).
// shot.weight (opcional) da más tiempo a una toma. LTX: 3–16 s enteros.
function shotSecondsFor(voice, shots) {
  const total = LEAD + Number(voice.seconds || 0) + TAIL;
  const ws = shots.map((s) => Number(s.weight) > 0 ? Number(s.weight) : 1);
  const tot = ws.reduce((a, b) => a + b, 0) || 1;
  return shots.map((s, i) => Math.max(3, Math.min(16, Math.round((ws[i] / tot) * total))));
}

module.exports = { continuousMode, voiceText, textChunks, ensureFullVoice, shotSecondsFor, LEAD, TAIL };
