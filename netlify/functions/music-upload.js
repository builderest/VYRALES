// POST { series, filename, content_type } → { upload_url, public_url }
// URL firmada para que el navegador suba la música de fondo DIRECTO a Supabase Storage
// (sin pasar por la función, que tiene límite de 6 MB). Máx. recomendado: 15 MB, mp3/m4a/wav.
const { getSupabaseClient } = require('./_supabase');
const { BUCKET, ensureMediaBucket } = require('./_storage');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ALLOWED = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg' };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const body = JSON.parse(event.body || '{}');
    const ext = ALLOWED[body.content_type];
    if (!ext) return json(400, { error: 'Formato de audio no permitido. Usa MP3, M4A, WAV u OGG.' });
    const slug = String(body.series || 'sin_serie').replace(/[^a-z0-9_]/g, '');
    const supabase = getSupabaseClient();
    await ensureMediaBucket(supabase);
    const path = `${slug}/music/${Date.now()}.${ext}`;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw error;
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return json(200, { upload_url: data.signedUrl, public_url: pub.publicUrl, path });
  } catch (err) {
    console.error('[music-upload] ERROR:', err);
    return json(500, { error: err.message });
  }
};
