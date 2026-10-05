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

module.exports = { generateImage, IMAGE_MODEL, IMAGE_PRICE_USD, MAX_CHARACTER_REFS };
