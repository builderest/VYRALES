// TEMPORAL — SOLO LOCAL: corrige el prompt guardado de la toma 8 (cliffhanger) del
// episodio #1. Veo generó un tiroteo/persecución que NO está en el guion real — el guion
// solo dice que Kenji lleva la mano a su arma (sin dispararla) y que la IA le susurra una
// palabra a Elena. El prompt viejo era el texto narrativo en español tal cual, que Veo
// interpretó mal; este es un prompt en inglés, más literal y visual, sin ninguna acción de
// disparo.
//
// Ábrelo una vez en el navegador mientras corre `netlify dev`:
//   http://localhost:8888/.netlify/functions/fix-shot8-prompt
// Después, dale a "Regenerar" en la toma 8 del dashboard — regen-shot.js reusa el prompt
// que quede guardado, así que va a usar este nuevo automáticamente.
// Bórralo después de usarlo una vez.
const { getSupabaseClient } = require('./_supabase');

const NEW_PROMPT_SHOT8 =
  'Neo-Tokyo 2089, rain-slicked corporate skyscraper interior, tense cyberpunk thriller. ' +
  'Characters: 25yo cybernetic engineer female, short silver hair, glowing violet ocular lens, cyberpunk street jacket; ' +
  '35yo Japanese male operative, sharp black tech suit, clean jawline with subtle scar, intense gaze. ' +
  'Vertical 9:16 cinematic shot, photorealistic, consistent lighting. ' +
  "Kenji's hand slowly rests on the grip of his holstered sidearm — a controlled, threatening gesture, he does NOT draw or fire it. " +
  'Through the rain-streaked window behind them, a security drone sweeps a harsh white spotlight across the lab interior. ' +
  'Elena is backed against the window, cornered, no way out. ' +
  "Her violet ocular lens suddenly flickers and pulses brighter — her eyes widen with shock as she hears something only she can hear. " +
  'Hold on her stunned expression. Hard cut to black.';

exports.handler = async () => {
  try {
    const supabase = getSupabaseClient();
    const seriesSlug = process.env.DEFAULT_SERIES_SLUG || 'dragon_silicio';

    const { data: series, error: seriesError } = await supabase
      .from('series')
      .select('id')
      .eq('slug', seriesSlug)
      .single();
    if (seriesError || !series) throw seriesError || new Error('Serie no encontrada');

    const { data: episode, error: episodeError } = await supabase
      .from('episodes')
      .select('id, episode_number')
      .eq('series_id', series.id)
      .eq('episode_number', 1)
      .single();
    if (episodeError || !episode) throw episodeError || new Error('Episodio #1 no encontrado');

    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .select('id, shot_number, prompt')
      .eq('episode_id', episode.id)
      .eq('kind', 'video_clip')
      .eq('shot_number', 8)
      .single();
    if (assetError || !asset) throw assetError || new Error('No encontré la toma 8 del episodio 1');

    const { data: updated, error: updateError } = await supabase
      .from('assets')
      .update({ prompt: NEW_PROMPT_SHOT8 })
      .eq('id', asset.id)
      .select()
      .single();
    if (updateError) throw updateError;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_prompt: asset.prompt, new_prompt: updated.prompt, asset_id: updated.id })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
