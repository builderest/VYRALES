// Registro de gastos: una fila por cada llamada que cuesta dinero (video de Veo o imagen de
// Gemini), aunque después se regenere. El dashboard suma esta tabla para mostrar el gasto
// REAL acumulado (ver supabase/migrations/004_registro_de_gastos.sql).
// Nunca rompe la generación: si no se puede anotar, solo avisa en el log.
// MULTIUSUARIO (migración 009): cada fila lleva el espacio dueño, y si ese espacio usó una clave
// PRESTADA por el admin, se le descuentan créditos = costo × margen ÷ valor del crédito (ver _tenant.js).
const T = require('./_tenant');

async function wsForSpend(supabase, seriesId) {
  const c = T.current();
  if (c && c.wsId) return c.wsId;
  if (process.env.VYRALES_WS) return process.env.VYRALES_WS; // trabajo del agente para otro espacio
  if (seriesId) {
    try { const { data } = await supabase.from('series').select('workspace_id').eq('id', seriesId).maybeSingle(); if (data && data.workspace_id) return data.workspace_id; } catch (_) {}
  }
  return T.ADMIN_WS;
}
function serviceOf(model) {
  const m = String(model || '');
  if (/^fal_|fal/i.test(m)) return 'fal';
  if (/claude_plan|^ltx|king|local/i.test(m)) return null; // plan de Claude o PC: no es una API prestada
  return 'google';
}

async function logSpend(supabase, { seriesId, episodeId = null, shotNumber = null, kind, model = null, costUsd = 0, note = null }) {
  try {
    const on = await T.tenancyOn(supabase);
    const ws = on ? await wsForSpend(supabase, seriesId) : null;
    const { error } = await supabase.from('generation_log').insert(Object.assign({
      series_id: seriesId || null,
      episode_id: episodeId,
      shot_number: shotNumber,
      kind,
      model,
      cost_usd: Number(costUsd) || 0,
      note
    }, on ? { workspace_id: ws } : {}));
    if (error) console.warn('[spend] no se pudo registrar el gasto:', error.message);
    if (on && ws !== T.ADMIN_WS && Number(costUsd) > 0) {
      try { await T.chargeApiUse(supabase, { wsId: ws, service: serviceOf(model), costUsd: Number(costUsd), note: kind + (note ? ' · ' + note : '') }); }
      catch (e) { console.warn('[spend] no se pudieron cobrar créditos:', e.message); }
    }
  } catch (err) {
    console.warn('[spend] no se pudo registrar el gasto:', err.message);
  }
}

module.exports = { logSpend };
