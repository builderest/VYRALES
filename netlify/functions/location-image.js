// Imagen fija de un lugar — acciones rápidas (no llaman a ninguna API de pago):
//   GET  ?series=<slug>&location_key=<key>                 → { prompt, original, edited, url }
//   POST { series, location_key, content_type, data_base64 } → subir una imagen propia
//   POST { series, location_key, remove: true }               → quitar la imagen
//   POST { series, location_key, prompt }                     → guardar prompt editado (sin generar)
//   POST { series, location_key, reset_prompt: true }         → volver al prompt automático
const { getSupabaseClient } = require('./_supabase');
const { buildLocationPrompt } = require('./_keyframe');
const { ensureMediaBucket, uploadFile, removeByPublicUrl } = require('./_storage');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

exports.handler = async (event) => {
  try {
    const supabase = getSupabaseClient();
    const input = event.httpMethod === 'GET' ? event.queryStringParameters || {} : JSON.parse(event.body || '{}');
    const { data: series, error } = await supabase.from('series').select('id, slug, story_bible, visual_memory').eq('slug', input.series || '').single();
    if (error || !series) return json(404, { error: 'Serie no encontrada' });
    const key = String(input.location_key || '');
    const original = buildLocationPrompt(key, series.story_bible);
    const vm = Object.assign({ locations: {} }, series.visual_memory || {});
    const cur = vm.locations[key] || {};

    if (event.httpMethod === 'GET') {
      return json(200, { prompt: cur.prompt_override || original, original, edited: !!cur.prompt_override, url: cur.url || null });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    let next = Object.assign({}, cur);
    if (input.remove) {
      if (cur.url) await removeByPublicUrl(supabase, cur.url);
      next = cur.prompt_override ? { prompt_override: cur.prompt_override } : null;
    } else if (input.reset_prompt) {
      delete next.prompt_override;
    } else if (input.prompt !== undefined && !input.data_base64) {
      const p = String(input.prompt || '').trim();
      if (p.length < 20) return json(400, { error: 'El prompt está vacío o es demasiado corto.' });
      if (p === original) delete next.prompt_override; else next.prompt_override = p;
    } else {
      const ext = ALLOWED[input.content_type];
      if (!ext || !input.data_base64) return json(400, { error: 'Imagen inválida (JPG, PNG o WEBP).' });
      const buffer = Buffer.from(input.data_base64, 'base64');
      if (buffer.length > 4 * 1024 * 1024) return json(413, { error: 'La imagen pesa más de 4 MB.' });
      await ensureMediaBucket(supabase);
      const url = await uploadFile(supabase, { path: `${series.slug}/locations/${key}-v${Date.now()}.${ext}`, buffer, contentType: input.content_type });
      if (cur.url && cur.url !== url) await removeByPublicUrl(supabase, cur.url);
      next = Object.assign(next, { url, source: 'uploaded', cost_usd: 0, updated_at: new Date().toISOString() });
    }
    vm.locations = Object.assign({}, vm.locations);
    if (next && Object.keys(next).length) vm.locations[key] = next; else delete vm.locations[key];
    const { error: upErr } = await supabase.from('series').update({ visual_memory: vm }).eq('id', series.id);
    if (upErr) throw upErr;
    const saved = vm.locations[key] || {};
    return json(200, { location_key: key, url: saved.url || null, prompt: saved.prompt_override || original, edited: !!saved.prompt_override });
  } catch (err) {
    console.error('[location-image] ERROR:', err);
    return json(500, { error: err.message });
  }
};
