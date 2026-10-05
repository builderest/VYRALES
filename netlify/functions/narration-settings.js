// POST /.netlify/functions/narration-settings
//   { series, enabled?, voice?, video_audio?: 'ambient' | 'none' }
// Guarda la configuración del narrador con voz fija en series.story_bible.narration.
// No llama a ninguna API de pago (cambiar la voz deja las narraciones viejas marcadas para rehacer).
const { getSupabaseClient } = require('./_supabase');
const { VOICES, TTS_MODEL_DEFAULT, DEFAULT_VOICE } = require('./_tts');

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
    sb.narration = cur;
    const { error: uErr } = await supabase.from('series').update({ story_bible: sb }).eq('id', series.id);
    if (uErr) throw uErr;
    return json(200, { narration: cur });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
