// Voces fijas por personaje ("doblaje"): cada personaje/extra que habla recibe UNA voz de
// Gemini TTS, distinta para cada uno, y la conserva en todas las tomas y episodios.
// Se asigna sola (sin pagar nada) comparando la descripción de la voz del personaje
// (profile.voice o extras[x].voice, en inglés) con las etiquetas de cada voz del catálogo.
// Guardado en series.story_bible.voice_cast = { [speaker]: { voice, auto, style? } }.
//
// Catálogo: las 30 voces de Gemini TTS con su descriptor oficial (ai.google.dev, speech
// generation). El género NO lo publica Google: se midió el tono (F0 mediano) de una muestra de
// cada voz con gemini-3.8-flash-tts (oct-2026): ≤142 Hz → 'm', ≥162 Hz → 'f' salvo Fenrir/Achird
// (162-167 Hz, voces masculinas agudas). Gacrux (119 Hz) y Pulcherrima (139 Hz) suenan graves:
// se tratan como masculinas. Igual el dashboard deja escuchar y cambiar cada una.
const CATALOG = {
  Zephyr: { g: 'f', d: 'brillante', t: ['bright', 'young', 'lively'] },
  Puck: { g: 'm', d: 'animada', t: ['upbeat', 'young', 'excited', 'lively'] },
  Charon: { g: 'm', d: 'informativa, grave', t: ['deep', 'calm', 'narrator', 'informative', 'warm'] },
  Kore: { g: 'f', d: 'firme', t: ['firm', 'sharp', 'intense', 'strong'] },
  Fenrir: { g: 'm', d: 'excitable', t: ['excited', 'urgent', 'frightened', 'breathless', 'fast', 'young', 'sharp'] },
  Leda: { g: 'f', d: 'juvenil', t: ['young', 'youthful', 'bright', 'girl'] },
  Orus: { g: 'm', d: 'firme', t: ['firm', 'deep', 'authoritative', 'steady', 'blunt', 'strong'] },
  Aoede: { g: 'f', d: 'ligera', t: ['breezy', 'light', 'friendly'] },
  Callirrhoe: { g: 'f', d: 'relajada', t: ['easy', 'calm', 'gentle'] },
  Autonoe: { g: 'f', d: 'brillante', t: ['bright', 'clear'] },
  Enceladus: { g: 'm', d: 'susurrante', t: ['breathy', 'whisper', 'cold', 'sinister', 'hoarse', 'smooth'] },
  Iapetus: { g: 'm', d: 'clara', t: ['clear', 'calm', 'measured'] },
  Umbriel: { g: 'm', d: 'relajada', t: ['easy', 'calm', 'gentle', 'friendly'] },
  Algieba: { g: 'm', d: 'suave', t: ['smooth', 'cold', 'elegant', 'calm'] },
  Despina: { g: 'f', d: 'suave', t: ['smooth', 'soft', 'elegant'] },
  Erinome: { g: 'f', d: 'clara', t: ['clear', 'measured'] },
  Algenib: { g: 'm', d: 'grave, rasposa', t: ['gravelly', 'raspy', 'hoarse', 'deep', 'weathered', 'old', 'mature', 'grave'] },
  Rasalgethi: { g: 'm', d: 'informativa', t: ['informative', 'measured', 'lecturing', 'mature', 'old', 'thin'] },
  Laomedeia: { g: 'f', d: 'animada', t: ['upbeat', 'young', 'lively', 'excited'] },
  Achernar: { g: 'f', d: 'suave', t: ['soft', 'gentle', 'tender', 'emotional'] },
  Alnilam: { g: 'm', d: 'firme, profunda', t: ['firm', 'deep', 'powerful', 'vast', 'resonant', 'baritone', 'strong'] },
  Schedar: { g: 'm', d: 'pareja', t: ['even', 'mature', 'old', 'steady', 'hoarse', 'low'] },
  Gacrux: { g: 'm', d: 'madura', t: ['mature', 'old', 'elderly', 'warm', 'low'] },
  Pulcherrima: { g: 'm', d: 'directa', t: ['forward', 'sharp', 'intense', 'fast'] },
  Achird: { g: 'm', d: 'amigable', t: ['friendly', 'warm', 'gentle'] },
  Zubenelgenubi: { g: 'm', d: 'casual', t: ['casual', 'fast', 'nasal', 'sharp'] },
  Vindemiatrix: { g: 'f', d: 'gentil', t: ['gentle', 'soft', 'calm', 'warm'] },
  Sadachbia: { g: 'm', d: 'vivaz', t: ['lively', 'young', 'excited'] },
  Sadaltager: { g: 'm', d: 'experta', t: ['knowledgeable', 'mature', 'measured', 'calm', 'narrator'] },
  Sulafat: { g: 'f', d: 'cálida', t: ['warm', 'emotional', 'low', 'mature', 'gentle'] }
};
const ALL_VOICES = Object.keys(CATALOG);

// Palabras de la descripción (inglés o español) → etiquetas del catálogo.
const KEYWORDS = [
  [/deep|grave|vast|resonant|baritone|bass|profund/i, 'deep'],
  [/powerful|mighty|thunder|majestic|poderos/i, 'powerful'],
  [/old|older|elderly|aged|anciano|viej/i, 'old'],
  [/mature|weathered|middle-aged|madur/i, 'mature'],
  [/young|youth|teen|boy|girl|joven/i, 'young'],
  [/breathless|frightened|scared|urgent|panic|asustad/i, 'frightened'],
  [/excited|lively|upbeat|energetic/i, 'excited'],
  [/whisper|breathy|susurr/i, 'whisper'],
  [/cold|sinister|menacing|frí[oa]/i, 'cold'],
  [/smooth|silky|suave/i, 'smooth'],
  [/hoarse|broken|raspy|rough|gravel|ronc/i, 'hoarse'],
  [/warm|cálid/i, 'warm'],
  [/gentle|soft|tender|dulce/i, 'gentle'],
  [/calm|serene|tranquil/i, 'calm'],
  [/emotional|tearful|grief/i, 'emotional'],
  [/sharp|intense|harsh|cortante/i, 'sharp'],
  [/fast|rapid|quick|rápid/i, 'fast'],
  [/nasal/i, 'nasal'],
  [/firm|blunt|steady|stern|authorit|firme/i, 'firm'],
  [/measured|lectur|thin/i, 'measured'],
  [/clear|clara/i, 'clear'],
  [/narrat|storyteller|documentary|narrador/i, 'narrator'],
  [/low\b|grave/i, 'low']
];
const isFemale = (text) => /\b(female|woman|women|girl|mother|wife|she|her)\b|femenin|mujer/i.test(text);

function scoreVoice(name, tags, female) {
  const v = CATALOG[name];
  if ((v.g === 'f') !== female) return -100;
  return tags.reduce((s, t) => s + (v.t.includes(t) ? 2 : 0), 0);
}

// speakers: [{ key, description, role, lines }] → { key: voiceName } (sin repetir voces).
// keep: asignaciones existentes que se respetan (manuales o ya usadas en tomas generadas).
function assignVoices(speakers, keep = {}) {
  const out = {};
  const used = new Set();
  Object.entries(keep).forEach(([k, v]) => { if (v && CATALOG[v.voice || v]) { out[k] = v.voice || v; used.add(out[k]); } });
  const refersTo = (s) => /voice of |voz de /i.test(s.description || '') ? 1 : 0;
  const order = speakers.filter((s) => !out[s.key]).sort((a, b) =>
    (refersTo(a) - refersTo(b)) || (rank(a.role) - rank(b.role)) || ((b.lines || 0) - (a.lines || 0)));
  for (const s of order) {
    const text = String(s.description || '');
    const female = isFemale(text);
    const tags = KEYWORDS.filter(([re]) => re.test(text)).map(([, t]) => t);
    if (/narrat|storyteller|narrador/i.test(s.key + ' ' + text)) tags.push('narrator');
    const ranked = ALL_VOICES
      .map((name) => ({ name, score: scoreVoice(name, tags, female) - (used.has(name) ? 50 : 0) }))
      .sort((a, b) => b.score - a.score);
    // "La voz de Dios desde el torbellino" = mismo personaje que Dios: misma voz.
    const alias = Object.keys(out).find((k) => k !== s.key && new RegExp(`voice of ${k}\\b|voz de ${k}\\b`, 'i').test(text));
    if (alias) { out[s.key] = out[alias]; continue; }
    out[s.key] = ranked[0].name;
    used.add(ranked[0].name);
  }
  return out;
}
function rank(role) {
  return /protagon/i.test(role || '') ? 0 : /narrat/i.test(role || '') ? 1 : /antagon/i.test(role || '') ? 2 : /secund/i.test(role || '') ? 3 : 4;
}

// Todos los que hablan en la serie, con la descripción de su voz.
function seriesSpeakers({ episodes = [], characters = [], storyBible = {} }) {
  const count = {};
  for (const ep of episodes) for (const sh of ep.shots || []) {
    const ds = !sh.dialogue ? [] : Array.isArray(sh.dialogue) ? sh.dialogue : [sh.dialogue];
    ds.forEach((d) => { if (d && d.speaker && d.line) count[d.speaker] = (count[d.speaker] || 0) + 1; });
  }
  return Object.keys(count).map((key) => {
    const info = speakerInfo(key, characters, storyBible);
    return { key, lines: count[key], ...info };
  });
}

function speakerInfo(key, characters = [], storyBible = {}) {
  const ex = storyBible.extras && storyBible.extras[key];
  if (ex) {
    const e = typeof ex === 'string' ? { who: ex } : ex;
    const vo = e.voiceover === true || /off-?screen|voice-?over|narrat|narrador/i.test(e.who || '');
    return { name: key, who: e.who || key, description: `${e.who || ''}. ${e.voice || ''}`.trim(), voiceDesc: e.voice || '', role: vo ? 'narrador' : 'extra', voiceover: vo };
  }
  const row = characters.find((r) => (r.profile && r.profile.key) === key || r.name === key || String(r.name || '').split(' ')[0] === key);
  if (row) {
    const p = row.profile || {};
    return { name: row.name, who: row.fixed_prompt_tag || row.name, description: `${row.fixed_prompt_tag || ''}. ${p.voice || ''}`.trim(), voiceDesc: p.voice || '', role: row.role || '', voiceover: false };
  }
  return { name: key, who: key, description: key, voiceDesc: '', role: '', voiceover: false };
}

// Instrucción de actuación para Gemini TTS de UNA línea.
function actingStyle({ info, shot, override }) {
  if (override) return override;
  const base = info.voiceover
    ? `Narración en off de ${info.who}. Voz: ${info.voiceDesc || 'grave y cálida'}. Tono solemne y cautivador, ritmo fluido.`
    : `Actuación de doblaje para una película animada: este personaje es ${String(info.who).split(',').slice(0, 2).join(',')}. Voz: ${info.voiceDesc || 'natural'}.`;
  const scene = shot && (shot.action_en || shot.scene_es) ? ` Escena: ${String(shot.action_en || shot.scene_es).slice(0, 220)}` : '';
  return `${base}${scene} Habla en español latino neutro, con la emoción de la escena, natural y creíble, sin sobreactuar. Pronuncia cada palabra con claridad. La frase completa dura como máximo 5 segundos y medio.`;
}

// Efecto automático según quién es: demonios → 'demon', Dios/voz divina → 'divine'.
function fxFor(key, info) {
  const t = `${key} ${(info && info.description) || ''}`;
  if (/sat[aá]n|devil|demon|diablo|lucifer|acusador|serpent|serpiente/i.test(t)) return 'demon';
  if (/\bdios\b|\bgod\b|divine|divin|se[ñn]or\b.*trono|whirlwind|torbellino|ángel|angel/i.test(t)) return 'divine';
  return '';
}

// Reparto completo para una serie nueva o reimportada (lo usa import-series): voz distinta
// por hablante + efecto (el que pida el JSON en profile.voice_fx / extras.voice_fx, o el
// automático). Respeta lo elegido a mano en el dashboard (auto === false / fx_manual).
function buildVoiceCast({ episodes = [], characters = [], storyBible = {}, existing = {} }) {
  const speakers = seriesSpeakers({ episodes, characters, storyBible });
  const keep = {};
  Object.entries(existing || {}).forEach(([k, v]) => { if (v && v.auto === false) keep[k] = v; });
  const assigned = assignVoices(speakers, keep);
  const vc = {};
  for (const x of speakers) {
    const old = existing && existing[x.key];
    const explicitFx = explicitFxOf(x.key, characters, storyBible);
    vc[x.key] = {
      voice: keep[x.key] ? keep[x.key].voice : assigned[x.key],
      auto: !keep[x.key],
      fx: old && old.fx_manual ? old.fx : (explicitFx != null ? explicitFx : fxFor(x.key, x)),
      ...(old && old.fx_manual ? { fx_manual: true } : {})
    };
  }
  return vc;
}
function explicitFxOf(key, characters, storyBible) {
  const ex = storyBible.extras && storyBible.extras[key];
  if (ex && typeof ex === 'object' && ex.voice_fx != null) return ex.voice_fx === 'none' ? '' : String(ex.voice_fx);
  const row = characters.find((r) => (r.profile && r.profile.key) === key || r.name === key);
  if (row && row.profile && row.profile.voice_fx != null) return row.profile.voice_fx === 'none' ? '' : String(row.profile.voice_fx);
  return null;
}

module.exports = { buildVoiceCast, fxFor, CATALOG, ALL_VOICES, assignVoices, seriesSpeakers, speakerInfo, actingStyle };
