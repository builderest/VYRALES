// Obsoleto: Instagram ahora se conecta junto con Facebook (Facebook Login). Redirige al nuevo inicio.
exports.handler = async (event) => ({ statusCode: 302, headers: { Location: '/.netlify/functions/oauth-meta-start' + (event.rawQuery ? '?' + event.rawQuery : ''), 'Cache-Control': 'no-store' }, body: '' });
