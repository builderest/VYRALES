// Obsoleto: la vuelta de Meta ahora llega a /auth/meta/callback (oauth-meta-callback).
exports.handler = async () => ({ statusCode: 302, headers: { Location: '/?connected=meta', 'Cache-Control': 'no-store' }, body: '' });
