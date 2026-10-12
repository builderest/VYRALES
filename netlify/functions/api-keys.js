// Página Cuenta → API del panel: ver el estado de cada API, guardar/quitar claves y probarlas.
//   GET                                   → estado (NUNCA devuelve claves completas)
//   POST { action: 'save', values: {...} } → guarda cifrado en app_secrets del espacio de quien llama
//   POST { action: 'remove', name }        → quita su clave (admin: vuelve la del .env; otros: la prestada o nada)
//   POST { action: 'test', service }       → prueba la conexión con la clave que está en uso
// Multiusuario: cada espacio ve y cambia SOLO sus claves. Las del admin nunca se muestran a otros:
// a lo sumo ven "prestada por el administrador".
const fs = require('fs');
const path = require('path');
const { checkDashboardKey } = require('./_auth');
const T = require('./_tenant');
const K = require('./_keys');

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body)
});

const SETUP_SQL = (() => {
  for (const f of ['009_multiusuario.sql', '008_app_secrets.sql']) {
    try { return fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', f), 'utf8'); } catch (_) {}
  }
  return 'create table if not exists public.app_secrets (\n  name text primary key,\n  value_enc text not null,\n  updated_at timestamptz not null default now()\n);\nalter table public.app_secrets enable row level security;\nrevoke all on public.app_secrets from anon, authenticated;\n';
})();

function hint(name, value) {
  if (!value) return '';
  const f = K.FIELD[name];
  if (f && !f.secret) return value.length > 60 ? value.slice(0, 57) + '…' : value;
  return '••••' + value.slice(-4);
}

async function estado(sb, ctx) {
  const r = await K.applyForCtx(sb, ctx, true);
  const setup = r.error && K.isMissingTable(r.error);
  const isAdmin = ctx.wsId === T.ADMIN_WS;
  const services = K.SERVICES.filter((s) => isAdmin || !s.adminOnly).map((s) => {
    const fields = s.fields.map((f) => {
      const source = r.src[f.name] || 'falta';
      const val = process.env[f.name] || '';
      return {
        name: f.name, label: f.label, secret: !!f.secret, source,
        // Lo prestado por el admin NO se muestra (ni los últimos 4): solo que existe.
        hint: source === 'prestada' ? '' : hint(f.name, val),
        server_too: isAdmin && source === 'panel' && !!K.serverValue(f.name),
        updated_at: source === 'panel' ? (r.updated[f.name] || null) : null
      };
    });
    return { id: s.id, name: s.name, sub: s.sub, icon: s.icon, desc: s.desc, url: s.url, test: !!s.test, charged: !!s.charged, fields };
  });
  return {
    is_admin: isAdmin,
    setup_needed: !!setup,
    setup_sql: setup && isAdmin ? SETUP_SQL : undefined,
    error: r.error && !setup ? String(r.error.message || r.error) : undefined,
    credits: ctx.ws ? Number(ctx.ws.credits) || 0 : null,
    services,
    server: isAdmin ? K.SERVER_ONLY.map((x) => ({ name: x.name, label: x.label, set: !!process.env[x.name] })) : []
  };
}

// ---------- pruebas (gratis: no generan nada) ----------
async function probar(service) {
  const env = process.env;
  const T9 = { signal: AbortSignal.timeout(9000) };
  try {
    if (service === 'google') {
      if (!env.GOOGLE_AI_API_KEY) return { ok: false, msg: 'Falta la API key.' };
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', Object.assign({ headers: { 'x-goog-api-key': env.GOOGLE_AI_API_KEY } }, T9));
      if (r.ok) return { ok: true, msg: 'Google AI respondió: la clave funciona.' };
      const j = await r.json().catch(() => ({}));
      return { ok: false, msg: 'Google rechazó la clave (' + r.status + '): ' + ((j.error && j.error.message) || 'sin detalle') };
    }
    if (service === 'tiktok') {
      if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) return { ok: false, msg: 'Faltan Client key y/o Client secret.' };
      const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', Object.assign({
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, grant_type: 'client_credentials' })
      }, T9));
      const j = await r.json().catch(() => ({}));
      if (j.access_token) return { ok: true, msg: 'TikTok aceptó la app. Ahora conecta tu cuenta en Redes conectadas.' };
      return { ok: false, msg: 'TikTok rechazó la app: ' + (j.error_description || j.error || ('HTTP ' + r.status)) };
    }
    if (service === 'meta') {
      const out = [];
      for (const [id, sec, label] of [[env.META_APP_ID, env.META_APP_SECRET, 'Facebook'], [env.INSTAGRAM_APP_ID, env.INSTAGRAM_APP_SECRET, 'Instagram']]) {
        if (!id && !sec) continue;
        if (!id || !sec) { out.push({ ok: false, t: label + ': falta App ID o App secret' }); continue; }
        const u = 'https://graph.facebook.com/oauth/access_token?' + new URLSearchParams({ client_id: id, client_secret: sec, grant_type: 'client_credentials' });
        const r = await fetch(u, T9);
        const j = await r.json().catch(() => ({}));
        out.push(j.access_token ? { ok: true, t: label + ': app aceptada' } : { ok: false, t: label + ': ' + ((j.error && j.error.message) || 'HTTP ' + r.status) });
      }
      if (!out.length) return { ok: false, msg: 'Faltan App ID y App secret.' };
      return { ok: out.every((x) => x.ok), msg: out.map((x) => x.t).join(' · ') };
    }
    if (service === 'youtube') {
      if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET) return { ok: false, msg: 'Faltan Client ID y/o Client secret.' };
      // Sin costo: un refresh_token falso. "invalid_grant" = Client ID/secret correctos; "invalid_client" = mal.
      const r = await fetch('https://oauth2.googleapis.com/token', Object.assign({
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: 'vyrales-prueba' })
      }, T9));
      const j = await r.json().catch(() => ({}));
      if (j.error === 'invalid_grant' || j.error === 'unauthorized_client') return { ok: true, msg: 'Google reconoce el Client ID y el secret. Conecta tu canal en Redes conectadas.' };
      return { ok: false, msg: 'Google rechazó las credenciales: ' + (j.error_description || j.error || 'HTTP ' + r.status) };
    }
    return { ok: null, msg: 'Este servicio no tiene una prueba gratis: se comprueba la primera vez que se usa.' };
  } catch (e) {
    return { ok: false, msg: 'No se pudo probar (' + (e.name === 'TimeoutError' ? 'tardó demasiado' : e.message) + ').' };
  }
}

exports.handler = async (event) => {
  const authErr = checkDashboardKey(event);
  if (authErr) return json(401, { error: authErr });
  const ctx = T.current() || { wsId: T.ADMIN_WS, isAdmin: true };
  let sb;
  try { sb = ctx.sb || require('./_supabase').getSupabaseClient(); } catch (e) { return json(500, { error: e.message }); }
  const isAdmin = ctx.wsId === T.ADMIN_WS;
  const on = await T.tenancyOn(sb);

  if (event.httpMethod === 'GET') return json(200, await estado(sb, ctx));
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });

  const body = T.readBody(event);

  if (body.action === 'save') {
    const values = body.values || {};
    const rows = [];
    for (const [name, raw] of Object.entries(values)) {
      if (!K.ALLOWED.has(name)) return json(400, { error: 'Nombre no permitido: ' + name });
      if (!isAdmin && K.SERVICE[K.FIELD[name].service].adminOnly) return json(403, { error: 'Solo el administrador cambia ' + name });
      const v = String(raw == null ? '' : raw).trim();
      if (!v) continue;
      if (v.length > 4096 || /[\r\n]/.test(v)) return json(400, { error: 'Valor no válido para ' + name });
      if (name === 'PUBLIC_BASE_URL' && !/^https?:\/\/[^\s]+$/i.test(v)) return json(400, { error: 'La dirección pública debe empezar con https://' });
      rows.push(Object.assign({ name, value_enc: K.encrypt(v), updated_at: new Date().toISOString() }, on ? { workspace_id: ctx.wsId } : {}));
    }
    if (!rows.length) return json(400, { error: 'No escribiste ninguna clave.' });
    if (!on && !isAdmin) return json(409, { error: 'Falta la migración 009.' });
    const { error } = await sb.from('app_secrets').upsert(rows, { onConflict: on ? 'workspace_id,name' : 'name' });
    if (error) return json(K.isMissingTable(error) ? 409 : 500, { error: K.isMissingTable(error) ? 'Falta crear la tabla app_secrets en Supabase.' : error.message });
    K.forgetRows(ctx.wsId);
    return json(200, Object.assign({ saved: rows.map((r) => r.name) }, await estado(sb, ctx)));
  }

  if (body.action === 'remove') {
    if (!K.ALLOWED.has(body.name)) return json(400, { error: 'Nombre no permitido' });
    let q = sb.from('app_secrets').delete().eq('name', body.name);
    if (on) q = q.eq('workspace_id', ctx.wsId);
    const { error } = await q;
    if (error) return json(500, { error: error.message });
    K.forgetRows(ctx.wsId);
    return json(200, Object.assign({ removed: body.name }, await estado(sb, ctx)));
  }

  if (body.action === 'test') {
    if (!K.SERVICES.some((s) => s.id === body.service)) return json(400, { error: 'Servicio desconocido' });
    await K.applyForCtx(sb, ctx, true);
    return json(200, await probar(body.service));
  }

  return json(400, { error: 'Acción desconocida' });
};

// Guardia de espacios + claves del espacio que llama (ver _tenant.js y _keys.js).
exports.handler = require('./_keys').withKeys(exports.handler);
