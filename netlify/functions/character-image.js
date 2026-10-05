// POST /.netlify/functions/character-image
//
// Sube (o quita) la imagen de referencia de UN personaje — el botón "Subir foto" de cada
// ficha del Elenco en el dashboard.
//
//   Subir:  { character_id, content_type: 'image/jpeg'|'image/png'|'image/webp', data_base64 }
//   Quitar: { character_id, remove: true }
//
// La imagen se guarda en Supabase Storage (bucket "media", carpeta characters/<serie>/) y su
// URL pública queda en characters.reference_image_url. El nombre lleva la fecha para que el
// navegador no muestre una versión vieja en caché al reemplazarla.
//
// El dashboard reduce la foto en el navegador antes de mandarla (máx. 1280 px, JPEG), así el
// body queda muy por debajo del límite de ~6 MB de las funciones de Netlify.
// No llama a ninguna API de pago.
const { getSupabaseClient } = require('./_supabase');
const { ensureMediaBucket, uploadFile } = require('./_storage');

const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 4 * 1024 * 1024;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return json(400, { error: 'Body JSON inválido (¿la imagen es demasiado grande?).' });
  }
  if (!body.character_id) return json(400, { error: 'Falta character_id.' });

  try {
    const supabase = getSupabaseClient();
    const { data: character, error: charError } = await supabase
      .from('characters')
      .select('id, name, series:series_id(slug)')
      .eq('id', body.character_id)
      .single();
    if (charError || !character) return json(404, { error: 'Personaje no encontrado.' });

    if (body.remove) {
      const { error } = await supabase.from('characters').update({ reference_image_url: null }).eq('id', character.id);
      if (error) throw error;
      console.log('[character-image] foto quitada:', character.name);
      return json(200, { character_id: character.id, reference_image_url: null });
    }

    const ext = ALLOWED[body.content_type];
    if (!ext) return json(400, { error: 'Formato no permitido. Usa JPG, PNG o WEBP.' });
    if (!body.data_base64) return json(400, { error: 'Falta la imagen.' });

    const buffer = Buffer.from(body.data_base64, 'base64');
    if (buffer.length === 0) return json(400, { error: 'La imagen está vacía.' });
    if (buffer.length > MAX_BYTES) return json(413, { error: 'La imagen pesa más de 4 MB.' });

    await ensureMediaBucket(supabase);
    const slug = (character.series && character.series.slug) || 'sin_serie';
    const storagePath = `characters/${slug}/${character.id}-${Date.now()}.${ext}`;
    const publicUrl = await uploadFile(supabase, { path: storagePath, buffer, contentType: body.content_type });

    const { error: updateError } = await supabase
      .from('characters')
      .update({ reference_image_url: publicUrl })
      .eq('id', character.id);
    if (updateError) throw updateError;

    console.log('[character-image] foto subida:', character.name, publicUrl, Math.round(buffer.length / 1024) + ' KB');
    return json(200, { character_id: character.id, reference_image_url: publicUrl });
  } catch (err) {
    console.error('[character-image] ERROR:', err);
    return json(500, { error: err.message });
  }
};
