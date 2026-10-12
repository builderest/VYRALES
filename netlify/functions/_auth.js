// Llave del dashboard para acciones peligrosas (publicar en redes, conectar cuentas).
// El dashboard de vyrales.netlify.app es público: sin esto, cualquiera que conozca la URL
// podría publicar en tu Instagram. La llave va en DASHBOARD_KEY (.env y Netlify) y el
// dashboard la manda en el header x-vyrales-key (o ?k= en los enlaces de "Conectar").
// MULTIUSUARIO: también vale la sesión de cualquier usuario activo (cookie "u.<id>.…", ver _tenant.js);
// lo que cada uno puede tocar lo decide la guardia de espacios de _tenant.js, no esta llave.
const crypto = require('crypto');
function checkDashboardKey(event) {
  const want = process.env.DASHBOARD_KEY;
  if (!want) return 'Falta DASHBOARD_KEY en el .env / Netlify (protege la publicación en redes).';
  const sess = require('./_tenant').parseSession(event);
  if (sess) return null; // cookie de usuario, cookie vieja de admin o header del sistema
  const got = (event.queryStringParameters || {}).k || '';
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(want));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'Llave del dashboard incorrecta.';
  return null;
}
module.exports = { checkDashboardKey };
