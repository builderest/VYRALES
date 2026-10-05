// POST /.netlify/functions/character-photo-background
//   { character_id }                → genera (o regenera) la foto de ese personaje
//   { series, only_missing: true }  → genera las fotos que faltan de toda la serie, en orden
//                                     (protagonistas primero: la primera fija el estilo)
// Cada foto cuesta ~$0.067 (Gemini). Background: el dashboard hace polling.
const { getSupabaseClient } = require('./_supabase');
const { createCharacterPhoto } = require('./_character_photo');

const LOG = '[character-photo]';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    const supabase = getSupabaseClient();
    let seriesId = null;
    if (body.character_id) {
      const { data: ch } = await supabase.from('characters').select('series_id').eq('id', body.character_id).single();
      seriesId = ch && ch.series_id;
    } else {
      const { data: s } = await supabase.from('series').select('id').eq('slug', body.series || '').single();
      seriesId = s && s.id;
    }
    if (!seriesId) throw new Error('Serie o personaje no encontrado.');
    const { data: series } = await supabase.from('series').select('id, slug, story_bible').eq('id', seriesId).single();
    const loadChars = async () => {
      const { data, error } = await supabase
        .from('characters')
        .select('id, name, role, fixed_prompt_tag, profile, reference_image_url, sort_order')
        .eq('series_id', seriesId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data || [];
    };

    let chars = await loadChars();
    const targets = body.character_id
      ? chars.filter((c) => c.id === body.character_id)
      : chars.filter((c) => !c.reference_image_url);
    const done = [];
    const failed = [];
    for (const target of targets) {
      try {
        await createCharacterPhoto(supabase, { series, character: target, allCharacters: chars, log: (...a) => console.log(LOG, ...a) });
        done.push(target.name);
        chars = await loadChars(); // la recién creada sirve de referencia de estilo para la siguiente
      } catch (err) {
        console.error(LOG, 'falló', target.name, err.message);
        failed.push(target.name);
      }
    }
    console.log(LOG, 'listo ✅', done.join(', '), failed.length ? '| fallaron: ' + failed.join(', ') : '');
    return { statusCode: 200, body: JSON.stringify({ done, failed }) };
  } catch (err) {
    console.error(LOG, 'ERROR:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
