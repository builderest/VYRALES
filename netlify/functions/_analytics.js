// Analítica del canal (página /analitica.html). Solo datos REALES de las APIs oficiales:
//   YouTube Data API (youtube.readonly, ya concedido): suscriptores, vistas y likes por video.
//   YouTube Analytics API (yt-analytics.readonly): % visto, suscriptores ganados, vistas por día,
//     fuentes de tráfico. Hace falta (1) activar la API en Google Cloud y (2) reconectar YouTube.
//   Instagram/Facebook (Graph): seguidores y likes/comentarios; las vistas piden
//     instagram_manage_insights / read_insights (reconectar Meta).
//   TikTok: estadísticas piden user.info.stats + video.list (añadirlos en el portal de TikTok).
// Si algo no está disponible se devuelve { ok:false, reason } y la página lo explica: nunca se
// rellena con números inventados.
const { getAccount } = require('./_social');

const G = 'https://graph.facebook.com/v21.0/';
const day = (d) => d.toISOString().slice(0, 10);

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  let body = {};
  try { body = await res.json(); } catch (_) {}
  return { ok: res.ok, status: res.status, body };
}

async function ytToken(sb) {
  const acc = await getAccount(sb, 'youtube');
  if (!acc) return null;
  if (acc.expires_at && new Date(acc.expires_at).getTime() - Date.now() > 5 * 60000) return { token: acc.access_token, scopes: acc.scopes || '' };
  const r = await getJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: acc.refresh_token })
  });
  if (!r.body.access_token) throw new Error('El permiso de YouTube venció: reconecta YouTube.');
  { const T = require('./_tenant'); let uq = sb.from('social_accounts').update({ access_token: r.body.access_token, expires_at: new Date(Date.now() + (r.body.expires_in || 3600) * 1000).toISOString() }).eq('platform', 'youtube'); if (await T.tenancyOn(sb)) uq = uq.eq('workspace_id', T.currentWs()); await uq; }
  return { token: r.body.access_token, scopes: r.body.scope || acc.scopes || '' };
}

const isoDur = (s) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };

function analyticsProblem(r) {
  const msg = JSON.stringify(r.body.error || r.body).slice(0, 300);
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) return { reason: 'api_disabled', msg: 'Activa "YouTube Analytics API" en Google Cloud (mismo proyecto de la app) y luego reconecta YouTube.' };
  if (r.status === 403 || r.status === 401) return { reason: 'scope', msg: 'Falta el permiso de estadísticas: dale "Reconectar YouTube".' };
  if (r.status >= 500) return { reason: 'temporal', msg: 'Google no respondió ahora mismo (error temporal de YouTube Analytics). Dale "Actualizar" en un minuto.' };
  return { reason: 'error', msg };
}

async function youtube(sb) {
  const t = await ytToken(sb);
  if (!t) return { connected: false };
  const H = { headers: { Authorization: 'Bearer ' + t.token } };
  const ch = await getJson('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true', H);
  const c = ch.body.items && ch.body.items[0];
  if (!c) return { connected: true, error: 'YouTube no devolvió el canal (HTTP ' + ch.status + ').' };
  const out = {
    connected: true,
    channel: { id: c.id, title: c.snippet.title, subs: +c.statistics.subscriberCount || 0, views: +c.statistics.viewCount || 0, videos: +c.statistics.videoCount || 0, created: c.snippet.publishedAt },
    videos: [], analytics: { ok: false }
  };
  const pl = await getJson('https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=' + c.contentDetails.relatedPlaylists.uploads, H);
  const ids = (pl.body.items || []).map((i) => i.contentDetails.videoId);
  if (ids.length) {
    const v = await getJson('https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,status&id=' + ids.join(','), H);
    out.videos = (v.body.items || []).map((x) => ({
      id: x.id, title: x.snippet.title, published: x.snippet.publishedAt, privacy: x.status && x.status.privacyStatus,
      thumb: (x.snippet.thumbnails && (x.snippet.thumbnails.medium || x.snippet.thumbnails.default) || {}).url || '',
      duration: isoDur(x.contentDetails.duration), views: +x.statistics.viewCount || 0, likes: +x.statistics.likeCount || 0, comments: +x.statistics.commentCount || 0,
      url: 'https://youtube.com/shorts/' + x.id
    }));
  }
  // YouTube Analytics (si está activo y con permiso).
  const end = day(new Date());
  const start28 = day(new Date(Date.now() - 27 * 86400000));
  const startAll = day(new Date(c.snippet.publishedAt));
  // Google a veces responde 500 "backendError" suelto: se reintenta hasta 3 veces antes de rendirse.
  const A = async (q) => { let r; for (let k = 0; k < 3; k++) { r = await getJson('https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&' + q, H); if (r.status < 500) return r; await new Promise((ok) => setTimeout(ok, 1500 * (k + 1))); } return r; };
  const daily = await A(`startDate=${start28}&endDate=${end}&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost&dimensions=day&sort=day`);
  if (!daily.ok) { out.analytics = Object.assign({ ok: false }, analyticsProblem(daily)); return out; }
  const [perVideo, traffic, totals] = await Promise.all([
    A(`startDate=${startAll}&endDate=${end}&metrics=views,averageViewPercentage,averageViewDuration,subscribersGained,estimatedMinutesWatched&dimensions=video&sort=-views&maxResults=200`),
    A(`startDate=${start28}&endDate=${end}&metrics=views&dimensions=insightTrafficSourceType&sort=-views`),
    A(`startDate=${start28}&endDate=${end}&metrics=views,averageViewPercentage,subscribersGained,estimatedMinutesWatched`)
  ]);
  const rows = (r) => (r.ok && r.body.rows) || [];
  out.analytics = {
    ok: true, start: start28, end,
    daily: rows(daily).map((r) => ({ day: r[0], views: r[1], minutes: r[2], subs: r[3] - r[4] })),
    perVideo: Object.fromEntries(rows(perVideo).map((r) => [r[0], { views: r[1], avgPct: r[2], avgSec: r[3], subs: r[4], minutes: r[5] }])),
    traffic: rows(traffic).map((r) => ({ source: r[0], views: r[1] })),
    totals: rows(totals)[0] ? { views: rows(totals)[0][0], avgPct: rows(totals)[0][1], subs: rows(totals)[0][2], minutes: rows(totals)[0][3] } : null
  };
  return out;
}

async function instagram(sb) {
  const acc = await getAccount(sb, 'instagram');
  if (!acc) return { connected: false };
  const tk = '&access_token=' + encodeURIComponent(acc.access_token);
  const me = await getJson(G + acc.account_id + '?fields=followers_count,media_count,username' + tk);
  if (!me.ok) return { connected: true, error: 'Instagram: ' + JSON.stringify(me.body.error || {}).slice(0, 160) };
  const m = await getJson(G + acc.account_id + '/media?fields=id,caption,like_count,comments_count,timestamp,permalink,media_product_type&limit=25' + tk);
  const media = (m.body.data || []).map((x) => ({ id: x.id, title: String(x.caption || '').split('\n')[0].slice(0, 90), published: x.timestamp, likes: x.like_count || 0, comments: x.comments_count || 0, url: x.permalink, views: null }));
  let insights = true;
  for (const x of media.slice(0, 15)) {
    const r = await getJson(G + x.id + '/insights?metric=views' + tk);
    if (!r.ok) { insights = false; break; }
    const v = (r.body.data || []).find((d) => d.name === 'views');
    x.views = v && v.values && v.values[0] ? v.values[0].value : null;
  }
  return { connected: true, followers: me.body.followers_count || 0, posts: me.body.media_count || 0, username: me.body.username, media, insights };
}

async function facebook(sb) {
  const acc = await getAccount(sb, 'facebook');
  if (!acc) return { connected: false };
  const tk = '&access_token=' + encodeURIComponent(acc.access_token);
  const me = await getJson(G + acc.account_id + '?fields=followers_count,name' + tk);
  if (!me.ok) return { connected: true, error: 'Facebook: ' + JSON.stringify(me.body.error || {}).slice(0, 160) };
  const r = await getJson(G + acc.account_id + '/video_reels?fields=id,description,created_time&limit=25' + tk);
  const media = (r.body.data || []).map((x) => ({ id: x.id, title: String(x.description || '').split('\n')[0].slice(0, 90), published: x.created_time, views: null, url: 'https://www.facebook.com/reel/' + x.id }));
  let insights = true;
  for (const x of media.slice(0, 15)) {
    const k = await getJson(G + x.id + '/video_insights?metric=blue_reels_play_count' + tk);
    if (!k.ok) { insights = false; break; }
    const v = (k.body.data || [])[0];
    x.views = v && v.values && v.values[0] ? v.values[0].value : null;
  }
  return { connected: true, followers: me.body.followers_count || 0, name: me.body.name, media, insights };
}

async function tiktok(sb) {
  const acc = await getAccount(sb, 'tiktok');
  if (!acc) return { connected: false };
  if (!/user\.info\.stats/.test(acc.scopes || '')) return { connected: true, stats: false, msg: 'Para ver estadísticas, TikTok pide los permisos user.info.stats y video.list (se añaden en el portal de desarrolladores de TikTok y luego se reconecta).' };
  const r = await getJson('https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count', { headers: { Authorization: 'Bearer ' + acc.access_token } });
  const u = r.body.data && r.body.data.user;
  return u ? { connected: true, stats: true, followers: u.follower_count, likes: u.likes_count, videos: u.video_count } : { connected: true, stats: false, msg: 'TikTok: ' + JSON.stringify(r.body.error || {}).slice(0, 160) };
}

// Temas: cada video se une a su episodio/serie (por id de publicación o por título) y se
// clasifica con palabras clave. Orden = prioridad.
const TOPICS = [
  ['Humanos antiguos', /humano|neandert|denisov|antepasad|humanidad|homo |sapiens|adn|prehist|caverna|tribu/i],
  ['Guerras y batallas', /guerra|batalla|legi[oó]n|soldad|mis[ií]l|nuclear|ej[eé]rcito|imperio|romano|roma\b|b[uú]nker|sovi[eé]t/i],
  ['Espacio y planeta Tierra', /\bluna\b|planeta|\bsol\b|espacio|galaxi|asteroide|universo|[oó]rbita|volc[aá]n|d[ií]a duraba/i],
  ['Dinosaurios y bestias', /dinosaur|depredador|tibur[oó]n|bestia|monstruo|ballena|pulpo|megalod|animal/i],
  ['Mente y realidad', /cerebro|mente|realidad|psicol|percepci/i],
  ['Misterios', /misterio|enigma|secreto|desapareci|inexplicable/i]
];
const topicOf = (txt) => { for (const [name, re] of TOPICS) if (re.test(txt)) return name; return 'Otros'; };
const firstLine = (s) => String(s || '').split('\n')[0];
const norm = (s) => String(s || '').toLowerCase().replace(/#\S+|\|.*$/g, '').replace(/[^a-z0-9áéíóúñü ]/g, ' ').replace(/\s+/g, ' ').trim();

async function episodeIndex(sb) {
  const { data } = await sb.from('episodes').select('id, title, episode_number, series_id, validator_report, series(id, slug, title, synopsis)').not('validator_report', 'is', null).limit(500);
  const byYt = {}, byTitle = [];
  (data || []).forEach((e) => {
    const vr = e.validator_report || {};
    const run = vr.social_runs || {};
    const info = { episode_id: e.id, series_id: e.series_id, series: e.series && (e.series.title || e.series.slug), synopsis: e.series && e.series.synopsis, ep: e.episode_number };
    if (run.youtube && run.youtube.video_id) byYt[run.youtube.video_id] = info;
    const pk = vr.publish_package || {};
    [pk.youtube_title, pk.cover_text, e.title, firstLine(pk.instagram), firstLine(pk.facebook), firstLine(pk.tiktok)].filter(Boolean).forEach((t) => byTitle.push([norm(t), info]));
  });
  return { byYt, byTitle };
}

function attach(v, idx) {
  let info = idx.byYt[v.id];
  if (!info) { const n = norm(v.title); const hit = idx.byTitle.find(([t]) => t && n && (t === n || (t.length > 12 && (n.startsWith(t) || t.startsWith(n))))); info = hit && hit[1]; }
  const txt = [v.title, info && info.series, info && info.synopsis].filter(Boolean).join(' ');
  return Object.assign(v, { topic: topicOf(txt), series: info ? info.series : null, series_id: info ? info.series_id : null, episode_id: info ? info.episode_id : null });
}

async function collect(sb) {
  const safe = (p) => p.catch((e) => ({ error: e.message }));
  const [yt, ig, fb, tt, idx] = await Promise.all([safe(youtube(sb)), safe(instagram(sb)), safe(facebook(sb)), safe(tiktok(sb)), episodeIndex(sb).catch(() => ({ byYt: {}, byTitle: [] }))]);
  (yt.videos || []).forEach((v) => { attach(v, idx); const a = yt.analytics && yt.analytics.ok && yt.analytics.perVideo[v.id]; if (a) Object.assign(v, { avgPct: a.avgPct, avgSec: a.avgSec, subsGained: a.subs }); });
  [ig, fb].forEach((p) => (p.media || []).forEach((m) => attach(m, idx)));
  return { at: new Date().toISOString(), youtube: yt, instagram: ig, facebook: fb, tiktok: tt };
}

// VIRALES de afuera (Franklin oct-12: "buscar videos que ya se han vuelto virales en mi nicho").
// Usa la API de YouTube (search.list ordenado por vistas, Shorts en español de los últimos 6 meses) para traer
// referencias REALES por tema, con sus vistas reales. $0 (cuota gratis de la API). Si falla, devuelve '' y las ideas igual salen.
const VIRAL_QUERIES = [
  ['Humanos antiguos', 'prehistoria humanos antiguos'],
  ['Guerras y batallas', 'historia guerra batalla'],
  ['Espacio y planeta Tierra', 'espacio universo asombroso'],
  ['Dinosaurios y bestias', 'dinosaurios bestias prehistoricas'],
  ['Misterios', 'misterios de la historia']
];
async function viralRefs(sb) {
  let t;
  try { t = await ytToken(sb); } catch (_) { t = null; }
  if (!t || !t.token) return '';
  // Cada canal busca virales de SU nicho (oct-13). El principal usa historia; un canal usa sus términos (settings.nicho).
  let queries = VIRAL_QUERIES;
  try {
    const T = require('./_tenant'); const ws = T.currentWs();
    if (ws && ws !== T.ADMIN_WS) {
      const { data: w } = await sb.from('workspaces').select('settings').eq('id', ws).maybeSingle();
      const nq = w && w.settings && w.settings.nicho && w.settings.nicho.queries;
      if (Array.isArray(nq) && nq.length) queries = nq.map((q) => ['Nicho', q]);
    }
  } catch (_) {}
  const H = { headers: { Authorization: 'Bearer ' + t.token } };
  const after = new Date(Date.now() - 180 * 86400000).toISOString();
  const seen = new Set(); const refs = [];
  for (const [topic, q] of queries) {
    try {
      const su = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&order=viewCount&relevanceLanguage=es&regionCode=US&videoDuration=short&publishedAfter=' + after + '&q=' + encodeURIComponent(q);
      const sr = await getJson(su, H);
      const ids = (sr.body.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
      if (!ids.length) continue;
      const vr = await getJson('https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=' + ids.join(','), H);
      (vr.body.items || []).map((x) => ({ title: x.snippet.title, views: +(x.statistics && x.statistics.viewCount) || 0 }))
        .filter((x) => x.views >= 50000)
        .sort((a, b) => b.views - a.views).slice(0, 3)
        .forEach((x) => { if (!seen.has(x.title)) { seen.add(x.title); refs.push(`- [${topic}] "${x.title}" — ${x.views.toLocaleString('es')} vistas`); } });
    } catch (_) {}
  }
  return refs.join('\n');
}

module.exports = { collect, topicOf, TOPICS, viralRefs };
