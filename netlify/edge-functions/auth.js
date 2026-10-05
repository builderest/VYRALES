// Candado de VYRALES (corre en Netlify ANTES de servir cualquier página o función).
// Sin sesión: las páginas redirigen a /login.html y las funciones responden 401.
// Sesión = cookie vyrales_auth = "<vence>.<HMAC-SHA256(DASHBOARD_KEY, 'vyrales:'+vence)>"
// (la crea netlify/functions/login.js). Llamadas internas servidor→servidor pueden mandar
// el header x-vyrales-key con la DASHBOARD_KEY.
// Lo único público: privacidad/términos, login, el archivo de verificación de TikTok y las
// URLs a las que TikTok/Instagram regresan después de autorizar.
const PUBLIC = [
  /^\/privacidad\.html$/, /^\/eliminar-datos\.html$/, /^\/terminos\.html$/, /^\/login\.html$/, /^\/robots\.txt$/,
  /^\/tiktok[\w.-]*\.txt$/, /^\/favicon/,
  /^\/\.netlify\/functions\/login$/,
  /^\/\.netlify\/functions\/oauth-(tiktok|instagram|meta)-callback$/,
  /^\/auth\/(tiktok|instagram|meta)\/callback$/
];

const enc = new TextEncoder();
async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function cookieOf(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

export default async (request, context) => {
  const url = new URL(request.url);
  if (PUBLIC.some((r) => r.test(url.pathname))) return context.next();
  const key = Netlify.env.get('DASHBOARD_KEY');
  if (!key) return new Response('VYRALES está cerrado: falta DASHBOARD_KEY en las variables de entorno.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });

  const header = request.headers.get('x-vyrales-key');
  if (header && same(header, key)) return context.next();

  const token = cookieOf(request, 'vyrales_auth');
  if (token) {
    const [exp, sig] = token.split('.');
    if (Number(exp) > Date.now() && same(sig || '', await hmacHex(key, 'vyrales:' + exp))) return context.next();
  }
  if (url.pathname.startsWith('/.netlify/')) {
    return new Response(JSON.stringify({ error: 'No autorizado: inicia sesión en VYRALES.' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  return Response.redirect(new URL('/login.html?next=' + encodeURIComponent(url.pathname + url.search), url), 302);
};

export const config = { path: '/*' };
