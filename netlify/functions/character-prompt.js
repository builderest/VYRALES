// Prompt editable de la foto de un personaje (modal "Generar foto").
//   GET  ?character_id=<uuid>                 → { prompt, original, edited }
//   POST { character_id, prompt }             → guarda el prompt editado
//   POST { character_id, reset: true }        → vuelve al automático
//   POST { character_id, style_reference: bool } → usar (o no) su foto como referencia de estilo
// Se guarda en characters.profile.image_prompt_override. No cuesta dinero.
const { getSupabaseClient } = require('./_supabase');
const { buildImagePrompt } = require('./_series');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  try {
    const supabase = getSupabaseClient();
    const input = event.httpMethod === 'GET' ? event.queryStringParameters || {} : JSON.parse(event.body || '{}');
    const { data: ch, error } = await supabase
      .from('characters')
      .select('id, fixed_prompt_tag, profile, series:series_id(story_bible)')
      .eq('id', input.character_id || '')
      .single();
    if (error || !ch) return json(404, { error: 'Personaje no encontrado.' });
    const profile = Object.assign({}, ch.profile || {});
    const original = profile.image_prompt || buildImagePrompt({ fixed_prompt_tag: ch.fixed_prompt_tag }, ch.series && ch.series.story_bible);

    if (event.httpMethod === 'GET') {
      const edited = !!(profile.image_prompt_override && profile.image_prompt_override.trim());
      return json(200, { prompt: edited ? profile.image_prompt_override : original, original, edited });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    if (typeof input.style_reference === 'boolean') {
      profile.style_reference = input.style_reference;
      const { error: e2 } = await supabase.from('characters').update({ profile }).eq('id', ch.id);
      if (e2) throw e2;
      return json(200, { style_reference: profile.style_reference });
    }
    if (input.reset) delete profile.image_prompt_override;
    else {
      const p = String(input.prompt || '').trim();
      if (p.length < 20) return json(400, { error: 'El prompt está vacío o es demasiado corto.' });
      if (p === original) delete profile.image_prompt_override; else profile.image_prompt_override = p;
    }
    const { error: upErr } = await supabase.from('characters').update({ profile }).eq('id', ch.id);
    if (upErr) throw upErr;
    return json(200, { prompt: profile.image_prompt_override || original, original, edited: !!profile.image_prompt_override });
  } catch (err) {
    console.error('[character-prompt] ERROR:', err);
    return json(500, { error: err.message });
  }
};
