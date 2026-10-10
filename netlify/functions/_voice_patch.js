// PARCHE DE VOZ: si cambia el texto de un video que ya tiene voz, NO se regenera toda la voz
// (la IA de voz suena distinta en cada toma y Franklin ya aprobó la que había). Se rehacen SOLO las
// frases que cambiaron y se pegan dentro del audio original, cortando por los tiempos reales de cada palabra.
// Solo en la PC (necesita la alineación de Whisper local). Devuelve { wav, changed, total } o null.
const { synthesize, tightenSpeech } = require('./_tts');

function parseWav(buf) {
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(off + 10), sr: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') data = buf.subarray(off + 8, Math.min(buf.length, off + 8 + sz));
    off += 8 + sz + (sz % 2);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error('WAV no soportado');
  const n = Math.floor(data.length / 2 / fmt.ch), pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = data.readInt16LE(i * 2 * fmt.ch);
  return { sr: fmt.sr, pcm };
}
function buildWav(sr, pcm) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(pcm[i], 44 + i * 2);
  return b;
}
function resample(pcm, from, to) {
  if (from === to) return pcm;
  const r = from / to, m = Math.floor(pcm.length / r), o = new Int16Array(m);
  for (let i = 0; i < m; i++) { const x = i * r, k = Math.floor(x), f = x - k; o[i] = Math.round(pcm[k] * (1 - f) + (pcm[k + 1] || 0) * f); }
  return o;
}
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, '').replace(/\s+/g, ' ').trim();
// Frases por índice de palabra: termina en . ! ? (los "…" son pausas dentro de la frase).
function sentences(text) {
  const toks = String(text).split(/\s+/).filter(Boolean), out = [];
  let st = 0;
  toks.forEach((t, i) => { if (/[.!?]["»”)]*$/.test(t) || i === toks.length - 1) { out.push({ a: st, b: i, text: toks.slice(st, i + 1).join(' ') }); st = i + 1; } });
  return out;
}

async function patchVoice({ oldWav, oldWords, oldText, newText, cfg, tempo = 1, atempo, log = console.log }) {
  const A = sentences(oldText), B = sentences(newText);
  if (!oldWords || oldWords.length !== String(oldText).split(/\s+/).filter(Boolean).length) throw new Error('las palabras alineadas no coinciden con el texto viejo');
  // LCS de frases (texto normalizado)
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = norm(A[i].text) === norm(B[j].text) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const keep = new Array(m).fill(-1);
  for (let i = 0, j = 0; i < n && j < m;) { if (norm(A[i].text) === norm(B[j].text)) { keep[j] = i; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  const changed = keep.filter((k) => k < 0).length;
  if (!changed) return null;
  if (changed > Math.ceil(m * 0.5)) { log(`parche de voz: cambiaron ${changed}/${m} frases (demasiadas) → voz nueva completa`); return null; }
  const old = parseWav(oldWav), sr = old.sr;
  const sec = (t) => Math.max(0, Math.min(old.pcm.length, Math.round(t * sr)));
  const pieces = [];
  const gap = (s) => new Int16Array(Math.round(s * sr));
  for (let j = 0; j < m; j++) {
    if (keep[j] >= 0) {
      const s = A[keep[j]], w0 = oldWords[s.a], w1 = oldWords[s.b];
      pieces.push(old.pcm.subarray(sec(w0.start - 0.06), sec(w1.end + 0.12)));
    } else {
      log(`parche de voz: rehaciendo SOLO la frase ${j + 1}: "${B[j].text.slice(0, 80)}"`);
      const style = (cfg.style || '') + ' Es una frase suelta dentro de una narración ya grabada: mismo tono, misma energía y mismo ritmo que el resto.';
      const r = await synthesize({ text: B[j].text, voice: cfg.voice, style, model: cfg.model, log });
      let w = tightenSpeech(r.wav, log);
      if (tempo && Math.abs(tempo - 1) > 0.005 && atempo) w = atempo(w, tempo);
      const p = parseWav(w);
      pieces.push(resample(p.pcm, p.sr, sr));
      pieces.costUsd = (pieces.costUsd || 0) + (r.costUsd || 0);
    }
    if (j < m - 1) pieces.push(gap(0.28));
  }
  const total = pieces.reduce((a, p) => a + p.length, 0), out = new Int16Array(total);
  let o = 0; for (const p of pieces) { out.set(p, o); o += p.length; }
  return { wav: buildWav(sr, out), changed, total: m, costUsd: pieces.costUsd || 0 };
}

module.exports = { patchVoice, sentences, parseWav, buildWav };
