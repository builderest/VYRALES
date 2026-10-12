// POST /.netlify/functions/login  (form o JSON { email, password, next })  → cookie de sesión 30 días.
// GET  /.netlify/functions/login?logout=1 → cierra la sesión.
// MULTIUSUARIO:
//   * Email + contraseña de un usuario (tabla app_users, hash scrypt) → cookie "u.<id>.<vence>.<firma>".
//   * Administrador: email vacío o "admin" + la DASHBOARD_KEY → cookie de admin (la de siempre).
// Falla lenta (1.5 s) para frenar intentos de adivinar contraseñas.
const crypto = require('crypto');
const T = require('./_tenant');
const DAYS = 30;

function token(key) {
  const exp = Date.now() + DAYS * 86400000;
  return exp + '.' + crypto.createHmac('sha256', key).update('vyrales:' + exp).digest('hex');
}
function cookie(event, value, maxAge) {
  const host = (event.headers && (event.headers.host || event.headers.Host)) || '';
  const secure = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? '' : '; Secure';
  return `vyrales_auth=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)/.test(n) ? n : '/');
const fail = async (next) => {
  await new Promise((r) => setTimeout(r, 1500));
  return { statusCode: 302, headers: { Location: '/login.html?error=1&next=' + encodeURIComponent(safeNext(next)), 'Cache-Control': 'no-store' }, body: '' };
};

exports.handler = async (event) => {
  const key = process.env.DASHBOARD_KEY;
  if (!key) return { statusCode: 503, body: 'Falta DASHBOARD_KEY.' };
  const q = event.queryStringParameters || {};
  if (event.httpMethod === 'GET' && q.logout) {
    return { statusCode: 302, headers: { Location: '/login.html', 'Set-Cookie': cookie(event, '', 0), 'Cache-Control': 'no-store' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let body = {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : (event.body || '');
  try { body = /json/.test((event.headers && event.headers['content-type']) || '') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); } catch (_) {}
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  // Administrador (como siempre): la DASHBOARD_KEY.
  if (!email || email === 'admin') {
    const a = Buffer.from(password);
    const b = Buffer.from(key);
    if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) return fail(body.next);
    return { statusCode: 302, headers: { Location: safeNext(body.next), 'Set-Cookie': cookie(event, token(key), DAYS * 86400), 'Cache-Control': 'no-store' }, body: '' };
  }

  // Usuario con email y contraseña.
  try {
    const sb = require('./_supabase').getSupabaseClient();
    if (!(await T.tenancyOn(sb))) return fail(body.next);
    const { data: u } = await sb.from('app_users').select('id, pass_hash, active, workspace_id').eq('email', email).maybeSingle();
    if (!u || !u.active || !T.verifyPassword(password, u.pass_hash)) return fail(body.next);
    const ws = await T.loadWs(sb, u.workspace_id);
    if (!ws || !ws.active) return fail(body.next);
    await sb.from('app_users').update({ last_login_at: new Date().toISOString() }).eq('id', u.id);
    return { statusCode: 302, headers: { Location: safeNext(body.next), 'Set-Cookie': cookie(event, T.userCookieValue(u.id, DAYS), DAYS * 86400), 'Cache-Control': 'no-store' }, body: '' };
  } catch (_) {
    return fail(body.next);
  }
};

// Guardia de espacios + claves del espacio que llama (ver _tenant.js y _keys.js).
exports.handler = require('./_keys').withKeys(exports.handler);
