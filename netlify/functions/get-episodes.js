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
      // DEBUG TEMPORAL: exponemos el detalle real del error para diagnosticar
      // la conexión a Supabase en producción. Quitar este 'debug' una vez
      // confirmado que todo funciona.
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'Serie no encontrada',
          debug: seriesError ? { message: seriesError.message, code: seriesError.code, details: seriesError.details, hint: seriesError.hint } : null
        })
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

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ series, episodes, characters: characters || [] })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
