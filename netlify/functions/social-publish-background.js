// POST /.netlify/functions/social-publish-background  { episode_id, platform: 'tiktok'|'instagram'|'facebook'|'youtube' }
//   tiktok    → envía el video final como BORRADOR a la bandeja de TikTok (el usuario termina en la app)
//   instagram → publica el Reel con la descripción, la portada y el aviso de IA del paquete
//   facebook  → publica el Reel en tu Página de Facebook (misma descripción que Instagram)
//   youtube   → sube el Short (título + descripción + etiqueta de IA por API; privado si el proyecto no está auditado)
// Resultado en episodes.validator_report.social_runs[platform] { status, at, error?, url? }.
const { getSupabaseClient } = require('./_supabase');
const { tiktokSendDraft, tiktokDirectPost, instagramPublishReel, facebookPublishReel, youtubeUpload, youtubeAddToPlaylist, youtubePlaylists } = require('./_social');
const { youtubeTitle } = require('./_publish');

const LOG = '[social]';

const { checkDashboardKey } = require('./_auth');

// Plataformas que pueden subir el video desde la PC (archivo en calidad completa de VYRALE/finales).
// Facebook/Instagram también (oct-11): la PC les manda el archivo directo (rupload), así ya no van en 480–720p.
const PC_PLATFORMS = ['tiktok', 'youtube', 'facebook', 'instagram'];

// ¿La PC tiene el video final en calidad completa de ESTA versión y el agente está en línea?
async function pcFullQuality(supabase, epId, final) {
  const { data: st } = await supabase.from('agent_state').select('last_seen, info').eq('id', 1).maybeSingle();
  if (!st || !st.last_seen || Date.now() - new Date(st.last_seen).getTime() > 15000) return null;
  const f = ((st.info && st.info.files && st.info.files.finales) || []).find((x) => x.episode_id === epId && x.source === final.storage_path);
  return f || null;
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
    const { data: ep, error } = await supabase.from('episodes').select('id, title, episode_number, series_id, validator_report, continuity, assets(kind, storage_path)').eq('id', epId || '').single();
    if (error || !ep) throw error || new Error('Episodio no encontrado.');
    const final = (ep.assets || []).find((a) => a.kind === 'final_render' && a.storage_path);
    if (!final) throw new Error('El episodio no tiene video final.');
    let pk = (ep.validator_report || {}).publish_package;
    if (!pk || pk.status !== 'done') throw new Error('Primero dale "Preparar textos y portada".');
    // Short que lleva al LARGO (Franklin, oct-11): en TODAS las redes va el enlace al video largo de YouTube,
    // justo debajo de "entra al enlace que te dejo aquí abajo" y en el comentario fijado.
    const parentId = (ep.continuity || {}).parent_episode_id;
    if (parentId && (pk.cta_to_long || (ep.continuity || {}).kind === 'short_cta')) {
      const { data: par } = await supabase.from('episodes').select('validator_report').eq('id', parentId).single();
      const pvr = (par && par.validator_report) || {};
      const yt = ((pvr.published || {}).youtube) || ((pvr.social_runs || {}).youtube) || {};
      const longUrl = yt.url || (yt.video_id ? 'https://youtu.be/' + yt.video_id : '');
      if (longUrl) {
        const line = '👉 Historia completa: ' + longUrl;
        // Instagram y TikTok NO convierten en enlace lo que va en el texto (HECHO): ahí se manda al enlace del perfil,
        // que apunta a vyrales.app/ver (siempre muestra los largos públicos). Facebook y YouTube sí llevan el enlace directo.
        const SITE = (process.env.PUBLIC_SITE_HOST || 'vyrales.app') + '/ver';
        const lineBio = '👉 Historia completa: toca el enlace de mi perfil (' + SITE + ')';
        const add = (t, ln = line) => { t = String(t || ''); if (!t || t.includes(longUrl) || t.includes(SITE)) return t; const i = t.indexOf('👇'); if (i < 0) return ln + '\n' + t; const end = t.indexOf('\n', i); return end < 0 ? t + '\n' + ln : t.slice(0, end) + '\n' + ln + t.slice(end); };
        pk = Object.assign({}, pk, { tiktok: add(pk.tiktok, lineBio), instagram: add(pk.instagram, lineBio), facebook: add(pk.facebook || pk.instagram), youtube: add(pk.youtube, '▶ Historia completa: toca el video relacionado (arriba del título)'),
          pinned_comment: String(pk.pinned_comment || '').replace(/\(pega aquí el enlace del video largo\)/, longUrl) || line });
        log('enlace al video largo agregado a los textos:', longUrl);
        if (yt.privacy === 'private' || /uploaded_private/.test(String(yt.status || ''))) log('AVISO: el video largo sigue en PRIVADO en YouTube; el enlace no funcionará para el público hasta que lo hagas público.');
      } else log('AVISO: el video largo todavía no está en YouTube → este Short sale sin enlace (súbelo primero).');
    }
    await save({ status: 'running' });
    // TikTok Direct Post: el panel guarda lo que el usuario eligió (privacidad, interruptores,
    // divulgación, etiqueta de IA) en validator_report.tiktok_post justo antes de publicar.
    const tp = (ep.validator_report || {}).tiktok_post;
    if (platform === 'tiktok' && tp && tp.privacy_level && Date.now() - new Date(tp.at || 0).getTime() < 30 * 60000) {
      const r = await tiktokDirectPost(supabase, { videoBuffer: await loadVideo(final), post: tp, log });
      const done = r.status === 'PUBLISH_COMPLETE';
      await save({ status: done ? 'published' : 'tiktok_processing', publish_id: r.publishId, tiktok_status: r.status, privacy: r.privacy, url: r.url, is_aigc: tp.is_aigc !== false }, done && r.privacy !== 'SELF_ONLY' ? { url: r.url, via: 'api' } : null);
      log('TikTok: publicado directo ✅', r.status, r.privacy, r.url || '', '· calidad', quality);
    } else if (platform === 'tiktok') {
      const r = await tiktokSendDraft(supabase, { videoBuffer: await loadVideo(final), log });
      await save({ status: 'draft_sent', publish_id: r.publishId, tiktok_status: r.status });
      log('TikTok: borrador enviado ✅', r.status, '· calidad', quality);
    } else if (platform === 'youtube') {
      const title = pk.youtube_title || youtubeTitle(pk.cover_text, pk.part || ('Parte ' + ep.episode_number));
      const description = pk.youtube || [pk.instagram, '#Shorts'].join('\n');
      // Título y descripción también en INGLÉS (localización): del paquete, o de la pista en inglés del episodio.
      const enC = (ep.continuity && ep.continuity.english) || {};
      const en = pk.youtube_title_en ? { title: pk.youtube_title_en, description: pk.youtube_en || '' } : (enC.title ? { title: enC.title, description: [enC.description || '', '', 'Made with AI.'].join('\n') } : null);
      if (!en) log('YouTube: este paquete no trae textos en inglés (se generan en los paquetes nuevos); sube solo en español');
      const r = await youtubeUpload(supabase, { videoBuffer: await loadVideo(final), title, description, tags: pk.hashtags || [], privacy: privacy || 'private', en, log }); // PRIVADO por defecto (Franklin, oct-7: revisa antes de hacerlo público)
      if (r.privacy === 'private') await save({ status: 'uploaded_private', url: r.url, video_id: r.videoId, forced: r.forcedPrivate });
      else await save({ status: 'published', url: r.url, video_id: r.videoId, privacy: r.privacy }, { url: r.url, via: 'api' });
      log('YouTube: subido ✅', r.url, r.privacy, '· calidad', quality);
      // Documental largo: sin letras en pantalla → subtítulos CC español e inglés (YouTube los muestra según el idioma).
      if ((ep.continuity || {}).kind === 'largo') {
        try {
          const C = require('./_captions');
          const { data: epFull } = await supabase.from('episodes').select('*').eq('id', ep.id).single();
          await C.uploadSubtitles(supabase, { videoId: r.videoId, subs: await C.ensureSubtitles(supabase, epFull, log), log });
        } catch (e) { log('YouTube: subtítulos no subidos (' + String(e.message).slice(0, 160) + ') → se pueden subir con "subtitulos:<ep>"'); }
      }
      // Documental largo: las fuentes van como comentario (la API no deja FIJARLO: se fija a mano en Studio con 1 clic).
      if ((pk.landscape || parentId) && pk.pinned_comment) { // largo: fuentes · Short del largo: enlace a la historia completa
        try {
          const tk = await require('./_social').youtubeAccessToken(supabase);
          const cr = await fetch('https://www.googleapis.com/youtube/v3/commentThreads?part=snippet', { method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ snippet: { videoId: r.videoId, topLevelComment: { snippet: { textOriginal: String(pk.pinned_comment).slice(0, 9000) } } } }) });
          log(cr.ok ? 'YouTube: comentario con las fuentes publicado (fíjalo en Studio: ⋮ → Fijar)' : 'YouTube: no pude publicar el comentario de fuentes (HTTP ' + cr.status + ': ' + (await cr.text()).slice(0, 160) + ')');
        } catch (e) { log('YouTube: comentario de fuentes falló (' + String(e.message).slice(0, 120) + ')'); }
      }
      // Playlists (Franklin, oct-11: más alcance): las de la serie + las del TEMA del episodio (un video puede ir en varias).
      try {
        const { data: ser } = await supabase.from('series').select('slug, title, story_bible').eq('id', ep.series_id).single();
        const lists = await youtubePlaylists(supabase);
        const want = new Set(((ser && ser.story_bible && ser.story_bible.youtube_playlists) || []));
        const topic = [ep.title, pk.youtube_title, pk.youtube_title_en, ser && ser.title].join(' ').toLowerCase();
        const RULES = [
          [/origen|human|neandert|denisov|sapiens|homo |ancestr|prehist|toba|cazadores|evoluci/, /orígenes|origins/i],
          [/historia|history|imperio|guerra|batalla|siglo|antigu|rey|reina/, /historia|history/i],
          [/curios|sabías|facts|ciencia|espacio|cuerpo|planeta|animal|océano|tierra/, /curiosidades|facts/i]
        ];
        for (const [re, listRe] of RULES) if (re.test(topic)) lists.filter((l) => listRe.test(l.title)).forEach((l) => want.add(l.id));
        for (const pid of want) {
          try { await youtubeAddToPlaylist(supabase, { videoId: r.videoId, playlistId: pid }); log('YouTube: agregado a la playlist', (lists.find((l) => l.id === pid) || {}).title || pid); }
          catch (e) { log('YouTube: no pude agregarlo a la playlist (' + String(e.message).slice(0, 160) + ')'); }
        }
        if (!want.size) log('YouTube: ninguna playlist coincide con este video');
      } catch (e) { log('YouTube: playlists no disponibles (' + String(e.message).slice(0, 120) + ')'); }
    } else if (platform === 'facebook') {
      // Calidad completa desde la PC; si Meta rechaza el archivo, se reintenta con el enlace de Supabase (720p).
      let r;
      try { r = await facebookPublishReel(supabase, { videoUrl: final.storage_path, videoBuffer: quality === 'completa' ? await loadVideo(final) : null, caption: pk.facebook || pk.instagram, log }); }
      catch (e) { if (quality !== 'completa') throw e; log('facebook: la subida en calidad completa falló (' + String(e.message).slice(0, 160) + ') → reintento con el enlace'); r = await facebookPublishReel(supabase, { videoUrl: final.storage_path, caption: pk.facebook || pk.instagram, log }); }
      await save({ status: 'published', url: r.permalink, video_id: r.videoId, pending: !!r.pending }, { url: r.permalink, via: 'api' });
      log('Facebook: Reel publicado ✅', r.permalink);
    } else {
      // Calidad completa desde la PC; si Meta rechaza el archivo, se reintenta con el enlace de Supabase (720p).
      let r;
      try { r = await instagramPublishReel(supabase, { videoUrl: final.storage_path, videoBuffer: quality === 'completa' ? await loadVideo(final) : null, coverUrl: pk.cover_url, caption: pk.instagram, log }); }
      catch (e) { if (quality !== 'completa') throw e; log('instagram: la subida en calidad completa falló (' + String(e.message).slice(0, 160) + ') → reintento con el enlace'); r = await instagramPublishReel(supabase, { videoUrl: final.storage_path, coverUrl: pk.cover_url, caption: pk.instagram, log }); }
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
  // Lo elegido en el panel de TikTok (Direct Post): se guarda en el episodio para que lo use
  // quien suba el video (Netlify o la PC). Solo campos conocidos, con sus tipos.
  if (platform === 'tiktok' && body.tiktok_post && /^[0-9a-f-]{36}$/i.test(epId || '')) {
    const t = body.tiktok_post;
    const tp = {
      at: new Date().toISOString(),
      title: String(t.title || '').slice(0, 2200),
      privacy_level: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'].includes(t.privacy_level) ? t.privacy_level : null,
      disable_comment: !!t.disable_comment, disable_duet: !!t.disable_duet, disable_stitch: !!t.disable_stitch,
      brand_content_toggle: !!t.brand_content_toggle, brand_organic_toggle: !!t.brand_organic_toggle,
      is_aigc: t.is_aigc !== false
    };
    if (!tp.privacy_level) return { statusCode: 400, body: JSON.stringify({ error: 'Elige la privacidad.' }) };
    const { data: cur } = await supabase.from('episodes').select('validator_report').eq('id', epId).single();
    await supabase.from('episodes').update({ validator_report: Object.assign({}, (cur && cur.validator_report) || {}, { tiktok_post: tp }) }).eq('id', epId);
  }
  // YouTube / TikTok: si la PC tiene la versión en calidad completa, la sube el agente desde la PC.
  if (PC_PLATFORMS.includes(platform) && !body.no_pc && /^[0-9a-f-]{36}$/i.test(epId || '')) {
    try {
      const { data: ep } = await supabase.from('episodes').select('id, validator_report, assets(kind, storage_path)').eq('id', epId).single();
      const final = ep && (ep.assets || []).find((a) => a.kind === 'final_render' && a.storage_path);
      const pk = ep && (ep.validator_report || {}).publish_package;
      if (final && pk && pk.status === 'done' && await pcFullQuality(supabase, epId, final)) {
        const vr = Object.assign({}, ep.validator_report || {});
        vr.social_runs = Object.assign({}, vr.social_runs || {}, { [platform]: { at: new Date().toISOString(), status: 'running', quality: 'completa', via: 'pc' } });
        await supabase.from('episodes').update({ validator_report: vr }).eq('id', epId);
        const { error } = await supabase.from('agent_jobs').insert(await require('./_tenant').jobRow(supabase, 'publish:' + epId + ':' + platform + (body.privacy === 'public' ? ':public' : body.privacy === 'private' ? ':private' : '')));
        if (!error) { console.log(LOG, platform, '→ lo sube la PC en calidad completa'); return { statusCode: 200, body: JSON.stringify({ ok: true, via: 'pc' }) }; }
        console.log(LOG, 'no se pudo encargar a la PC (', error.message, '): se sube desde Netlify');
      }
    } catch (err) { console.log(LOG, 'revisión de la PC falló (', err.message, '): se sube desde Netlify'); }
  }
  const r = await runPublish({ supabase, epId, platform, privacy: body.privacy, loadVideo: fromSupabase, quality: 'reducida' });
  return { statusCode: r.ok ? 200 : 500, body: JSON.stringify(r) };
};

exports.runPublish = runPublish;

// Claves de la página Cuenta → API (cifradas en Supabase; mandan sobre el .env). Ver _keys.js.
exports.handler = require('./_keys').withKeys(exports.handler);
