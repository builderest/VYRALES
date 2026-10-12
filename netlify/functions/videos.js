// GET /.netlify/functions/videos — TODOS los videos terminados (con video final), de todas tus series.
// Los largos van primero con sus Shorts "hijos" (continuity.parent_episode_id) debajo. Para la página "Videos" del panel:
// ver, elegir y publicar sin buscar episodio por episodio (Franklin, oct-12).
const { getSupabaseClient } = require('./_supabase');
const T = require('./_tenant');
const { latestPerShot } = require('./_assets');

exports.handler = async () => {
  try {
    const sb = getSupabaseClient();
    const on = await T.tenancyOn(sb);
    const ws = T.currentWs();
    let q = sb.from('series').select('id, slug, title');
    if (on) q = q.eq('workspace_id', ws);
    const { data: series } = await q;
    const byId = Object.fromEntries((series || []).map((s) => [s.id, s]));
    if (!series || !series.length) return json(200, { videos: [] });
    const { data: eps, error } = await sb.from('episodes')
      .select('id, series_id, episode_number, title, status, continuity, validator_report, published_at, updated_at, assets(kind, storage_path, shot_number, created_at, updated_at)')
      .in('series_id', series.map((s) => s.id)).neq('status', 'archivado');
    if (error) throw error;
    const vids = [];
    for (const e of eps || []) {
      const finals = (e.assets || []).filter((a) => a.kind === 'final_render' && a.storage_path);
      if (!finals.length) continue;
      const fin = finals.sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))[0];
      const c = e.continuity || {}; const vr = e.validator_report || {}; const pk = vr.publish_package || {};
      const img = latestPerShot((e.assets || []).filter((a) => a.kind === 'image' && a.storage_path), ['image']).filter((a) => a.kind === 'image').sort((a, b) => (a.shot_number || 0) - (b.shot_number || 0))[0];
      const pub = vr.published || {}; const runs = vr.social_runs || {};
      vids.push({
        id: e.id, series_slug: (byId[e.series_id] || {}).slug, series_title: (byId[e.series_id] || {}).title,
        episode_number: e.episode_number, title: e.title, status: e.status,
        kind: c.kind === 'largo' ? 'largo' : c.kind === 'short_cta' || c.parent_episode_id ? 'short' : 'short',
        landscape: c.kind === 'largo' || c.aspect === '16:9',
        parent_id: c.parent_episode_id || null,
        final_url: fin.storage_path, final_at: fin.updated_at || fin.created_at,
        thumb: (c.thumbnail || {}).es_url || pk.cover_url || (img && img.storage_path) || null,
        seconds: c.voice && c.voice.seconds ? Math.round(Number(c.voice.seconds)) : null,
        package_ready: pk.status === 'done',
        published: Object.fromEntries(['youtube', 'tiktok', 'instagram', 'facebook'].map((p) => [p, pub[p] ? (pub[p].url || true) : ((runs[p] || {}).status === 'uploaded_private' ? 'privado' : null)]))
      });
    }
    // Orden: largos (más nuevo primero) y debajo sus Shorts; después los Shorts sueltos.
    const time = (v) => String(v.final_at || '');
    const largos = vids.filter((v) => v.kind === 'largo').sort((a, b) => time(b).localeCompare(time(a)));
    const ids = new Set(largos.map((l) => l.id));
    const out = [];
    for (const l of largos) { out.push(l); vids.filter((v) => v.parent_id === l.id).sort((a, b) => a.episode_number - b.episode_number).forEach((s) => out.push(Object.assign(s, { child: true }))); }
    vids.filter((v) => v.kind !== 'largo' && !ids.has(v.parent_id)).sort((a, b) => time(b).localeCompare(time(a))).forEach((v) => out.push(v));
    return json(200, { videos: out });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
function json(s, b) { return { statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) }; }

// Claves de la página Cuenta → API (cifradas en Supabase; mandan sobre el .env). Ver _keys.js.
exports.handler = require('./_keys').withKeys(exports.handler);
