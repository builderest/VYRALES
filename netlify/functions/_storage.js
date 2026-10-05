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
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType,
    upsert: true
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

module.exports = { BUCKET, ensureMediaBucket, uploadClip, uploadFile };
