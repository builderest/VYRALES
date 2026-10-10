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
function matchWords(scriptWords, heard0) {
  // Whisper por pedazos de 30 s puede repetir palabras o devolver tiempos que retroceden: se ordenan
  // y se descartan los que se encimen con lo anterior.
  const heard = [];
  for (const h of heard0.slice().sort((a, b) => a.timestamp[0] - b.timestamp[0])) {
    const last = heard[heard.length - 1];
    if (last && h.timestamp[0] < last.timestamp[0] + 0.02) continue;
    heard.push(h);
  }
  const A = scriptWords.map(norm), B = heard.map((h) => norm(h.text));
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] && A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = new Array(n).fill(null);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (A[i] && A[i] === B[j]) { out[i] = { word: scriptWords[i], start: heard[j].timestamp[0], end: heard[j].timestamp[1] == null ? heard[j].timestamp[0] + 0.3 : heard[j].timestamp[1] }; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  // Palabras cortas sueltas ("la", "de") casadas lejos de sus vecinas son falsos positivos: fuera.
  for (let i = 0; i < n; i++) {
    if (!out[i] || A[i].length > 3) continue;
    let p = i - 1; while (p >= 0 && !out[p]) p--;
    let q = i + 1; while (q < n && !out[q]) q++;
    const gapP = p >= 0 ? i - p : 0, gapQ = q < n ? q - i : 0;
    if (gapP > 3 && gapQ > 3) out[i] = null;
  }
  // Coherencia de tiempos: un ancla que va hacia atrás, o que exige hablar a más de 7 palabras/s
  // (o empezar mucho después del inicio), es un casamiento falso de Whisper → fuera.
  {
    let pi = -1, pt = 0;
    for (let i = 0; i < n; i++) {
      if (!out[i]) continue;
      const t = out[i].start;
      const bad = pi < 0 ? t > 1.5 + i * 0.7 : (t < pt || ((i - pi) >= 3 && (i - pi) / Math.max(0.01, t - pt) > 7) || (t - pt) > 2.5 + (i - pi) * 0.9);
      if (bad) out[i] = null; else { pi = i; pt = t; }
    }
  }
  const matched = out.filter(Boolean).length;
  // Huecos (Whisper no oyó ese tramo, o "66" vs "sesenta y seis"): se reparten entre la palabra
  // casada anterior y la siguiente, en proporción al largo de cada palabra.
  for (let i = 0; i < n;) {
    if (out[i]) { i++; continue; }
    let q = i; while (q < n && !out[q]) q++;
    const a = i > 0 ? out[i - 1].end : 0;
    const b = q < n ? out[q].start : a + (q - i) * 0.35;
    const lens = []; for (let k = i; k < q; k++) lens.push(Math.max(2, norm(scriptWords[k]).length));
    const tot = lens.reduce((x, y) => x + y, 0);
    let t = a;
    for (let k = i; k < q; k++) {
      const d = ((b - a) * lens[k - i]) / tot;
      out[k] = { word: scriptWords[k], start: Math.round(t * 100) / 100, end: Math.round((t + d) * 100) / 100, guess: true };
      t += d;
    }
    i = q;
  }
  return { words: out, matched };
}

async function alignWords(wavBuffer, text, log = console.log) {
  if (!process.env.VYRALES_LOCAL_RUN) return null;
  try {
    const t0 = Date.now();
    const asr = await loadAsr(log);
    const r = await asr(wavTo16k(wavBuffer), { language: 'spanish', task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
    const audio = wavTo16k(wavBuffer);
    let heard = (r.chunks || []).filter((c) => c && c.timestamp && c.timestamp[0] != null);
    const scriptWords = String(text).split(/\s+/).filter(Boolean);
    let { words, matched } = matchWords(scriptWords, heard);
    // Si casó poco, se vuelve a escuchar TODO en ventanas fijas de 24 s (con 4 s de traslape).
    if (matched < scriptWords.length * 0.9) {
      const W = 24, O = 4, total = audio.length / 16000, extra = [];
      for (let a = 0; a < total; a += W - O) {
        const seg = audio.subarray(Math.floor(a * 16000), Math.min(audio.length, Math.ceil((a + W) * 16000)));
        if (seg.length < 8000) break;
        const r3 = await asr(seg, { language: 'spanish', task: 'transcribe', return_timestamps: 'word' });
        for (const c of (r3.chunks || [])) if (c && c.timestamp && c.timestamp[0] != null && (a === 0 || c.timestamp[0] >= O / 2)) extra.push({ text: c.text, timestamp: [Math.round((c.timestamp[0] + a) * 100) / 100, Math.round(((c.timestamp[1] == null ? c.timestamp[0] + 0.3 : c.timestamp[1]) + a) * 100) / 100] });
      }
      const m2 = matchWords(scriptWords, extra);
      log(`alineación de voz: segunda escucha por ventanas → ${m2.matched}/${scriptWords.length} (antes ${matched})`);
      if (m2.matched > matched) { heard = extra; words = m2.words; matched = m2.matched; }
    }
    // Whisper a veces se salta un pedazo entero (~20 s): se vuelve a transcribir SOLO ese tramo y se re-casa.
    for (let pass = 0; pass < 2; pass++) {
      const holes = [];
      for (let i = 0; i < words.length;) {
        if (!words[i].guess) { i++; continue; }
        let q = i; while (q < words.length && words[q].guess) q++;
        if (q - i >= 5) holes.push([Math.max(0, (words[i - 1] || { end: 0 }).end - 0.3), (words[q] || { start: audio.length / 16000 }).start + 0.3]);
        i = q;
      }
      if (!holes.length) break;
      for (const [a, b] of holes) {
        const seg = audio.subarray(Math.floor(a * 16000), Math.min(audio.length, Math.ceil(b * 16000)));
        if (seg.length < 16000) continue;
        const r2 = await asr(seg, { language: 'spanish', task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
        const extra = (r2.chunks || []).filter((c) => c && c.timestamp && c.timestamp[0] != null).map((c) => ({ text: c.text, timestamp: [Math.round((c.timestamp[0] + a) * 100) / 100, Math.round(((c.timestamp[1] == null ? c.timestamp[0] + 0.3 : c.timestamp[1]) + a) * 100) / 100] }));
        heard = heard.filter((h) => h.timestamp[0] < a || h.timestamp[0] > b).concat(extra);
      }
      ({ words, matched } = matchWords(scriptWords, heard));
      log(`alineación de voz: re-escuché ${holes.length} tramo(s) que Whisper se saltó → ${matched}/${scriptWords.length}`);
    }
    log(`alineación de voz (Whisper local): ${matched}/${scriptWords.length} palabras casadas en ${Math.round((Date.now() - t0) / 1000)} s`);
    if (matched < scriptWords.length * 0.6) { log('alineación de voz: muy pocas palabras casadas → uso la estimación'); return null; }
    return words;
  } catch (e) {
    log('alineación de voz: falló (' + String(e.message).slice(0, 200) + ') → uso la estimación');
    return null;
  }
}

module.exports = { alignWords, matchWords, wavTo16k };
