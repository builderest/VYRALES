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
const { BUCKET, uploadClip } = require('./_storage');

// De una URL pública de Supabase Storage saca la ruta interna dentro del bucket.
// https://<proyecto>.supabase.co/storage/v1/object/public/media/<ruta> → <ruta>
function storagePathFromPublicUrl(url) {
  const marker = `/object/public/${BUCKET}/`;
  const i = String(url || '').indexOf(marker);
  return i === -1 ? null : decodeURIComponent(String(url).slice(i + marker.length).split('?')[0]);
}
const { generateVeoClip, loadReferenceImages } = require('./_veo');
const { buildShotPrompt, referenceUrlsForShot } = require('./_series');

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
    const { data: episode, error: episodeError } = await supabase
      .from('episodes')
      .select('episode_number, shots, series_id, series:series_id(slug, story_bible)')
      .eq('id', asset.episode_id)
      .single();
    if (episodeError || !episode) throw episodeError || new Error('Episodio no encontrado');

    // Novelas con tomas estructuradas: el prompt se RECONSTRUYE con el guion y los
    // personajes actuales, así cualquier corrección (vestuario, cámara, reglas del prompt)
    // se aplica al regenerar. Series viejas: se reusa el prompt guardado como antes.
    let prompt = asset.prompt;
    let referenceImages = [];
    const shot = Array.isArray(episode.shots) ? episode.shots.find((x) => x.n === asset.shot_number) : null;
    if (shot) {
      const { data: characters, error: charsError } = await supabase
        .from('characters')
        .select('name, fixed_prompt_tag, profile, reference_image_url')
        .eq('series_id', episode.series_id);
      if (charsError) throw charsError;
      const sb = (episode.series && episode.series.story_bible) || {};
      prompt = buildShotPrompt(shot, characters, sb);
      if (sb.rules && sb.rules.reference_images) {
        referenceImages = await loadReferenceImages(referenceUrlsForShot(shot, characters));
      }
      console.log(LOG, 'prompt reconstruido desde el guion actual (toma', asset.shot_number + ').');
    }
    if (!prompt) throw new Error('Esta toma no tiene un prompt para regenerar.');

    // Con fotos de referencia la toma necesita un modelo que las acepte (la regla de la serie
    // manda sobre el modelo con el que se generó la versión anterior).
    const rules = (episode.series && episode.series.story_bible && episode.series.story_bible.rules) || {};
    let modelKey = ['veo_lite', 'veo_fast', 'veo_standard'].includes(asset.model) ? asset.model : 'veo_lite';
    if (referenceImages.length) modelKey = rules.shot_model === 'veo_standard' ? 'veo_standard' : 'veo_fast';
    console.log(LOG, 'generando con Veo (' + modelKey + ')... esto tarda un rato.');
    const { videoBuffer, costUsd, model } = await generateVeoClip({ modelKey, prompt, referenceImages });
    console.log(LOG, 'Veo terminó, subiendo a Supabase Storage...');

    // Nombre con versión: si se reusara shot-NN.mp4, la caché del navegador/CDN podría
    // seguir mostrando el video viejo después de regenerar.
    const storagePath = `${episode.series.slug}/ep${episode.episode_number}/shot-${String(asset.shot_number).padStart(2, '0')}-v${Date.now()}.mp4`;
    const publicUrl = await uploadClip(supabase, { path: storagePath, buffer: videoBuffer });

    const { data: updated, error: updateError } = await supabase
      .from('assets')
      .update({ storage_path: publicUrl, prompt, model: modelKey, cost_usd: costUsd, approved: false, approved_at: null })
      .eq('id', assetId)
      .select()
      .single();
    if (updateError) throw updateError;

    // Recién AHORA (video nuevo subido y guardado en la base) se borra el archivo viejo de
    // Storage, para no acumular clips sin uso. Si algo falló antes, el viejo sigue intacto.
    const oldPath = storagePathFromPublicUrl(asset.storage_path);
    if (oldPath && oldPath !== storagePath) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([oldPath]);
      if (removeError) console.warn(LOG, 'no se pudo borrar el archivo viejo (no es grave):', oldPath, removeError.message);
      else console.log(LOG, 'archivo viejo borrado de Storage:', oldPath);
    }

    console.log(LOG, 'listo ✅. Toma', updated.shot_number, 'regenerada:', publicUrl);
    return { statusCode: 200, body: JSON.stringify({ asset: updated, model }) };
  } catch (err) {
    console.error(LOG, 'ERROR:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
