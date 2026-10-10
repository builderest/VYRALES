// Helpers del bucket de Supabase Storage donde viven los clips de video generados.
const BUCKET = 'media';

// Crea el bucket si no existe aún (idempotente — seguro llamarlo en cada request).
async function ensureMediaBucket(supabase) {
  const { data: existing } = await supabase.storage.getBucket(BUCKET);
  if (existing) return;

  const { error: createError } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (createError && !/already exists/i.test(createError.message || '')) {
    throw createError;
  }
}

async function uploadClip(supabase, { path: storagePath, buffer }) {
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: 'video/mp4',
    upsert: true
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

// Subida genérica (imágenes de referencia de personajes, etc.). Devuelve la URL pública.
async function uploadFile(supabase, { path: storagePath, buffer, contentType }) {
  // Reintentos: Supabase a veces responde 5xx sueltos (oct-2026: un 520 tumbó una toma entera).
  let error = null;
  for (let k = 0; k < 4; k++) {
    ({ error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, { contentType, upsert: true }));
    if (!error) break;
    const st = Number(error.status || error.statusCode) || 0;
    if (st && st < 500 && st !== 429) break;
    await new Promise((r) => setTimeout(r, 2000 * (k + 1)));
  }
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

// De una URL pública de Supabase Storage saca la ruta interna dentro del bucket.
function storagePathFromPublicUrl(url) {
  const marker = `/object/public/${BUCKET}/`;
  const i = String(url || '').indexOf(marker);
  return i === -1 ? null : decodeURIComponent(String(url).slice(i + marker.length).split('?')[0]);
}

// Borra un archivo viejo por su URL pública (no falla si no se puede: solo avisa).
async function removeByPublicUrl(supabase, url, log = console.log) {
  const p = storagePathFromPublicUrl(url);
  if (!p) return;
  const { error } = await supabase.storage.from(BUCKET).remove([p]);
  if (error) log('no se pudo borrar el archivo viejo (no es grave):', p, error.message);
}

// Dónde queda una toma recién generada:
//   - Si vino de fal.ai (pedida SIN vencimiento): se usa la URL de fal directamente. No se sube a
//     Supabase → no gasta espacio ni las descargas del plan gratis (5 GB/mes, se pasó a 21 GB).
//     Respaldo: el agente de la PC guarda una copia de cada toma en VYRALE/finales/.cache.
//   - Si vino de Google (Veo directo, sin URL pública): se sube a Supabase como antes.
// VYRALES_CLIPS_IN_SUPABASE=1 en el .env vuelve al comportamiento anterior.
async function storeClip(supabase, { veo, path: storagePath }) {
  if (veo && veo.falUrl && process.env.VYRALES_CLIPS_IN_SUPABASE !== '1') return veo.falUrl;
  return uploadClip(supabase, { path: storagePath, buffer: veo.videoBuffer });
}

module.exports = { BUCKET, ensureMediaBucket, uploadClip, storeClip, uploadFile, storagePathFromPublicUrl, removeByPublicUrl };
