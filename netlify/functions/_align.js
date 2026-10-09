// Tiempos REALES de cada palabra de la voz (Whisper local con @huggingface/transformers, gratis).
// Solo corre en la PC (VYRALES_LOCAL_RUN): se instala aparte en agente/.whisper la primera vez
// (no se mezcla con node_modules del proyecto). Si algo falla devuelve null y se usa la estimación.
// Devuelve [{ word, start, end }] con las palabras DEL GUION (no las que oye Whisper).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const DIR = process.env.VYRALES_WHISPER_DIR || path.join(__dirname, '..', '..', 'agente', '.whisper');
const PKG = '@huggingface/transformers@3.5.1';
const MODEL = 'onnx-community/whisper-small_timestamped';
let asrP = null;

async function loadAsr(log) {
  if (asrP) return asrP;
  asrP = (async () => {
    const entry = path.join(DIR, 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs');
    if (!fs.existsSync(entry)) {
      log('alineación de voz: instalando Whisper local (solo la primera vez, ~1 min)...');
      fs.mkdirSync(DIR, { recursive: true });
      if (!fs.existsSync(path.join(DIR, 'package.json'))) fs.writeFileSync(path.join(DIR, 'package.json'), '{"name":"vy-whisper","private":true}');
      execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', PKG], { cwd: DIR, stdio: 'ignore', shell: process.platform === 'win32', timeout: 10 * 60000 });
    }
    const { pipeline, env } = await import(pathToFileURL(entry).href);
    env.cacheDir = path.join(DIR, 'cache');
    return pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' });
  })();
  return asrP;
}

// WAV PCM16 → Float32 mono 16 kHz
function wavTo16k(buf) {
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(off + 10), sr: buf.readUInt32LE(off + 12) };
    if (id === 'data') data = buf.subarray(off + 8, Math.min(buf.length, off + 8 + sz));
    off += 8 + sz + (sz % 2);
  }
  if (!fmt || !data) throw new Error('WAV sin formato/datos');
  const n = Math.floor(data.length / 2 / fmt.ch), src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = data.readInt16LE(i * 2 * fmt.ch) / 32768;
  const ratio = fmt.sr / 16000, m = Math.floor(n / ratio), a = new Float32Array(m);
  for (let i = 0; i < m; i++) { const x = i * ratio, k = Math.floor(x), f = x - k; a[i] = src[k] * (1 - f) + (src[k + 1] || 0) * f; }
  return a;
}

const norm = (w) => String(w || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');

// Une las palabras del guion con las que oyó Whisper (LCS); las que no casan (p. ej. "sesenta y seis" vs "66")
// se reparten entre la anterior y la siguiente que sí casaron.
function matchWords(scriptWords, heard) {
  const A = scriptWords.map(norm), B = heard.map((h) => norm(h.text));
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] && A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = new Array(n).fill(null);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (A[i] && A[i] === B[j]) { out[i] = { word: scriptWords[i], start: heard[j].timestamp[0], end: heard[j].timestamp[1] }; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  let matched = out.filter(Boolean).length;
  for (let i = 0; i < n; i++) {
    if (out[i]) continue;
    let p = i - 1; while (p >= 0 && !out[p]) p--;
    let q = i + 1; while (q < n && !out[q]) q++;
    const a = p >= 0 ? out[p].end : 0, b = q < n ? out[q].start : a + 0.3 * (q - p);
    const span = q - p, k = i - p;
    const st = a + ((b - a) * (k - 1)) / Math.max(1, span - 1), en = a + ((b - a) * k) / Math.max(1, span - 1);
    out[i] = { word: scriptWords[i], start: Math.round(Math.min(st, en) * 100) / 100, end: Math.round(Math.max(st, en) * 100) / 100, guess: true };
  }
  return { words: out, matched };
}

async function alignWords(wavBuffer, text, log = console.log) {
  if (!process.env.VYRALES_LOCAL_RUN) return null;
  try {
    const t0 = Date.now();
    const asr = await loadAsr(log);
    const r = await asr(wavTo16k(wavBuffer), { language: 'spanish', task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
    const heard = (r.chunks || []).filter((c) => c && c.timestamp && c.timestamp[0] != null);
    const scriptWords = String(text).split(/\s+/).filter(Boolean);
    const { words, matched } = matchWords(scriptWords, heard);
    log(`alineación de voz (Whisper local): ${matched}/${scriptWords.length} palabras casadas en ${Math.round((Date.now() - t0) / 1000)} s`);
    if (matched < scriptWords.length * 0.6) { log('alineación de voz: muy pocas palabras casadas → uso la estimación'); return null; }
    return words;
  } catch (e) {
    log('alineación de voz: falló (' + String(e.message).slice(0, 200) + ') → uso la estimación');
    return null;
  }
}

module.exports = { alignWords, matchWords, wavTo16k };
