// GET /.netlify/functions/oauth-youtube-start → redirige a la pantalla de autorización de YouTube (Google).
// ?backup=1 → conecta el RESPALDO del canal admin (mismo canal de YouTube, autorizado con el proyecto
// 2 de Google Cloud) para cuando se acabe la cuota del proyecto 1 (oct-15).
const { youtubeAuthUrl } = require('./_social');
const { checkDashboardKey } = require('./_auth');
exports.handler = async (event) => {
  const denied = checkDashboardKey(event);
  if (denied) return { statusCode: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: '<p style="font-family:sans-serif">' + denied + '</p>' };
  try {
    const backup = (event.queryStringParameters || {}).backup === '1';
    return { statusCode: 302, headers: { Location: youtubeAuthUrl(backup ? 'youtube_backup' : 'youtube'), 'Cache-Control': 'no-store' }, body: '' };
  }
  catch (err) { return { statusCode: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: '<p style="font-family:sans-serif">' + err.message + '</p>' }; }
};

// Claves de la página Cuenta → API (cifradas en Supabase; mandan sobre el .env). Ver _keys.js.
exports.handler = require('./_keys').withKeys(exports.handler);
