// GET /.netlify/functions/cerebro → lo que sabe el CEREBRO: patrones con evidencia (estado, casos, tasa vs base, en
// cuántos episodios), fiabilidad del juez del QA, arreglos que funcionaron, análisis de Claude y el diario del especialista.
const { getSupabaseClient } = require('./_supabase');
const M = require('./_memoria');
const C = require('./_cerebro');
const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
exports.handler = async () => {
  try {
    const sb = getSupabaseClient();
    const doc = await M.readJson(sb, C.RULES, null);
    const diario = await M.readJson(sb, C.DIARY, []);
    return json(200, { doc, diario: diario.slice(-40).reverse() });
  } catch (e) { return json(500, { error: e.message }); }
};
