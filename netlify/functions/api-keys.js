// Página Cuenta → API del panel: ver el estado de cada API, guardar/quitar claves y probarlas.
//   GET                                   → estado (NUNCA devuelve claves completas)
//   POST { action: 'save', values: {...} } → guarda cifrado en app_secrets (solo nombres de la lista blanca)
//   POST { action: 'remove', name }        → quita del panel (vuelve a usarse la del .env / Netlify)
//   POST { action: 'test', service }       → prueba la conexión con la clave que está en uso
// Protegida con la sesión / llave del panel (igual que publicar en redes).
const fs = require('fs');
const path = require('path');
const { checkDashboardKey } = require('./_auth');
const { getSupabaseClient } = require('./_supabase');
const K = require('./_keys');

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body)
});

const SETUP_SQL = (() => {
  try { return fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '008_app_secrets.sql'), 'utf8'); } catch (_) {}
  return 'create table if not exists public.app_secrets (\n  name text primary key,\n  value_enc text not null,\n  updated_at timestamptz not null default now()\n);\nalter table public.app_secrets enable row level security;\nrevoke all on public.app_secrets from anon, authenticated;\n';
})();

// Lo que se puede mostrar de una clave sin revelarla
function hint(name, value) {
  if (!value) return '';
  const f = K.FIELD[name];
  if (f && !f.secret) return value.length > 60 ? value.slice(0, 57) + '…' : value;
  return '••••' + value.slice(-4);
}

async function estado(sb) {
  const { rows, error } = await K.applyKeys(sb, true);
  const setup = error && K.isMissingTable(error);
  const at = Object.fromEntries((rows || []).map((r) => [r.name, r.updated_at]));
  const services = K.SERVICES.map((s) => {
    const fields = s.fields.map((f) => {
      const panel = K.fromPanel(f.name);
      const val = process.env[f.name] || '';
      return {
        name: f.name, label: f.label, secret: !!f.secret,
        source: panel ? 'panel' : (val ? 'servidor' : 'falta'),
        hint: hint(f.name, val),
        server_too: panel && !!K.serverValue(f.name),
        updated_at: panel ? at[f.name] || null : null
      };
    });
    return { id: s.id, name: s.name, sub: s.sub, icon: s.icon, desc: s.desc, url: s.url, test: !!s.test, fields };
  });
  return {
    setup_needed: !!setup,
    setup_sql: setup ? SETUP_SQL : undefined,
    error: error && !setup ? String(error.message || error) : undefined,
    services,
    server: K.SERVER_ONLY.map((x) => ({ name: x.name, label: x.label, set: !!process.env[x.name] }))
  };
}

// ---------- pruebas (gratis: no generan nada) ----------
async function probar(service) {
  const env = process.env;
  const T = { signal: AbortSignal.timeout(9000) };
  try {
    if (service === 'google') {
      if (!env.GOOGLE_AI_API_KEY) return { ok: false, msg: 'Falta la API key.' };
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', Object.assign({ headers: { 'x-goog-api-key': env.GOOGLE_AI_API_KEY } }, T));
      if (r.ok) return { ok: true, msg: 'Google AI respondió: la clave funciona.' };
      const j = await r.json().catch(() => ({}));
      return { ok: false, msg: 'Google rechazó la clave (' + r.status + '): ' + ((j.error && j.error.message) || 'sin detalle') };
    }
    if (service === 'tiktok') {
      if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) return { ok: false, msg: 'Faltan Client key y/o Client secret.' };
      const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', Object.assign({
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, grant_type: 'client_credentials' })
      }, T));
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
        const r = await fetch(u, T);
        const j = await r.json().catch(() => ({}));
        out.push(j.access_token ? { ok: true, t: label + ': app aceptada' } : { ok: false, t: label + ': ' + ((j.error && j.error.message) || 'HTTP ' + r.status) });
      }
      if (!out.length) return { ok: false, msg: 'Faltan App ID y App secret.' };
      return { ok: out.every((x) => x.ok), msg: out.map((x) => x.t).join(' · ') };
    }
    if (service === 'youtube') {
      if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET) return { ok: false, msg: 'Faltan Client ID y/o Client secret.' };
      // Truco sin costo: se pide un token con un refresh_token falso. Si Google dice "invalid_grant",
      // el Client ID/secret son correctos; si dice "invalid_client", están mal.
      const r = await fetch('https://oauth2.googleapis.com/token', Object.assign({
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: 'vyrales-prueba' })
      }, T));
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
  let sb;
  try { sb = getSupabaseClient(); } catch (e) { return json(500, { error: e.message }); }

  if (event.httpMethod === 'GET') return json(200, await estado(sb));
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });

  let body = {};
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '{}')); }
  catch (_) { return json(400, { error: 'JSON inválido' }); }

  if (body.action === 'save') {
    const values = body.values || {};
    const rows = [];
    for (const [name, raw] of Object.entries(values)) {
      if (!K.ALLOWED.has(name)) return json(400, { error: 'Nombre no permitido: ' + name });
      const v = String(raw == null ? '' : raw).trim();
      if (!v) continue;
      if (v.length > 4096 || /[\r\n]/.test(v)) return json(400, { error: 'Valor no válido para ' + name });
      if (name === 'PUBLIC_BASE_URL' && !/^https?:\/\/[^\s]+$/i.test(v)) return json(400, { error: 'La dirección pública debe empezar con https://' });
      rows.push({ name, value_enc: K.encrypt(v), updated_at: new Date().toISOString() });
    }
    if (!rows.length) return json(400, { error: 'No escribiste ninguna clave.' });
    const { error } = await sb.from('app_secrets').upsert(rows, { onConflict: 'name' });
    if (error) return json(K.isMissingTable(error) ? 409 : 500, { error: K.isMissingTable(error) ? 'Falta crear la tabla app_secrets en Supabase.' : error.message });
    return json(200, Object.assign({ saved: rows.map((r) => r.name) }, await estado(sb)));
  }

  if (body.action === 'remove') {
    if (!K.ALLOWED.has(body.name)) return json(400, { error: 'Nombre no permitido' });
    const { error } = await sb.from('app_secrets').delete().eq('name', body.name);
    if (error) return json(500, { error: error.message });
    return json(200, Object.assign({ removed: body.name }, await estado(sb)));
  }

  if (body.action === 'test') {
    if (!K.SERVICES.some((s) => s.id === body.service)) return json(400, { error: 'Servicio desconocido' });
    await K.applyKeys(sb, true);
    return json(200, await probar(body.service));
  }

  return json(400, { error: 'Acción desconocida' });
};
