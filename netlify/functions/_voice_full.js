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
const VOICE_V = 5; // v3: textos alineados con las pausas reales (DP); v2: // v2: pausas entre frases recortadas a 0.12 s (Franklin: "las pausas son muy grandes")
const LEAD = 0.6; // la voz empieza a los 0.6 s del video
const TAIL = 1.4; // y el video sigue 1.4 s después de la última palabra


// Pausas cortas: cualquier silencio de más de 0.15 s queda en 0.12 s (la frase se dice de corrido).
function shortPauses(wav) {
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-pause-'));
  const a = path.join(dir, 'a.wav'), b = path.join(dir, 'b.wav');
  fs.writeFileSync(a, wav);
  try {
    execFileSync(ffmpegBin(), ['-y', '-loglevel', 'error', '-i', a, '-af', 'silenceremove=start_periods=1:start_silence=0.12:start_threshold=-50dB:stop_periods=-1:stop_duration=0.15:stop_silence=0.12:stop_threshold=-40dB', b], { stdio: 'pipe' });
    return fs.readFileSync(b);
  } catch (_) { return wav; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// Objetivo ~1:20. Si la voz no cabe, se acelera un poco (máx. 5 %); si aun así es larga NO se recorta texto:
// las tomas se alargan solas (hasta 15 s) y el guionista agrega escenas.
// (máx. 5 %: más rápido suena apurado; atempo conserva el tono). Devuelve el wav (igual o acelerado).
function fitTempo(wav, seconds, maxVoice, log) {
  if (!(maxVoice > 0) || seconds <= maxVoice) return wav;
  const tempo = Math.min(1.05, seconds / maxVoice); // más de 5 % ya suena apurado (Franklin, oct-2026)
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-tempo-'));
  const a = path.join(dir, 'a.wav'), b = path.join(dir, 'b.wav');
  fs.writeFileSync(a, wav);
  try {
    execFileSync(ffmpegBin(), ['-y', '-loglevel', 'error', '-i', a, '-af', 'atempo=' + tempo.toFixed(3), b], { stdio: 'pipe' });
    log(`voz continua: ${seconds.toFixed(1)} s no cabe en 1:20 → acelerada ${tempo.toFixed(2)}x`);
    return fs.readFileSync(b);
  } catch (_) { return wav; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function atempoWav(wav, tempo) {
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-at-'));
  const a = path.join(dir, 'a.wav'), b = path.join(dir, 'b.wav');
  fs.writeFileSync(a, wav);
  try { execFileSync(ffmpegBin(), ['-y', '-loglevel', 'error', '-i', a, '-af', 'atempo=' + Number(tempo).toFixed(3), b], { stdio: 'pipe' }); return fs.readFileSync(b); }
  catch (_) { return wav; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
// Tiempo de cada palabra (dentro de cada pedazo, repartido por el largo de la palabra).
function wordTimes(segments) {
  const out = [];
  for (const sg of segments || []) {
    const ws = String(sg.text).split(/\s+/).filter(Boolean);
    const w = ws.map((x) => x.replace(/[^\p{L}\p{N}]/gu, '').length + 1);
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    let t = Number(sg.start);
    ws.forEach((x, i) => { const d = (w[i] / tot) * (Number(sg.end) - Number(sg.start)); out.push({ word: x, start: t, end: t + d }); t += d; });
  }
  return out;
}
const normW = (x) => String(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');

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
  return new Promise((res) => execFile(ffmpegBin(), ['-i', file, '-af', 'silencedetect=noise=-36dB:d=0.07', '-f', 'null', '-'], (e, so, se) => {
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
    for (const [s0, s1] of sil) { if (s0 - t > 0.05) spans.push([t, s0]); t = s1; }
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
  // Más tramos de voz que pedazos: se agrupan tramos seguidos para cada pedazo (programación dinámica),
  // buscando que cada pedazo dure lo que "pesa" su texto. Así los cortes caen en las pausas reales.
  if (spans.length > chunks.length && chunks.length > 0) {
    const w = chunks.map((c) => c.replace(/[^\p{L}\p{N}]/gu, '').length + 2);
    const W = w.reduce((a, b) => a + b, 0);
    const speech = spans.reduce((a, x) => a + (x[1] - x[0]), 0);
    const n = spans.length, m = chunks.length;
    const pre = [0]; spans.forEach((x) => pre.push(pre[pre.length - 1] + (x[1] - x[0])));
    const INF = 1e18;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(INF));
    const bk = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(-1));
    dp[0][0] = 0;
    let cumW = 0;
    for (let i = 1; i <= m; i++) {
      cumW += w[i - 1];
      const E = (cumW / W) * speech; // dónde "debería" terminar este pedazo (tiempo de voz acumulado)
      for (let j = i; j <= n - (m - i); j++) {
        for (let k = i - 1; k < j; k++) {
          if (dp[i - 1][k] >= INF) continue;
          const c = dp[i - 1][k] + Math.pow(pre[j] - E, 2);
          if (c < dp[i][j]) { dp[i][j] = c; bk[i][j] = k; }
        }
      }
    }
    if (dp[m][n] < INF) {
      const out = [];
      let j = n;
      for (let i = m; i >= 1; i--) { const k = bk[i][j]; out.unshift({ text: chunks[i - 1], start: spans[k][0], end: spans[j - 1][1] }); j = k; }
      return out;
    }
  }
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
  if (!force && cur && cur.url && cur.text === text && cur.v === VOICE_V && cur.voice === (cfg.voice || '')) {
    // Voz ya hecha pero sin tiempos reales por palabra: se alinean una vez (Whisper local en la PC).
    if (!(Array.isArray(cur.words) && cur.words.length) && process.env.VYRALES_LOCAL_RUN) {
      try {
        const wavB = Buffer.from(await (await fetch(cur.url)).arrayBuffer());
        const words = await require('./_align').alignWords(wavB, text, log);
        if (words) {
          const withW = Object.assign({}, cur, { words });
          const { data: frW } = await supabase.from('episodes').select('continuity').eq('id', episode.id).single();
          await supabase.from('episodes').update({ continuity: Object.assign({}, (frW && frW.continuity) || {}, { voice: withW }) }).eq('id', episode.id);
          return withW;
        }
      } catch (e) { log('alineación de voz: no se pudo con la voz existente (' + String(e.message).slice(0, 120) + ')'); }
    }
    return cur;
  }
  // Misma voz y mismo texto pero alineación vieja: se re-alinea con el MISMO audio (no cambia la voz ni los tiempos del video).
  if (!force && cur && cur.url && cur.text === text && cur.voice === (cfg.voice || '') && Number(cur.v) >= 2 && cur.v !== VOICE_V) {
    const dir0 = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-voice-'));
    const f0 = path.join(dir0, 'v.wav');
    fs.writeFileSync(f0, Buffer.from(await (await fetch(cur.url)).arrayBuffer()));
    const spans0 = await speechSpans(f0, Number(cur.seconds));
    fs.rmSync(dir0, { recursive: true, force: true });
    const segments0 = alignChunks(textChunks(text), spans0, Number(cur.seconds)).map((x) => ({ text: x.text, start: Math.round(x.start * 100) / 100, end: Math.round(x.end * 100) / 100 }));
    const voice0 = Object.assign({}, cur, { v: VOICE_V, segments: segments0 });
    const { data: fr0 } = await supabase.from('episodes').select('continuity').eq('id', episode.id).single();
    await supabase.from('episodes').update({ continuity: Object.assign({}, (fr0 && fr0.continuity) || {}, { voice: voice0 }) }).eq('id', episode.id);
    episode.continuity = Object.assign({}, episode.continuity || {}, { voice: voice0 });
    log(`voz continua: re-alineada (${spans0.length} tramos de voz → ${segments0.length} textos)`);
    return voice0;
  }
  // Cambió el texto de un video que YA tiene voz: se rehacen SOLO las frases que cambiaron y se pegan en
  // el audio aprobado (la IA de voz suena distinta en cada toma; Franklin no quiere que cambie la voz).
  let patched = null;
  if (!force && cur && cur.url && cur.text && cur.voice === (cfg.voice || '') && process.env.VYRALES_LOCAL_RUN) {
    try {
      const oldWav = Buffer.from(await (await fetch(cur.url)).arrayBuffer());
      const nOld = String(cur.text).split(/\s+/).filter(Boolean).length;
      const oldWords = Array.isArray(cur.words) && cur.words.length === nOld ? cur.words : await require('./_align').alignWords(oldWav, cur.text, log);
      patched = await require('./_voice_patch').patchVoice({ oldWav, oldWords, oldText: cur.text, newText: text, cfg, tempo: Number(cur.tempo) || 1, atempo: atempoWav, log });
      if (patched) {
        await logSpend(supabase, { seriesId: series.id, episodeId: episode.id, shotNumber: 0, kind: 'narration', model: 'tts_parche', costUsd: patched.costUsd, note: 'parche de voz' });
        log(`parche de voz: ${patched.changed}/${patched.total} frases nuevas; el resto es la voz original`);
      }
    } catch (e) { log('parche de voz: no se pudo (' + String(e.message).slice(0, 160) + ') → voz nueva completa'); patched = null; }
  }
  if (patched) {
    const wavP = patched.wav;
    const secondsP = Math.round(wavSeconds(wavP) * 100) / 100;
    const dirP = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-voice-'));
    const fP = path.join(dirP, 'v.wav');
    fs.writeFileSync(fP, wavP);
    const spansP = await speechSpans(fP, secondsP);
    fs.rmSync(dirP, { recursive: true, force: true });
    const segmentsP = alignChunks(textChunks(text), spansP, secondsP).map((x) => ({ text: x.text, start: Math.round(x.start * 100) / 100, end: Math.round(x.end * 100) / 100 }));
    await ensureMediaBucket(supabase);
    const urlP = await uploadFile(supabase, { path: `${series.slug}/ep${episode.episode_number}/voz-completa-v${Date.now()}.wav`, buffer: wavP, contentType: 'audio/wav' });
    const wordsP = await require('./_align').alignWords(wavP, text, log);
    const voiceP = Object.assign({ url: urlP, seconds: secondsP, text, v: VOICE_V, voice: cfg.voice || '', segments: segmentsP, tempo: Number(cur.tempo) || 1, patched_from: cur.url, at: new Date().toISOString() }, wordsP ? { words: wordsP } : {});
    const { data: frP } = await supabase.from('episodes').select('continuity').eq('id', episode.id).single();
    await supabase.from('episodes').update({ continuity: Object.assign({}, (frP && frP.continuity) || {}, { voice: voiceP }) }).eq('id', episode.id);
    episode.continuity = Object.assign({}, episode.continuity || {}, { voice: voiceP });
    return voiceP;
  }
  log('voz continua: narrando TODO el texto en una sola toma de voz...');
  const style = (cfg.style || '') + ' Es UNA sola frase continua: dila de corrido, con naturalidad, sin cortes ni pausas raras; solo una pausa mínima en cada punto o coma.';
  const takes = [];
  for (let k = 0; k < 2; k++) {
    const r = await synthesize({ text, voice: cfg.voice, style, model: cfg.model, log });
    await logSpend(supabase, { seriesId: series.id, episodeId: episode.id, shotNumber: 0, kind: 'narration', model: 'tts_' + r.model, costUsd: r.costUsd, note: 'voz continua' });
    takes.push(r);
  }
  const best = energyScore(takes[1].wav) > energyScore(takes[0].wav) ? takes[1] : takes[0];
  let wav = shortPauses(tightenSpeech(best.wav, log));
  let usedTempo = 1;
  {
    const sbT = (series && series.story_bible) || {};
    // Cierre: dura lo que diga su voz (≈0.42 s por palabra) o sus segundos, lo que sea más largo.
    const ecVoice = sbT.end_card && sbT.end_card.voice ? String(sbT.end_card.voice).split(/\s+/).filter(Boolean).length * 0.42 : 0;
    const ec = sbT.end_card && sbT.end_card.enabled ? Math.max(Number(sbT.end_card.seconds) || 2.5, ecVoice) + 0.3 : 0;
    const maxTotal = Number(sbT.max_seconds) || 80;
    const raw = wavSeconds(wav);
    wav = fitTempo(wav, raw, maxTotal - LEAD - TAIL - ec, log);
    usedTempo = Math.round((raw / Math.max(0.1, wavSeconds(wav))) * 1000) / 1000;
  }
  const seconds = Math.round(wavSeconds(wav) * 100) / 100;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-voice-'));
  const f = path.join(dir, 'v.wav');
  fs.writeFileSync(f, wav);
  const spans = await speechSpans(f, seconds);
  fs.rmSync(dir, { recursive: true, force: true });
  const segments = alignChunks(textChunks(text), spans, seconds).map((x) => ({ text: x.text, start: Math.round(x.start * 100) / 100, end: Math.round(x.end * 100) / 100 }));
  await ensureMediaBucket(supabase);
  const url = await uploadFile(supabase, { path: `${series.slug}/ep${episode.episode_number}/voz-completa-v${Date.now()}.wav`, buffer: wav, contentType: 'audio/wav' });
  // Tiempos reales por palabra (Whisper local en la PC); sin esto las tomas se cortaban hasta 2 s fuera de la voz.
  const words = await require('./_align').alignWords(wav, text, log);
  const voice = Object.assign({ url, seconds, text, v: VOICE_V, voice: cfg.voice || '', segments, tempo: usedTempo, at: new Date().toISOString() }, words ? { words } : {});
  const { data: fresh } = await supabase.from('episodes').select('continuity').eq('id', episode.id).single();
  await supabase.from('episodes').update({ continuity: Object.assign({}, (fresh && fresh.continuity) || {}, { voice }) }).eq('id', episode.id);
  episode.continuity = Object.assign({}, episode.continuity || {}, { voice });
  if (cur && cur.url && cur.url !== url) await removeByPublicUrl(supabase, cur.url, log).catch(() => {});
  log(`voz continua lista: ${seconds} s, ${segments.length} pedazos de texto:`, segments.map((s) => `${s.start}-${s.end} "${s.text}"`).join(' | '));
  return voice;
}

// Duración de cada toma para que el video entero dure lo que la voz (+ entrada y salida).
// shot.weight (opcional) da más tiempo a una toma. LTX: 3–16 s enteros.
// Cada toma necesita su parte de la voz (voice_part). Guiones narrados viejos la traen como línea del Narrador.
function withParts(shots) {
  return (shots || []).map((s) => {
    if (s.voice_part) return s;
    const d = (Array.isArray(s.dialogue) ? s.dialogue : s.dialogue ? [s.dialogue] : []).map((x) => x && x.line).filter(Boolean).join(' ');
    return d ? Object.assign({}, s, { voice_part: d.replace(/\s*…\s*/g, ' ').trim() }) : s;
  });
}
function shotSecondsFor(voice, shots) {
  shots = withParts(shots);
  const total = LEAD + Number(voice.seconds || 0) + TAIL;
  // Sincronía: si las tomas dicen qué parte de la frase cubren (shot.voice_part), cada toma dura
  // exactamente lo que tarda la voz en llegar a la parte de la siguiente (cortes redondeados en el
  // acumulado para no ir corriendo el desfase).
  if (shots.length > 1 && shots.every((s) => s.voice_part)) {
    // voice.words = tiempos reales por palabra (alineación forzada), si existen; si no, estimados.
    const wt = Array.isArray(voice.words) && voice.words.length ? voice.words : wordTimes(voice.segments);
    const words = wt.map((x) => normW(x.word));
    let cursor = 0;
    const startOf = shots.map((s) => {
      const seq = String(s.voice_part).split(/\s+/).map(normW).filter(Boolean).slice(0, 3);
      let k = -1;
      for (let j = cursor; j < words.length && k < 0; j++) if (seq.every((w, q) => words[j + q] === w)) k = j;
      if (k < 0) k = words.indexOf(seq[0], cursor);
      if (k < 0) k = cursor;
      cursor = k + 1;
      return wt[k] ? wt[k].start : 0;
    });
    const cuts = [0];
    for (let i = 1; i < shots.length; i++) cuts.push(Math.round(LEAD + startOf[i] - 0.15));
    cuts.push(Math.round(total));
    const secs = shots.map((_, i) => Math.max(2, Math.min(15, cuts[i + 1] - cuts[i])));
    return secs;
  }
  const ws = shots.map((s) => Number(s.weight) > 0 ? Number(s.weight) : 1);
  const tot = ws.reduce((a, b) => a + b, 0) || 1;
  return shots.map((s, i) => Math.max(3, Math.min(15, Math.round((ws[i] / tot) * total))));
}

// Igual que shotSecondsFor pero SIN redondear: { [n]: segundos exactos } para recortar/ajustar en el render.
function shotCutsExact(voice, shots) {
  shots = withParts(shots);
  if (!(shots.length > 1 && shots.every((s) => s.voice_part))) return null;
  const wt = Array.isArray(voice.words) && voice.words.length ? voice.words : wordTimes(voice.segments);
  const words = wt.map((x) => normW(x.word));
  let cursor = 0;
  const startOf = shots.map((s) => {
    // Se busca la secuencia de las 3 primeras palabras ("Los usa para"), no solo la 1ª ("los" aparece antes en "los ojos").
    const seq = String(s.voice_part).split(/\s+/).map(normW).filter(Boolean).slice(0, 3);
    let k = -1;
    for (let j = cursor; j < words.length && k < 0; j++) if (seq.every((w, q) => words[j + q] === w)) k = j;
    if (k < 0) k = words.indexOf(seq[0], cursor);
    if (k < 0) k = cursor;
    cursor = k + 1;
    return wt[k] ? wt[k].start : 0;
  });
  const total = LEAD + Number(voice.seconds || 0) + TAIL;
  const cuts = [0];
  for (let i = 1; i < shots.length; i++) cuts.push(LEAD + startOf[i] - 0.15);
  cuts.push(total);
  const out = {};
  shots.forEach((s, i) => { out[s.n] = Math.max(1, cuts[i + 1] - cuts[i]); });
  return out;
}

module.exports = { shotCutsExact, wordTimes, continuousMode, voiceText, textChunks, ensureFullVoice, shotSecondsFor, LEAD, TAIL };
