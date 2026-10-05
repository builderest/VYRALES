// GET /.netlify/functions/oauth-instagram-callback?code=...&state=... — la red vuelve aquí después de autorizar.
// Guarda el token en social_accounts (solo lo lee la service role) y muestra una página simple.
const { getSupabaseClient } = require('./_supabase');
const { instagramConnect, stateProblem } = require('./_social');
const page = (ok, msg) => ({ statusCode: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#0b0f19;color:#e2e8f0;padding:40px;text-align:center">' +
    '<h2 style="color:' + (ok ? '#10b981' : '#ec4899') + '">' + (ok ? '✅ ' : '❌ ') + msg + '</h2>' +
    '<p><a href="' + (ok ? '/?connected=instagram' : '/') + '" style="display:inline-block;margin-top:12px;padding:10px 18px;border-radius:8px;background:#06b6d4;color:#001018;font-weight:700;text-decoration:none">Volver a VYRALES</a></p>' +
    (ok ? '<p style="color:#94a3b8;font-size:14px">Volviendo al panel en 2 segundos…</p><script>setTimeout(function(){location.replace("/?connected=instagram")},2000)</script>' : '') + '</body>' });
exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  if (q.error) return page(false, 'Autorización cancelada: ' + String(q.error_description || q.error).replace(/[<>]/g, ''));
  let problem = null;
  try { problem = stateProblem('instagram', q.state); } catch (err) { return page(false, String(err.message).replace(/[<>]/g, '')); }
  if (problem) return page(false, problem.replace(/[<>]/g, ''));
  try {
    const name = await instagramConnect(getSupabaseClient(), q.code);
    return page(true, 'instagram conectado: ' + String(name || '').replace(/[<>]/g, ''));
  } catch (err) { return page(false, String(err.message).replace(/[<>]/g, '')); }
};
