// POST /.netlify/functions/music-generate-background  { series, prompt?, name? }
// Genera una pista de música de fondo con Lyria 3.5 (~$0.08) y la guarda en la biblioteca de
// la serie (story_bible.music_tracks) para usarla en cualquier episodio desde el editor.
// Estado para el polling del editor: story_bible.music_last_run { status, at, url?, error? }.
const { getSupabaseClient } = require('./_supabase');
const { generateMusic, MUSIC_MODEL } = require('./_music');
const { ensureMediaBucket, uploadFile } = require('./_storage');
const { logSpend } = require('./_spend');

const LOG = '[music]';

async function patchBible(supabase, seriesId, fn) {
  // Relee antes de escribir: story_bible lo tocan también otras funciones.
  const { data } = await supabase.from('series').select('story_bible').eq('id', seriesId).single();
  const sb = Object.assign({}, (data && data.story_bible) || {});
  fn(sb);
  const { error } = await supabase.from('series').update({ story_bible: sb }).eq('id', seriesId);
  if (error) throw error;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const supabase = getSupabaseClient();
  let series = null;
  try {
    const body = JSON.parse(event.body || '{}');
    const { data } = await supabase.from('series').select('id, slug').eq('slug', body.series || '').single();
    series = data;
    if (!series) throw new Error('Serie no encontrada.');
    await patchBible(supabase, series.id, (sb) => { sb.music_last_run = { status: 'running', at: new Date().toISOString() }; });
    console.log(LOG, 'generando música con Lyria 3.5...');
    const r = await generateMusic({ prompt: body.prompt });
    await logSpend(supabase, { seriesId: series.id, kind: 'music', model: MUSIC_MODEL, costUsd: r.costUsd, note: String(body.name || '').slice(0, 80) || null });
    await ensureMediaBucket(supabase);
    const url = await uploadFile(supabase, { path: `${series.slug}/music/track-${Date.now()}.mp3`, buffer: r.buffer, contentType: r.mime });
    const track = { url, name: String(body.name || 'Música IA ' + new Date().toLocaleDateString('es')).slice(0, 80), prompt: String(body.prompt || '').slice(0, 1000), at: new Date().toISOString() };
    await patchBible(supabase, series.id, (sb) => {
      sb.music_tracks = [track].concat(Array.isArray(sb.music_tracks) ? sb.music_tracks : []).slice(0, 30);
      sb.music_last_run = { status: 'done', at: new Date().toISOString(), url };
    });
    console.log(LOG, 'lista ✅', url);
    return { statusCode: 200, body: JSON.stringify({ track }) };
  } catch (err) {
    console.error(LOG, 'ERROR:', err.message);
    if (series) await patchBible(supabase, series.id, (sb) => { sb.music_last_run = { status: 'error', at: new Date().toISOString(), error: String(err.message).slice(0, 300) }; }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
