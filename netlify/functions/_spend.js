// Registro de gastos: una fila por cada llamada que cuesta dinero (video de Veo o imagen de
// Gemini), aunque después se regenere. El dashboard suma esta tabla para mostrar el gasto
// REAL acumulado (ver supabase/migrations/004_registro_de_gastos.sql).
// Nunca rompe la generación: si no se puede anotar, solo avisa en el log.
async function logSpend(supabase, { seriesId, episodeId = null, shotNumber = null, kind, model = null, costUsd = 0, note = null }) {
  try {
    const { error } = await supabase.from('generation_log').insert({
      series_id: seriesId || null,
      episode_id: episodeId,
      shot_number: shotNumber,
      kind,
      model,
      cost_usd: Number(costUsd) || 0,
      note
    });
    if (error) console.warn('[spend] no se pudo registrar el gasto:', error.message);
  } catch (err) {
    console.warn('[spend] no se pudo registrar el gasto:', err.message);
  }
}

module.exports = { logSpend };
