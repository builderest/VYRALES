// GET /.netlify/functions/social-status → qué redes están conectadas (SIN tokens).
const { getSupabaseClient } = require('./_supabase');
const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
exports.handler = async () => {
  const keys = { tiktok: !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET), instagram: !!(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET) };
  try {
    const { data, error } = await getSupabaseClient().from('social_accounts').select('platform, account_name, expires_at, refresh_expires_at, updated_at');
    if (error) return json(200, { keys, accounts: {}, table_missing: true, error: error.message });
    const accounts = {};
    (data || []).forEach((a) => { accounts[a.platform] = { name: a.account_name, expires_at: a.platform === 'tiktok' ? (a.refresh_expires_at || a.expires_at) : a.expires_at, updated_at: a.updated_at }; });
    return json(200, { keys, accounts });
  } catch (err) { return json(500, { error: err.message }); }
};
