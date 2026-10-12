// /.netlify/functions/me — quién soy en el panel (para mostrar u ocultar opciones) y mis créditos.
//   GET                                          → cuenta, rol, permisos, saldo, precios y últimos movimientos
//   POST { action:'prefs', prefs:{...} }          → guarda MI interfaz (tema, menú…) — máx. 4 KB
//   POST { action:'password', current, password } → cambiar MI contraseña
const T = require('./_tenant');
const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  const ctx = T.current();
  if (!ctx || ctx.mode === 'anon') return json(401, { error: 'Inicia sesión.' });
  const sb = ctx.sb || require('./_supabase').getSupabaseClient();
  const on = await T.tenancyOn(sb);
  if (!on) return json(200, { tenancy: false, is_admin: true, name: 'Administrador', credits: null, perms: null, ledger: [] });
  try {
    if (event.httpMethod === 'POST') {
      const b = T.readBody(event);
      if (!ctx.user) return json(400, { error: 'La cuenta de administrador entra con la llave del panel: no tiene preferencias ni contraseña aquí.' });
      if (b.action === 'prefs') {
        const raw = JSON.stringify(b.prefs || {});
        if (raw.length > 4096) return json(400, { error: 'Preferencias demasiado grandes.' });
        const { error } = await sb.from('app_users').update({ prefs: JSON.parse(raw) }).eq('id', ctx.user.id);
        if (error) throw error;
        T.forget('user:' + ctx.user.id);
        return json(200, { ok: true });
      }
      if (b.action === 'password') {
        const { data: u } = await sb.from('app_users').select('pass_hash').eq('id', ctx.user.id).single();
        if (!T.verifyPassword(String(b.current || ''), u.pass_hash)) { await new Promise((r) => setTimeout(r, 1200)); return json(400, { error: 'La contraseña actual no es correcta.' }); }
        if (String(b.password || '').length < 8) return json(400, { error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
        const { error } = await sb.from('app_users').update({ pass_hash: T.hashPassword(String(b.password)) }).eq('id', ctx.user.id);
        if (error) throw error;
        return json(200, { ok: true });
      }
      return json(400, { error: 'Acción desconocida.' });
    }
    const ws = await T.loadWs(sb, ctx.wsId);
    const st = await T.adminSettings(sb);
    const { data: ledger } = await sb.from('credit_ledger').select('delta, balance_after, reason, detail, created_at').eq('workspace_id', ctx.wsId).order('created_at', { ascending: false }).limit(50);
    return json(200, {
      tenancy: true,
      is_admin: !!ctx.isAdmin,
      name: (ctx.user && (ctx.user.name || ctx.user.email)) || 'Administrador',
      email: ctx.user ? ctx.user.email : null,
      prefs: ctx.user ? ctx.user.prefs || {} : {},
      workspace: { id: ctx.wsId, name: ws && ws.name },
      credits: ctx.isAdmin ? null : Number(ws && ws.credits) || 0,
      perms: ctx.isAdmin ? null : (ws && ws.perms) || {},
      prices: ctx.isAdmin ? null : { credit_usd: st.credit_usd, markup: st.markup, pc_job_credits: st.pc_job_credits, pc_shot_credits: st.pc_shot_credits },
      ledger: ctx.isAdmin ? [] : ledger || []
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

// Guardia de espacios + claves (ver _tenant.js y _keys.js).
exports.handler = require('./_keys').withKeys(exports.handler);
