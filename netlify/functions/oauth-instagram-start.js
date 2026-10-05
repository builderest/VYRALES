// GET /.netlify/functions/oauth-instagram-start → redirige a la pantalla de autorización de la red.
const { instagramAuthUrl } = require('./_social');
const { checkDashboardKey } = require('./_auth');
exports.handler = async (event) => {
  const denied = checkDashboardKey(event);
  if (denied) return { statusCode: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: '<p style="font-family:sans-serif">' + denied + '</p>' };
  try { return { statusCode: 302, headers: { Location: instagramAuthUrl(), 'Cache-Control': 'no-store' }, body: '' }; }
  catch (err) { return { statusCode: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: '<p style="font-family:sans-serif">' + err.message + '</p>' }; }
};
