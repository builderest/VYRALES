// Narrador con voz fija: Gemini TTS (misma llave GOOGLE_AI_API_KEY).
// Docs: https://ai.google.dev/gemini-api/docs/speech-generation  (API "interactions")
// Precio (oct-2026, https://ai.google.dev/gemini-api/docs/pricing): audio de salida
// 25 tokens/segundo; 3.8 Flash TTS hasta $18 por 1M tokens de salida → ~$0.004 por frase de 8 s.
const TTS_MODEL_DEFAULT = 'gemini-3.8-flash-tts';
const TTS_PRICE_PER_M = { // USD por 1M tokens (se usa el precio más alto publicado, para no subestimar)
  'gemini-3.8-flash-tts': { input: 1.0, output: 18.0 },
  'gemini-3.8-flash-lite-tts': { input: 1.0, output: 12.0 }
};
const DEFAULT_VOICE = 'Charon';
// Ritmo: con estilo "pausado" las frases de 13 palabras duraban 7.5–8.5 s y no caben en una
// toma de 8 s; se pide que la frase completa dure unos 6 segundos.
const DEFAULT_STYLE = 'Narrador de documental de naturaleza: voz grave, cálida y resonante, cautivadora, con énfasis suave en las palabras clave y un tono de asombro y misterio. Ritmo fluido, sin pausas largas: la frase completa dura unos 6 segundos. Pronuncia cada palabra con total claridad, en especial los números.';
const { ALL_VOICES } = require('./_voices');
const VOICES = ALL_VOICES; // las 30 voces de Gemini TTS (catálogo en _voices.js)

function wavSeconds(buf) {
  // RIFF: busca el chunk "fmt " (byteRate en +8) y "data" (tamaño en +4).
  let byteRate = 48000;
  let dataSize = buf.length - 44;
  for (let i = 12; i < buf.length - 8;) {
    const id = buf.toString('ascii', i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(i + 16);
    if (id === 'data') { dataSize = Math.min(size, buf.length - i - 8); break; }
    i += 8 + size + (size % 2);
  }
  return dataSize / byteRate;
}

async function callTts(body) {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('Falta GOOGLE_AI_API_KEY (la usa el narrador TTS).');
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text.slice(0, 400) }; }
  if (!res.ok) {
    const err = new Error(`Gemini TTS respondió HTTP ${res.status}: ${JSON.stringify(json.error || json).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// Devuelve { wav: Buffer, seconds, costUsd, model, voice }.
async function synthesize({ text, voice = DEFAULT_VOICE, style = DEFAULT_STYLE, model = TTS_MODEL_DEFAULT, log = console.log }) {
  const line = String(text || '').trim();
  if (!line) throw new Error('No hay texto para narrar.');
  const body = {
    model,
    input: [{ type: 'user_input', content: [{ type: 'text', text: line, annotations: [{ type: 'speech_metadata', style: style || DEFAULT_STYLE }] }] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice: voice || DEFAULT_VOICE }] }
  };
  // Nivel 1 de Google: 10 frases por minuto. Al pasarse responde 429 "retry in 57s": se espera
  // lo que pide (hasta 4 intentos) en vez de fallar la toma.
  let json;
  for (let attempt = 1; ; attempt++) {
    try {
      json = await callTts(body);
      break;
    } catch (err) {
      if ((err.status !== 429 && !(err.status >= 500)) || attempt >= 5) throw err;
      const m = /retry in (\d+(?:\.\d+)?)s/i.exec(err.message);
      const wait = Math.min(70, m ? Number(m[1]) + 2 : 20 * attempt);
      log(`[tts] límite/servidor ocupado, reintento ${attempt} en ${wait} s:`, err.message.slice(0, 120));
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
  let data = null;
  for (const step of json.steps || []) for (const c of step.content || []) if (c && c.data) data = c.data;
  if (!data) throw new Error('Gemini TTS no devolvió audio: ' + JSON.stringify(json).slice(0, 300));
  const wav = Buffer.from(data, 'base64');
  if (wav.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Gemini TTS devolvió un formato inesperado (no WAV).');
  const usage = json.usage || {};
  const price = TTS_PRICE_PER_M[model] || TTS_PRICE_PER_M[TTS_MODEL_DEFAULT];
  const costUsd = ((Number(usage.total_input_tokens) || 300) * price.input + (Number(usage.total_output_tokens) || 250) * price.output) / 1e6;
  return { wav, seconds: wavSeconds(wav), costUsd, model, voice: voice || DEFAULT_VOICE };
}

// Une varios WAV (mismo formato PCM que devuelve Gemini) con un silencio entre ellos.
// Para tomas con más de una línea (dos personajes que hablan en la misma toma).
function pcmOf(buf) {
  let fmt = null; let data = null;
  for (let i = 12; i < buf.length - 8;) {
    const id = buf.toString('ascii', i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    if (id === 'fmt ') fmt = buf.slice(i + 8, i + 8 + size);
    if (id === 'data') { data = buf.slice(i + 8, i + 8 + Math.min(size, buf.length - i - 8)); break; }
    i += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV sin chunk fmt/data.');
  return { fmt, data };
}
function concatWavs(bufs, gapSeconds = 0.35) {
  if (bufs.length === 1) return bufs[0];
  const parts = bufs.map(pcmOf);
  const fmt = parts[0].fmt;
  const byteRate = fmt.readUInt32LE(8);
  const blockAlign = fmt.readUInt16LE(12);
  const gapBytes = Math.round(byteRate * gapSeconds / blockAlign) * blockAlign;
  const chunks = [];
  parts.forEach((p, i) => { if (i) chunks.push(Buffer.alloc(gapBytes)); chunks.push(p.data); });
  const data = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0); header.writeUInt32LE(4 + 8 + fmt.length + 8 + data.length, 4); header.write('WAVE', 8);
  const fmtHead = Buffer.alloc(8); fmtHead.write('fmt ', 0); fmtHead.writeUInt32LE(fmt.length, 4);
  const dataHead = Buffer.alloc(8); dataHead.write('data', 0); dataHead.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, fmtHead, fmt, dataHead, data]);
}

// Quita las pausas "dramáticas" largas que mete el TTS (prueba Job T6: 10.1 s → 7.3 s, con
// 2.3 s de silencios). Deja hasta 0.22 s entre frases y recorta el silencio del inicio.
// Usa ffmpeg-static (Netlify) o el ffmpeg del sistema; si ninguno funciona, devuelve el original.
function tightenSpeech(wav, log = console.log) {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const { execFileSync } = require('child_process');
  const bins = [];
  try { bins.push(require('ffmpeg-static')); } catch (_) {}
  bins.push('ffmpeg');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-'));
  const inF = path.join(dir, 'in.wav'); const outF = path.join(dir, 'out.wav');
  fs.writeFileSync(inF, wav);
  const af = 'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-38dB:stop_periods=-1:stop_duration=0.28:stop_silence=0.22:stop_threshold=-38dB';
  for (const bin of bins) {
    try {
      execFileSync(bin, ['-y', '-loglevel', 'error', '-i', inF, '-af', af, outF], { stdio: 'pipe' });
      const out = fs.readFileSync(outF);
      fs.rmSync(dir, { recursive: true, force: true });
      return out;
    } catch (_) { /* probar el siguiente */ }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  log('[tts] no se pudieron recortar las pausas (sin ffmpeg); se deja el audio original.');
  return wav;
}

module.exports = { tightenSpeech, concatWavs, synthesize, wavSeconds, TTS_MODEL_DEFAULT, DEFAULT_VOICE, DEFAULT_STYLE, VOICES, TTS_PRICE_PER_M };
