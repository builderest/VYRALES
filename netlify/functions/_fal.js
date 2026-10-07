// Proveedor de video alternativo: fal.ai (mismo Veo 3.1, mismo precio, SIN límite diario;
// solo limita cuántos videos procesa a la vez — los demás esperan en fila, no se rechazan).
// Docs: https://fal.ai/models/fal-ai/veo3.1/lite/image-to-video/api
// Necesita FAL_KEY en .env / Netlify. Solo image-to-video (cuadro inicial): así trabaja VYRALES.
const FAL_ENDPOINTS = {
  veo_lite: 'fal-ai/veo3.1/lite/image-to-video',
  veo_fast: 'fal-ai/veo3.1/fast/image-to-video',
  veo_standard: 'fal-ai/veo3.1/image-to-video'
};
const QUEUE = 'https://queue.fal.run/';

function falKey() {
  const k = process.env.FAL_KEY;
  if (!k) throw new Error('Falta FAL_KEY en el .env / Netlify (proveedor fal.ai).');
  return k;
}

async function falFetch(url, opts = {}) {
  const res = await fetch(url, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: `Key ${falKey()}`, 'Content-Type': 'application/json' }, opts.headers || {})
  }));
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    const detail = body && (body.detail || body.error || body.message || body.raw);
    const err = new Error(`fal.ai respondió HTTP ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// Devuelve { videoBuffer, requestId }.
async function falGenerateVideo({ modelKey, prompt, startImage, aspectRatio = '9:16', durationSeconds = 8, generateAudio = true, log = console.log }) {
  const endpoint = FAL_ENDPOINTS[modelKey];
  if (!endpoint) throw new Error(`fal.ai no tiene configurado el modelo ${modelKey}.`);
  if (!startImage || !startImage.imageBytes) throw new Error('Con fal.ai cada toma necesita su cuadro inicial (memoria visual activada).');

  const input = {
    prompt,
    image_url: `data:${startImage.mimeType || 'image/jpeg'};base64,${startImage.imageBytes}`,
    aspect_ratio: aspectRatio,
    duration: `${Number(durationSeconds)}s`,
    resolution: '720p',
    generate_audio: generateAudio !== false
  };
  // Sin vencimiento: el video se queda en el CDN de fal y VYRALES lo usa desde ahí (no se copia a
  // Supabase, cuyo plan gratis limita las descargas a 5 GB/mes). Doc: fal.ai/docs → media-expiration.
  const sub = await falFetch(QUEUE + endpoint, { method: 'POST', body: JSON.stringify(input), headers: { 'X-Fal-Object-Lifecycle-Preference': JSON.stringify({ expiration_duration_seconds: null }) } });
  const requestId = sub.request_id;
  const statusUrl = sub.status_url || `${QUEUE}${endpoint}/requests/${requestId}/status`;
  const responseUrl = sub.response_url || `${QUEUE}${endpoint}/requests/${requestId}`;
  log('[fal] enviado', endpoint, 'request', requestId);

  const started = Date.now();
  const MAX_WAIT_MS = 12 * 60 * 1000;
  let lastStatus = '';
  for (;;) {
    if (Date.now() - started > MAX_WAIT_MS) throw new Error('fal.ai tardó más de 12 minutos con la toma (request ' + requestId + ').');
    await new Promise((r) => setTimeout(r, 5000));
    const s = await falFetch(statusUrl, { method: 'GET' });
    const status = s && s.status;
    if (status !== lastStatus) {
      log('[fal] estado:', status, s.queue_position != null ? '(posición en fila ' + s.queue_position + ')' : '');
      lastStatus = status;
    }
    if (status === 'COMPLETED') break;
    if (status && !['IN_QUEUE', 'IN_PROGRESS'].includes(status)) throw new Error('fal.ai devolvió estado ' + status);
  }
  const result = await falFetch(responseUrl, { method: 'GET' });
  const url = result && result.video && result.video.url;
  if (!url) throw new Error('fal.ai no devolvió video: ' + JSON.stringify(result).slice(0, 400));
  const res = await fetch(url);
  if (!res.ok) throw new Error('No se pudo descargar el video de fal.ai (HTTP ' + res.status + ')');
  return { videoBuffer: Buffer.from(await res.arrayBuffer()), requestId, url };
}

module.exports = { falGenerateVideo, FAL_ENDPOINTS };
