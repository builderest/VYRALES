// ⚠️ SUPERADA — el dashboard ya NO llama a esta función. Úsala `regen-shot-background.js`
// en su lugar (misma lógica, pero como background function — esta versión síncrona se
// quedaba corta contra el límite de ~30s de Netlify cuando Veo tardaba más de eso, que es
// casi siempre). Se deja aquí sin usar por ahora — candidata a borrar en la limpieza antes
// de producción (junto con seed-characters.js / seed-script-episode1.js).
//
// POST /.netlify/functions/regen-shot   body: { assetId }
// Regenera UNA toma puntual con Veo, reusando el mismo prompt que se guardó la primera
// vez (assets.prompt), y reemplaza el video en Supabase Storage. Consume la API de Veo
// de verdad (cargo real, igual que generate-media-background).
const { getSupabaseClient } = require('./_supabase');
const { uploadClip } = require('./_storage');
const { generateVeoClip } = require('./_veo');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const { assetId } = JSON.parse(event.body || '{}');
    if (!assetId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta assetId' }) };
    }
    const supabase = getSupabaseClient();

    const { data: asset, error: fetchError } = await supabase
      .from('assets')
      .select('*')
      .eq('id', assetId)
      .single();
    if (fetchError || !asset) throw fetchError || new Error('Toma no encontrada');
    if (!asset.prompt) throw new Error('Esta toma no tiene un prompt guardado para regenerar.');

    const { data: episode, error: episodeError } = await supabase
      .from('episodes')
      .select('episode_number, series:series_id(slug)')
      .eq('id', asset.episode_id)
      .single();
    if (episodeError || !episode) throw episodeError || new Error('Episodio no encontrado');

    const modelKey = ['veo_lite', 'veo_fast', 'veo_standard'].includes(asset.model) ? asset.model : 'veo_lite';
    const { videoBuffer, costUsd, model } = await generateVeoClip({ modelKey, prompt: asset.prompt });

    const storagePath = `${episode.series.slug}/ep${episode.episode_number}/shot-${String(asset.shot_number).padStart(2, '0')}.mp4`;
    const publicUrl = await uploadClip(supabase, { path: storagePath, buffer: videoBuffer });

    const { data: updated, error: updateError } = await supabase
      .from('assets')
      .update({ storage_path: publicUrl, cost_usd: costUsd, approved: false, approved_at: null })
      .eq('id', assetId)
      .select()
      .single();
    if (updateError) throw updateError;

    return { statusCode: 200, body: JSON.stringify({ asset: updated, model }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
