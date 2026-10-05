// POST /.netlify/functions/render-episode-background   { series, episode_id }
// Botón "Renderizar video final" del editor: aplica el plan de edición (recortes, orden,
// subtítulos, música, volumen parejo, tarjetas) y reemplaza el final_render del episodio.
// $0 (solo ffmpeg). El resultado de la corrida queda en episodes.validator_report.last_render
// para que el dashboard lo muestre.
const fs = require('fs');
const { getSupabaseClient } = require('./_supabase');
const { renderEpisode } = require('./_render');
const { ensureMediaBucket, uploadClip, removeByPublicUrl } = require('./_storage');

const LOG = '[render-episode]';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const supabase = getSupabaseClient();
  let episode = null;
  const report = async (patch) => {
    if (!episode) return;
    const vr = Object.assign({}, episode.validator_report || {}, { last_render: Object.assign({ at: new Date().toISOString() }, patch) });
    episode.validator_report = vr;
    await supabase.from('episodes').update({ validator_report: vr }).eq('id', episode.id);
  };
  try {
    const body = JSON.parse(event.body || '{}');
    const { data: series } = await supabase.from('series').select('id, slug, story_bible').eq('slug', body.series || '').single();
    if (!series) throw new Error('Serie no encontrada.');
    const { data: ep, error } = await supabase.from('episodes').select('*, assets(*)').eq('id', body.episode_id || '').eq('series_id', series.id).single();
    if (error || !ep) throw error || new Error('Episodio no encontrado.');
    episode = ep;
    if (ep.status === 'generando_media') throw new Error('El episodio se está generando; renderiza cuando termine.');
    await report({ status: 'rendering' });

    const t0 = Date.now();
    const result = await renderEpisode({ episode: ep, series, log: (...a) => console.log(LOG, ...a) });
    try {
      await ensureMediaBucket(supabase);
      const url = await uploadClip(supabase, { path: `${series.slug}/ep${ep.episode_number}/final-v${Date.now()}.mp4`, buffer: fs.readFileSync(result.file) });
      const old = (ep.assets || []).find((a) => a.kind === 'final_render');
      if (old) {
        const { error: uErr } = await supabase.from('assets').update({ storage_path: url, cost_usd: 0, approved: false, approved_at: null }).eq('id', old.id);
        if (uErr) throw uErr;
        if (old.storage_path && old.storage_path !== url) await removeByPublicUrl(supabase, old.storage_path, (...a) => console.log(LOG, ...a));
      } else {
        const { error: iErr } = await supabase.from('assets').insert({ episode_id: ep.id, kind: 'final_render', model: 'other', storage_path: url, cost_usd: 0, approved: false });
        if (iErr) throw iErr;
      }
      await supabase.from('episodes').update({ final_video_path: url }).eq('id', ep.id);
      await report({ status: 'done', url, seconds: Math.round(result.seconds * 10) / 10, pieces: result.pieces, took_s: Math.round((Date.now() - t0) / 1000) });
      console.log(LOG, 'listo ✅', url, result.seconds.toFixed(1) + 's de video');
      return { statusCode: 200, body: JSON.stringify({ url, seconds: result.seconds }) };
    } finally {
      result.cleanup();
    }
  } catch (err) {
    console.error(LOG, 'ERROR:', err.message, (err.stderr || '').slice(-1500));
    await report({ status: 'error', error: String(err.message || err).slice(0, 300) }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
