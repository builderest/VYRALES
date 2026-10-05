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

    // Gasto REAL (tabla generation_log): de esta serie y del mes en curso (todas las series).
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const [{ data: seriesSpend }, { data: monthSpend }] = await Promise.all([
      supabase.from('generation_log').select('kind, cost_usd').eq('series_id', series.id),
      supabase.from('generation_log').select('cost_usd').gte('created_at', monthStart)
    ]);
    const spend = { series_total: 0, month_total: 0, by_kind: {}, generations: 0 };
    (seriesSpend || []).forEach((r) => {
      const c = Number(r.cost_usd) || 0;
      spend.series_total += c;
      spend.by_kind[r.kind] = (spend.by_kind[r.kind] || 0) + c;
      spend.generations++;
    });
    (monthSpend || []).forEach((r) => (spend.month_total += Number(r.cost_usd) || 0));

    // Cuota diaria de Veo (Google la reinicia a medianoche hora del Pacífico): videos hechos
    // HOY por modelo, en todas las series. Lite en Nivel 1 = 10 por día.
    const now = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(now).map((p) => [p.type, p.value]));
    const ptAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const offsetMs = ptAsUtc - Math.floor(now.getTime() / 1000) * 1000;
    const dayStartUtc = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offsetMs);
    const { data: todayVideos } = await supabase
      .from('generation_log').select('model').eq('kind', 'video').gte('created_at', dayStartUtc.toISOString());
    spend.veo_today = { by_model: {}, day_start: dayStartUtc.toISOString(), limits: { veo_lite: 10, veo_fast: 10 } };
    (todayVideos || []).forEach((r) => { spend.veo_today.by_model[r.model] = (spend.veo_today.by_model[r.model] || 0) + 1; });

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
        channels_count: channelsCount || 0,
        spend
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
