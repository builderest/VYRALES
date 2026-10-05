// Prompt editable de una toma (botón "Generar/Regenerar" → modal con el prompt actual).
//
//   GET  ?episode_id=<uuid>&shot=<n>&kind=video|keyframe
//        → { prompt, original, edited }   (prompt = el que se va a usar; original = el automático)
//   POST { episode_id, shot, kind, prompt }     → guarda el prompt editado de esa toma
//   POST { episode_id, shot, kind, reset: true } → vuelve al prompt automático
//
// Lo editado se guarda en episodes.shots[n].prompt_override (video) o
// .keyframe_prompt_override (cuadro inicial), y lo usan Generar toma, Regenerar y Producir.
// No llama a ninguna API de pago.
const { getSupabaseClient } = require('./_supabase');
const { buildShotPrompt } = require('./_series');
const { buildKeyframePrompt } = require('./_keyframe');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const FIELD = { video: 'prompt_override', keyframe: 'keyframe_prompt_override' };

async function load(supabase, episodeId) {
  const { data: episode, error } = await supabase
    .from('episodes')
    .select('id, episode_number, shots, series_id, status, series:series_id(slug, story_bible, visual_memory)')
    .eq('id', episodeId)
    .single();
  if (error || !episode) throw error || new Error('Episodio no encontrado');
  const { data: characters, error: cErr } = await supabase
    .from('characters')
    .select('name, fixed_prompt_tag, profile, reference_image_url')
    .eq('series_id', episode.series_id);
  if (cErr) throw cErr;
  return { episode, characters };
}

function originalPrompt(kind, shot, characters, series) {
  if (kind === 'keyframe') {
    const vm = series.visual_memory || {};
    const hasLoc = !!(vm.locations && vm.locations[shot.location] && vm.locations[shot.location].url);
    return buildKeyframePrompt(shot, characters, series.story_bible, hasLoc);
  }
  return buildShotPrompt(shot, characters, series.story_bible);
}

exports.handler = async (event) => {
  try {
    const supabase = getSupabaseClient();
    const input = event.httpMethod === 'GET' ? event.queryStringParameters || {} : JSON.parse(event.body || '{}');
    const kind = input.kind === 'keyframe' ? 'keyframe' : 'video';
    const n = Number(input.shot);
    if (!input.episode_id || !n) return json(400, { error: 'Faltan episode_id o shot.' });

    const { episode, characters } = await load(supabase, input.episode_id);
    const shots = Array.isArray(episode.shots) ? episode.shots : [];
    const idx = shots.findIndex((s) => s.n === n);
    if (idx === -1) return json(404, { error: `El episodio no tiene la toma ${n}.` });
    const shot = shots[idx];
    const original = originalPrompt(kind, shot, characters, episode.series);

    if (event.httpMethod === 'GET') {
      const edited = !!(shot[FIELD[kind]] && shot[FIELD[kind]].trim());
      return json(200, { prompt: edited ? shot[FIELD[kind]] : original, original, edited });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    if (['generando_media'].includes(episode.status)) {
      return json(409, { error: 'El episodio se está generando ahora mismo. Espera a que termine para editar prompts.' });
    }
    const next = shots.slice();
    if (input.reset) {
      const copy = Object.assign({}, shot);
      delete copy[FIELD[kind]];
      next[idx] = copy;
    } else {
      const prompt = String(input.prompt || '').trim();
      if (prompt.length < 20) return json(400, { error: 'El prompt está vacío o es demasiado corto.' });
      if (prompt.length > 6000) return json(400, { error: 'El prompt es demasiado largo (máx. 6000 caracteres).' });
      next[idx] = Object.assign({}, shot, { [FIELD[kind]]: prompt === original ? undefined : prompt });
      if (prompt === original) delete next[idx][FIELD[kind]];
    }
    const { error } = await supabase.from('episodes').update({ shots: next }).eq('id', episode.id);
    if (error) throw error;
    const edited = !!(next[idx][FIELD[kind]]);
    return json(200, { prompt: edited ? next[idx][FIELD[kind]] : original, original, edited });
  } catch (err) {
    console.error('[shot-prompt] ERROR:', err);
    return json(500, { error: err.message });
  }
};
