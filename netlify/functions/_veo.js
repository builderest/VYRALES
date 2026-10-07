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
  veo_lite: 0.05, // 720p — precio oficial (marzo 2026): Lite $0.05/s, Fast $0.10/s, Standard $0.40/s
  veo_fast: 0.10,
  veo_standard: 0.40
};
// fal.ai cobra DISTINTO que Google y distinto con/sin audio (720p, verificado oct-2026 en
// fal.ai/models/fal-ai/veo3.1/*): Fast con audio es $0.15/s, no $0.10.
const FAL_PRICE_PER_SECOND_USD = {
  veo_lite: { audio: 0.05, silent: 0.03 },
  veo_fast: { audio: 0.15, silent: 0.10 },
  veo_standard: { audio: 0.40, silent: 0.20 }
};
function videoPricePerSecond(modelKey, provider = 'google', generateAudio = true) {
  if (provider === 'fal') { const p = FAL_PRICE_PER_SECOND_USD[modelKey]; return p ? p[generateAudio === false ? 'silent' : 'audio'] : 0; }
  return VEO_PRICE_PER_SECOND_USD[modelKey] || 0;
}

function getGenAIClient() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('Falta la variable de entorno GOOGLE_AI_API_KEY.');
  }
  return new GoogleGenAI({ apiKey });
}

// Cuotas reales de Veo (Google AI Studio, Nivel 1, visto el 2026-10-05): Veo 3 Lite =
// 2 solicitudes por MINUTO y 10 por DÍA (se reinicia a medianoche, hora del Pacífico).
// - Ritmo: nunca más de 2 por minuto → mínimo 31 s entre el inicio de dos videos.
// - 429: se espera 65 s (se vacía la ventana del minuto) y se reintenta UNA vez. Si vuelve
//   a dar 429 es la cuota DIARIA: se lanza un error con code = 'VEO_QUOTA' y la producción
//   se detiene (antes reintentaba 4 veces con esperas de hasta 160 s en CADA toma).
const MIN_GAP_MS = 31000;
let lastVeoCallAt = 0;
async function paceVeo() {
  const wait = lastVeoCallAt + MIN_GAP_MS - Date.now();
  if (wait > 0) {
    console.log('[veo] respetando el límite de 2 por minuto: espero', Math.ceil(wait / 1000) + 's');
    await new Promise((r) => setTimeout(r, wait));
  }
  lastVeoCallAt = Date.now();
}
function isQuotaError(err) {
  return !!err && (err.status === 429 || /RESOURCE_EXHAUSTED|\b429\b/.test(err.message || ''));
}
async function callWithRetry(fn) {
  await paceVeo();
  try {
    return await fn();
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    console.warn('[veo] 429 (cuota) — espero 65s y reintento una sola vez...');
    await new Promise((r) => setTimeout(r, 65000));
    await paceVeo();
    try {
      return await fn();
    } catch (err2) {
      if (!isQuotaError(err2)) throw err2;
      const e = new Error('Se acabó la cuota de Veo de Google (límite de videos por día de tu nivel). Vuelve a intentar después de la medianoche, hora del Pacífico.');
      e.code = 'VEO_QUOTA';
      e.status = 429;
      throw e;
    }
  }
}

// Modelos que aceptan imágenes de referencia ("Ingredients to video"). Veo 3.1 Lite NO.
// Fuente: https://ai.google.dev/gemini-api/docs/veo (hasta 3 imágenes, duración 8 s).
const MODELS_WITH_REFERENCE_IMAGES = new Set(['veo_fast', 'veo_standard']);

// modelKey: 'veo_lite' | 'veo_fast' | 'veo_standard'
// referenceImages: [{ imageBytes: <base64>, mimeType: 'image/jpeg' }] (máx. 3) — fotos de
// los personajes de la toma para que Veo mantenga sus caras.
// startImage: { imageBytes, mimeType } — CUADRO INICIAL (image-to-video). Veo 3.1 Lite sí lo
// acepta: es como la memoria visual llega a Lite (la cara y el set ya vienen en el cuadro).
async function generateVeoClip({ modelKey, prompt, aspectRatio = '9:16', durationSeconds = 8, referenceImages = [], startImage = null, provider = 'google', generateAudio = true, ltxPrompt = null, log = console.log }) {
  // Proveedor PC king: LTX-2.5 local por Tailscale, gratis (solo corre desde Cronix, ver _king.js).
  if (provider === 'king') {
    const { kingGenerateVideo } = require('./_king');
    const { videoBuffer } = await kingGenerateVideo({ prompt: ltxPrompt || prompt, startImage, durationSeconds, log });
    return { videoBuffer, costUsd: 0, model: 'king:ltx2.5', provider: 'king', generateAudio: false };
  }
  // Proveedor fal.ai: mismo modelo y precio, sin cuota diaria (ver _fal.js).
  if (provider === 'fal') {
    if (referenceImages.length) throw new Error('Con fal.ai no se usan fotos de referencia directas; usa memoria visual (cuadro inicial).');
    const { falGenerateVideo } = require('./_fal');
    const { videoBuffer, url: falUrl } = await falGenerateVideo({ modelKey, prompt, startImage, aspectRatio, durationSeconds, generateAudio, log });
    return { videoBuffer, falUrl, costUsd: Number(durationSeconds) * videoPricePerSecond(modelKey, 'fal', generateAudio), model: 'fal:' + modelKey, provider: 'fal', generateAudio: generateAudio !== false };
  }
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
      ...(startImage ? { image: { imageBytes: startImage.imageBytes, mimeType: startImage.mimeType || 'image/png' } } : {}),
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

module.exports = { generateVeoClip, videoPricePerSecond, FAL_PRICE_PER_SECOND_USD, loadReferenceImages, VEO_MODELS, VEO_PRICE_PER_SECOND_USD, MODELS_WITH_REFERENCE_IMAGES };
