// PÚBLICO: vyrales.app/ver — "historias completas". Instagram y TikTok no dejan enlaces en el texto (no se pueden
// tocar), así que el perfil lleva UN enlace fijo a esta página, que siempre muestra los videos largos PÚBLICOS en
// YouTube, el más nuevo primero (Franklin, oct-11). ?v=<episode_id> abre directo ese video.
const { getSupabaseClient } = require('./_supabase');
const CHANNEL = process.env.YOUTUBE_CHANNEL_URL || 'https://www.youtube.com/channel/UCfBQ7OFSDrImT96FsDZkY_Q';
const esc = (t) => String(t || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
exports.handler = async (event) => {
  const sb = getSupabaseClient();
  const { data } = await sb.from('episodes').select('id, title, continuity, validator_report, published_at').order('published_at', { ascending: false, nullsFirst: false }).limit(200);
  const longs = (data || []).filter((e) => (e.continuity || {}).kind === 'largo' && (((e.validator_report || {}).published || {}).youtube || {}).url)
    .map((e) => ({ id: e.id, title: ((e.validator_report || {}).publish_package || {}).youtube_title || e.title, url: e.validator_report.published.youtube.url, thumb: ((e.continuity || {}).thumbnail || {}).es_url || ((e.validator_report || {}).publish_package || {}).cover_url || '' }));
  const q = event.queryStringParameters || {};
  const pick = q.v ? longs.find((l) => l.id === q.v) : null;
  if (pick) return { statusCode: 302, headers: { Location: pick.url, 'Cache-Control': 'no-store' }, body: '' };
  const cards = longs.map((l, i) => `<a class="card" href="${esc(l.url)}" rel="noopener">${l.thumb ? `<img src="${esc(l.thumb)}" alt="" loading="${i ? 'lazy' : 'eager'}">` : ''}<div class="t">${i === 0 ? '<span class="new">NUEVO</span>' : ''}${esc(l.title)}</div><div class="b">▶ Ver en YouTube</div></a>`).join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VYRALES · Historias completas</title><meta name="description" content="Las historias completas de VYRALES en YouTube.">
<style>:root{color-scheme:dark}body{margin:0;background:#0b0f17;color:#e8edf5;font:16px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}
.w{max-width:560px;margin:0 auto;padding:22px 16px 40px}h1{font-size:24px;margin:4px 0 2px;letter-spacing:.5px}p{color:#9aa6b8;margin:0 0 18px}
.card{display:block;background:#141b27;border:1px solid #243046;border-radius:14px;overflow:hidden;margin:0 0 16px;color:inherit;text-decoration:none}
.card img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}.t{padding:12px 14px 4px;font-weight:700}.b{padding:0 14px 14px;color:#ff4d4d;font-weight:700}
.new{background:#ffd400;color:#000;font-size:11px;font-weight:800;border-radius:6px;padding:2px 6px;margin-right:8px}
.ch{display:block;text-align:center;background:#ff0033;color:#fff;font-weight:800;border-radius:12px;padding:14px;text-decoration:none;margin-top:8px}</style></head>
<body><div class="w"><h1>VYRALES · Historias completas</h1><p>Full stories · Toca un video para verlo completo en YouTube.</p>
${cards || '<p>Muy pronto: la primera historia completa.</p>'}<a class="ch" href="${esc(CHANNEL)}" rel="noopener">Ver el canal de YouTube</a></div></body></html>`;
  return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }, body: html };
};

// Claves de la página Cuenta → API (cifradas en Supabase; mandan sobre el .env). Ver _keys.js.
exports.handler = require('./_keys').withKeys(exports.handler);
