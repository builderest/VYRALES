// /.netlify/functions/workspaces — CANALES del admin (oct-13): varios canales en una misma cuenta.
// Un "canal" es un espacio nuevo que PERTENECE al admin (owner_ws = admin). No tiene login propio:
// el admin crea varios, cambia entre ellos (fase 2) y cada uno lleva sus redes, series, videos y guionista aparte.
//   GET                                                   → mis canales (el principal + los que creé)
//   POST { action:'create', name }                        → crear un canal nuevo (vacío, separado)
//   POST { action:'rename', workspace_id, name }          → renombrar un canal mío
//   POST { action:'delete', workspace_id, confirm:'BORRAR' } → borrar un canal mío SOLO si no tiene novelas
const T = require('./_tenant');
const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
const UUID = /^[0-9a-f-]{36}$/i;
// Un canal mío puede usar todo lo del admin (claves y PC); el cobro/Claude se resuelve por owner_ws en fases siguientes.
const FULL_PERMS = { keys: { google: true, fal: true, tiktok: true, meta: true, youtube: true }, pc: true };
const MISSING_COL = (e) => e && /owner_ws|column .* does not exist|42703/i.test(e.message || e.code || '');

async function misCanales(sb) {
  const { data: wss, error } = await sb.from('workspaces').select('id, name, is_admin, owner_ws, active, created_at').order('created_at');
  if (error) { const err = new Error(error.message); err.code = error.code; throw err; }
  const { data: series } = await sb.from('series').select('workspace_id');
  const count = {}; (series || []).forEach((s) => { count[s.workspace_id] = (count[s.workspace_id] || 0) + 1; });
  const mine = (wss || []).filter((w) => w.id === T.ADMIN_WS || w.owner_ws === T.ADMIN_WS);
  return {
    channels: mine.map((w) => ({
      id: w.id,
      name: w.id === T.ADMIN_WS ? (w.name || 'Principal') : w.name,
      principal: w.id === T.ADMIN_WS,
      active: w.active !== false,
      series: count[w.id] || 0,
      created_at: w.created_at
    }))
  };
}

exports.handler = async (event) => {
  const ctx = T.current();
  if (!ctx || !ctx.isAdmin) return json(403, { error: 'Solo el administrador.' });
  const sb = ctx.sb || require('./_supabase').getSupabaseClient();
  if (!(await T.tenancyOn(sb))) return json(409, { error: 'Falta la migración 009 (multiusuario) en Supabase.', setup_needed: true });
  try {
    if (event.httpMethod === 'GET') return json(200, await misCanales(sb));
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
    const b = T.readBody(event);

    if (b.action === 'create') {
      const name = String(b.name || '').trim().slice(0, 80);
      if (name.length < 2) return json(400, { error: 'Ponle un nombre al canal (mínimo 2 letras).' });
      const { data: ws, error } = await sb.from('workspaces').insert({ name, owner_ws: T.ADMIN_WS, perms: FULL_PERMS }).select('id').single();
      if (error) { if (MISSING_COL(error)) return json(409, { error: 'Falta la migración 010 (canales) en Supabase.', setup_needed: true }); throw error; }
      return json(200, Object.assign({ created: ws.id }, await misCanales(sb)));
    }

    // Renombrar/borrar: debe ser un canal MÍO (owner_ws = admin). Nunca el principal ni una cuenta de cliente.
    const wsId = String(b.workspace_id || '');
    if (!UUID.test(wsId)) return json(400, { error: 'Falta el canal.' });
    if (wsId === T.ADMIN_WS) return json(400, { error: 'El canal principal no se cambia desde aquí.' });
    const { data: target, error: te } = await sb.from('workspaces').select('id, owner_ws').eq('id', wsId).maybeSingle();
    if (te && MISSING_COL(te)) return json(409, { error: 'Falta la migración 010 (canales) en Supabase.', setup_needed: true });
    if (!target || target.owner_ws !== T.ADMIN_WS) return json(403, { error: 'Ese canal no es tuyo.' });

    if (b.action === 'rename') {
      const name = String(b.name || '').trim().slice(0, 80);
      if (name.length < 2) return json(400, { error: 'Nombre muy corto.' });
      const { error } = await sb.from('workspaces').update({ name }).eq('id', wsId).eq('owner_ws', T.ADMIN_WS);
      if (error) throw error;
      return json(200, Object.assign({ ok: true }, await misCanales(sb)));
    }

    if (b.action === 'delete') {
      if (b.confirm !== 'BORRAR') return json(400, { error: 'Para borrar, confirma con BORRAR.' });
      const { data: s } = await sb.from('series').select('id').eq('workspace_id', wsId).limit(1);
      if (s && s.length) return json(409, { error: 'Ese canal tiene novelas. Bórralas primero.' });
      const { error } = await sb.from('workspaces').delete().eq('id', wsId).eq('owner_ws', T.ADMIN_WS);
      if (error) throw error;
      return json(200, Object.assign({ deleted: wsId }, await misCanales(sb)));
    }

    return json(400, { error: 'Acción desconocida.' });
  } catch (err) {
    if (MISSING_COL(err)) return json(409, { error: 'Falta la migración 010 (canales) en Supabase.', setup_needed: true });
    return json(500, { error: err.message });
  }
};

exports.handler = require('./_keys').withKeys(exports.handler, { adminOnly: true });
