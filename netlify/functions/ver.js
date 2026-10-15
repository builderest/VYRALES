// PÚBLICO: vyrales.app/ver — "historias completas". Instagram y TikTok no dejan enlaces en el texto (no se pueden
// tocar), así que el perfil lleva UN enlace fijo a esta página, que siempre muestra los videos largos PÚBLICOS en
// YouTube, el más nuevo primero (Franklin, oct-11).
// oct-15 (Franklin): el video se ve AQUÍ MISMO (empotrado con el reproductor oficial de YouTube — sí cuenta como
// vista en YouTube), con un diseño parecido a YouTube (reproductor grande + lista de "siguientes" al lado/abajo).
// ?v=<episode_id> hace que ESE video sea el que se ve de entrada en la pantalla grande (antes redirigía a YouTube).
const { getSupabaseClient } = require('./_supabase');
const CHANNEL = process.env.YOUTUBE_CHANNEL_URL || 'https://www.youtube.com/channel/UCfBQ7OFSDrImT96FsDZkY_Q';
const CHANNEL_ID = (CHANNEL.match(/\/channel\/([^/?]+)/) || [])[1] || 'UCfBQ7OFSDrImT96FsDZkY_Q';
const esc = (t) => String(t || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n) => new Intl.NumberFormat('es').format(n || 0);
// Saca el ID de 11 caracteres de un link youtu.be/... o youtube.com/watch?v=...
function ytId(url) {
  const m = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/.exec(String(url || ''));
  return m ? m[1] : null;
}
// Avatar, banner, suscriptores y descripción REALES del canal (misma API que ya usa /analitica), en caché 12 h
// (media/cache/canal_vyrales.json) para no gastar cuota en cada visita de esta página pública (Franklin, oct-15).
async function getChannelInfo(sb) {
  const path = 'cache/canal_vyrales.json';
  try {
    const { data } = await sb.storage.from('media').download(path + '?t=' + Date.now());
    if (data) { const c = JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8')); if (c && c.at && Date.now() - c.at < 12 * 3600000) return c.info; }
  } catch (_) {}
  let info = null;
  try {
    const SOC = require('./_social');
    info = await SOC.withYoutubeFallback(sb, console.log, async (platform) => {
      const token = await SOC.youtubeAccessToken(sb, platform);
      const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,brandingSettings&mine=true', { headers: { Authorization: 'Bearer ' + token } });
      const j = await r.json();
      if (!r.ok) throw new Error('youtube channels HTTP ' + r.status + ': ' + JSON.stringify(j).slice(0, 500));
      const c = j.items && j.items[0];
      if (!c) throw new Error('sin canal');
      return {
        title: c.snippet.title, handle: c.snippet.customUrl, desc: c.snippet.description || '',
        subs: +c.statistics.subscriberCount || 0, videos: +c.statistics.videoCount || 0,
        avatar: (c.snippet.thumbnails.high || c.snippet.thumbnails.default || {}).url || '',
        banner: ((c.brandingSettings || {}).image || {}).bannerExternalUrl || ''
      };
    });
  } catch (_) { info = null; }
  if (info) { try { await sb.storage.from('media').upload(path, Buffer.from(JSON.stringify({ at: Date.now(), info })), { contentType: 'application/json', upsert: true, cacheControl: '0' }); } catch (_) {} }
  return info;
}
// Playlists reales del canal (id + título + miniatura), en caché 12 h (misma idea que getChannelInfo).
async function getPlaylists(sb) {
  const path = 'cache/playlists_vyrales.json';
  try {
    const { data } = await sb.storage.from('media').download(path + '?t=' + Date.now());
    if (data) { const c = JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8')); if (c && c.at && Date.now() - c.at < 12 * 3600000) return c.list; }
  } catch (_) {}
  let list = null;
  try {
    const SOC = require('./_social');
    list = await SOC.withYoutubeFallback(sb, console.log, async (platform) => {
      const token = await SOC.youtubeAccessToken(sb, platform);
      const r = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50', { headers: { Authorization: 'Bearer ' + token } });
      const j = await r.json();
      if (!r.ok) throw new Error('youtube playlists HTTP ' + r.status + ': ' + JSON.stringify(j).slice(0, 500));
      return (j.items || []).filter((p) => (p.contentDetails || {}).itemCount > 0).map((p) => ({
        id: p.id, title: p.snippet.title, count: p.contentDetails.itemCount,
        thumb: ((p.snippet.thumbnails || {}).medium || (p.snippet.thumbnails || {}).default || {}).url || ''
      }));
    });
  } catch (_) { list = null; }
  if (list) { try { await sb.storage.from('media').upload(path, Buffer.from(JSON.stringify({ at: Date.now(), list })), { contentType: 'application/json', upsert: true, cacheControl: '0' }); } catch (_) {} }
  return list || [];
}
exports.handler = async (event) => {
  const sb = getSupabaseClient();
  // MULTIUSUARIO: esta página pública es del canal del ADMIN: solo sus historias (las de otras cuentas no salen).
  const T = require('./_tenant');
  const ch = await getChannelInfo(sb); // avatar/banner/subs reales del canal (o null si falla: se usa un header simple)
  const playlists = await getPlaylists(sb);
  const on = await T.tenancyOn(sb);
  let q0 = sb.from('episodes').select(on ? 'id, title, continuity, validator_report, published_at, series!inner(workspace_id)' : 'id, title, continuity, validator_report, published_at');
  if (on) q0 = q0.eq('series.workspace_id', T.ADMIN_WS);
  const { data } = await q0.order('published_at', { ascending: false, nullsFirst: false }).limit(200);
  const published = (data || []).filter((e) => (((e.validator_report || {}).published || {}).youtube || {}).url);
  const toItem = (e) => ({
    id: e.id,
    title: ((e.validator_report || {}).publish_package || {}).youtube_title || e.title,
    url: e.validator_report.published.youtube.url,
    vid: ytId(e.validator_report.published.youtube.url),
    thumb: ((e.continuity || {}).thumbnail || {}).es_url || ((e.validator_report || {}).publish_package || {}).cover_url || ''
  });
  const longs = published.filter((e) => /\/shorts\//.test(e.validator_report.published.youtube.url) === false).map(toItem).filter((l) => l.vid);
  const shorts = published.filter((e) => /\/shorts\//.test(e.validator_report.published.youtube.url)).map(toItem).filter((l) => l.vid);
  const q = event.queryStringParameters || {};
  const initial = (q.v && (longs.find((l) => l.id === q.v) || shorts.find((l) => l.id === q.v))) || longs[0] || shorts[0] || null;

  if (!initial) {
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VYRALES · Historias completas</title></head><body style="margin:0;background:#0f0f0f;color:#f1f1f1;font:16px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">
<div><p>Muy pronto: la primera historia completa.</p><a href="${esc(CHANNEL)}" style="color:#3ea6ff">Ver el canal de YouTube</a></div></body></html>`;
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }, body: html };
  }

  const ytThumb = (vid) => `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
  const listItem = (cls) => (l, i) => `<button class="item ${cls}${l.id === initial.id ? ' active' : ''}" data-id="${esc(l.id)}" data-vid="${esc(l.vid)}" data-title="${esc(l.title)}" data-url="${esc(l.url)}" data-kind="video">
    <span class="th"><img src="${esc(l.thumb || ytThumb(l.vid))}" alt="" loading="${i < 6 ? 'eager' : 'lazy'}">${i === 0 ? '<i class="new">NUEVO</i>' : ''}</span>
    <span class="meta"><b>${esc(l.title)}</b></span>
  </button>`;
  const list = longs.map(listItem('long')).join('');
  const shortList = shorts.map(listItem('short')).join('');
  const plItem = (p) => `<button class="item pl" data-pid="${esc(p.id)}" data-title="${esc(p.title)}" data-kind="playlist">
    <span class="th"><img src="${esc(p.thumb)}" alt="" loading="lazy"></span>
    <span class="meta"><b>${esc(p.title)}</b><small>${nf(p.count)} videos</small></span>
  </button>`;
  const plList = playlists.map(plItem).join('');

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(initial.title)} · VYRALES</title>
<meta name="description" content="Las historias completas de VYRALES en YouTube.">
<meta property="og:title" content="${esc(initial.title)}"><meta property="og:image" content="${esc(initial.thumb || ytThumb(initial.vid))}">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0f0f0f;color:#f1f1f1;font:15px/1.4 Roboto,system-ui,-apple-system,Segoe UI,sans-serif}
.banner{width:100%;aspect-ratio:1060/175;background:#111 linear-gradient(135deg,#1a1033,#0f0f0f);overflow:hidden}
.banner img{width:100%;height:100%;object-fit:cover;display:block}
.chhead{max-width:1100px;margin:0 auto;padding:0 16px;display:flex;align-items:flex-start;gap:18px;margin-top:-34px}
@media (max-width:640px){.chhead{flex-wrap:wrap;margin-top:-28px}}
.avatar{flex:none;width:88px;height:88px;border-radius:50%;object-fit:cover;background:#1a1a1a;border:3px solid #0f0f0f}
@media (max-width:640px){.avatar{width:68px;height:68px}}
.chinfo{flex:1;min-width:0;padding-top:38px}
@media (max-width:640px){.chinfo{padding-top:10px}}
.chinfo h1{margin:0;font-size:20px;font-weight:700;color:#fff}
.chinfo .sub{color:#aaa;font-size:13px;margin-top:4px}
.chinfo .desc{color:#aaa;font-size:13px;margin-top:6px;max-width:640px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.subbtn{flex:none;padding-top:38px}
@media (max-width:640px){.subbtn{padding-top:4px;width:100%}}
.subbtn iframe{display:block}
.fallback-sub{display:inline-flex;align-items:center;background:#f1f1f1;color:#0f0f0f;border-radius:18px;padding:10px 20px;font-size:14px;font-weight:700;text-decoration:none;white-space:nowrap}
.wrap{max-width:1100px;margin:0 auto;padding:20px 16px 60px}
@media (max-width:980px){.wrap{padding:0 0 40px}}
.player{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:12px;overflow:hidden}
@media (max-width:980px){.player{border-radius:0}}
.player iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.poster{position:absolute;inset:0;width:100%;height:100%;cursor:pointer;border:0;padding:0;background:#000}
.poster img{width:100%;height:100%;object-fit:cover;display:block;opacity:.85}
.poster .play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.poster .play svg{filter:drop-shadow(0 2px 10px rgba(0,0,0,.6))}
.info{padding:14px 16px 0}
@media (max-width:980px){.info{padding:14px 16px}}
.info h1{font-size:19px;line-height:1.35;margin:0 0 10px;font-weight:700}
.info .row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.yt{display:inline-flex;align-items:center;gap:6px;background:#272727;color:#f1f1f1;border-radius:18px;padding:8px 14px;font-size:13px;font-weight:600;text-decoration:none}
.yt:hover{background:#3f3f3f}
.side{margin-top:28px}
.side h2{font-size:16px;color:#f1f1f1;font-weight:700;margin:0 0 14px;padding:0 4px}
@media (max-width:980px){.side{padding:0 16px}}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px 14px}
.item{display:block;width:100%;text-align:left;background:transparent;border:0;color:inherit;font:inherit;cursor:pointer;padding:0;border-radius:12px}
.item .th{position:relative;width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#1a1a1a;margin-bottom:8px}
.item.active .th{outline:2px solid #3ea6ff}
.item:hover .th img{transform:scale(1.03)}
.th img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s}
.new{position:absolute;left:6px;top:6px;background:#ffd400;color:#000;font-size:10px;font-weight:800;border-radius:4px;padding:2px 5px;font-style:normal;z-index:1}
.meta b{font-size:14px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:#f1f1f1}
.meta small{display:block;color:#aaa;font-size:12px;margin-top:3px}
.tabs{display:flex;gap:6px;border-bottom:1px solid #272727;margin:18px 4px 0;padding:0 0 0}
@media (max-width:980px){.tabs{margin:12px 16px 0;overflow-x:auto}}
.tab{appearance:none;background:transparent;border:0;color:#aaa;font:inherit;font-weight:600;font-size:14px;padding:12px 16px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.tab.on{color:#fff;border-bottom-color:#fff}
.panel{display:none}
.panel.on{display:block}
/* Shorts: tarjetas verticales tipo celular (9:16), como en la pestaña Shorts del canal real */
.gridshorts{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px 12px}
.gridshorts .item .th{aspect-ratio:9/16;border-radius:14px}
@media (min-width:640px){.gridshorts{grid-template-columns:repeat(auto-fill,minmax(170px,1fr))}}
.gridplaylists{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px 14px}
.gridplaylists .item .th{aspect-ratio:16/9;border-radius:12px}
.empty-tab{color:#aaa;padding:30px 4px;text-align:center}
</style></head>
<body>
${ch && ch.banner ? `<div class="banner"><img src="${esc(ch.banner)}" alt=""></div>` : ''}
<div class="chhead">
  <img class="avatar" src="${esc((ch && ch.avatar) || '/icon-192.png')}" alt="VYRALES">
  <div class="chinfo">
    <h1>${esc((ch && ch.title) || 'VYRALES')}</h1>
    <div class="sub">${ch ? esc(ch.handle || '@vyrales') + ' · ' + nf(ch.subs) + ' suscriptores · ' + nf(ch.videos) + ' videos' : '@vyrales'}</div>
    ${ch && ch.desc ? `<div class="desc">${esc(ch.desc)}</div>` : ''}
  </div>
  <div class="subbtn">
    <iframe src="https://www.youtube.com/subscribe_embed?channelid=${esc(CHANNEL_ID)}&layout=default&theme=dark" scrolling="no" frameborder="0" width="220" height="56" style="border:0;overflow:hidden" onerror="this.outerHTML='<a class=&quot;fallback-sub&quot; href=&quot;${esc(CHANNEL)}&quot; target=&quot;_blank&quot; rel=&quot;noopener&quot;>Suscribirme</a>'"></iframe>
  </div>
</div>
<div class="wrap">
  <div class="player" id="player">
    <button class="poster" id="poster" data-vid="${esc(initial.vid)}" aria-label="Reproducir">
      <img src="${esc(initial.thumb || ytThumb(initial.vid))}" alt="">
      <span class="play"><svg width="68" height="48" viewBox="0 0 68 48"><path d="M66.5 7.7c-.8-2.9-2.9-5.1-5.8-5.9C55.6 0 34 0 34 0S12.4 0 7.3 1.8C4.4 2.6 2.3 4.8 1.5 7.7 0 13 0 24 0 24s0 11 1.5 16.3c.8 2.9 2.9 5.1 5.8 5.9C12.4 48 34 48 34 48s21.6 0 26.7-1.8c2.9-.8 5-3 5.8-5.9C68 35 68 24 68 24s0-11-1.5-16.3z" fill="#f00" opacity=".92"/><path d="M27 34l18-10-18-10v20z" fill="#fff"/></svg></span>
    </button>
  </div>
  <div class="info">
    <h1 id="title">${esc(initial.title)}</h1>
    <div class="row"><a class="yt" id="ytlink" href="${esc(initial.url)}" target="_blank" rel="noopener">▶ Ver en YouTube</a></div>
  </div>
  <div class="side">
    <div class="tabs">
      <button class="tab on" data-tab="videos">Videos</button>
      ${shorts.length ? '<button class="tab" data-tab="shorts">Shorts</button>' : ''}
      ${playlists.length ? '<button class="tab" data-tab="playlists">Listas de reproducción</button>' : ''}
    </div>
    <div class="panel on" id="panel-videos">
      ${longs.length ? `<div class="grid">${list}</div>` : '<div class="empty-tab">Aún no hay videos largos.</div>'}
    </div>
    ${shorts.length ? `<div class="panel" id="panel-shorts"><div class="gridshorts">${shortList}</div></div>` : ''}
    ${playlists.length ? `<div class="panel" id="panel-playlists"><div class="gridplaylists">${plList}</div></div>` : ''}
  </div>
</div>
<script>
(function(){
  var player = document.getElementById('player');
  function embedVideo(vid){
    player.innerHTML = '<iframe src="https://www.youtube.com/embed/'+vid+'?autoplay=1&rel=0" title="VYRALES" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
  }
  function embedPlaylist(pid){
    player.innerHTML = '<iframe src="https://www.youtube.com/embed/videoseries?list='+pid+'&autoplay=1&rel=0" title="VYRALES" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
  }
  document.getElementById('poster').addEventListener('click', function(){ embedVideo(this.getAttribute('data-vid')); });

  // Pestañas Videos / Shorts / Listas
  var tabs = document.querySelectorAll('.tab');
  tabs.forEach(function(t){
    t.addEventListener('click', function(){
      tabs.forEach(function(x){ x.classList.remove('on'); });
      document.querySelectorAll('.panel').forEach(function(x){ x.classList.remove('on'); });
      t.classList.add('on');
      var p = document.getElementById('panel-' + t.getAttribute('data-tab'));
      if (p) p.classList.add('on');
    });
  });

  var items = document.querySelectorAll('.item');
  items.forEach(function(it){
    it.addEventListener('click', function(){
      items.forEach(function(x){ x.classList.remove('active'); });
      var kind = it.getAttribute('data-kind');
      if (kind === 'playlist') {
        embedPlaylist(it.getAttribute('data-pid'));
        document.getElementById('title').textContent = it.getAttribute('data-title');
        document.getElementById('ytlink').href = 'https://www.youtube.com/playlist?list=' + it.getAttribute('data-pid');
        document.title = it.getAttribute('data-title') + ' · VYRALES';
      } else {
        it.classList.add('active');
        embedVideo(it.getAttribute('data-vid'));
        document.getElementById('title').textContent = it.getAttribute('data-title');
        document.getElementById('ytlink').href = it.getAttribute('data-url');
        document.title = it.getAttribute('data-title') + ' · VYRALES';
        try { history.pushState(null, '', '/ver?v=' + it.getAttribute('data-id')); } catch(_){}
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
})();
</script>
</body></html>`;
  return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=120' }, body: html };
};

// Claves de la página Cuenta → API (cifradas en Supabase; mandan sobre el .env). Ver _keys.js.
exports.handler = require('./_keys').withKeys(exports.handler);
