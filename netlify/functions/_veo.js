// Cliente de Veo 3.1 (Gemini API) — genera un clip de video a partir de un prompt y lo
// devuelve como Buffer, listo para subir a Supabase Storage.
//
// Fuente de la implementación (verificada en octubre 2026):
//   https://ai.google.dev/gemini-api/docs/veo
// Si Google cambia el SDK/endpoint, ese es el lugar para revisar primero.
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const VEO_MODELS = {
  veo_lite: 'veo-3.1-lite-generate-preview',
  veo_fast: 'veo-3.1-fast-generate-preview',
  veo_standard: 'veo-3.1-generate-preview'
};

// Calibrado el 2026-10-04 contra el gasto REAL confirmado en "Gasto de la API de Gemini"
// (Google AI Studio, proyecto "My First Project"): $3.60 totales por el episodio #1
// completo (7 tomas veo_lite + 1 toma veo_fast del cliffhanger, 8s cada una). Nuestra
// estimación previa daba $3.44 — un 4.6% por debajo de lo real — así que estos valores
// están escalados por ese mismo factor (1.0465) respecto a los precios públicos originales.
// Sigue siendo una aproximación: Google no desglosa lite vs. fast en ese panel, solo el
// total, así que no podemos calibrar cada modelo de forma 100% independiente todavía.
// Si quieres precisión exacta, revisa el reporte de transacciones de Cloud Billing (tarda
// hasta 24h en aparecer) en vez de este panel de "Gasto de la API de Gemini".
// Fuente de precios públicos: https://ai.google.dev/gemini-api/docs/pricing
const VEO_PRICE_PER_SECOND_USD = {
  veo_lite: 0.042,
  veo_fast: 0.157,
  veo_standard: 0.419
};

function getGenAIClient() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('Falta la variable de entorno GOOGLE_AI_API_KEY.');
  }
  return new GoogleGenAI({ apiKey });
}

// Reintenta con backoff exponencial solo en 429 (cuota excedida) — común en cuentas de
// facturación recién activadas, que arrancan con cuotas bajas de solicitudes simultáneas.
async function callWithRetry(fn, { retries = 4, baseDelayMs = 20000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const is429 = err.status === 429 || /RESOURCE_EXHAUSTED|429/.test(err.message || '');
      if (!is429 || attempt === retries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn('[veo] 429 (cuota excedida) — reintentando en', Math.round(delay / 1000) + 's', '(intento', attempt + 1, 'de', retries + ')');
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

// Modelos que aceptan imágenes de referencia ("Ingredients to video"). Veo 3.1 Lite NO.
// Fuente: https://ai.google.dev/gemini-api/docs/veo (hasta 3 imágenes, duración 8 s).
const MODELS_WITH_REFERENCE_IMAGES = new Set(['veo_fast', 'veo_standard']);

// modelKey: 'veo_lite' | 'veo_fast' | 'veo_standard'
// referenceImages: [{ imageBytes: <base64>, mimeType: 'image/jpeg' }] (máx. 3) — fotos de
// los personajes de la toma para que Veo mantenga sus caras.
async function generateVeoClip({ modelKey, prompt, aspectRatio = '9:16', durationSeconds = 8, referenceImages = [] }) {
  const model = VEO_MODELS[modelKey];
  if (!model) throw new Error('Modelo de Veo desconocido: ' + modelKey);
  if (referenceImages.length) {
    // Nunca se descartan en silencio: si el modelo no las acepta, se aborta antes de gastar.
    if (!MODELS_WITH_REFERENCE_IMAGES.has(modelKey)) {
      throw new Error(`El modelo ${modelKey} no acepta fotos de referencia. Usa veo_fast o veo_standard.`);
    }
    if (referenceImages.length > 3) throw new Error('Veo acepta máximo 3 fotos de referencia por toma.');
    if (Number(durationSeconds) !== 8) throw new Error('Con fotos de referencia la toma debe durar 8 segundos.');
  }

  // La API exige durationSeconds como número (no string) — "8" falla con 400 INVALID_ARGUMENT.
  const durationSecondsNum = Number(durationSeconds);

  const ai = getGenAIClient();

  let operation = await callWithRetry(() =>
    ai.models.generateVideos({
      model,
      prompt,
      config: Object.assign(
        { aspectRatio, durationSeconds: durationSecondsNum },
        referenceImages.length
          ? {
              referenceImages: referenceImages.map((img) => ({
                image: { imageBytes: img.imageBytes, mimeType: img.mimeType || 'image/jpeg' },
                referenceType: 'ASSET'
              }))
            }
          : {}
      )
    })
  );

  const startedAt = Date.now();
  // 6 minutos es el máximo documentado en horas pico + margen de seguridad.
  const MAX_WAIT_MS = 6 * 60 * 1000 + 30 * 1000;

  while (!operation.done) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new Error('Tiempo de espera agotado generando el clip con Veo (' + model + ').');
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  const generated =
    operation.response && operation.response.generatedVideos && operation.response.generatedVideos[0];
  if (!generated || !generated.video) {
    throw new Error('Veo no devolvió ningún video. Respuesta: ' + JSON.stringify(operation.response));
  }

  const tmpPath = path.join(os.tmpdir(), `veo-${crypto.randomUUID()}.mp4`);
  await ai.files.download({ file: generated.video, downloadPath: tmpPath });
  const videoBuffer = fs.readFileSync(tmpPath);
  fs.unlinkSync(tmpPath);

  const costUsd = durationSecondsNum * (VEO_PRICE_PER_SECOND_USD[modelKey] || 0);

  return { videoBuffer, costUsd, model };
}

// Descarga las fotos de referencia (URLs públicas de Supabase) y las deja en base64 para Veo.
async function loadReferenceImages(urls) {
  const out = [];
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('No se pudo descargar la foto de referencia ' + url + ' (HTTP ' + res.status + ')');
    const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    out.push({ imageBytes: Buffer.from(await res.arrayBuffer()).toString('base64'), mimeType });
  }
  return out;
}

module.exports = { generateVeoClip, loadReferenceImages, VEO_MODELS, VEO_PRICE_PER_SECOND_USD, MODELS_WITH_REFERENCE_IMAGES };
