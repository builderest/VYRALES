// POST /.netlify/functions/social-publish-background  { episode_id, platform: 'tiktok'|'instagram'|'facebook' }
//   tiktok    → envía el video final como BORRADOR a la bandeja de TikTok (el usuario termina en la app)
//   instagram → publica el Reel con la descripción, la portada y el aviso de IA del paquete
//   facebook  → publica el Reel en tu Página de Facebook (misma descripción que Instagram)
// Resultado en episodes.validator_report.social_runs[platform] { status, at, error?, url? }.
const { getSupabaseClient } = require('./_supabase');
const { tiktokSendDraft, instagramPublishReel, facebookPublishReel } = require('./_social');

const LOG = '[social]';

const { checkDashboardKey } = require('./_auth');
exports.handler = async (event) => {
  const denied = checkDashboardKey(event);
  if (denied) return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: denied }) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const supabase = getSupabaseClient();
  const body = JSON.parse(event.body || '{}');
  const platform = body.platform;
  const epId = body.episode_id;
  const save = async (patch, published) => {
    const { data } = await supabase.from('episodes').select('validator_report, published_at').eq('id', epId).single();
    const vr = Object.assign({}, (data && data.validator_report) || {});
    vr.social_runs = Object.assign({}, vr.social_runs || {}, { [platform]: Object.assign({ at: new Date().toISOString() }, patch) });
    const upd = { validator_report: vr };
    if (published) {
      vr.published = Object.assign({}, vr.published || {}, { [platform]: Object.assign({ at: new Date().toISOString() }, published) });
      if (!data.published_at) upd.published_at = new Date().toISOString();
    }
    await supabase.from('episodes').update(upd).eq('id', epId);
  };
  try {
    if (!['tiktok', 'instagram', 'facebook'].includes(platform)) throw new Error('Plataforma no válida.');
    const { data: ep, error } = await supabase.from('episodes').select('id, episode_number, validator_report, assets(kind, storage_path)').eq('id', epId || '').single();
    if (error || !ep) throw error || new Error('Episodio no encontrado.');
    const final = (ep.assets || []).find((a) => a.kind === 'final_render' && a.storage_path);
    if (!final) throw new Error('El episodio no tiene video final.');
    const pk = (ep.validator_report || {}).publish_package;
    if (!pk || pk.status !== 'done') throw new Error('Primero dale "Preparar textos y portada".');
    await save({ status: 'running' });
    if (platform === 'tiktok') {
      const res = await fetch(final.storage_path);
      if (!res.ok) throw new Error('No se pudo bajar el video final (HTTP ' + res.status + ').');
      const r = await tiktokSendDraft(supabase, { videoBuffer: Buffer.from(await res.arrayBuffer()), log: (...a) => console.log(LOG, ...a) });
      await save({ status: 'draft_sent', publish_id: r.publishId, tiktok_status: r.status });
      console.log(LOG, 'TikTok: borrador enviado ✅', r.status);
    } else if (platform === 'facebook') {
      const r = await facebookPublishReel(supabase, { videoUrl: final.storage_path, caption: pk.facebook || pk.instagram, log: (...a) => console.log(LOG, ...a) });
      await save({ status: 'published', url: r.permalink, video_id: r.videoId, pending: !!r.pending }, { url: r.permalink, via: 'api' });
      console.log(LOG, 'Facebook: Reel publicado ✅', r.permalink);
    } else {
      const r = await instagramPublishReel(supabase, { videoUrl: final.storage_path, coverUrl: pk.cover_url, caption: pk.instagram, log: (...a) => console.log(LOG, ...a) });
      await save({ status: 'published', url: r.permalink, media_id: r.mediaId }, { url: r.permalink, via: 'api' });
      console.log(LOG, 'Instagram: Reel publicado ✅', r.permalink);
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error(LOG, platform, 'ERROR:', err.message);
    if (epId) await save({ status: 'error', error: String(err.message).slice(0, 400) }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
