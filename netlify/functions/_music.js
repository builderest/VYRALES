// Música de fondo con IA: Google Lyria 3.5 (misma GOOGLE_AI_API_KEY, API "interactions").
// Docs: https://ai.google.dev/gemini-api/docs/music-generation
// Precio: ~$0.08 por pista completa (un par de minutos). Google no reclama la propiedad del
// contenido generado (términos de la Gemini API). Lleva marca de agua SynthID inaudible.
// Prueba real (5 oct): 1:58 min, MP3 44.1 kHz, sin voces, ~32 s en generarse.
const MUSIC_MODEL = 'lyria-3.5';
const MUSIC_PRICE_USD = 0.08;
const INSTRUMENTAL = 'Instrumental only, no vocals, no singing, no choir words, no spoken words.';
const UNDER_NARRATION = 'It sits under a narrator voice: steady and unobtrusive, no sudden loud hits.';
const DEFAULT_MUSIC_PROMPT = 'A 3-minute cinematic natural-history documentary underscore: deep warm cello and low strings, soft taiko-style drums pulsing slowly, airy ethnic flute, gentle piano motifs, a sense of ancient mystery, wonder and discovery, tension that rises gradually and resolves softly at the end. 70 BPM.';

async function generateMusic({ prompt }) {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('Falta GOOGLE_AI_API_KEY (la usa la música con IA).');
  const text = `${INSTRUMENTAL} ${String(prompt || DEFAULT_MUSIC_PROMPT).trim()} ${UNDER_NARRATION}`;
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MUSIC_MODEL, input: text })
  });
  const raw = await res.text();
  let json = null;
  try { json = JSON.parse(raw); } catch (_) { json = { raw: raw.slice(0, 300) }; }
  if (!res.ok) throw new Error(`Lyria respondió HTTP ${res.status}: ${JSON.stringify(json.error || json).slice(0, 300)}`);
  let data = null;
  let mime = 'audio/mpeg';
  for (const step of json.steps || []) for (const c of step.content || []) if (c && c.data) { data = c.data; mime = c.mime_type || mime; }
  if (!data) throw new Error('Lyria no devolvió audio: ' + JSON.stringify(json).slice(0, 300));
  return { buffer: Buffer.from(data, 'base64'), mime, costUsd: MUSIC_PRICE_USD, prompt: text };
}

module.exports = { generateMusic, MUSIC_MODEL, MUSIC_PRICE_USD, DEFAULT_MUSIC_PROMPT };
