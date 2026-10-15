// PÚBLICO: vyrales.app/ver — "historias completas". Instagram y TikTok no dejan enlaces en el texto (no se pueden
// tocar), así que el perfil lleva UN enlace fijo a esta página, que siempre muestra los videos largos PÚBLICOS en
// YouTube, el más nuevo primero (Franklin, oct-11).
// oct-15 (Franklin): el video se ve AQUÍ MISMO (empotrado con el reproductor oficial de YouTube — sí cuenta como
// vista en YouTube), con un diseño parecido a YouTube (reproductor grande + lista de "siguientes" al lado/abajo).
// ?v=<episode_id> hace que ESE video sea el que se ve de entrada en la pantalla grande (antes redirigía a YouTube).
const { getSupabaseClient } = require('./_supabase');
const CHANNEL = process.env.YOUTUBE_CHANNEL_URL || 'https://www.youtube.com/channel/UCfBQ7OFSDrImT96FsDZkY_Q';
const esc = (t) => String(t || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Saca el ID de 11 caracteres de un link youtu.be/... o youtube.com/watch?v=...
function ytId(url) {
  const m = /(?:youtu\.be\/|[?&]v=|\/embed\/)([A-Za-z0-9_-]{11})/.exec(String(url || ''));
  return m ? m[1] : null;
}
exports.handler = async (event) => {
  const sb = getSupabaseClient();
  // MULTIUSUARIO: esta página pública es del canal del ADMIN: solo sus historias (las de otras cuentas no salen).
  const T = require('./_tenant');
  const on = await T.tenancyOn(sb);
  let q0 = sb.from('episodes').select(on ? 'id, title, continuity, validator_report, published_at, series!inner(workspace_id)' : 'id, title, continuity, validator_report, published_at');
  if (on) q0 = q0.eq('series.workspace_id', T.ADMIN_WS);
  const { data } = await q0.order('published_at', { ascending: false, nullsFirst: false }).limit(200);
  const longs = (data || []).filter((e) => (e.continuity || {}).kind === 'largo' && (((e.validator_report || {}).published || {}).youtube || {}).url)
    .map((e) => ({
      id: e.id,
      title: ((e.validator_report || {}).publish_package || {}).youtube_title || e.title,
      url: e.validator_report.published.youtube.url,
      vid: ytId(e.validator_report.published.youtube.url),
      thumb: ((e.continuity || {}).thumbnail || {}).es_url || ((e.validator_report || {}).publish_package || {}).cover_url || ''
    }))
    .filter((l) => l.vid);
  const q = event.queryStringParameters || {};
  const initial = (q.v && longs.find((l) => l.id === q.v)) || longs[0] || null;

  if (!longs.length) {
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VYRALES · Historias completas</title></head><body style="margin:0;background:#0f0f0f;color:#f1f1f1;font:16px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">
<div><p>Muy pronto: la primera historia completa.</p><a href="${esc(CHANNEL)}" style="color:#3ea6ff">Ver el canal de YouTube</a></div></body></html>`;
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }, body: html };
  }

  const ytThumb = (vid) => `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
  const listItem = (l, i) => `<button class="item${l.id === initial.id ? ' active' : ''}" data-id="${esc(l.id)}" data-vid="${esc(l.vid)}" data-title="${esc(l.title)}" data-url="${esc(l.url)}">
    <span class="th"><img src="${esc(l.thumb || ytThumb(l.vid))}" alt="" loading="${i < 3 ? 'eager' : 'lazy'}">${i === 0 ? '<i class="new">NUEVO</i>' : ''}</span>
    <span class="meta"><b>${esc(l.title)}</b></span>
  </button>`;
  const list = longs.map(listItem).join('');

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(initial.title)} · VYRALES</title>
<meta name="description" content="Las historias completas de VYRALES en YouTube.">
<meta property="og:title" content="${esc(initial.title)}"><meta property="og:image" content="${esc(initial.thumb || ytThumb(initial.vid))}">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0f0f0f;color:#f1f1f1;font:15px/1.4 Roboto,system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;align-items:center;gap:10px;padding:10px 16px;position:sticky;top:0;background:#0f0f0f;z-index:5;border-bottom:1px solid #272727}
header .logo{display:flex;align-items:center;gap:8px;font-weight:700;font-size:18px;letter-spacing:.3px;color:#fff;text-decoration:none}
header .logo svg{flex:none}
header .ch{margin-left:auto;background:transparent;border:1px solid #3f3f3f;color:#f1f1f1;border-radius:18px;padding:8px 14px;font-size:13px;font-weight:600;text-decoration:none;white-space:nowrap}
header .ch:hover{background:#272727}
.wrap{max-width:1300px;margin:0 auto;padding:20px 16px 60px;display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:24px}
@media (max-width:980px){.wrap{grid-template-columns:1fr;padding:0 0 40px}}
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
.side h2{font-size:14px;color:#aaa;font-weight:600;margin:0 0 10px;padding:0 4px}
@media (max-width:980px){.side{padding:0 16px}.side h2{padding:4px 0 10px}}
.item{display:flex;gap:8px;width:100%;text-align:left;background:transparent;border:0;color:inherit;font:inherit;cursor:pointer;padding:6px 4px;border-radius:10px;margin-bottom:4px}
.item:hover{background:#1f1f1f}
.item.active{background:#272727}
.th{position:relative;flex:none;width:168px;aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:#1a1a1a}
.th img{width:100%;height:100%;object-fit:cover;display:block}
.new{position:absolute;left:6px;top:6px;background:#ffd400;color:#000;font-size:10px;font-weight:800;border-radius:4px;padding:2px 5px;font-style:normal}
.meta{min-width:0;display:flex;flex-direction:column;justify-content:center}
.meta b{font-size:13px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
</style></head>
<body>
<header>
  <a class="logo" href="/ver"><svg width="26" height="18" viewBox="0 0 28 20"><rect width="28" height="20" rx="6" fill="#ff0000"/><path d="M11 5.5l8 4.5-8 4.5z" fill="#fff"/></svg>VYRALES</a>
  <a class="ch" href="${esc(CHANNEL)}" rel="noopener">Suscribirme en YouTube</a>
</header>
<div class="wrap">
  <div>
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
  </div>
  <div class="side">
    <h2>Más historias completas</h2>
    ${list}
  </div>
</div>
<script>
(function(){
  var player = document.getElementById('player');
  function embed(vid){
    player.innerHTML = '<iframe src="https://www.youtube.com/embed/'+vid+'?autoplay=1&rel=0" title="VYRALES" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
  }
  document.getElementById('poster').addEventListener('click', function(){ embed(this.getAttribute('data-vid')); });
  var items = document.querySelectorAll('.item');
  items.forEach(function(it){
    it.addEventListener('click', function(){
      items.forEach(function(x){ x.classList.remove('active'); });
      it.classList.add('active');
      embed(it.getAttribute('data-vid'));
      document.getElementById('title').textContent = it.getAttribute('data-title');
      document.getElementById('ytlink').href = it.getAttribute('data-url');
      document.title = it.getAttribute('data-title') + ' · VYRALES';
      try { history.pushState(null, '', '/ver?v=' + it.getAttribute('data-id')); } catch(_){}
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
