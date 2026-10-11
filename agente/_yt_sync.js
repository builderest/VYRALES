// Videos subidos en PRIVADO que Franklin hizo públicos en Studio: se marcan como publicados (vyrales.app/ver, enlaces
// de los Shorts) y, si es un largo, se publica el comentario con las fuentes (con video privado YouTube lo rechaza).
async function syncYoutubePublic(sb, log = console.log) {
  const F = require('path').join(__dirname, '..', 'netlify', 'functions');
  const { data } = await sb.from('episodes').select('id, title, continuity, validator_report').order('updated_at', { ascending: false }).limit(150);
  const todo = (data || []).filter((e) => { const vr = e.validator_report || {}; const r = (vr.social_runs || {}).youtube || {}; return r.video_id && r.status === 'uploaded_private' && !((vr.published || {}).youtube); });
  if (!todo.length) return 0;
  const tk = await require(F + '/_social').youtubeAccessToken(sb);
  const ids = todo.map((e) => e.validator_report.social_runs.youtube.video_id);
  const j = await (await fetch('https://www.googleapis.com/youtube/v3/videos?part=status&id=' + ids.join(','), { headers: { Authorization: 'Bearer ' + tk } })).json();
  const pub = new Set((j.items || []).filter((v) => v.status && v.status.privacyStatus === 'public').map((v) => v.id));
  let n = 0;
  for (const e of todo) {
    const r = e.validator_report.social_runs.youtube;
    if (!pub.has(r.video_id)) continue;
    const { data: fr } = await sb.from('episodes').select('validator_report, published_at').eq('id', e.id).single();
    const vr = Object.assign({}, fr.validator_report || {});
    vr.published = Object.assign({}, vr.published || {}, { youtube: { at: new Date().toISOString(), url: r.url || ('https://youtu.be/' + r.video_id), video_id: r.video_id, via: 'studio' } });
    vr.social_runs = Object.assign({}, vr.social_runs, { youtube: Object.assign({}, r, { status: 'published', privacy: 'public' }) });
    await sb.from('episodes').update(Object.assign({ validator_report: vr }, fr.published_at ? {} : { published_at: new Date().toISOString() })).eq('id', e.id);
    log('YouTube: "' + e.title + '" ya es PÚBLICO → marcado como publicado');
    const pk = vr.publish_package || {};
    if (pk.pinned_comment && (pk.landscape || (e.continuity || {}).parent_episode_id)) {
      const cr = await fetch('https://www.googleapis.com/youtube/v3/commentThreads?part=snippet', { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify({ snippet: { videoId: r.video_id, topLevelComment: { snippet: { textOriginal: String(pk.pinned_comment).slice(0, 9000) } } } }) });
      log(cr.ok ? '  comentario publicado (fíjalo en Studio: ⋮ → Fijar)' : '  comentario no publicado (HTTP ' + cr.status + ': ' + (await cr.text()).slice(0, 160) + ')');
    }
    n++;
  }
  return n;
}
module.exports = { syncYoutubePublic };
