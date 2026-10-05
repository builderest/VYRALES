// POST /.netlify/functions/location-image-background   body: { series, location_key, prompt? }
// Genera con Gemini la IMAGEN FIJA de un lugar de la novela (memoria visual). Se guarda en
// series.visual_memory.locations[<key>] y se reutiliza como referencia en el cuadro inicial
// de cada toma de ese lugar. Cuesta ~$0.067. `prompt` opcional = prompt editado en el modal.
const { getSupabaseClient } = require('./_supabase');
const { generateImage } = require('./_image');
const { buildLocationPrompt } = require('./_keyframe');
const { ensureMediaBucket, uploadFile, removeByPublicUrl } = require('./_storage');

const LOG = '[location-image]';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    const supabase = getSupabaseClient();
    const { data: series, error } = await supabase.from('series').select('id, slug, story_bible, visual_memory').eq('slug', body.series || '').single();
    if (error || !series) throw error || new Error('Serie no encontrada');
    const key = String(body.location_key || '');
    const vm = Object.assign({ locations: {} }, series.visual_memory || {});
    const old = vm.locations[key];
    const prompt = (body.prompt && String(body.prompt).trim()) || (old && old.prompt_override) || buildLocationPrompt(key, series.story_bible);

    console.log(LOG, 'generando lugar', key, '...');
    const img = await generateImage({ prompt });
    await ensureMediaBucket(supabase);
    const ext = img.mimeType.includes('jpeg') ? 'jpg' : 'png';
    const url = await uploadFile(supabase, { path: `${series.slug}/locations/${key}-v${Date.now()}.${ext}`, buffer: img.buffer, contentType: img.mimeType });

    // Se relee la memoria justo antes de guardar (por si otro lugar se generó en paralelo).
    const { data: fresh } = await supabase.from('series').select('visual_memory').eq('id', series.id).single();
    const vm2 = Object.assign({ locations: {} }, (fresh && fresh.visual_memory) || {});
    vm2.locations = Object.assign({}, vm2.locations, {
      [key]: {
        url,
        prompt,
        prompt_override: body.prompt ? String(body.prompt).trim() : (old && old.prompt_override) || undefined,
        cost_usd: img.costUsd,
        source: 'generated',
        updated_at: new Date().toISOString()
      }
    });
    const { error: upErr } = await supabase.from('series').update({ visual_memory: vm2 }).eq('id', series.id);
    if (upErr) throw upErr;
    if (old && old.url && old.url !== url) await removeByPublicUrl(supabase, old.url, (...a) => console.log(LOG, ...a));
    console.log(LOG, 'listo ✅', key, url);
    return { statusCode: 200, body: JSON.stringify({ location_key: key, url }) };
  } catch (err) {
    console.error(LOG, 'ERROR:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
