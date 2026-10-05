// POST /.netlify/functions/login  (form o JSON { password, next })  → cookie de sesión 30 días.
// GET  /.netlify/functions/login?logout=1 → cierra la sesión.
// La contraseña es la DASHBOARD_KEY. Falla lenta (1.5 s) para frenar intentos de adivinarla.
const crypto = require('crypto');
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
  const a = Buffer.from(String(body.password || ''));
  const b = Buffer.from(key);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 1500));
    return { statusCode: 302, headers: { Location: '/login.html?error=1&next=' + encodeURIComponent(safeNext(body.next)), 'Cache-Control': 'no-store' }, body: '' };
  }
  return { statusCode: 302, headers: { Location: safeNext(body.next), 'Set-Cookie': cookie(event, token(key), DAYS * 86400), 'Cache-Control': 'no-store' }, body: '' };
};
