// MOVER UN GUION A PRODUCCIÓN (Franklin, oct-13): un guion no se produce directo desde Guiones;
// primero se mueve a la sala "Produciendo". Solo puede haber UN GRUPO en producción a la vez por serie.
// Un "grupo" = el video largo + todos sus Shorts (los que tienen continuity.parent_episode_id = el largo).
//   POST { episode_id, on }  → on=true: pone el grupo en producción; on=false: lo saca.
// Marca episodes.continuity.en_produccion = true/false (+ produccion_at) en TODO el grupo.
const { getSupabaseClient } = require('./_supabase');
const { checkDashboardKey } = require('./_auth');
const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  const sb = getSupabaseClient();
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido.' });
    const bad = checkDashboardKey(event);
    if (bad) return json(401, { error: bad });
    const body = JSON.parse(event.body || '{}');
    const epId = body.episode_id;
    const on = body.on !== false; // true por defecto
    const { data: ep, error } = await sb.from('episodes').select('id, episode_number, series_id, continuity, status').eq('id', epId || '').single();
    if (error || !ep) return json(404, { error: 'Episodio no encontrado.' });

    // Todos los episodios de la serie (para armar el grupo largo+shorts).
    const { data: all } = await sb.from('episodes').select('id, episode_number, continuity, status').eq('series_id', ep.series_id);
    const parentOf = (x) => (x.continuity && x.continuity.parent_episode_id) || null;
    // Raíz del grupo = el largo. Si moví un Short, su raíz es su parent; si moví el largo, es él mismo.
    const rootId = parentOf(ep) || ep.id;
    const group = (all || []).filter((x) => x.id === rootId || parentOf(x) === rootId);
    const groupIds = new Set(group.map((x) => x.id));

    // SOLO UN GRUPO A LA VEZ: al mover a producción, no debe haber OTRO grupo ya en producción sin terminar.
    if (on) {
      const otroEnProd = (all || []).find((o) => !groupIds.has(o.id) && o.continuity && o.continuity.en_produccion && o.status !== 'en_revision' && o.status !== 'publicado');
      if (otroEnProd) return json(409, { error: 'Ya hay un episodio en producción (EP ' + otroEnProd.episode_number + '). Termínalo o sácalo de producción antes de mover otro.' });
    }

    // Aplica el flag a TODO el grupo (largo + shorts).
    let n = 0;
    for (const g of group) {
      const cont = Object.assign({}, g.continuity || {});
      if (on) { cont.en_produccion = true; cont.produccion_at = new Date().toISOString(); }
      else { delete cont.en_produccion; delete cont.produccion_at; }
      const { error: uErr } = await sb.from('episodes').update({ continuity: cont }).eq('id', g.id);
      if (uErr) return json(500, { error: uErr.message });
      n++;
    }
    return json(200, { ok: true, en_produccion: !!on, movidos: n, grupo: group.map((g) => g.episode_number).sort((a, b) => a - b) });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
