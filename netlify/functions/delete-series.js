// POST /.netlify/functions/delete-series   body: { slug, confirm_slug }
//
// Borra una serie COMPLETA: la fila de `series` (y en cascada sus personajes, episodios y
// assets — ver ON DELETE CASCADE en supabase/schema.sql) más TODOS sus archivos en Supabase
// Storage (tomas, videos finales y fotos de referencia).
//
// Es PERMANENTE y no se puede deshacer. Por eso exige confirm_slug === slug: el dashboard
// le pide a Franklin escribir el slug a mano antes de llamar a esta función.
// No llama a ninguna API de pago.
const { getSupabaseClient } = require('./_supabase');
const { BUCKET } = require('./_storage');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

// Lista recursivamente todos los archivos bajo un prefijo del bucket.
async function listAll(storage, prefix) {
  const files = [];
  const { data, error } = await storage.list(prefix, { limit: 1000 });
  if (error) throw error;
  for (const entry of data || []) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null || entry.metadata === null) files.push(...(await listAll(storage, full))); // carpeta
    else files.push(full);
  }
  return files;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return json(400, { error: 'Body JSON inválido.' });
  }
  const slug = String(body.slug || '');
  if (!/^[a-z0-9_]{3,60}$/.test(slug)) return json(400, { error: 'slug inválido.' });
  if (body.confirm_slug !== slug) return json(400, { error: 'La confirmación no coincide con el slug. No se borró nada.' });

  try {
    const supabase = getSupabaseClient();
    const { data: series, error: seriesError } = await supabase.from('series').select('id, title').eq('slug', slug).maybeSingle();
    if (seriesError) throw seriesError;
    if (!series) return json(404, { error: 'La serie no existe.' });

    // 1) Archivos de Storage (si falla, no se borra la base: así no quedan filas apuntando a nada)
    const storage = supabase.storage.from(BUCKET);
    const files = [...(await listAll(storage, slug)), ...(await listAll(storage, `characters/${slug}`))];
    for (let i = 0; i < files.length; i += 100) {
      const { error } = await storage.remove(files.slice(i, i + 100));
      if (error) throw error;
    }

    // 2) Base de datos (cascada: personajes, episodios, assets, episode_channels)
    const { error: deleteError } = await supabase.from('series').delete().eq('id', series.id);
    if (deleteError) throw deleteError;

    console.log('[delete-series] serie borrada:', slug, '| archivos borrados:', files.length);
    return json(200, { deleted: slug, title: series.title, files_removed: files.length });
  } catch (err) {
    console.error('[delete-series] ERROR:', err);
    return json(500, { error: err.message });
  }
};
