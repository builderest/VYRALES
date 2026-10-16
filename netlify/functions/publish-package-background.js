// POST /.netlify/functions/publish-package-background  { episode_id }
// Arma el paquete de publicación del episodio (textos + portada) y lo guarda en
// episodes.validator_report.publish_package { status, at, cover_url, tiktok, instagram, ... }.
// Costo ~$0.001 (Gemini 3.8 Flash). No publica nada en ninguna red social.
const { getSupabaseClient } = require('./_supabase');
const { writeTexts, makeCover, TEXT_MODEL } = require('./_publish');
const { ensureMediaBucket, uploadFile } = require('./_storage');
const { logSpend } = require('./_spend');

const LOG = '[publish]';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const supabase = getSupabaseClient();
  let epId = null;
  const save = async (patch) => {
    const { data } = await supabase.from('episodes').select('validator_report').eq('id', epId).single();
    const vr = Object.assign({}, (data && data.validator_report) || {});
    vr.publish_package = Object.assign({}, vr.publish_package || {}, patch, { at: new Date().toISOString() });
    await supabase.from('episodes').update({ validator_report: vr }).eq('id', epId);
  };
  try {
    const body = JSON.parse(event.body || '{}');
    epId = body.episode_id;
    const { data: ep, error } = await supabase.from('episodes').select('id, episode_number, title, shots, series_id, continuity, assets(kind, shot_number, storage_path, created_at)').eq('id', epId || '').single();
    if (error || !ep) throw error || new Error('Episodio no encontrado.');
    const { data: series } = await supabase.from('series').select('id, slug, title, synopsis, story_bible').eq('id', ep.series_id).single();
    const { count } = await supabase.from('episodes').select('id', { count: 'exact', head: true }).eq('series_id', ep.series_id);
    await save({ status: 'running', error: null });
    console.log(LOG, `EP${ep.episode_number}: escribiendo textos...`);
    const t = await writeTexts({ series, episode: ep, totalEpisodes: count || 1 });
    await logSpend(supabase, { seriesId: series.id, episodeId: ep.id, kind: 'publish_text', model: TEXT_MODEL, costUsd: t.costUsd });
    const frame = (ep.assets || []).filter((a) => a.kind === 'image' && a.storage_path).sort((a, b) => a.shot_number - b.shot_number)[0];
    let coverUrl = null;
    if (frame) {
      console.log(LOG, 'armando portada con el cuadro de la toma', frame.shot_number, '...');
      const jpg = await makeCover({ imageUrl: frame.storage_path, coverText: t.cover_text, part: t.part });
      await ensureMediaBucket(supabase);
      coverUrl = await uploadFile(supabase, { path: `${series.slug}/ep${ep.episode_number}/cover-v${Date.now()}.jpg`, buffer: jpg, contentType: 'image/jpeg' });
    }
    // Portada con IA (Franklin oct-16: "IA en todos"): si ya existe la de este video final, se usa esa; si no, queda la del
    // cuadro por ahora y la PC hace la de IA (portada_yt) y la reemplaza sola en ~3 min.
    const th = (ep.continuity || {}).thumbnail || {};
    const lastFinal = (ep.assets || []).filter((a) => a.kind === 'final_render').map((a) => a.created_at).sort().pop() || '';
    const thFresh = th.social_url && th.at && new Date(th.at) >= new Date(lastFinal || 0);
    if (thFresh) coverUrl = th.social_url;
    const { costUsd, ...texts } = t;
    await save(Object.assign({ status: 'done', cover_url: coverUrl }, texts));
    if (!thFresh) {
      try {
        const { data: pend } = await supabase.from('agent_jobs').select('id').in('status', ['pending', 'running']).eq('command', 'portada_yt:' + ep.id).limit(1);
        if (!(pend && pend.length)) { await supabase.from('agent_jobs').insert(await require('./_tenant').jobRow(supabase, 'portada_yt:' + ep.id)); console.log(LOG, 'portada con IA en cola (PC)'); }
      } catch (e) { console.log(LOG, 'no pude pedir la portada con IA:', e.message); }
    }
    console.log(LOG, 'paquete listo ✅');
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error(LOG, 'ERROR:', err.message, (err.stderr || '').slice(-500));
    if (epId) await save({ status: 'error', error: String(err.message).slice(0, 300) }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// Claves de la página Cuenta → API (cifradas en Supabase; mandan sobre el .env). Ver _keys.js.
exports.handler = require('./_keys').withKeys(exports.handler);
