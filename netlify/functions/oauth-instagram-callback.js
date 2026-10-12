// Obsoleto: la vuelta de Meta ahora llega a /auth/meta/callback (oauth-meta-callback).
exports.handler = async () => ({ statusCode: 302, headers: { Location: '/?connected=meta', 'Cache-Control': 'no-store' }, body: '' });

// Claves de la página Cuenta → API (cifradas en Supabase; mandan sobre el .env). Ver _keys.js.
exports.handler = require('./_keys').withKeys(exports.handler);
