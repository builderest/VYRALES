// GET /.netlify/functions/get-episodes?series=dragon_silicio
// Devuelve los episodios de una serie con sus assets, para pintar el dashboard.
const { getSupabaseClient } = require('./_supabase');

exports.handler = async (event) => {
  try {
    const seriesSlug = event.queryStringParameters && event.queryStringParameters.series;
    const supabase = getSupabaseClient();

    const { data: series, error: seriesError } = await supabase
      .from('series')
      .select('id, slug, title, genre, story_bible')
      .eq('slug', seriesSlug || 'dragon_silicio')
      .single();

    if (seriesError || !series) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Serie no encontrada' })
      };
    }

    const { data: episodes, error: episodesError } = await supabase
      .from('episodes')
      .select('*, assets(*)')
      .eq('series_id', series.id)
      .order('episode_number', { ascending: false })
      .limit(20);

    if (episodesError) throw episodesError;

    const { data: characters } = await supabase
      .from('characters')
      .select('*')
      .eq('series_id', series.id);

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
        episodes,
        characters: characters || [],
        channels_count: channelsCount || 0
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
