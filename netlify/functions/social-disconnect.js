// POST /.netlify/functions/social-disconnect { platform } → borra la conexión guardada de esa red
// (el token en social_accounts). Para revocar el permiso del todo, también se quita la app
// desde la configuración de TikTok/Instagram.
const { getSupabaseClient } = require('./_supabase');
const { checkDashboardKey } = require('./_auth');
const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
exports.handler = async (event) => {
  const denied = checkDashboardKey(event);
  if (denied) return json(401, { error: denied });
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const { platform } = JSON.parse(event.body || '{}');
    if (!['tiktok', 'instagram', 'facebook', 'meta'].includes(platform)) return json(400, { error: 'Plataforma no válida.' });
    const { error } = await getSupabaseClient().from('social_accounts').delete().in('platform', platform === 'meta' ? ['facebook', 'instagram'] : [platform]);
    if (error) throw error;
    return json(200, { ok: true });
  } catch (err) { return json(500, { error: err.message }); }
};
