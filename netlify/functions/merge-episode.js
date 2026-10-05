// ⚠️ SUPERADA — el dashboard ya NO llama a esta función. Úsala `merge-episode-background.js`
// en su lugar (misma lógica vía _merge.js, pero como background function — esta versión
// síncrona corre el mismo riesgo de los ~30s de límite de Netlify que tenía regen-shot.js,
// porque descargar 8 clips + recodificar con ffmpeg puede tardar más que eso). Se deja aquí
// sin usar — candidata a borrar en la limpieza antes de producción.
//
// POST /.netlify/functions/merge-episode   body: { episode_id }  (opcional — sin body,
// toma el episodio más reciente en "en_revision")
//
// Botón manual "Unir / Rehacer" en el dashboard. El pipeline normal ya NO necesita esto:
// generate-media-background.js llama a la misma lógica automáticamente en cuanto las 8
// tomas terminan de generarse con éxito. Este endpoint queda como respaldo — por si esa
// unión automática falló, o si regeneraste una toma individual (regen-shot.js) y quieres
// actualizar el video final completo con la toma nueva.
const { getSupabaseClient } = require('./_supabase');
const { mergeEpisodeVideo } = require('./_merge');

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

  try {
    const { data: series, error: seriesError } = await supabase
      .from('series')
      .select('id, slug, story_bible')
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
      log: (...args) => console.log('[merge-episode]', ...args)
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ episode_id: episode.id, final_render: result.asset, shots_joined: result.shots_joined })
    };
  } catch (err) {
    console.error('[merge-episode] ERROR:', err, err.stderr || '');
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
