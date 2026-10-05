// POST /.netlify/functions/regen-shot-background   body: { assetId }
//
// Regenera UNA toma puntual con Veo, reusando el mismo prompt guardado (assets.prompt), y
// reemplaza el video en Supabase Storage. Consume la API de Veo de verdad (cargo real,
// igual que generate-media-background).
//
// Por qué es background function y no una normal: Veo tarda entre ~11 segundos y varios
// minutos en generar un clip, y las funciones normales de Netlify (y `netlify dev` local)
// cortan la ejecución a los ~30 segundos ("Task timed out"). `regen-shot.js` (la versión
// vieja, sin "-background") se quedó corta por eso — esta es su reemplazo, el dashboard ya
// llama a esta. La vieja queda sin usar, se puede borrar en la limpieza antes de producción.
//
// El dashboard no espera la respuesta de esta función (las background functions responden
// 202 de inmediato) — hace polling a get-episodes y detecta que terminó cuando cambia el
// `updated_at` de la toma (lo actualiza un trigger de Postgres automáticamente en cada
// UPDATE, ver supabase/schema.sql).
const { getSupabaseClient } = require('./_supabase');
const { uploadClip } = require('./_storage');
const { generateVeoClip } = require('./_veo');

const LOG = '[regen-shot]';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const { assetId } = JSON.parse(event.body || '{}');
    if (!assetId) {
      console.error(LOG, 'falta assetId en el body');
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta assetId' }) };
    }
    console.log(LOG, 'arrancó. assetId=', assetId);
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
    console.log(LOG, 'generando con Veo (' + modelKey + ')... esto tarda un rato.');
    const { videoBuffer, costUsd, model } = await generateVeoClip({ modelKey, prompt: asset.prompt });
    console.log(LOG, 'Veo terminó, subiendo a Supabase Storage...');

    const storagePath = `${episode.series.slug}/ep${episode.episode_number}/shot-${String(asset.shot_number).padStart(2, '0')}.mp4`;
    const publicUrl = await uploadClip(supabase, { path: storagePath, buffer: videoBuffer });

    const { data: updated, error: updateError } = await supabase
      .from('assets')
      .update({ storage_path: publicUrl, cost_usd: costUsd, approved: false, approved_at: null })
      .eq('id', assetId)
      .select()
      .single();
    if (updateError) throw updateError;

    console.log(LOG, 'listo ✅. Toma', updated.shot_number, 'regenerada:', publicUrl);
    return { statusCode: 200, body: JSON.stringify({ asset: updated, model }) };
  } catch (err) {
    console.error(LOG, 'ERROR:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
