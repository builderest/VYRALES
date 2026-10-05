// Conexión con TikTok e Instagram para publicar desde VYRALES.
//   TikTok   — Login Kit + Content Posting API. Sin auditoría de TikTok: "Upload" (el video
//              llega como BORRADOR a la bandeja de la app; el usuario activa la etiqueta de IA
//              y publica). Docs: developers.tiktok.com/doc/content-posting-api-get-started-upload-content
//   Instagram — "Instagram API with Instagram Login" (cuenta Creador/Empresa). Reels por
//              video_url (URL pública de Supabase) → contenedor → media_publish. Límite 100/24 h.
//              Docs: developers.facebook.com/docs/instagram-platform/content-publishing
// Llaves en .env / Netlify: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, INSTAGRAM_APP_ID,
// INSTAGRAM_APP_SECRET. Los tokens se guardan en la tabla social_accounts (migración 006).
const crypto = require('crypto');

const BASE_URL = () => (process.env.PUBLIC_BASE_URL || 'https://vyrales.app').replace(/\/$/, '');
const REDIRECT = (platform) => `${BASE_URL()}/.netlify/functions/oauth-${platform}-callback`;
const IG_GRAPH = 'https://graph.instagram.com/v23.0';

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} en el .env / Netlify.`);
  return v;
}

// state anti-CSRF firmado (sin guardar nada): plataforma + hora + firma HMAC con el secreto.
function makeState(platform) {
  const secret = platform === 'tiktok' ? need('TIKTOK_CLIENT_SECRET') : need('INSTAGRAM_APP_SECRET');
  const payload = `${platform}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
}
function checkState(platform, state) {
  const secret = platform === 'tiktok' ? need('TIKTOK_CLIENT_SECRET') : need('INSTAGRAM_APP_SECRET');
  const [p, ts, sig] = String(state || '').split('.');
  if (p !== platform || !ts || !sig) return false;
  if (Date.now() - Number(ts) > 15 * 60000) return false;
  const good = crypto.createHmac('sha256', secret).update(`${p}.${ts}`).digest('hex').slice(0, 32);
  return crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig.padEnd(32, '0').slice(0, 32)));
}

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
const TIKTOK_SCOPES = 'user.info.basic,video.upload,video.publish';
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

// ---------------- Instagram ----------------
const IG_SCOPES = 'instagram_business_basic,instagram_business_content_publish';
function instagramAuthUrl() {
  const q = new URLSearchParams({ client_id: need('INSTAGRAM_APP_ID'), redirect_uri: REDIRECT('instagram'), response_type: 'code', scope: IG_SCOPES, state: makeState('instagram') });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}
async function instagramConnect(supabase, code) {
  const short = await jsonFetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: need('INSTAGRAM_APP_ID'), client_secret: need('INSTAGRAM_APP_SECRET'), grant_type: 'authorization_code', redirect_uri: REDIRECT('instagram'), code })
  });
  const sb = short.body && (short.body.data ? short.body.data[0] : short.body);
  if (!short.res.ok || !sb || !sb.access_token) throw new Error('Instagram no dio el token: ' + JSON.stringify(short.body).slice(0, 300));
  const long = await jsonFetch(`https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: need('INSTAGRAM_APP_SECRET'), access_token: sb.access_token })}`);
  if (!long.res.ok || !long.body.access_token) throw new Error('Instagram no dio el token largo: ' + JSON.stringify(long.body).slice(0, 300));
  const me = await jsonFetch(`${IG_GRAPH}/me?${new URLSearchParams({ fields: 'user_id,username,account_type', access_token: long.body.access_token })}`);
  const userId = (me.body && (me.body.user_id || me.body.id)) || String(sb.user_id);
  await saveAccount(supabase, {
    platform: 'instagram', account_id: String(userId), account_name: me.body && me.body.username, access_token: long.body.access_token,
    expires_at: new Date(Date.now() + (long.body.expires_in || 5184000) * 1000).toISOString(), scopes: IG_SCOPES
  });
  return (me.body && me.body.username) || userId;
}
async function instagramAccess(supabase) {
  const acc = await getAccount(supabase, 'instagram');
  if (!acc) throw new Error('Instagram no está conectado. Dale "Conectar Instagram".');
  // Token largo (60 días): se renueva solo cuando le quedan menos de 10 días.
  if (acc.expires_at && new Date(acc.expires_at).getTime() - Date.now() < 10 * 86400000) {
    const r = await jsonFetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: acc.access_token })}`);
    if (r.res.ok && r.body.access_token) {
      acc.access_token = r.body.access_token;
      acc.expires_at = new Date(Date.now() + (r.body.expires_in || 5184000) * 1000).toISOString();
      await saveAccount(supabase, acc);
    }
  }
  return acc;
}
async function instagramPublishReel(supabase, { videoUrl, coverUrl, caption, log = console.log }) {
  const acc = await instagramAccess(supabase);
  const params = { media_type: 'REELS', video_url: videoUrl, caption: String(caption || '').slice(0, 2200), share_to_feed: 'true', access_token: acc.access_token };
  if (coverUrl) params.cover_url = coverUrl;
  const c = await jsonFetch(`${IG_GRAPH}/${acc.account_id}/media`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  if (!c.res.ok || !c.body.id) throw new Error('Instagram rechazó el Reel: ' + JSON.stringify(c.body.error || c.body).slice(0, 300));
  const containerId = c.body.id;
  log('[instagram] contenedor', containerId, '— esperando que Instagram procese el video...');
  let status = '';
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await jsonFetch(`${IG_GRAPH}/${containerId}?${new URLSearchParams({ fields: 'status_code,status', access_token: acc.access_token })}`);
    status = s.body && s.body.status_code;
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error('Instagram no pudo procesar el video: ' + JSON.stringify(s.body).slice(0, 300));
  }
  if (status !== 'FINISHED') throw new Error('Instagram tardó demasiado en procesar el video (estado ' + status + ').');
  const p = await jsonFetch(`${IG_GRAPH}/${acc.account_id}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ creation_id: containerId, access_token: acc.access_token }) });
  if (!p.res.ok || !p.body.id) throw new Error('Instagram no publicó: ' + JSON.stringify(p.body.error || p.body).slice(0, 300));
  let permalink = null;
  try { const m = await jsonFetch(`${IG_GRAPH}/${p.body.id}?${new URLSearchParams({ fields: 'permalink', access_token: acc.access_token })}`); permalink = m.body.permalink || null; } catch (_) {}
  return { mediaId: p.body.id, permalink };
}

module.exports = { tiktokAuthUrl, tiktokConnect, tiktokSendDraft, instagramAuthUrl, instagramConnect, instagramPublishReel, checkState, getAccount, REDIRECT };
