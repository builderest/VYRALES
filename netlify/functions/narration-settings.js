// POST /.netlify/functions/narration-settings
//   { series, enabled?, voice?, video_audio?: 'ambient' | 'none', cast?: bool,
//     speaker?, speaker_voice?, reassign?: bool }
// cast = voces fijas para TODOS los personajes (el video va sin audio y se doblan con TTS).
// speaker + speaker_voice = cambiar la voz de un personaje a mano. reassign = volver a asignar
// solas las voces automáticas (las elegidas a mano se respetan).
// Guarda la configuración del narrador con voz fija en series.story_bible.narration.
// No llama a ninguna API de pago (cambiar la voz deja las narraciones viejas marcadas para rehacer).
const { getSupabaseClient } = require('./_supabase');
const { VOICES, TTS_MODEL_DEFAULT, DEFAULT_VOICE } = require('./_tts');
const { assignVoices, seriesSpeakers, speakerInfo, fxFor } = require('./_voices');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const body = JSON.parse(event.body || '{}');
    const supabase = getSupabaseClient();
    const { data: series, error } = await supabase.from('series').select('id, story_bible').eq('slug', body.series || '').single();
    if (error || !series) return json(404, { error: 'Serie no encontrada.' });
    const sb = Object.assign({}, series.story_bible || {});
    const cur = Object.assign({ engine: 'gemini_tts', voice: DEFAULT_VOICE, model: TTS_MODEL_DEFAULT, video_audio: 'ambient' }, sb.narration || {});
    if (body.enabled === false) cur.engine = 'veo';
    if (body.enabled === true) cur.engine = 'gemini_tts';
    if (body.voice != null) {
      if (!VOICES.includes(body.voice)) return json(400, { error: 'Voz no válida: ' + body.voice });
      cur.voice = body.voice;
    }
    if (body.video_audio != null) {
      if (!['ambient', 'none'].includes(body.video_audio)) return json(400, { error: 'video_audio debe ser ambient o none.' });
      cur.video_audio = body.video_audio;
    }
    if (body.cast != null) {
      cur.cast = !!body.cast;
      if (cur.cast) { cur.engine = 'gemini_tts'; cur.video_audio = 'none'; }
    }
    const vc = Object.assign({}, sb.voice_cast || {});
    if (body.speaker && body.speaker_voice != null) {
      if (!VOICES.includes(body.speaker_voice)) return json(400, { error: 'Voz no válida: ' + body.speaker_voice });
      vc[body.speaker] = Object.assign({}, vc[body.speaker] || {}, { voice: body.speaker_voice, auto: false });
    }
    if (body.speaker && body.speaker_fx != null) {
      if (!['', 'none', 'demon', 'divine', 'echo'].includes(body.speaker_fx)) return json(400, { error: 'Efecto no válido.' });
      vc[body.speaker] = Object.assign({}, vc[body.speaker] || {}, { fx: body.speaker_fx === 'none' ? '' : body.speaker_fx, fx_manual: true });
    }
    if (cur.cast && (body.cast || body.reassign || body.speaker)) {
      // Asignación automática (gratis): cada hablante de la serie recibe una voz distinta.
      const [{ data: eps }, { data: chars }] = await Promise.all([
        supabase.from('episodes').select('shots').eq('series_id', series.id),
        supabase.from('characters').select('name, role, fixed_prompt_tag, profile').eq('series_id', series.id)
      ]);
      const speakers = seriesSpeakers({ episodes: eps || [], characters: chars || [], storyBible: sb });
      const keep = {};
      Object.entries(vc).forEach(([k, v]) => { if (v && (!body.reassign || v.auto === false)) keep[k] = v; });
      const assigned = assignVoices(speakers, keep);
      speakers.forEach((x) => { if (!keep[x.key]) vc[x.key] = Object.assign({}, vc[x.key] && vc[x.key].fx_manual ? { fx: vc[x.key].fx, fx_manual: true } : {}, { voice: assigned[x.key], auto: true }); });
      // Efecto automático (demonio / divino) para quien no tenga uno elegido a mano.
      speakers.forEach((x) => { const cur = vc[x.key]; if (cur && !cur.fx_manual && cur.fx == null) cur.fx = fxFor(x.key, x); });
    }
    sb.voice_cast = vc;
    sb.narration = cur;
    const { error: uErr } = await supabase.from('series').update({ story_bible: sb }).eq('id', series.id);
    if (uErr) throw uErr;
    return json(200, { narration: cur, voice_cast: vc });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
