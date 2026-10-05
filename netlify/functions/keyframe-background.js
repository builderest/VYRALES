// POST /.netlify/functions/keyframe-background   body: { episode_id, shot }
// Genera (o regenera) el CUADRO INICIAL de una toma con Gemini: fotos de cara de los
// personajes + imagen fija del lugar + prompt (el editado si existe). Cuesta ~$0.067.
// Background function: el dashboard hace polling hasta que aparece/cambia el asset 'image'.
const { getSupabaseClient } = require('./_supabase');
const { createKeyframe } = require('./_keyframe');

const LOG = '[keyframe]';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  try {
    const { episode_id: episodeId, shot: shotNumber } = JSON.parse(event.body || '{}');
    if (!episodeId || !shotNumber) throw new Error('Faltan episode_id o shot.');
    const supabase = getSupabaseClient();
    const { data: episode, error } = await supabase
      .from('episodes')
      .select('id, episode_number, shots, series_id, status, series:series_id(slug, story_bible, visual_memory)')
      .eq('id', episodeId)
      .single();
    if (error || !episode) throw error || new Error('Episodio no encontrado');
    if (episode.status === 'generando_media') throw new Error('El episodio se está generando: espera a que termine.');
    const shot = (episode.shots || []).find((s) => s.n === Number(shotNumber));
    if (!shot) throw new Error(`El episodio no tiene la toma ${shotNumber}.`);
    const { data: characters, error: cErr } = await supabase
      .from('characters')
      .select('name, fixed_prompt_tag, profile, reference_image_url')
      .eq('series_id', episode.series_id);
    if (cErr) throw cErr;

    const { asset } = await createKeyframe(supabase, {
      series: Object.assign({ id: episode.series_id }, episode.series),
      episode,
      shot,
      characters,
      log: (...a) => console.log(LOG, ...a)
    });
    console.log(LOG, 'listo ✅ toma', shot.n, asset.storage_path);
    return { statusCode: 200, body: JSON.stringify({ asset }) };
  } catch (err) {
    console.error(LOG, 'ERROR:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
