// PÚBLICO: vyrales.app/ver — "historias completas". Instagram y TikTok no dejan enlaces en el texto (no se pueden
// tocar), así que el perfil lleva UN enlace fijo a esta página, que siempre muestra los videos largos PÚBLICOS en
// YouTube, el más nuevo primero (Franklin, oct-11).
// oct-15 (Franklin): el video se ve AQUÍ MISMO (empotrado con el reproductor oficial de YouTube — sí cuenta como
// vista en YouTube), con un diseño parecido a YouTube (reproductor grande + lista de "siguientes" al lado/abajo).
// ?v=<episode_id> hace que ESE video sea el que se ve de entrada en la pantalla grande (antes redirigía a YouTube).
const { getSupabaseClient } = require('./_supabase');
const CHANNEL = process.env.YOUTUBE_CHANNEL_URL || 'https://www.youtube.com/channel/UCfBQ7OFSDrImT96FsDZkY_Q';
const CHANNEL_ID = (CHANNEL.match(/\/channel\/([^/?]+)/) || [])[1] || 'UCfBQ7OFSDrImT96FsDZkY_Q';
const SITE_ORIGIN = process.env.PUBLIC_BASE_URL || 'https://vyrales.app';
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
        // YouTube devuelve el banner recortado a baja resolución por defecto; pidiendo el ancho
        // grande (=w2120) sale la imagen de verdad en alta calidad (Franklin, oct-15).
        banner: (((c.brandingSettings || {}).image || {}).bannerExternalUrl ? ((c.brandingSettings || {}).image || {}).bannerExternalUrl + '=w2120' : '')
      };
    });
  } catch (_) { info = null; }
  if (info) { try { await sb.storage.from('media').upload(path, Buffer.from(JSON.stringify({ at: Date.now(), info })), { contentType: 'application/json', upsert: true, cacheControl: '0' }); } catch (_) {} }
  return info;
}
// Vistas y duración REALES de cada video/short (videos.list, hasta 50 ids por llamada), en caché 12 h.
// Nunca se inventan vistas/fecha: si la API falla, esos datos simplemente no se muestran.
async function getVideoStats(sb, ids) {
  const key = ids.slice().sort().join(',');
  const path = 'cache/stats_vyrales.json';
  try {
    const { data } = await sb.storage.from('media').download(path + '?t=' + Date.now());
    if (data) { const c = JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8')); if (c && c.at && c.key === key && Date.now() - c.at < 12 * 3600000) return c.map; }
  } catch (_) {}
  let map = {};
  try {
    const SOC = require('./_social');
    await SOC.withYoutubeFallback(sb, console.log, async (platform) => {
      const token = await SOC.youtubeAccessToken(sb, platform);
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=' + batch.join(','), { headers: { Authorization: 'Bearer ' + token } });
        const j = await r.json();
        if (!r.ok) throw new Error('youtube videos HTTP ' + r.status + ': ' + JSON.stringify(j).slice(0, 500));
        (j.items || []).forEach((v) => { map[v.id] = { views: +v.statistics.viewCount || 0, duration: v.contentDetails.duration || '' }; });
      }
    });
  } catch (_) { map = {}; }
  if (Object.keys(map).length) { try { await sb.storage.from('media').upload(path, Buffer.from(JSON.stringify({ at: Date.now(), key, map })), { contentType: 'application/json', upsert: true, cacheControl: '0' }); } catch (_) {} }
  return map;
}
// "PT10M5S" -> "10:05" (duración real de YouTube para la insignia en la miniatura).
function fmtDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
  if (!m) return '';
  const h = +m[1] || 0, mi = +m[2] || 0, se = +m[3] || 0;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(mi)}:${pad(se)}` : `${mi}:${pad(se)}`;
}
// Fecha relativa a partir de published_at (dato real que ya tenemos, no inventado).
function fmtRelDate(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d <= 0) return 'Hoy';
  if (d === 1) return 'Hace 1 día';
  if (d < 30) return `Hace ${d} días`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return mo === 1 ? 'Hace 1 mes' : `Hace ${mo} meses`;
  const y = Math.floor(mo / 12);
  return y === 1 ? 'Hace 1 año' : `Hace ${y} años`;
}
exports.handler = async (event) => {
  const sb = getSupabaseClient();
  // MULTIUSUARIO: esta página pública es del canal del ADMIN: solo sus historias (las de otras cuentas no salen).
  const T = require('./_tenant');
  const ch = await getChannelInfo(sb); // avatar/banner/subs reales del canal (o null si falla: se usa un header simple)
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
    thumb: ((e.continuity || {}).thumbnail || {}).es_url || ((e.validator_report || {}).publish_package || {}).cover_url || '',
    date: e.published_at || null
  });
  // "Short" es: la URL es /shorts/ (confirma solo), o el episodio quedó marcado con continuity.kind
  // distinto de 'largo' (el campo 'short_cta' que usa el sistema para los cortos, o sin kind) — la URL
  // sola no alcanza porque muchos shorts se publicaron con un link normal youtu.be/<id> (Franklin, oct-15).
  const isShort = (e) => /\/shorts\//.test(e.validator_report.published.youtube.url) || (e.continuity || {}).kind !== 'largo';
  const longs = published.filter((e) => !isShort(e)).map(toItem).filter((l) => l.vid);
  const shorts = published.filter((e) => isShort(e)).map(toItem).filter((l) => l.vid);
  const q = event.queryStringParameters || {};
  const initialLong = (q.v && longs.find((l) => l.id === q.v)) || longs[0] || null;
  const initialShort = (q.v && shorts.find((l) => l.id === q.v)) || shorts[0] || null;
  const openShortsFirst = !!(q.v && !initialLong && initialShort);

  if (!initialLong && !initialShort) {
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VYRALES · Historias completas</title></head><body style="margin:0;background:#0f0f0f;color:#f1f1f1;font:16px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">
<div><p>Muy pronto: la primera historia completa.</p><a href="${esc(CHANNEL)}" style="color:#3ea6ff">Ver el canal de YouTube</a></div></body></html>`;
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }, body: html };
  }

  const stats = await getVideoStats(sb, [...longs, ...shorts].map((l) => l.vid)); // vistas/duración reales (caché 12h)
  const withStats = (l) => Object.assign({}, l, { views: (stats[l.vid] || {}).views, dur: fmtDuration((stats[l.vid] || {}).duration) });
  const ytThumb = (vid) => `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
  const metaLine = (l) => ['VYRALES', l.views != null ? nf(l.views) + ' vistas' : null, l.date ? fmtRelDate(l.date) : null].filter(Boolean).join(' • ');
  const listItem = (cls, initialId) => (l) => `<button class="list-item${l.id === initialId ? ' active' : ''}" data-id="${esc(l.id)}" data-vid="${esc(l.vid)}" data-title="${esc(l.title)}" data-url="${esc(l.url)}" data-info="${esc(metaLine(l))}">
    <span class="thumb-container ${cls}"><img src="${esc(l.thumb || ytThumb(l.vid))}" alt="" loading="lazy">${l.dur ? `<span class="duration-badge">${esc(l.dur)}</span>` : ''}</span>
    <span class="item-info"><span class="item-title">${esc(l.title)}</span><span class="item-meta">VYRALES</span><span class="item-meta">${esc(metaLine(l))}</span></span>
  </button>`;
  const longsWithStats = longs.map(withStats);
  const shortsWithStats = shorts.map(withStats);
  const videosListHtml = longsWithStats.map(listItem('horizontal', (initialLong || {}).id)).join('');
  const shortsListHtml = shortsWithStats.map(listItem('vertical', (initialShort || {}).id)).join('');
  const il = initialLong ? withStats(initialLong) : null;
  const is = initialShort ? withStats(initialShort) : null;
  const first = il || is;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(first.title)} · VYRALES</title>
<meta name="description" content="Las historias completas de VYRALES en YouTube.">
<meta property="og:title" content="${esc(first.title)}"><meta property="og:image" content="${esc(first.thumb || ytThumb(first.vid))}">
<link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f0f0f;color:#f1f1f1;font-family:Roboto,system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}
.container{max-width:1280px;margin:0 auto}
.banner{width:100%;aspect-ratio:1060/175;border-radius:12px;background:#111 linear-gradient(135deg,#1a1033,#0f0f0f);overflow:hidden;margin-bottom:16px}
.banner img{width:100%;height:100%;object-fit:cover;display:block}
.channel-info{display:flex;align-items:center;gap:20px;margin-bottom:20px;padding:0 4px;flex-wrap:wrap}
.channel-avatar{width:88px;height:88px;border-radius:50%;object-fit:cover;background:#1a1a1a;border:3px solid #3f3f3f;flex:none}
.channel-details h2{font-size:1.3rem;margin-bottom:4px;color:#fff}
.channel-meta{font-size:.9rem;color:#aaa;margin-bottom:10px}
.subscribe-btn{display:inline-flex;align-items:center;gap:8px;background:#cc0000;color:#fff;border:0;border-radius:2px;padding:10px 20px;font-weight:700;font-size:.9rem;letter-spacing:.3px;text-decoration:none;cursor:pointer;text-transform:uppercase}
.subscribe-btn:hover{background:#b00000}
.tabs{display:flex;border-bottom:1px solid #3f3f3f;margin-bottom:24px;gap:24px;padding:0 4px}
.tab{padding:12px 4px;font-weight:500;color:#aaa;cursor:pointer;position:relative;background:none;border:none;font:inherit;font-size:1rem}
.tab.active{color:#f1f1f1}
.tab.active::after{content:'';position:absolute;bottom:-1px;left:0;width:100%;height:3px;background:#f1f1f1}
.panel-grid{display:grid;grid-template-columns:2.2fr 1fr;gap:24px}
@media (max-width:900px){.panel-grid{grid-template-columns:1fr}}
.video-wrapper{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.5)}
.video-wrapper.short-format{aspect-ratio:9/16;max-width:420px;margin:0 auto}
.video-wrapper iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.poster{position:absolute;inset:0;width:100%;height:100%;cursor:pointer;border:0;padding:0;background:#000}
.poster img{width:100%;height:100%;object-fit:cover;display:block;opacity:.85}
.poster .play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.poster .play svg{filter:drop-shadow(0 2px 10px rgba(0,0,0,.6))}
.featured-details{margin-top:16px;padding:0 4px}
.short-format + .featured-details{text-align:center;max-width:420px;margin:12px auto 0}
.featured-title{font-size:1.2rem;font-weight:500;line-height:1.4;margin-bottom:8px}
.featured-info{font-size:.9rem;color:#aaa}
.playlist-area{max-height:720px;overflow-y:auto;padding-right:6px}
.playlist-area::-webkit-scrollbar{width:6px}
.playlist-area::-webkit-scrollbar-thumb{background:#3f3f3f;border-radius:3px}
.playlist-title{font-size:1.05rem;font-weight:500;margin-bottom:12px;position:sticky;top:0;background:#0f0f0f;padding:4px 0;z-index:1}
.list-item{display:flex;gap:12px;padding:8px;border-radius:8px;cursor:pointer;margin-bottom:8px;background:transparent;border:0;width:100%;text-align:left;color:inherit;font:inherit}
.list-item:hover,.list-item.active{background:#272727}
.list-item.active .thumb-container{outline:2px solid #3ea6ff}
.thumb-container{position:relative;border-radius:8px;overflow:hidden;background:#1a1a1a;flex:none}
.thumb-container.horizontal{width:140px;aspect-ratio:16/9}
.thumb-container.vertical{width:90px;aspect-ratio:9/16}
.thumb-container img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s ease}
.list-item:hover .thumb-container img{transform:scale(1.07)}
.duration-badge{position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,.8);font-size:.7rem;padding:2px 4px;border-radius:4px;color:#fff;font-weight:500}
.item-info{display:flex;flex-direction:column;justify-content:flex-start;min-width:0}
.item-title{font-size:.88rem;font-weight:500;line-height:1.3;margin-bottom:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:#f1f1f1}
.item-meta{font-size:.74rem;color:#aaa}
.section-view{display:none}
.section-view.active{display:block}
.empty-tab{color:#aaa;padding:30px 4px;text-align:center}
</style></head>
<body>
<div class="container">
${ch && ch.banner ? `<div class="banner"><img src="${esc(ch.banner)}" alt=""></div>` : '<div class="banner"></div>'}
<div class="channel-info">
  <img class="channel-avatar" src="${esc((ch && ch.avatar) || '/icon-192.png')}" alt="VYRALES">
  <div class="channel-details">
    <h2>${esc((ch && ch.title) || 'VYRALES')}</h2>
    <div class="channel-meta">${ch ? esc(ch.handle || '@vyrales') + ' • ' + nf(ch.subs) + ' suscriptores • ' + nf(ch.videos) + ' videos' : '@vyrales'}</div>
    <a class="subscribe-btn" href="${esc(CHANNEL)}" target="_blank" rel="noopener">Suscribirme</a>
  </div>
</div>

<div class="tabs">
  <button class="tab${openShortsFirst ? '' : ' active'}" data-section="videos-section">Videos</button>
  ${shorts.length ? `<button class="tab${openShortsFirst ? ' active' : ''}" data-section="shorts-section">Shorts</button>` : ''}
</div>

<div id="videos-section" class="section-view${openShortsFirst ? '' : ' active'}">
  ${il ? `<div class="panel-grid">
    <div class="featured-area">
      <div class="video-wrapper" id="video-player">
        <button class="poster" id="video-poster" data-vid="${esc(il.vid)}" aria-label="Reproducir">
          <img src="${esc(il.thumb || ytThumb(il.vid))}" alt="">
          <span class="play"><svg width="68" height="48" viewBox="0 0 68 48"><path d="M66.5 7.7c-.8-2.9-2.9-5.1-5.8-5.9C55.6 0 34 0 34 0S12.4 0 7.3 1.8C4.4 2.6 2.3 4.8 1.5 7.7 0 13 0 24 0 24s0 11 1.5 16.3c.8 2.9 2.9 5.1 5.8 5.9C12.4 48 34 48 34 48s21.6 0 26.7-1.8c2.9-.8 5-3 5.8-5.9C68 35 68 24 68 24s0-11-1.5-16.3z" fill="#f00" opacity=".92"/><path d="M27 34l18-10-18-10v20z" fill="#fff"/></svg></span>
        </button>
      </div>
      <div class="featured-details">
        <h3 class="featured-title" id="video-title">${esc(il.title)}</h3>
        <div class="featured-info" id="video-info">${esc(metaLine(il))}</div>
        <div style="margin-top:8px"><a id="video-ytlink" href="${esc(il.url)}" target="_blank" rel="noopener" style="color:#3ea6ff;font-size:.85rem;text-decoration:none">▶ Ver en YouTube</a></div>
      </div>
    </div>
    <div class="playlist-area">
      <div class="playlist-title">Más historias completas</div>
      <div id="videos-list">${videosListHtml}</div>
    </div>
  </div>` : '<div class="empty-tab">Aún no hay videos largos.</div>'}
</div>

${shorts.length ? `<div id="shorts-section" class="section-view${openShortsFirst ? ' active' : ''}">
  <div class="panel-grid">
    <div class="featured-area">
      <div class="video-wrapper short-format" id="short-player">
        <button class="poster" id="short-poster" data-vid="${esc(is.vid)}" aria-label="Reproducir">
          <img src="${esc(is.thumb || ytThumb(is.vid))}" alt="">
          <span class="play"><svg width="68" height="48" viewBox="0 0 68 48"><path d="M66.5 7.7c-.8-2.9-2.9-5.1-5.8-5.9C55.6 0 34 0 34 0S12.4 0 7.3 1.8C4.4 2.6 2.3 4.8 1.5 7.7 0 13 0 24 0 24s0 11 1.5 16.3c.8 2.9 2.9 5.1 5.8 5.9C12.4 48 34 48 34 48s21.6 0 26.7-1.8c2.9-.8 5-3 5.8-5.9C68 35 68 24 68 24s0-11-1.5-16.3z" fill="#f00" opacity=".92"/><path d="M27 34l18-10-18-10v20z" fill="#fff"/></svg></span>
        </button>
      </div>
      <div class="featured-details">
        <h3 class="featured-title" id="short-title">${esc(is.title)}</h3>
        <div class="featured-info" id="short-info">${esc(metaLine(is))}</div>
        <div style="margin-top:8px"><a id="short-ytlink" href="${esc(is.url)}" target="_blank" rel="noopener" style="color:#3ea6ff;font-size:.85rem;text-decoration:none">▶ Ver en YouTube</a></div>
      </div>
    </div>
    <div class="playlist-area">
      <div class="playlist-title">Otros Shorts</div>
      <div id="shorts-list">${shortsListHtml}</div>
    </div>
  </div>
</div>` : ''}

</div>
<script>
var SITE_ORIGIN = ${JSON.stringify(SITE_ORIGIN)};
(function(){
  function wire(prefix, posterId, playerId){
    var poster = document.getElementById(posterId);
    var player = document.getElementById(playerId);
    if (!poster || !player) return;
    function embed(vid){
      player.innerHTML = '<iframe src="https://www.youtube.com/embed/'+vid+'?autoplay=1&rel=0&origin='+encodeURIComponent(SITE_ORIGIN)+'" title="VYRALES" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
    }
    poster.addEventListener('click', function(){ embed(this.getAttribute('data-vid')); });
    document.querySelectorAll('#' + prefix + '-list .list-item').forEach(function(it){
      it.addEventListener('click', function(){
        document.querySelectorAll('#' + prefix + '-list .list-item').forEach(function(x){ x.classList.remove('active'); });
        it.classList.add('active');
        embed(it.getAttribute('data-vid'));
        document.getElementById(prefix + '-title').textContent = it.getAttribute('data-title');
        document.getElementById(prefix + '-info').textContent = it.getAttribute('data-info');
        var yt = document.getElementById(prefix + '-ytlink'); if (yt) yt.href = it.getAttribute('data-url');
        document.title = it.getAttribute('data-title') + ' · VYRALES';
        if (prefix === 'video') { try { history.pushState(null, '', '/ver?v=' + it.getAttribute('data-id')); } catch(_){} }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }
  wire('video', 'video-poster', 'video-player');
  wire('short', 'short-poster', 'short-player');

  var tabs = document.querySelectorAll('.tab');
  tabs.forEach(function(t){
    t.addEventListener('click', function(){
      tabs.forEach(function(x){ x.classList.remove('active'); });
      document.querySelectorAll('.section-view').forEach(function(x){ x.classList.remove('active'); });
      t.classList.add('active');
      var sec = document.getElementById(t.getAttribute('data-section'));
      if (sec) sec.classList.add('active');
    });
  });
})();
</script>
</body></html>`;
  return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=120' }, body: html };
};

// Claves de la página Cuenta → API (cifradas en Supabase; mandan sobre el .env). Ver _keys.js.
exports.handler = require('./_keys').withKeys(exports.handler);
