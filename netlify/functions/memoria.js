// GET  /.netlify/functions/memoria            → { rules, updated_at, history, lecciones (últimas 30), pendientes }
// POST { delete: <índice> }                   → borra una regla de la memoria de Claude (Franklin no la quiere)
// POST { add: "<regla>" }                     → Franklin agrega una regla a mano
const { getSupabaseClient } = require('./_supabase');
const { checkDashboardKey } = require('./_auth');
const M = require('./_memoria');
const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
exports.handler = async (event) => {
  try {
    const sb = getSupabaseClient();
    const mem = await M.readJson(sb, 'reglas.json', { rules: [] });
    if (event.httpMethod === 'GET') {
      const les = await M.readJson(sb, 'lecciones.json', []);
      return json(200, { rules: mem.rules || [], updated_at: mem.updated_at || null, history: (mem.history || []).slice(-10).reverse(), lecciones: les.slice(-30).reverse(), pendientes: les.filter((l) => !l.consolidated).length });
    }
    const bad = checkDashboardKey(event); if (bad) return json(401, { error: bad });
    const body = JSON.parse(event.body || '{}');
    const rules = (mem.rules || []).slice();
    if (body.delete != null) {
      const i = Number(body.delete); if (!(i >= 0 && i < rules.length)) return json(400, { error: 'Regla no encontrada.' });
      const [gone] = rules.splice(i, 1);
      await M.addLesson(sb, { source: 'franklin', motivo: 'Franklin borró esta regla de la memoria (no la quiere): ' + gone.regla });
    } else if (body.add) {
      const regla = String(body.add).trim().slice(0, 400); if (regla.length < 8) return json(400, { error: 'La regla es muy corta.' });
      // 🧠 oct-14: la regla nueva queda "evaluando" (todavía NO se usa) hasta que el cerebro la revise contra la evidencia y las
      // reglas que ya existen (claude_aprender en tu PC, $0). Si no está de acuerdo, te deja una objeción con la mejor solución.
      rules.unshift({ regla, por_que: 'La agregó Franklin', origen: 'franklin', estado: 'evaluando', at: new Date().toISOString() });
      try { const { data: pend } = await sb.from('agent_jobs').select('id').eq('status', 'pending').eq('command', 'claude_aprender').limit(1); if (!(pend && pend.length)) await sb.from('agent_jobs').insert({ command: 'claude_aprender' }); } catch (_) {}
    } else return json(400, { error: 'Nada que hacer.' });
    await M.writeJson(sb, 'reglas.json', Object.assign({}, mem, { rules, updated_at: new Date().toISOString() }));
    return json(200, { ok: true, rules });
  } catch (e) { return json(500, { error: e.message }); }
};

// Claves de la página Cuenta → API (cifradas en Supabase; mandan sobre el .env). Ver _keys.js.
exports.handler = require('./_keys').withKeys(exports.handler, { adminOnly: true }); // solo el administrador
