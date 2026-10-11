// POST { job } → crea en el panel el VIDEO LARGO (serie "<canal> · Historias completas", horizontal 16:9) y sus
// SHORTS verticales (como videos nuevos del canal vertical, cada uno con su llamada a la acción al largo).
// El guion lo escribió Claude en la PC (agente/claude_largo.js → media/guiones/<job>.json). $0.
const { getSupabaseClient } = require('./_supabase');
const { TIPOS } = require('./_guionista');
const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

const fixShots = (shots) => (shots || []).map((s, i) => {
  const line = (s.dialogue || []).map((d) => d.line).join(' ');
  return Object.assign({ location: 'escena', characters: [], sfx: '' }, s, { n: i + 1, scene_es: s.scene_es || s.visual_es || line, location: s.location || 'escena', characters: [] });
});
function seriesJson({ slug, title, synopsis, tipo, sbExtra, narration, ep, aspect }) {
  ep = Object.assign({}, ep, { shots: fixShots(ep.shots) });
  const p = TIPOS[tipo] || TIPOS.historia;
  const words = ep.shots.map((s) => (s.dialogue || []).map((d) => d.line).join(' ')).join(' ').split(/\s+/).filter(Boolean).length;
  const maxLine = Math.max(...ep.shots.map((s) => (s.dialogue || []).map((d) => d.line).join(' ').split(/\s+/).length));
  return {
    format_version: 3, slug, title, genre: tipo, language: 'es', synopsis,
    story_bible: Object.assign({
      format: 'narrado_unico', aspect, tone: p.tono, visual_style: p.visual + (aspect === '16:9' ? ', widescreen 16:9 cinematic framing' : ''),
      narration: narration || { engine: 'gemini_tts', voice: p.voz, model: 'gemini-3.8-flash-tts', video_audio: 'none', style: p.vozEstilo, mode: 'continuous' },
      subtitle_style: 'palabra', image_engine: 'flow',
      extras: { Narrador: { who: 'an off-screen narrator who is never visible on camera', voice: 'a deep, resonant adult male documentary narrator voice in neutral Latin American Spanish', voiceover: true } },
      rules: { keyframes: true, shot_seconds: 8, shots_per_episode: ep.shots.length, max_dialogue_words_per_shot: Math.max(28, maxLine), max_characters_per_shot: 2, max_words_per_episode: Math.max(600, words + 50), shot_model: 'veo_lite', cliffhanger_model: 'veo_lite', reference_images: false },
      locations: { escena: { visual: p.visual, ambient: 'quiet natural ambience' } }
    }, sbExtra || {}),
    characters: [],
    episodes: [Object.assign({ episode_number: 1 }, ep)]
  };
}

exports.handler = async (event) => {
  try {
    const sb = getSupabaseClient();
    const body = JSON.parse(event.body || '{}');
    const job = String(body.job || '').replace(/[^a-z0-9-]/gi, '');
    const { data: u } = sb.storage.from('media').getPublicUrl(`guiones/${job}.json`);
    const r = await fetch(u.publicUrl + '?t=' + Date.now());
    if (!r.ok) return json(404, { error: 'No encontré ese guion largo.' });
    const g = await r.json();
    if (!g.ok || !g.long) return json(400, { error: 'Ese guion largo no está completo.' });
    const tipo = g.tipo || 'historia';
    const p = TIPOS[tipo] || TIPOS.historia;
    // La MISMA voz y estilo del canal vertical (Franklin: "mantener siempre la misma voz del narrador").
    const { data: vert } = await sb.from('series').select('story_bible').eq('slug', p.slug).maybeSingle();
    const narration = vert && vert.story_bible && vert.story_bible.narration ? Object.assign({}, vert.story_bible.narration, { mode: 'continuous' }) : null;
    const { handler: imp } = require('./import-series');
    const doImport = async (data) => { const res = await imp({ httpMethod: 'POST', queryStringParameters: {}, body: JSON.stringify({ series: data }) }); const o = JSON.parse(res.body || '{}'); if (res.statusCode >= 400) throw new Error((o.error || res.statusCode) + (o.errors ? ': ' + o.errors.slice(0, 4).join(' · ') : '')); return o; };
    const L = g.long;
    const longSlug = p.slug + '_completa';
    const longEp = { title: L.title, continuity: { summary: L.description || '', hook_text: L.hook_text || '', sources: L.sources || [], chapters: L.chapters || [], youtube_description: L.description || '', visual_checked: new Date().toISOString(), from_job: job, kind: 'largo' }, shots: L.shots };
    await doImport(seriesJson({ slug: longSlug, title: p.title + ' · Historias completas', synopsis: 'Historias completas (8–15 min) para YouTube: ' + p.nombre + '.', tipo, narration, ep: longEp, aspect: '16:9',
      sbExtra: { end_card: { enabled: true, mode: 'tail', text: 'SUSCRÍBETE', subtext: 'Una historia completa cada semana', voice: '', seconds: 3 } } }));
    const { data: ls } = await sb.from('series').select('id').eq('slug', longSlug).single();
    const { data: le } = await sb.from('episodes').select('id, episode_number').eq('series_id', ls.id).order('episode_number', { ascending: false }).limit(1).single();
    let shorts = 0;
    for (const s of g.shorts || []) {
      const ep = { title: s.title, continuity: { summary: 'Short que lleva al video completo: ' + L.title, hook_text: s.hook_text || '', pinned_comment: s.pinned_comment || '', cta_to_long: { series: longSlug, episode_id: le.id, title: L.title }, visual_checked: new Date().toISOString(), from_job: job, kind: 'short_cta' }, shots: s.shots };
      await doImport(seriesJson({ slug: p.slug, title: p.title, synopsis: 'Videos únicos narrados: ' + p.nombre + '.', tipo, narration, ep, aspect: '9:16' }));
      shorts++;
    }
    return json(200, { ok: true, long_slug: longSlug, long_episode: le.episode_number, shorts, short_slug: p.slug });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
exports._seriesJson = seriesJson;
