// PÚBLICO: vyrales.app/ve/<episode_id> — página para mandarle un video a alguien (WhatsApp, etc.) sin que entre al panel.
// El id es un UUID (imposible de adivinar): solo lo ve quien tenga el enlace. Muestra el video final, título y portada
// (con vista previa en WhatsApp por las etiquetas og:). Franklin, oct-12.
const { getSupabaseClient } = require('./_supabase');
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const id = String(q.id || (event.path || '').split('/').pop() || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return page(404, 'Video no encontrado', '<p>El enlace no es válido.</p>');
  const sb = getSupabaseClient();
  const { data: e } = await sb.from('episodes').select('id, title, continuity, validator_report, assets(kind, storage_path, shot_number, created_at, updated_at)').eq('id', id).maybeSingle();
  const fin = e && (e.assets || []).filter((a) => a.kind === 'final_render' && a.storage_path).sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))[0];
  if (!e || !fin) return page(404, 'Video no encontrado', '<p>Este video ya no está disponible.</p>');
  const c = e.continuity || {}; const pk = (e.validator_report || {}).publish_package || {};
  const img = (e.assets || []).filter((a) => a.kind === 'image' && a.storage_path).sort((a, b) => (a.shot_number || 0) - (b.shot_number || 0))[0];
  const thumb = (c.thumbnail || {}).es_url || pk.cover_url || (img && img.storage_path) || '';
  const land = c.kind === 'largo' || c.aspect === '16:9';
  const title = pk.youtube_title ? String(pk.youtube_title).replace(/#\S+/g, '').trim() : e.title;
  const desc = String(c.summary || c.hook_text || 'Un video de VYRALES').split('\n')[0].slice(0, 200);
  const yt = (((e.validator_report || {}).published || {}).youtube || {}).url;
  const body = `<video src="${esc(fin.storage_path)}" ${thumb ? `poster="${esc(thumb)}"` : ''} controls playsinline preload="metadata" class="${land ? 'land' : 'vert'}"></video>
<h1>${esc(title)}</h1><p>${esc(desc)}</p>
${yt ? `<a class="btn" href="${esc(yt)}" rel="noopener">▶ Ver en YouTube</a>` : ''}<a class="btn2" href="/ver">Más historias de VYRALES</a>`;
  return page(200, title, body, { desc, thumb, video: fin.storage_path });
};

function page(status, title, body, og = {}) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · VYRALES</title>
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(og.desc || '')}"><meta property="og:type" content="video.other">
${og.thumb ? `<meta property="og:image" content="${esc(og.thumb)}">` : ''}${og.video ? `<meta property="og:video" content="${esc(og.video)}"><meta property="og:video:type" content="video/mp4">` : ''}
<meta name="twitter:card" content="summary_large_image">
<style>:root{color-scheme:dark}body{margin:0;background:#0b0f17;color:#e8edf5;font:16px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
.w{max-width:720px;margin:0 auto;padding:18px 16px 40px;text-align:center}.logo{font-weight:800;letter-spacing:.3em;color:#7cc4ff;font-size:13px;margin-bottom:14px}
video{background:#000;border-radius:14px;display:block;margin:0 auto}video.land{width:100%;aspect-ratio:16/9}video.vert{height:min(78vh,760px);aspect-ratio:9/16;max-width:100%}
h1{font-size:20px;margin:16px 0 6px}p{color:#9aa6b8;margin:0 0 16px}.btn,.btn2{display:block;border-radius:12px;padding:13px;font-weight:700;text-decoration:none;margin:10px auto;max-width:420px}
.btn{background:#ff0033;color:#fff}.btn2{border:1px solid #2b3a55;color:#cfe0ff}</style></head>
<body><div class="w"><div class="logo">VYRALES</div>${body}</div></body></html>`;
  return { statusCode: status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' }, body: html };
}
