// Plan de edición del episodio (editor del dashboard). No cuesta dinero.
//   GET  ?episode_id=<uuid>              → { plan, saved }  (plan resuelto: guardado + tomas nuevas)
//   POST { episode_id, plan }            → guarda el plan en episodes.edit_plan
//   POST { episode_id, reset: true }     → borra el plan (vuelve a todo por defecto)
const { getSupabaseClient } = require('./_supabase');
const { resolvePlan } = require('./_render');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const txt = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').slice(0, max);

// Solo se guardan campos conocidos y con valores en rango (el plan viene del navegador).
function sanitize(plan) {
  const p = plan || {};
  const card = (c) => ({ enabled: !!(c && c.enabled), text: txt(c && c.text, 80), subtext: txt(c && c.subtext, 120), seconds: num(c && c.seconds, 1, 6, 2) });
  return {
    version: 2,
    clips: (Array.isArray(p.clips) ? p.clips : []).slice(0, 60).map((c) => ({
      shot: Math.round(num(c.shot, 1, 999, 1)),
      include: c.include !== false,
      trim_start: num(c.trim_start, 0, 7, 0),
      trim_end: num(c.trim_end, 0, 7, 0),
      volume: num(c.volume, 0, 2, 1),
      speed: num(c.speed, 0.5, 2, 1),
      zoom: c.zoom === true,
      transition: ['cut', 'crossfade', 'fade_black', 'dissolve', 'slide', 'slide_up', 'wipe', 'zoom', 'circle', 'blur', 'flash'].includes(c.transition) ? c.transition : 'cut',
      transition_s: num(c.transition_s, 0.2, 1.5, 0.4),
      subtitle: c.subtitle == null || c.subtitle === '' ? null : txt(c.subtitle, 200),
      overlay: txt(c.overlay, 60)
    })),
    subtitles: {
      enabled: !(p.subtitles && p.subtitles.enabled === false),
      size: num(p.subtitles && p.subtitles.size, 22, 70, 38),
      margin_v: num(p.subtitles && p.subtitles.margin_v, 20, 1150, 180),
      style: p.subtitles && ['classic', 'yellow', 'box'].includes(p.subtitles.style) ? p.subtitles.style : 'classic',
      karaoke: !!(p.subtitles && p.subtitles.karaoke),
      speaker_colors: !!(p.subtitles && p.subtitles.speaker_colors),
      animation: p.subtitles && p.subtitles.animation === 'pop' ? 'pop' : 'none'
    },
    audio: {
      normalize: !(p.audio && p.audio.normalize === false),
      music_url: p.audio && typeof p.audio.music_url === 'string' && /^https:\/\//.test(p.audio.music_url) ? p.audio.music_url : null,
      music_name: txt(p.audio && p.audio.music_name, 120),
      music_volume: num(p.audio && p.audio.music_volume, 0, 1, 0.12),
      duck: !(p.audio && p.audio.duck === false)
    },
    title_card: card(p.title_card),
    end_card: card(p.end_card)
  };
}

exports.handler = async (event) => {
  try {
    const supabase = getSupabaseClient();
    const input = event.httpMethod === 'GET' ? event.queryStringParameters || {} : JSON.parse(event.body || '{}');
    const { data: ep, error } = await supabase.from('episodes').select('id, episode_number, title, shots, edit_plan, series_id').eq('id', input.episode_id || '').single();
    if (error) {
      if (/edit_plan/.test(error.message || '')) return json(500, { error: 'Falta la columna episodes.edit_plan: corre la migración supabase/migrations/005_editor.sql en Supabase.' });
      return json(404, { error: 'Episodio no encontrado.' });
    }
    if (event.httpMethod === 'GET') return json(200, { plan: resolvePlan(ep), saved: !!ep.edit_plan });
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    const plan = input.reset ? null : sanitize(input.plan);
    const { error: upErr } = await supabase.from('episodes').update({ edit_plan: plan }).eq('id', ep.id);
    if (upErr) throw upErr;
    return json(200, { plan: resolvePlan(Object.assign({}, ep, { edit_plan: plan })), saved: !!plan });
  } catch (err) {
    console.error('[edit-plan] ERROR:', err);
    return json(500, { error: err.message });
  }
};
