// Generación de imágenes con Gemini (misma GOOGLE_AI_API_KEY que Veo, sin otra API).
// Se usa para la MEMORIA VISUAL de cada novela:
//   - la imagen fija de cada lugar (set) de la serie;
//   - el CUADRO INICIAL de cada toma, que luego Veo Lite anima (image-to-video).
//
// Modelo: gemini-3.1-flash-image — acepta hasta 4 imágenes de personajes "para mantener
// consistencia" + hasta 10 de objetos/lugares, y genera en 9:16.
// Fuentes (verificadas 2026-10-05): https://ai.google.dev/gemini-api/docs/image-generation
//                                   https://ai.google.dev/gemini-api/docs/pricing
const { GoogleGenAI } = require('@google/genai');

const IMAGE_MODEL = 'gemini-3.1-flash-image';
const IMAGE_PRICE_USD = 0.067; // por imagen 1K (precio público, tabla de Gemini API)
const MAX_CHARACTER_REFS = 4;
const MAX_TOTAL_REFS = 14;

function client() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('Falta la variable de entorno GOOGLE_AI_API_KEY.');
  return new GoogleGenAI({ apiKey });
}

async function withRetry(fn, { retries = 3, baseDelayMs = 8000 } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const retryable = err.status === 429 || err.status === 503 || /RESOURCE_EXHAUSTED|UNAVAILABLE|429|503/.test(err.message || '');
      if (!retryable || i === retries) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, i)));
    }
  }
  throw last;
}

// references: [{ label: 'Face reference of Valentina', imageBytes: <base64>, mimeType }]
// Cada imagen va precedida de su etiqueta, así el modelo sabe a quién/qué corresponde.
async function generateImage({ prompt, references = [], aspectRatio = '9:16' }) {
  if (references.length > MAX_TOTAL_REFS) throw new Error(`Demasiadas imágenes de referencia (${references.length}, máx. ${MAX_TOTAL_REFS}).`);
  const parts = [];
  references.forEach((ref, i) => {
    parts.push({ text: `Reference image ${i + 1}: ${ref.label}.` });
    parts.push({ inlineData: { mimeType: ref.mimeType || 'image/jpeg', data: ref.imageBytes } });
  });
  parts.push({ text: prompt });

  const ai = client();
  const response = await withRetry(() =>
    ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: 'user', parts }],
      config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio, imageSize: '1K' } }
    })
  );

  const candidate = response && response.candidates && response.candidates[0];
  const imagePart = candidate && candidate.content && (candidate.content.parts || []).find((p) => p.inlineData && p.inlineData.data);
  if (!imagePart) {
    const reason = (candidate && candidate.finishReason) || (response && response.promptFeedback && response.promptFeedback.blockReason) || 'sin imagen';
    throw new Error('El modelo de imagen no devolvió ninguna imagen (' + reason + ').');
  }
  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType || 'image/png',
    costUsd: IMAGE_PRICE_USD,
    model: IMAGE_MODEL
  };
}

// oct-14 — REGLA DE FRANKLIN: "ninguna imagen tiene que pagar en ningún momento; Gemini es lo mismo que Flow, a menos
// que Flow falle 2 o 3 veces". freeImage = Google Flow en la PC ($0) con hasta 3 intentos; Gemini (de pago) SOLO si
// los 3 fallan. Fuera de la PC (Netlify) no hay Flow → error claro en vez de cobrar (el panel manda las imágenes a la PC).
function flowImagenes() {
  const path = require('path'); const fs = require('fs');
  const f = [path.join(__dirname, '..', '..', 'agente', 'flow_imagenes.js'), path.join(process.cwd(), 'agente', 'flow_imagenes.js')].find((x) => { try { return fs.existsSync(x); } catch (_) { return false; } });
  return f ? eval('require')(f) : null;
}
// anonimizar: nombres de personas reales; si Flow rechaza por política, los siguientes intentos los cambian por
// "the person in image N" / "the person" (Flow no hace personas reales famosas por su nombre).
const sinNombres = (txt, names) => { let s = String(txt || ''); for (const n of (names || []).filter(Boolean).sort((a, b) => b.length - a.length)) { const base = String(n).replace(/\s*\(.*?\)\s*/g, ' ').trim(); for (const k of [n, base, base.split(/\s+/)[0]].filter((x) => x && x.length > 2)) s = s.split(k).join('the person'); } return s; };
async function freeImage({ prompt, references = [], aspectRatio = '9:16', log = () => {}, tries = 3, anonimizar = [] }) {
  const F = process.env.VYRALES_LOCAL_RUN ? flowImagenes() : null;
  if (!F) {
    if (process.env.VYRALES_PAID_IMAGES === '1') return generateImage({ prompt, references, aspectRatio });
    throw new Error('Las imágenes se hacen gratis con Google Flow en la PC; aquí no hay Flow y no se paga Gemini. Mándalo a la PC.');
  }
  let refs = references || [];
  let anon = false;
  let last = null;
  for (let i = 1; i <= tries; i++) {
    try {
      // Tras un rechazo por política: SIN las fotos de cara de esas personas (Flow no hace personas reales desde una
      // foto) y sin sus nombres; el prompt ya trae su descripción (rasgos y ropa). Se conservan las demás referencias (lugar).
      const esDePersona = (r) => (anonimizar || []).some((n) => { const b = String(n).replace(/\s*\(.*?\)\s*/g, ' ').trim(); return String(r.label || '').includes(n) || (b && String(r.label || '').includes(b)); });
      const R = anon ? refs.filter((r) => !esDePersona(r)).map((r) => Object.assign({}, r, { label: sinNombres(r.label, anonimizar) })) : refs;
      const pr = anon ? sinNombres(prompt, anonimizar) : prompt;
      const p = R.length ? 'Reference images in order: ' + R.map((r, k) => `image ${k + 1} = ${r.label}`).join('; ') + '. ' + pr : pr;
      const f = await F.flowImage({ prompt: p, refs: R, aspect: aspectRatio === '16:9' ? '16:9' : '9:16' });
      return { buffer: f.buffer, mimeType: f.mimeType || 'image/jpeg', costUsd: 0, model: 'flow' };
    } catch (e) { last = e; if (/POLITICA/.test(e.message) && anonimizar.length && !anon) { anon = true; log('Flow: rechazo por política → reintento sin los nombres de las personas'); } log('Flow falló (intento ' + i + '/' + tries + '): ' + String(e.message).slice(0, 140)); if (i < tries) await new Promise((r) => setTimeout(r, 4000 * i)); }
  }
  log('Flow falló ' + tries + ' veces → Gemini (de pago, ~$' + IMAGE_PRICE_USD + ')');
  return generateImage({ prompt, references, aspectRatio });
}
module.exports = { freeImage, generateImage, IMAGE_MODEL, IMAGE_PRICE_USD, MAX_CHARACTER_REFS };
