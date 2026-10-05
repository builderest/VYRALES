// POST /.netlify/functions/publish-mark  { episode_id, platform: 'tiktok'|'instagram'|'facebook'|'youtube', url?, unmark? }
// Registra que el episodio se publicó en una red (para llevar la cuenta en el dashboard).
const { getSupabaseClient } = require('./_supabase');
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const { checkDashboardKey } = require('./_auth');
exports.handler = async (event) => {
  const denied = checkDashboardKey(event);
  if (denied) return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: denied }) };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const b = JSON.parse(event.body || '{}');
    if (!['tiktok', 'instagram', 'facebook', 'youtube'].includes(b.platform)) return json(400, { error: 'Plataforma no válida.' });
    const url = String(b.url || '').trim();
    if (url && !/^https:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com|instagram\.com|facebook\.com|m\.facebook\.com|fb\.watch|youtube\.com|m\.youtube\.com|youtu\.be)\//.test(url)) return json(400, { error: 'El enlace no parece de TikTok, Instagram, Facebook o YouTube.' });
    const supabase = getSupabaseClient();
    const { data: ep, error } = await supabase.from('episodes').select('id, validator_report, published_at').eq('id', b.episode_id || '').single();
    if (error || !ep) return json(404, { error: 'Episodio no encontrado.' });
    const vr = Object.assign({}, ep.validator_report || {});
    vr.published = Object.assign({}, vr.published || {});
    if (b.unmark) delete vr.published[b.platform];
    else vr.published[b.platform] = { url: url || null, at: new Date().toISOString() };
    const patch = { validator_report: vr };
    if (!b.unmark && !ep.published_at) patch.published_at = new Date().toISOString();
    const { error: uErr } = await supabase.from('episodes').update(patch).eq('id', ep.id);
    if (uErr) throw uErr;
    return json(200, { published: vr.published });
  } catch (err) { return json(500, { error: err.message }); }
};
