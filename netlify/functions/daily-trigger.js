// Scheduled function — Netlify la corre sola todos los días (ver netlify.toml).
// Por ahora solo crea la fila del próximo episodio en estado "guion_pendiente".
// El guion en sí lo escribe la tarea programada de Claude (ver /claude_tasks/),
// que luego actualiza esta misma fila con el texto y el estado "guion_generado".
const { getSupabaseClient } = require('./_supabase');

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

    const { data: last } = await supabase
      .from('episodes')
      .select('episode_number')
      .eq('series_id', series.id)
      .order('episode_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextNumber = last ? last.episode_number + 1 : 1;

    const { data: created, error: insertError } = await supabase
      .from('episodes')
      .insert({ series_id: series.id, episode_number: nextNumber, status: 'guion_pendiente' })
      .select()
      .single();
    if (insertError) throw insertError;

    return { statusCode: 200, body: JSON.stringify({ created }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
