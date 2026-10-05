// TEMPORAL — SOLO LOCAL: siembra los dos personajes fijos de la serie en Supabase.
// Ábrelo una vez en el navegador mientras corre `netlify dev`:
//   http://localhost:8888/.netlify/functions/seed-characters
// Es idempotente (si ya existen, no los duplica). Bórralo cuando ya no lo necesites.
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

    const characters = [
      {
        series_id: series.id,
        name: 'Elena Vance',
        role: 'protagonista',
        description: 'Ingeniera cibernética rebelde. Pelo corto plateado, chaqueta de cuero con neón violeta, prótesis ocular derecha.',
        fixed_prompt_tag: '25yo cybernetic engineer female, short silver hair, glowing violet ocular lens, cyberpunk street jacket'
      },
      {
        series_id: series.id,
        name: 'Kenji Sato',
        role: 'antagonista',
        description: 'Agente corporativo de SilicoCorp. Traje táctico de corte limpio, cicatriz diagonal en barbilla, mirada implacable.',
        fixed_prompt_tag: '35yo Japanese male operative, sharp black tech suit, clean jawline with subtle scar, intense gaze'
      }
    ];

    const results = [];
    for (const c of characters) {
      const { data: existing } = await supabase
        .from('characters')
        .select('id')
        .eq('series_id', series.id)
        .eq('name', c.name)
        .maybeSingle();

      if (existing) {
        results.push({ name: c.name, status: 'ya existía', id: existing.id });
        continue;
      }

      const { data: inserted, error: insertError } = await supabase
        .from('characters')
        .insert(c)
        .select()
        .single();
      if (insertError) throw insertError;
      results.push({ name: c.name, status: 'creado', id: inserted.id });
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
