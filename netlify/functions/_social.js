// Conexión con TikTok e Instagram para publicar desde VYRALES.
//   TikTok   — Login Kit + Content Posting API. Sin auditoría de TikTok: "Upload" (el video
//              llega como BORRADOR a la bandeja de la app; el usuario activa la etiqueta de IA
//              y publica). Docs: developers.tiktok.com/doc/content-posting-api-get-started-upload-content
//   Meta      — "Facebook Login": una conexión da la Página de Facebook y su Instagram vinculado
//              (ver sección Meta abajo).
// Llaves en .env / Netlify: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, META_APP_ID, META_APP_SECRET. Los tokens se guardan en la tabla social_accounts (migración 006).
const crypto = require('crypto');

const BASE_URL = () => (process.env.PUBLIC_BASE_URL || 'https://vyrales.app').replace(/\/$/, '');
const REDIRECT = (platform) => `${BASE_URL()}/auth/${platform}/callback`;

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} en el .env / Netlify.`);
  return v;
}

// state anti-CSRF firmado (sin guardar nada): plataforma + hora + firma HMAC con el secreto.
const stateSecret = (platform) => platform === 'tiktok' ? need('TIKTOK_CLIENT_SECRET') : metaSecret();
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
// Solo lo que tiene la app en TikTok: borrador (video.upload). video.publish aparece al activar
// "Direct Post"; para pedirlo, poner TIKTOK_SCOPES=user.info.basic,video.upload,video.publish.
const TIKTOK_SCOPES = process.env.TIKTOK_SCOPES || 'user.info.basic,video.upload';
function tiktokAuthUrl() {
  const q = new URLSearchParams({ client_key: need('TIKTOK_CLIENT_KEY'), scope: TIKTOK_SCOPES, response_type: 'code', redirect_uri: REDIRECT('tiktok'), state: makeState('tiktok') });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}
async function tiktokToken(params) {
  const { res, body } = await jsonFetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ client_key: need('TIKTOK_CLIENT_KEY'), client_secret: need('TIKTOK_CLIENT_SECRET') }, params))
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
    scopes: t.scope || TIKTOK_SCOPES
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
  if (size > 64 * 1024 * 1024) throw new Error('El video pesa más de 64 MB (TikTok exigiría varios pedazos).');
  const { res, body } = await jsonFetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 } })
  });
  if (!res.ok || !body.data || !body.data.upload_url) throw new Error('TikTok rechazó el inicio de la subida: ' + JSON.stringify(body.error || body).slice(0, 300));
  log('[tiktok] subiendo', (size / 1048576).toFixed(1), 'MB...');
  const up = await fetch(body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Content-Range': `bytes 0-${size - 1}/${size}` }, body: videoBuffer });
  if (!up.ok) throw new Error('TikTok rechazó el archivo (HTTP ' + up.status + '): ' + (await up.text()).slice(0, 200));
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
  const list = (pages.body.data || []);
  if (!list.length) throw new Error('Meta no devolvió ninguna Página. En la pantalla de permisos tienes que MARCAR tu Página de VYRALES (y su Instagram). Vuelve a darle Conectar.');
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

module.exports = { tiktokAuthUrl, tiktokConnect, tiktokSendDraft, metaAuthUrl, metaConnect, instagramPublishReel, facebookPublishReel, checkState, stateProblem, getAccount, REDIRECT };
