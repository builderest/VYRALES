// OBJECIONES DEL CEREBRO (Franklin oct-14): cuando el cerebro NO está de acuerdo con un cambio, no lo hace y lo explica.
//   GET                                        → { pendientes, recientes }
//   POST { id, decision: 'forzar' | 'propuesta' | 'descartar' }
//     forzar    → "hazlo igual": se aplica lo que pidió Franklin y queda marcado como experimento (¿quién tenía razón?)
//     propuesta → se usa la solución que propuso el cerebro (en reglas: se guarda la regla reescrita)
//     descartar → "tienes razón": no se hace nada
// Para tomas, el "hazlo igual" lo hace el panel reenviando el cambio con forzar:true (así pasa por la misma puerta).
const { getSupabaseClient } = require('./_supabase');
const { checkDashboardKey } = require('./_auth');
const M = require('./_memoria');
const C = require('./_cerebro');
const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  try {
    const sb = getSupabaseClient();
    const list = await C.listObjeciones(sb);
    if (event.httpMethod === 'GET') {
      return json(200, { pendientes: list.filter((o) => o.estado === 'pendiente').reverse(), recientes: list.filter((o) => o.estado !== 'pendiente').slice(-15).reverse() });
    }
    const bad = checkDashboardKey(event); if (bad) return json(401, { error: bad });
    const { id, decision } = JSON.parse(event.body || '{}');
    const o = list.find((x) => x.id === id);
    if (!o) return json(404, { error: 'Objeción no encontrada.' });
    if (!['forzar', 'propuesta', 'descartar'].includes(decision)) return json(400, { error: 'Decisión no válida.' });
    // Reglas de la memoria (regla nueva de Franklin o corrección suya que contradecía la evidencia).
    if (o.tipo === 'regla' || o.tipo === 'leccion') {
      const mem = await M.readJson(sb, 'reglas.json', { rules: [] });
      let rules = (mem.rules || []).slice();
      const i = rules.findIndex((r) => r.regla === o.regla);
      if (decision === 'forzar') {
        if (i >= 0) { rules[i] = Object.assign({}, rules[i], { forzada: true }); delete rules[i].estado; }
        else rules.unshift({ regla: o.regla, por_que: 'Franklin la pidió aunque el cerebro objetó (experimento)', origen: 'franklin', forzada: true });
      } else if (decision === 'propuesta' && o.propuesta_regla) {
        const nueva = { regla: String(o.propuesta_regla).slice(0, 400), por_que: 'Propuesta del cerebro en vez de: ' + String(o.regla).slice(0, 160), origen: 'franklin' };
        if (i >= 0) rules[i] = nueva; else rules.unshift(nueva);
      } else if (i >= 0 && rules[i].estado) rules.splice(i, 1); // descartar una regla que estaba en disputa
      await M.writeJson(sb, 'reglas.json', Object.assign({}, mem, { rules, updated_at: new Date().toISOString() }));
    }
    const r = await C.setObjecion(sb, id, { estado: decision === 'forzar' ? 'forzada' : decision === 'propuesta' ? 'propuesta_aceptada' : 'descartada' });
    return json(200, { ok: true, objecion: r });
  } catch (e) { return json(500, { error: e.message }); }
};
