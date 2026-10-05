// POST /.netlify/functions/location-image-background   body: { series, location_key, prompt? }
// Genera con Gemini la IMAGEN FIJA de un lugar de la novela (memoria visual). Se guarda en
// series.visual_memory.locations[<key>] y se reutiliza como referencia en el cuadro inicial
// de cada toma de ese lugar. Cuesta ~$0.067. `prompt` opcional = prompt editado en el modal.
const { getSupabaseClient } = require('./_supabase');
const { createLocationImage } = require('./_keyframe');

const LOG = '[location-image]';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    const supabase = getSupabaseClient();
    const { data: series, error } = await supabase.from('series').select('id, slug, story_bible, visual_memory').eq('slug', body.series || '').single();
    if (error || !series) throw error || new Error('Serie no encontrada');
    const key = String(body.location_key || '');
    const { url } = await createLocationImage(supabase, {
      seriesId: series.id, slug: series.slug, storyBible: series.story_bible, key,
      prompt: body.prompt, log: (...a) => console.log(LOG, ...a)
    });
    return { statusCode: 200, body: JSON.stringify({ location_key: key, url }) };
  } catch (err) {
    console.error(LOG, 'ERROR:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
