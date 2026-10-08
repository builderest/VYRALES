// Conexión con TikTok e Instagram para publicar desde VYRALES.
//   TikTok   — Login Kit + Content Posting API. Sin auditoría de TikTok: "Upload" (el video
//              llega como BORRADOR a la bandeja de la app; el usuario activa la etiqueta de IA
//              y publica). Docs: developers.tiktok.com/doc/content-posting-api-get-started-upload-content
//   Meta      — "Facebook Login": una conexión da la Página de Facebook y su Instagram vinculado
//              (ver sección Meta abajo).
//   YouTube   — Data API v3 (Shorts), ver sección YouTube abajo.
// Llaves en .env / Netlify: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, META_APP_ID, META_APP_SECRET,
// YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET. Los tokens se guardan en la tabla social_accounts (migración 006).
const crypto = require('crypto');

const BASE_URL = () => (process.env.PUBLIC_BASE_URL || 'https://vyrales.app').replace(/\/$/, '');
const REDIRECT = (platform) => `${BASE_URL()}/auth/${platform}/callback`;

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} en el .env / Netlify.`);
  return v;
}

// state anti-CSRF firmado (sin guardar nada): plataforma + hora + firma HMAC con el secreto.
const stateSecret = (platform) => platform === 'tiktok' ? ttSecret() : platform === 'youtube' ? need('YOUTUBE_CLIENT_SECRET') : metaSecret();
function makeState(platform) {
  const secret = stateSecret(platform);
  const payload = `${platform}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
}
// Devuelve null si el state es válido, o el MOTIVO exacto si no lo es.
function stateProblem(platform, state) {
  const secret = stateSecret(platform);
  if (!state) return 'La dirección llegó sin "state": hay que entrar dándole "Conectar" en VYRALES, no abriendo esta página directo.';
  const [p, ts, sig] = String(state).split('.');
  if (p !== platform || !ts || !sig) return 'El "state" llegó incompleto (' + String(state).slice(0, 20) + '…).';
  if (Date.now() - Number(ts) > 15 * 60000) return 'Pasaron más de 15 minutos desde que le diste "Conectar". Vuelve a intentarlo.';
  const good = crypto.createHmac('sha256', secret).update(`${p}.${ts}`).digest('hex').slice(0, 32);
  if (good !== sig) return 'La firma no coincide: el TIKTOK_CLIENT_SECRET (o el META_APP_SECRET) de Netlify NO es igual al de tu .env. Conecta desde vyrales.app (no desde localhost) o iguala las llaves.';
  return null;
}
function checkState(platform, state) { return stateProblem(platform, state) === null; }

async function saveAccount(supabase, row) {
  const { error } = await supabase.from('social_accounts').upsert(Object.assign({ updated_at: new Date().toISOString() }, row));
  if (error) throw new Error('No se pudo guardar la cuenta (¿corriste la migración 006?): ' + error.message);
}
async function getAccount(supabase, platform) {
  const { data, error } = await supabase.from('social_accounts').select('*').eq('platform', platform).maybeSingle();
  if (error) throw new Error('No se pudo leer la cuenta (¿corriste la migración 006?): ' + error.message);
  return data;
}

async function jsonFetch(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) { body = { raw: text.slice(0, 300) }; }
  return { res, body };
}

// ---------------- TikTok ----------------
// TIKTOK_SANDBOX=1 → usa la app de pruebas (Sandbox) de TikTok: TIKTOK_SANDBOX_CLIENT_KEY / _SECRET.
// Sirve para grabar el video demo de la revisión (video.publish) antes de que TikTok lo apruebe.
const ttSandbox = () => /^(1|true|si|sí)$/i.test(process.env.TIKTOK_SANDBOX || '');
const ttKey = () => ttSandbox() ? need('TIKTOK_SANDBOX_CLIENT_KEY') : need('TIKTOK_CLIENT_KEY');
const ttSecret = () => ttSandbox() ? need('TIKTOK_SANDBOX_CLIENT_SECRET') : need('TIKTOK_CLIENT_SECRET');
// Direct Post (publicar directo con etiqueta de IA): TIKTOK_DIRECT=1 cuando la app tenga video.publish.
const ttDirect = () => ttSandbox() || /^(1|true|si|sí)$/i.test(process.env.TIKTOK_DIRECT || '');
// Solo lo que tiene la app en TikTok: borrador (video.upload). video.publish aparece al activar
// "Direct Post"; para pedirlo, poner TIKTOK_SCOPES=user.info.basic,video.upload,video.publish.
const tiktokScopes = () => process.env.TIKTOK_SCOPES || (ttDirect() ? 'user.info.basic,video.upload,video.publish' : 'user.info.basic,video.upload');
function tiktokAuthUrl() {
  const q = new URLSearchParams({ client_key: ttKey(), scope: tiktokScopes(), response_type: 'code', redirect_uri: REDIRECT('tiktok'), state: makeState('tiktok'), disable_auto_auth: '1' }); // siempre muestra la pantalla de permisos
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}
async function tiktokToken(params) {
  const { res, body } = await jsonFetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ client_key: ttKey(), client_secret: ttSecret() }, params))
  });
  if (!res.ok || !body.access_token) throw new Error('TikTok no dio el token: ' + JSON.stringify(body).slice(0, 300));
  return body;
}
async function tiktokConnect(supabase, code) {
  const t = await tiktokToken({ code, grant_type: 'authorization_code', redirect_uri: REDIRECT('tiktok') });
  let name = null;
  try {
    const { body } = await jsonFetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', { headers: { Authorization: `Bearer ${t.access_token}` } });
    name = body && body.data && body.data.user && body.data.user.display_name;
  } catch (_) {}
  await saveAccount(supabase, {
    platform: 'tiktok', account_id: t.open_id, account_name: name, access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in || 86400) * 1000).toISOString(),
    refresh_expires_at: t.refresh_expires_in ? new Date(Date.now() + t.refresh_expires_in * 1000).toISOString() : null,
    scopes: t.scope || tiktokScopes()
  });
  return name || t.open_id;
}
async function tiktokAccessToken(supabase) {
  const acc = await getAccount(supabase, 'tiktok');
  if (!acc) throw new Error('TikTok no está conectado. Dale "Conectar TikTok".');
  if (acc.expires_at && new Date(acc.expires_at).getTime() - Date.now() > 5 * 60000) return acc.access_token;
  const t = await tiktokToken({ grant_type: 'refresh_token', refresh_token: acc.refresh_token });
  await saveAccount(supabase, Object.assign({}, acc, { access_token: t.access_token, refresh_token: t.refresh_token || acc.refresh_token, expires_at: new Date(Date.now() + (t.expires_in || 86400) * 1000).toISOString() }));
  return t.access_token;
}
// Envía el video a la bandeja de TikTok como borrador (un solo pedazo: el final pesa < 64 MB).
async function tiktokSendDraft(supabase, { videoBuffer, log = console.log }) {
  const token = await tiktokAccessToken(supabase);
  const size = videoBuffer.length;
  // TikTok: un solo pedazo hasta 64 MB; más grande (calidad completa desde la PC) va en pedazos de
  // 10 MB: total = floor(tamaño / pedazo) y el último pedazo se lleva el resto (regla de la API).
  const MB = 1024 * 1024;
  const chunk = size <= 64 * MB ? size : 10 * MB;
  const count = size <= 64 * MB ? 1 : Math.floor(size / chunk);
  const { res, body } = await jsonFetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count } })
  });
  if (!res.ok || !body.data || !body.data.upload_url) throw new Error('TikTok rechazó el inicio de la subida: ' + JSON.stringify(body.error || body).slice(0, 300));
  log('[tiktok] subiendo', (size / MB).toFixed(1), 'MB en', count, count === 1 ? 'pedazo...' : 'pedazos...');
  for (let k = 0; k < count; k++) {
    const start = k * chunk;
    const end = k === count - 1 ? size - 1 : start + chunk - 1;
    const part = videoBuffer.subarray(start, end + 1);
    const up = await fetch(body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(part.length), 'Content-Range': `bytes ${start}-${end}/${size}` }, body: part });
    if (!up.ok) throw new Error('TikTok rechazó el pedazo ' + (k + 1) + '/' + count + ' (HTTP ' + up.status + '): ' + (await up.text()).slice(0, 200));
  }
  const publishId = body.data.publish_id;
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await jsonFetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ publish_id: publishId }) });
    const s = st.body && st.body.data && st.body.data.status;
    log('[tiktok] estado:', s);
    if (s === 'SEND_TO_USER_INBOX' || s === 'PUBLISH_COMPLETE') return { publishId, status: s };
    if (s === 'FAILED') throw new Error('TikTok falló al procesar: ' + (st.body.data.fail_reason || 'sin detalle'));
  }
  return { publishId, status: 'PROCESSING' };
}

// ---- TikTok Direct Post (publica directo, con la etiqueta oficial de IA: is_aigc) ----
// Requiere video.publish. Mientras TikTok no audite la app, todo sale en SELF_ONLY (solo yo).
// Reglas de UX de TikTok (developers.tiktok.com/doc/content-sharing-guidelines): el panel muestra
// el nombre del creador, la privacidad SIN valor por defecto (de privacy_level_options), los
// interruptores de comentarios/dúo/stitch apagados y bloqueados si el creador los tiene apagados,
// la divulgación de contenido comercial y la declaración de Música / Contenido de marca.
async function tiktokCreatorInfo(supabase) {
  const token = await tiktokAccessToken(supabase);
  const { res, body } = await jsonFetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' }
  });
  const err = body && body.error;
  if (!res.ok || (err && err.code && err.code !== 'ok')) {
    const code = err && err.code;
    if (code === 'scope_not_authorized') throw new Error('La cuenta de TikTok no autorizó "video.publish". Dale Desconectar y Conectar TikTok otra vez (con TIKTOK_DIRECT=1 o TIKTOK_SANDBOX=1).');
    if (code === 'spam_risk_too_many_posts') throw new Error('TikTok: esta cuenta llegó al límite de publicaciones por hoy. Intenta más tarde.');
    if (code === 'spam_risk_user_banned_from_posting') throw new Error('TikTok: esta cuenta no puede publicar ahora mismo.');
    throw new Error('TikTok creator_info: ' + JSON.stringify(err || body).slice(0, 300));
  }
  return body.data; // { creator_avatar_url, creator_username, creator_nickname, privacy_level_options, comment_disabled, duet_disabled, stitch_disabled, max_video_post_duration_sec }
}

// Sube el archivo a una upload_url de TikTok (1 pedazo hasta 64 MB; si no, pedazos de 10 MB).
function ttChunks(size) {
  const MB = 1024 * 1024;
  const chunk = size <= 64 * MB ? size : 10 * MB;
  return { chunk, count: size <= 64 * MB ? 1 : Math.floor(size / chunk) };
}
async function ttUpload(uploadUrl, videoBuffer, log) {
  const size = videoBuffer.length;
  const { chunk, count } = ttChunks(size);
  log('[tiktok] subiendo', (size / 1048576).toFixed(1), 'MB en', count, count === 1 ? 'pedazo...' : 'pedazos...');
  for (let k = 0; k < count; k++) {
    const start = k * chunk;
    const end = k === count - 1 ? size - 1 : start + chunk - 1;
    const part = videoBuffer.subarray(start, end + 1);
    const up = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(part.length), 'Content-Range': `bytes ${start}-${end}/${size}` }, body: part });
    if (!up.ok) throw new Error('TikTok rechazó el pedazo ' + (k + 1) + '/' + count + ' (HTTP ' + up.status + '): ' + (await up.text()).slice(0, 200));
  }
}

// post: { title, privacy_level, disable_comment, disable_duet, disable_stitch, brand_content_toggle, brand_organic_toggle, is_aigc }
async function tiktokDirectPost(supabase, { videoBuffer, post, log = console.log }) {
  const info = await tiktokCreatorInfo(supabase); // TikTok exige consultarlo justo antes de publicar
  const opts = info.privacy_level_options || [];
  if (!post || !opts.includes(post.privacy_level)) throw new Error('Privacidad no válida para esta cuenta: ' + (post && post.privacy_level) + ' (opciones: ' + opts.join(', ') + ').');
  if (post.brand_content_toggle && post.privacy_level === 'SELF_ONLY') throw new Error('El contenido de marca no puede ser privado (regla de TikTok).');
  const post_info = {
    title: String(post.title || '').slice(0, 2200),
    privacy_level: post.privacy_level,
    disable_comment: !!(post.disable_comment || info.comment_disabled),
    disable_duet: !!(post.disable_duet || info.duet_disabled),
    disable_stitch: !!(post.disable_stitch || info.stitch_disabled),
    brand_content_toggle: !!post.brand_content_toggle,
    brand_organic_toggle: !!post.brand_organic_toggle,
    is_aigc: post.is_aigc !== false
  };
  const token = await tiktokAccessToken(supabase);
  const size = videoBuffer.length;
  const { chunk, count } = ttChunks(size);
  const { res, body } = await jsonFetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ post_info, source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count } })
  });
  if (!res.ok || !body.data || !body.data.upload_url) {
    const code = body && body.error && body.error.code;
    if (code === 'unaudited_client_can_only_post_to_private_accounts') throw new Error('TikTok todavía no auditó la app: mientras tanto solo deja publicar en cuentas de TikTok PRIVADAS. Pon tu cuenta en privada (TikTok → Configuración y privacidad → Privacidad → Cuenta privada), publica, y luego vuelve a ponerla pública.');
    throw new Error('TikTok rechazó la publicación: ' + JSON.stringify(body.error || body).slice(0, 300));
  }
  await ttUpload(body.data.upload_url, videoBuffer, log);
  const publishId = body.data.publish_id;
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await jsonFetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ publish_id: publishId }) });
    const d = (st.body && st.body.data) || {};
    log('[tiktok] estado:', d.status);
    if (d.status === 'PUBLISH_COMPLETE') {
      const vid = (d.publicaly_available_post_id || d.publicly_available_post_id || [])[0];
      const url = vid && info.creator_username ? `https://www.tiktok.com/@${info.creator_username}/video/${vid}` : (info.creator_username ? `https://www.tiktok.com/@${info.creator_username}` : null);
      return { publishId, status: d.status, url, privacy: post_info.privacy_level, username: info.creator_username };
    }
    if (d.status === 'FAILED') throw new Error('TikTok falló al procesar: ' + (d.fail_reason || 'sin detalle'));
  }
  return { publishId, status: 'PROCESSING', url: info.creator_username ? `https://www.tiktok.com/@${info.creator_username}` : null, privacy: post_info.privacy_level, username: info.creator_username };
}

// ---------------- Meta: Facebook (Página) + Instagram ----------------
// UNA sola conexión con "Facebook Login": da el token de tu PÁGINA de Facebook, y con ese mismo
// token se publica en el Instagram profesional vinculado a la Página.
//   Facebook Reels → /{page-id}/video_reels (start → rupload con file_url → finish PUBLISHED)
//     docs: developers.facebook.com/docs/video-api/guides/reels-publishing (30 Reels/24 h)
//   Instagram Reels → /{ig-user-id}/media (REELS, video_url) → media_publish (100/24 h)
// El token de Página sacado de un token de usuario largo NO caduca (hasta que cambies la
// contraseña o quites la app). Llaves: META_APP_ID, META_APP_SECRET (Opcional META_PAGE_ID si
// administras varias Páginas).
const FB_GRAPH = 'https://graph.facebook.com/v25.0';
const META_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management';
const metaId = () => process.env.META_APP_ID || need('INSTAGRAM_APP_ID');
const metaSecret = () => process.env.META_APP_SECRET || need('INSTAGRAM_APP_SECRET');
function metaAuthUrl() {
  const q = new URLSearchParams({ client_id: metaId(), redirect_uri: REDIRECT('meta'), response_type: 'code', scope: META_SCOPES, state: makeState('meta') });
  return `https://www.facebook.com/v25.0/dialog/oauth?${q}`;
}
const graphErr = (b) => JSON.stringify((b && b.error) ? { message: b.error.message, code: b.error.code, sub: b.error.error_subcode } : b).slice(0, 300);
async function metaConnect(supabase, code) {
  const short = await jsonFetch(`${FB_GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: metaId(), client_secret: metaSecret(), redirect_uri: REDIRECT('meta'), code })}`);
  if (!short.res.ok || !short.body.access_token) throw new Error('Meta no dio el token: ' + graphErr(short.body));
  const long = await jsonFetch(`${FB_GRAPH}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: metaId(), client_secret: metaSecret(), fb_exchange_token: short.body.access_token })}`);
  if (!long.res.ok || !long.body.access_token) throw new Error('Meta no dio el token largo: ' + graphErr(long.body));
  const pages = await jsonFetch(`${FB_GRAPH}/me/accounts?${new URLSearchParams({ fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '50', access_token: long.body.access_token })}`);
  if (!pages.res.ok) throw new Error('No se pudieron leer tus Páginas: ' + graphErr(pages.body));
  let list = (pages.body.data || []);
  // /me/accounts puede venir VACÍO aunque se haya marcado la Página (oct-2026, app nueva con casos de
  // uso / "Inicio de sesión para empresas", Página dentro de un portfolio). Plan B: debug_token dice qué
  // Páginas se autorizaron (granular_scopes.target_ids) y se piden una por una con su token de Página.
  if (!list.length) {
    const dbg = await jsonFetch(`${FB_GRAPH}/debug_token?${new URLSearchParams({ input_token: long.body.access_token, access_token: metaId() + '|' + metaSecret() })}`);
    const scopes = (dbg.body && dbg.body.data && dbg.body.data.granular_scopes) || [];
    const ids = new Set();
    scopes.filter((g) => /^pages_/.test(g.scope)).forEach((g) => (g.target_ids || []).forEach((id) => ids.add(id)));
    if (process.env.META_PAGE_ID) ids.add(process.env.META_PAGE_ID);
    for (const id of ids) {
      const pg = await jsonFetch(`${FB_GRAPH}/${id}?${new URLSearchParams({ fields: 'id,name,access_token,instagram_business_account{id,username}', access_token: long.body.access_token })}`);
      if (pg.res.ok && pg.body && pg.body.access_token) list.push(pg.body);
    }
    if (!list.length) throw new Error('Meta no devolvió ninguna Página. Permisos concedidos: ' + scopes.map((g) => g.scope + (g.target_ids ? '[' + g.target_ids.length + ']' : '')).join(', ') + '. Revisa que marcaste tu Página de VYRALES y que tu perfil es administrador de esa Página.');
  }
  const page = (process.env.META_PAGE_ID && list.find((p) => p.id === process.env.META_PAGE_ID)) || list.find((p) => p.instagram_business_account) || list[0];
  await saveAccount(supabase, { platform: 'facebook', account_id: page.id, account_name: page.name, access_token: page.access_token, expires_at: null, scopes: 'meta' });
  const ig = page.instagram_business_account;
  if (ig) await saveAccount(supabase, { platform: 'instagram', account_id: ig.id, account_name: ig.username, access_token: page.access_token, expires_at: null, scopes: 'meta' });
  return 'Facebook: ' + page.name + (ig ? ' · Instagram: @' + ig.username : ' · (esta Página NO tiene Instagram vinculado)');
}
async function metaAccount(supabase, platform) {
  const acc = await getAccount(supabase, platform);
  if (!acc) throw new Error((platform === 'facebook' ? 'Facebook' : 'Instagram') + ' no está conectado. Dale "Conectar Facebook + Instagram".');
  if (acc.scopes !== 'meta') throw new Error('La conexión de ' + platform + ' es antigua. Dale "Conectar Facebook + Instagram" otra vez.');
  return acc;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function instagramPublishReel(supabase, { videoUrl, coverUrl, caption, log = console.log }) {
  const acc = await metaAccount(supabase, 'instagram');
  const params = { media_type: 'REELS', video_url: videoUrl, caption: String(caption || '').slice(0, 2200), share_to_feed: 'true', access_token: acc.access_token };
  if (coverUrl) params.cover_url = coverUrl;
  const c = await jsonFetch(`${FB_GRAPH}/${acc.account_id}/media`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  if (!c.res.ok || !c.body.id) throw new Error('Instagram rechazó el Reel: ' + graphErr(c.body));
  const containerId = c.body.id;
  log('[instagram] contenedor', containerId, '— esperando que Instagram procese el video...');
  let status = '';
  for (let i = 0; i < 72; i++) {
    await sleep(5000);
    const s = await jsonFetch(`${FB_GRAPH}/${containerId}?${new URLSearchParams({ fields: 'status_code,status', access_token: acc.access_token })}`);
    status = s.body && s.body.status_code;
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error('Instagram no pudo procesar el video: ' + JSON.stringify(s.body).slice(0, 300));
  }
  if (status !== 'FINISHED') throw new Error('Instagram tardó demasiado en procesar el video (estado ' + status + ').');
  const p = await jsonFetch(`${FB_GRAPH}/${acc.account_id}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ creation_id: containerId, access_token: acc.access_token }) });
  if (!p.res.ok || !p.body.id) throw new Error('Instagram no publicó: ' + graphErr(p.body));
  let permalink = null;
  try { const m = await jsonFetch(`${FB_GRAPH}/${p.body.id}?${new URLSearchParams({ fields: 'permalink', access_token: acc.access_token })}`); permalink = m.body.permalink || null; } catch (_) {}
  return { mediaId: p.body.id, permalink };
}

async function facebookPublishReel(supabase, { videoUrl, caption, log = console.log }) {
  const acc = await metaAccount(supabase, 'facebook');
  const post = (params) => jsonFetch(`${FB_GRAPH}/${acc.account_id}/video_reels`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.assign({ access_token: acc.access_token }, params)) });
  const st = await post({ upload_phase: 'start' });
  if (!st.res.ok || !st.body.video_id) throw new Error('Facebook rechazó el inicio del Reel: ' + graphErr(st.body));
  const videoId = st.body.video_id;
  log('[facebook] video', videoId, '— Facebook baja el archivo desde Supabase...');
  const up = await jsonFetch(`https://rupload.facebook.com/video-upload/v25.0/${videoId}`, { method: 'POST', headers: { Authorization: `OAuth ${acc.access_token}`, file_url: videoUrl } });
  if (!up.res.ok || (up.body && up.body.success === false)) throw new Error('Facebook no pudo bajar el video: ' + graphErr(up.body));
  const fin = await post({ video_id: videoId, upload_phase: 'finish', video_state: 'PUBLISHED', description: String(caption || '').slice(0, 2200) });
  if (!fin.res.ok || fin.body.success === false) throw new Error('Facebook no publicó el Reel: ' + graphErr(fin.body));
  // Esperar a que termine de procesarse/publicarse (para avisar si falla).
  for (let i = 0; i < 72; i++) {
    await sleep(5000);
    const s = await jsonFetch(`${FB_GRAPH}/${videoId}?${new URLSearchParams({ fields: 'status,permalink_url', access_token: acc.access_token })}`);
    const status = (s.body && s.body.status) || {};
    const phases = [status.uploading_phase, status.processing_phase, status.publishing_phase].filter(Boolean);
    const bad = phases.find((ph) => ph.status === 'error');
    if (status.video_status === 'error' || bad) throw new Error('Facebook falló al procesar el Reel: ' + JSON.stringify((bad && bad.errors) || status).slice(0, 300));
    log('[facebook] estado:', status.video_status, status.publishing_phase && status.publishing_phase.status);
    if (status.publishing_phase && status.publishing_phase.status === 'complete') {
      const link = s.body.permalink_url ? (String(s.body.permalink_url).startsWith('http') ? s.body.permalink_url : 'https://www.facebook.com' + s.body.permalink_url) : `https://www.facebook.com/reel/${videoId}`;
      return { videoId, permalink: link };
    }
  }
  return { videoId, permalink: `https://www.facebook.com/reel/${videoId}`, pending: true };
}

// ---------------- YouTube (Shorts) ----------------
// YouTube Data API v3, OAuth de Google (scope youtube.upload). Subida "resumable" del MP4 del
// final. status.containsSyntheticMedia = true marca el video como contenido alterado/sintético
// (la etiqueta de IA de YouTube) — esto SÍ se puede por API.
// OJO: mientras el proyecto de Google Cloud no pase la auditoría de YouTube, todo video subido
// por API queda PRIVADO (regla de Google para proyectos sin verificar). Se cambia a Público en
// YouTube Studio con un toque. Docs: developers.google.com/youtube/v3/docs/videos/insert
// Llaves: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET.
const YT_SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';
function youtubeAuthUrl() {
  const q = new URLSearchParams({ client_id: need('YOUTUBE_CLIENT_ID'), redirect_uri: REDIRECT('youtube'), response_type: 'code', scope: YT_SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: makeState('youtube') });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
async function googleToken(params) {
  const { res, body } = await jsonFetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ client_id: need('YOUTUBE_CLIENT_ID'), client_secret: need('YOUTUBE_CLIENT_SECRET') }, params))
  });
  if (!res.ok || !body.access_token) throw new Error('Google no dio el token: ' + JSON.stringify(body).slice(0, 300));
  return body;
}
async function youtubeConnect(supabase, code) {
  const t = await googleToken({ code, grant_type: 'authorization_code', redirect_uri: REDIRECT('youtube') });
  if (!t.refresh_token) throw new Error('Google no dio refresh_token. Quita el acceso de VYRALES en myaccount.google.com/permissions y vuelve a conectar.');
  const ch = await jsonFetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${t.access_token}` } });
  const c = ch.body && ch.body.items && ch.body.items[0];
  if (!c) throw new Error('Esa cuenta de Google no tiene canal de YouTube (o elegiste otra cuenta/marca). Vuelve a conectar y elige el canal de VYRALES.');
  await saveAccount(supabase, {
    platform: 'youtube', account_id: c.id, account_name: c.snippet.title, access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(), scopes: t.scope || YT_SCOPES
  });
  return c.snippet.title;
}
async function youtubeAccessToken(supabase) {
  const acc = await getAccount(supabase, 'youtube');
  if (!acc) throw new Error('YouTube no está conectado. Dale "Conectar YouTube".');
  if (acc.expires_at && new Date(acc.expires_at).getTime() - Date.now() > 5 * 60000) return acc.access_token;
  let t;
  try { t = await googleToken({ grant_type: 'refresh_token', refresh_token: acc.refresh_token }); }
  catch (err) { throw new Error('El permiso de YouTube venció (' + err.message.slice(0, 120) + '). Si la app de Google está en modo "Testing" caduca a los 7 días: ponla "In production" y vuelve a conectar.'); }
  await saveAccount(supabase, Object.assign({}, acc, { access_token: t.access_token, expires_at: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString() }));
  return t.access_token;
}
// privacy: 'public' | 'unlisted' | 'private'. YouTube puede forzar 'private' (proyecto sin auditar).
async function youtubeUpload(supabase, { videoBuffer, title, description, tags = [], privacy = 'public', log = console.log }) {
  const token = await youtubeAccessToken(supabase);
  const meta = {
    snippet: { title: String(title || 'VYRALES').slice(0, 100), description: String(description || '').slice(0, 4900), tags: tags.map((t) => String(t).replace(/^#/, '')).slice(0, 15), categoryId: '27', defaultLanguage: 'es', defaultAudioLanguage: 'es' },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: true, embeddable: true }
  };
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(videoBuffer.length) },
    body: JSON.stringify(meta)
  });
  if (!init.ok) throw new Error('YouTube rechazó el inicio de la subida (HTTP ' + init.status + '): ' + (await init.text()).slice(0, 300));
  const uploadUrl = init.headers.get('location');
  log('[youtube] subiendo', (videoBuffer.length / 1048576).toFixed(1), 'MB...');
  const up = await jsonFetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(videoBuffer.length) }, body: videoBuffer });
  if (!up.res.ok || !up.body.id) throw new Error('YouTube rechazó el archivo (HTTP ' + up.res.status + '): ' + JSON.stringify(up.body.error || up.body).slice(0, 300));
  const got = up.body.status || {};
  return { videoId: up.body.id, url: `https://youtube.com/shorts/${up.body.id}`, privacy: got.privacyStatus || privacy, forcedPrivate: privacy !== 'private' && got.privacyStatus === 'private' };
}

module.exports = { tiktokAuthUrl, tiktokConnect, tiktokSendDraft, tiktokCreatorInfo, tiktokDirectPost, ttDirect, metaAuthUrl, metaConnect, instagramPublishReel, facebookPublishReel, youtubeAuthUrl, youtubeConnect, youtubeUpload, checkState, stateProblem, getAccount, REDIRECT };
