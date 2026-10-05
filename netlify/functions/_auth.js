// Llave del dashboard para acciones peligrosas (publicar en redes, conectar cuentas).
// El dashboard de vyrales.netlify.app es público: sin esto, cualquiera que conozca la URL
// podría publicar en tu Instagram. La llave va en DASHBOARD_KEY (.env y Netlify) y el
// dashboard la manda en el header x-vyrales-key (o ?k= en los enlaces de "Conectar").
const crypto = require('crypto');
function checkDashboardKey(event) {
  const want = process.env.DASHBOARD_KEY;
  if (!want) return 'Falta DASHBOARD_KEY en el .env / Netlify (protege la publicación en redes).';
  const h = event.headers || {};
  // Sesión del login (cookie vyrales_auth, misma firma que netlify/edge-functions/auth.js).
  const m = String(h.cookie || h.Cookie || '').match(/(?:^|;\s*)vyrales_auth=([^;]+)/);
  if (m) {
    const [exp, sig] = decodeURIComponent(m[1]).split('.');
    const good = crypto.createHmac('sha256', want).update('vyrales:' + exp).digest('hex');
    if (Number(exp) > Date.now() && sig && sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  }
  const got = h['x-vyrales-key'] || h['X-Vyrales-Key'] || (event.queryStringParameters || {}).k || '';
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(want));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'Llave del dashboard incorrecta.';
  return null;
}
module.exports = { checkDashboardKey };
