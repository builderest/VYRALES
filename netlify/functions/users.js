// Página Cuenta → Usuarios (SOLO el administrador): crear cuentas, permisos, créditos y precios.
//   GET                                                   → cuentas con su usuario, saldo, permisos y gasto del mes
//   POST { action:'create', email, name, password, credits, perms }
//   POST { action:'perms', workspace_id, perms:{ keys:{google,fal,tiktok,meta,youtube}, pc } }
//   POST { action:'credits', workspace_id, delta, note }   → + regalar / − quitar (queda en el historial)
//   POST { action:'active', workspace_id, active }         → pausar / reactivar la cuenta
//   POST { action:'password', user_id, password }          → nueva contraseña
//   POST { action:'settings', settings:{ markup, credit_usd, pc_job_credits, pc_shot_credits } }
//   POST { action:'delete', workspace_id, confirm:'BORRAR' } → solo si la cuenta no tiene novelas
const T = require('./_tenant');

const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
const KEY_SERVICES = ['google', 'fal', 'tiktok', 'meta', 'youtube'];
const UUID = /^[0-9a-f-]{36}$/i;
const cleanPerms = (p) => {
  p = p || {};
  const keys = {};
  KEY_SERVICES.forEach((k) => { keys[k] = !!(p.keys && p.keys[k] === true); });
  return { keys, pc: p.pc === true };
};
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

async function listar(sb) {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const [{ data: wss }, { data: users }, { data: series }, { data: spend }] = await Promise.all([
    sb.from('workspaces').select('id, name, is_admin, credits, perms, active, created_at').order('created_at'),
    sb.from('app_users').select('id, email, name, role, active, workspace_id, created_at, last_login_at'),
    sb.from('series').select('workspace_id'),
    sb.from('generation_log').select('workspace_id, cost_usd').gte('created_at', monthStart)
  ]);
  const count = {}, usd = {};
  (series || []).forEach((s) => { count[s.workspace_id] = (count[s.workspace_id] || 0) + 1; });
  (spend || []).forEach((r) => { usd[r.workspace_id] = (usd[r.workspace_id] || 0) + (Number(r.cost_usd) || 0); });
  return {
    settings: await T.adminSettings(sb),
    accounts: (wss || []).filter((w) => !w.is_admin).map((w) => ({
      id: w.id, name: w.name, credits: Number(w.credits) || 0, active: w.active, created_at: w.created_at,
      perms: cleanPerms(w.perms), series: count[w.id] || 0, month_usd: Math.round((usd[w.id] || 0) * 100) / 100,
      users: (users || []).filter((u) => u.workspace_id === w.id)
    }))
  };
}

exports.handler = async (event) => {
  const ctx = T.current();
  if (!ctx || !ctx.isAdmin) return json(403, { error: 'Solo el administrador.' });
  const sb = ctx.sb || require('./_supabase').getSupabaseClient();
  if (!(await T.tenancyOn(sb))) return json(409, { error: 'Falta la migración 009 (multiusuario) en Supabase.', setup_needed: true });
  try {
    if (event.httpMethod === 'GET') return json(200, await listar(sb));
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
    const b = T.readBody(event);
    const by = ctx.user ? ctx.user.id : null;

    if (b.action === 'create') {
      const email = String(b.email || '').trim().toLowerCase();
      const name = String(b.name || '').trim().slice(0, 80);
      const password = String(b.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) return json(400, { error: 'Email no válido.' });
      if (password.length < 8) return json(400, { error: 'La contraseña debe tener al menos 8 caracteres.' });
      const { data: dup } = await sb.from('app_users').select('id').eq('email', email).maybeSingle();
      if (dup) return json(409, { error: 'Ya existe un usuario con ese email.' });
      const { data: ws, error: e1 } = await sb.from('workspaces').insert({ name: name || email, perms: cleanPerms(b.perms) }).select().single();
      if (e1) throw e1;
      const { error: e2 } = await sb.from('app_users').insert({ email, name: name || null, pass_hash: T.hashPassword(password), workspace_id: ws.id, role: 'owner' });
      if (e2) { await sb.from('workspaces').delete().eq('id', ws.id); throw e2; }
      const credits = Math.round(num(b.credits, 0, 10000000, 0));
      if (credits > 0) await T.creditMove(sb, ws.id, credits, 'regalo_admin', 'créditos iniciales', null, by);
      return json(200, Object.assign({ created: ws.id }, await listar(sb)));
    }

    if (!['settings'].includes(b.action) && !(UUID.test(String(b.workspace_id || '')) || UUID.test(String(b.user_id || '')))) return json(400, { error: 'Falta la cuenta.' });
    if (b.workspace_id === T.ADMIN_WS) return json(400, { error: 'Tu propia cuenta (admin) no se cambia desde aquí.' });

    if (b.action === 'perms') {
      const { error } = await sb.from('workspaces').update({ perms: cleanPerms(b.perms) }).eq('id', b.workspace_id).eq('is_admin', false);
      if (error) throw error;
    } else if (b.action === 'credits') {
      const delta = Math.round(num(b.delta, -10000000, 10000000, 0));
      if (!delta) return json(400, { error: 'Escribe cuántos créditos.' });
      await T.creditMove(sb, b.workspace_id, delta, delta > 0 ? 'regalo_admin' : 'ajuste', String(b.note || '').slice(0, 120) || null, null, by);
    } else if (b.action === 'active') {
      const { error } = await sb.from('workspaces').update({ active: !!b.active }).eq('id', b.workspace_id).eq('is_admin', false);
      if (error) throw error;
    } else if (b.action === 'password') {
      const password = String(b.password || '');
      if (password.length < 8) return json(400, { error: 'La contraseña debe tener al menos 8 caracteres.' });
      const { data: u } = await sb.from('app_users').select('id, workspace_id').eq('id', b.user_id).maybeSingle();
      if (!u || u.workspace_id === T.ADMIN_WS) return json(404, { error: 'Usuario no encontrado.' });
      const { error } = await sb.from('app_users').update({ pass_hash: T.hashPassword(password) }).eq('id', u.id);
      if (error) throw error;
    } else if (b.action === 'settings') {
      const s = b.settings || {};
      const cur = await T.adminSettings(sb);
      const next = {
        markup: num(s.markup, 1, 20, cur.markup),
        credit_usd: num(s.credit_usd, 0.001, 1, cur.credit_usd),
        pc_job_credits: Math.round(num(s.pc_job_credits, 0, 100000, cur.pc_job_credits)),
        pc_shot_credits: Math.round(num(s.pc_shot_credits, 0, 100000, cur.pc_shot_credits))
      };
      const { error } = await sb.from('workspaces').update({ settings: next }).eq('id', T.ADMIN_WS);
      if (error) throw error;
    } else if (b.action === 'delete') {
      if (b.confirm !== 'BORRAR') return json(400, { error: 'Escribe BORRAR para confirmar.' });
      const { count } = await sb.from('series').select('id', { count: 'exact', head: true }).eq('workspace_id', b.workspace_id);
      if (count) return json(409, { error: 'La cuenta tiene ' + count + ' novela(s): mejor páusala, o borra sus novelas primero.' });
      const { error } = await sb.from('workspaces').delete().eq('id', b.workspace_id).eq('is_admin', false);
      if (error) throw error;
    } else {
      return json(400, { error: 'Acción desconocida.' });
    }
    T.forget();
    return json(200, await listar(sb));
  } catch (err) {
    return json(500, { error: err.message });
  }
};

// Guardia de espacios (solo admin) + claves (ver _tenant.js y _keys.js).
exports.handler = require('./_keys').withKeys(exports.handler, { adminOnly: true });
