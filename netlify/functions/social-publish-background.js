// POST /.netlify/functions/social-publish-background  { episode_id, platform: 'tiktok'|'instagram'|'facebook'|'youtube' }
//   tiktok    → envía el video final como BORRADOR a la bandeja de TikTok (el usuario termina en la app)
//   instagram → publica el Reel con la descripción, la portada y el aviso de IA del paquete
//   facebook  → publica el Reel en tu Página de Facebook (misma descripción que Instagram)
//   youtube   → sube el Short (título + descripción + etiqueta de IA por API; privado si el proyecto no está auditado)
// Resultado en episodes.validator_report.social_runs[platform] { status, at, error?, url? }.
const { getSupabaseClient } = require('./_supabase');
const { tiktokSendDraft, instagramPublishReel, facebookPublishReel, youtubeUpload } = require('./_social');
const { youtubeTitle } = require('./_publish');

const LOG = '[social]';

const { checkDashboardKey } = require('./_auth');

// Plataformas que pueden subir el video desde la PC (archivo en calidad completa de VYRALE/finales).
// Facebook/Instagram todavía usan el enlace público de Supabase (la PC no es pública).
const PC_PLATFORMS = ['tiktok', 'youtube'];

// ¿La PC tiene el video final en calidad completa de ESTA versión y el agente está en línea?
async function pcFullQuality(supabase, epId, final) {
  const { data: st } = await supabase.from('agent_state').select('last_seen, info').eq('id', 1).maybeSingle();
  if (!st || !st.last_seen || Date.now() - new Date(st.last_seen).getTime() > 15000) return null;
  const f = ((st.info && st.info.files && st.info.files.finales) || []).find((x) => x.episode_id === epId);
  return f && f.source === final.storage_path ? f : null;
}

// Núcleo: lo usa esta función (Netlify) y agente/publish_local.js (PC).
//   loadVideo(final) → Buffer del video a subir (Supabase en Netlify, archivo local en la PC).
async function runPublish({ supabase, epId, platform, privacy, loadVideo, quality, log = (...a) => console.log(LOG, ...a) }) {
  const save = async (patch, published) => {
    const { data } = await supabase.from('episodes').select('validator_report, published_at').eq('id', epId).single();
    const vr = Object.assign({}, (data && data.validator_report) || {});
    vr.social_runs = Object.assign({}, vr.social_runs || {}, { [platform]: Object.assign({ at: new Date().toISOString(), quality }, patch) });
    const upd = { validator_report: vr };
    if (published) {
      vr.published = Object.assign({}, vr.published || {}, { [platform]: Object.assign({ at: new Date().toISOString() }, published) });
      if (!data.published_at) upd.published_at = new Date().toISOString();
    }
    await supabase.from('episodes').update(upd).eq('id', epId);
  };
  try {
    if (!['tiktok', 'instagram', 'facebook', 'youtube'].includes(platform)) throw new Error('Plataforma no válida.');
    const { data: ep, error } = await supabase.from('episodes').select('id, episode_number, validator_report, assets(kind, storage_path)').eq('id', epId || '').single();
    if (error || !ep) throw error || new Error('Episodio no encontrado.');
    const final = (ep.assets || []).find((a) => a.kind === 'final_render' && a.storage_path);
    if (!final) throw new Error('El episodio no tiene video final.');
    const pk = (ep.validator_report || {}).publish_package;
    if (!pk || pk.status !== 'done') throw new Error('Primero dale "Preparar textos y portada".');
    await save({ status: 'running' });
    if (platform === 'tiktok') {
      const r = await tiktokSendDraft(supabase, { videoBuffer: await loadVideo(final), log });
      await save({ status: 'draft_sent', publish_id: r.publishId, tiktok_status: r.status });
      log('TikTok: borrador enviado ✅', r.status, '· calidad', quality);
    } else if (platform === 'youtube') {
      const title = pk.youtube_title || youtubeTitle(pk.cover_text, pk.part || ('Parte ' + ep.episode_number));
      const description = pk.youtube || [pk.instagram, '#Shorts'].join('\n');
      const r = await youtubeUpload(supabase, { videoBuffer: await loadVideo(final), title, description, tags: pk.hashtags || [], privacy: privacy || 'public', log });
      if (r.privacy === 'private') await save({ status: 'uploaded_private', url: r.url, video_id: r.videoId, forced: r.forcedPrivate });
      else await save({ status: 'published', url: r.url, video_id: r.videoId, privacy: r.privacy }, { url: r.url, via: 'api' });
      log('YouTube: subido ✅', r.url, r.privacy, '· calidad', quality);
    } else if (platform === 'facebook') {
      const r = await facebookPublishReel(supabase, { videoUrl: final.storage_path, caption: pk.facebook || pk.instagram, log });
      await save({ status: 'published', url: r.permalink, video_id: r.videoId, pending: !!r.pending }, { url: r.permalink, via: 'api' });
      log('Facebook: Reel publicado ✅', r.permalink);
    } else {
      const r = await instagramPublishReel(supabase, { videoUrl: final.storage_path, coverUrl: pk.cover_url, caption: pk.instagram, log });
      await save({ status: 'published', url: r.permalink, media_id: r.mediaId }, { url: r.permalink, via: 'api' });
      log('Instagram: Reel publicado ✅', r.permalink);
    }
    return { ok: true };
  } catch (err) {
    console.error(LOG, platform, 'ERROR:', err.message);
    if (epId) await save({ status: 'error', error: String(err.message).slice(0, 400) }).catch(() => {});
    return { ok: false, error: err.message };
  }
}

async function fromSupabase(final) {
  const res = await fetch(final.storage_path);
  if (!res.ok) throw new Error('No se pudo bajar el video final (HTTP ' + res.status + ').');
  return Buffer.from(await res.arrayBuffer());
}

exports.handler = async (event) => {
  const denied = checkDashboardKey(event);
  if (denied) return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: denied }) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const supabase = getSupabaseClient();
  const body = JSON.parse(event.body || '{}');
  const platform = body.platform;
  const epId = body.episode_id;
  // YouTube / TikTok: si la PC tiene la versión en calidad completa, la sube el agente desde la PC.
  if (PC_PLATFORMS.includes(platform) && /^[0-9a-f-]{36}$/i.test(epId || '')) {
    try {
      const { data: ep } = await supabase.from('episodes').select('id, validator_report, assets(kind, storage_path)').eq('id', epId).single();
      const final = ep && (ep.assets || []).find((a) => a.kind === 'final_render' && a.storage_path);
      const pk = ep && (ep.validator_report || {}).publish_package;
      if (final && pk && pk.status === 'done' && await pcFullQuality(supabase, epId, final)) {
        const vr = Object.assign({}, ep.validator_report || {});
        vr.social_runs = Object.assign({}, vr.social_runs || {}, { [platform]: { at: new Date().toISOString(), status: 'running', quality: 'completa', via: 'pc' } });
        await supabase.from('episodes').update({ validator_report: vr }).eq('id', epId);
        const { error } = await supabase.from('agent_jobs').insert({ command: 'publish:' + epId + ':' + platform + (body.privacy === 'private' ? ':private' : '') });
        if (!error) { console.log(LOG, platform, '→ lo sube la PC en calidad completa'); return { statusCode: 200, body: JSON.stringify({ ok: true, via: 'pc' }) }; }
        console.log(LOG, 'no se pudo encargar a la PC (', error.message, '): se sube desde Netlify');
      }
    } catch (err) { console.log(LOG, 'revisión de la PC falló (', err.message, '): se sube desde Netlify'); }
  }
  const r = await runPublish({ supabase, epId, platform, privacy: body.privacy, loadVideo: fromSupabase, quality: 'reducida' });
  return { statusCode: r.ok ? 200 : 500, body: JSON.stringify(r) };
};

exports.runPublish = runPublish;
