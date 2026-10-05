// GET /.netlify/functions/get-episodes?series=dragon_silicio
// Devuelve los episodios de una serie con sus assets, para pintar el dashboard.
const { getSupabaseClient } = require('./_supabase');

exports.handler = async (event) => {
  try {
    const seriesSlug =
      (event.queryStringParameters && event.queryStringParameters.series) ||
      process.env.DEFAULT_SERIES_SLUG ||
      'dragon_silicio';
    const supabase = getSupabaseClient();

    // Lista de todas las series para el selector del dashboard.
    const { data: allSeries } = await supabase
      .from('series')
      .select('id, slug, title, genre, created_at')
      .order('created_at', { ascending: false });

    const { data: series, error: seriesError } = await supabase
      .from('series')
      .select('id, slug, title, genre, synopsis, story_bible, visual_memory')
      .eq('slug', seriesSlug)
      .maybeSingle();

    if (seriesError || !series) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Serie no encontrada: ' + seriesSlug, all_series: allSeries || [] })
      };
    }

    const { data: episodes, error: episodesError } = await supabase
      .from('episodes')
      .select('*, assets(*)')
      .eq('series_id', series.id)
      .order('episode_number', { ascending: false })
      .limit(50);

    if (episodesError) throw episodesError;

    const { data: characters } = await supabase
      .from('characters')
      .select('*')
      .eq('series_id', series.id)
      .order('sort_order', { ascending: true });

    // Solo el conteo (head: true no trae filas, es barato) — para el panel de stats
    // reales del dashboard (nada de números de maqueta).
    const { count: channelsCount } = await supabase
      .from('channels')
      .select('id', { count: 'exact', head: true });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        series,
        all_series: allSeries || [],
        episodes,
        characters: characters || [],
        channels_count: channelsCount || 0
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
