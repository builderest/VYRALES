// GET /.netlify/functions/oauth-tiktok-callback?code=...&state=... — la red vuelve aquí después de autorizar.
// Guarda el token en social_accounts (solo lo lee la service role) y muestra una página simple.
const { getSupabaseClient } = require('./_supabase');
const { tiktokConnect, checkState } = require('./_social');
const page = (ok, msg) => ({ statusCode: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#0b0f19;color:#e2e8f0;padding:40px;text-align:center">' +
    '<h2 style="color:' + (ok ? '#10b981' : '#ec4899') + '">' + (ok ? '✅ ' : '❌ ') + msg + '</h2><p>Ya puedes cerrar esta pestaña y recargar el dashboard de VYRALES.</p></body>' });
exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  if (q.error) return page(false, 'Autorización cancelada: ' + String(q.error_description || q.error).replace(/[<>]/g, ''));
  if (!checkState('tiktok', q.state)) return page(false, 'El enlace expiró o no es válido. Vuelve a darle "Conectar" desde el dashboard.');
  try {
    const name = await tiktokConnect(getSupabaseClient(), q.code);
    return page(true, 'tiktok conectado: ' + String(name || '').replace(/[<>]/g, ''));
  } catch (err) { return page(false, String(err.message).replace(/[<>]/g, '')); }
};
