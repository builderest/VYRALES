// POST /.netlify/functions/merge-episode-background   body: { episode_id }  (opcional)
//
// Botón "Unir / Rehacer" del dashboard. Descarga las tomas, las une con ffmpeg, sube el
// resultado — ver _merge.js para la lógica real.
//
// Por qué es background function y no una normal: descargar 8 clips + recodificar con
// ffmpeg puede tardar más de los ~30 segundos que corta una función normal de Netlify (el
// mismo problema que tenía `regen-shot.js` con Veo — ver esa función para más detalle).
// `merge-episode.js` (sin "-background") queda sin usar, candidata a borrar en la limpieza
// antes de producción.
//
// El dashboard no espera la respuesta (background functions responden 202 de inmediato) —
// hace polling a get-episodes y detecta que terminó cuando aparece/cambia el `updated_at`
// del asset `final_render` (lo actualiza un trigger de Postgres, ver supabase/schema.sql).
const { getSupabaseClient } = require('./_supabase');
const { mergeEpisodeVideo } = require('./_merge');

const LOG = '[merge-episode]';

exports.handler = async (event) => {
  const supabase = getSupabaseClient();
  const seriesSlug = process.env.DEFAULT_SERIES_SLUG || 'dragon_silicio';
  const qs = event.queryStringParameters || {};
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    body = {};
  }
  const episodeId = body.episode_id || qs.episode_id;
  console.log(LOG, 'arrancó. episode_id=', episodeId || '(ninguno, toma el más reciente en en_revision)');

  try {
    const { data: series, error: seriesError } = await supabase
      .from('series')
      .select('id, slug')
      .eq('slug', seriesSlug)
      .single();
    if (seriesError || !series) throw seriesError || new Error('Serie no encontrada');

    let episodeQuery = supabase.from('episodes').select('*, assets(*)').eq('series_id', series.id);
    episodeQuery = episodeId
      ? episodeQuery.eq('id', episodeId)
      : episodeQuery.eq('status', 'en_revision').order('episode_number', { ascending: false }).limit(1);

    const { data: episodes, error: episodeError } = await episodeQuery;
    if (episodeError) throw episodeError;
    const episode = episodes && episodes[0];
    if (!episode) {
      throw new Error('No encontré un episodio "en_revision" para unir. Pasa ?episode_id=<uuid> si quieres uno específico.');
    }

    const result = await mergeEpisodeVideo(supabase, {
      episode,
      series,
      log: (...args) => console.log(LOG, ...args)
    });

    console.log(LOG, 'listo ✅. Video final:', result.asset.storage_path);
    return {
      statusCode: 200,
      body: JSON.stringify({ episode_id: episode.id, final_render: result.asset, shots_joined: result.shots_joined })
    };
  } catch (err) {
    console.error(LOG, 'ERROR:', err, err.stderr || '');
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
