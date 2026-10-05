// Narrador con voz fija: Gemini TTS (misma llave GOOGLE_AI_API_KEY).
// Docs: https://ai.google.dev/gemini-api/docs/speech-generation  (API "interactions")
// Precio (oct-2026, https://ai.google.dev/gemini-api/docs/pricing): audio de salida
// 25 tokens/segundo; 3.8 Flash TTS hasta $18 por 1M tokens de salida → ~$0.004 por frase de 8 s.
const TTS_MODEL_DEFAULT = 'gemini-3.8-flash-tts';
const TTS_PRICE_PER_M = { // USD por 1M tokens (se usa el precio más alto publicado, para no subestimar)
  'gemini-3.8-flash-tts': { input: 1.0, output: 18.0 },
  'gemini-3.8-flash-lite-tts': { input: 1.0, output: 12.0 }
};
const DEFAULT_VOICE = 'Charon';
// Ritmo: con estilo "pausado" las frases de 13 palabras duraban 7.5–8.5 s y no caben en una
// toma de 8 s; se pide que la frase completa dure unos 6 segundos.
const DEFAULT_STYLE = 'Narrador de documental de naturaleza: voz grave, cálida y resonante, cautivadora, con énfasis suave en las palabras clave y un tono de asombro y misterio. Ritmo fluido, sin pausas largas: la frase completa dura unos 6 segundos. Pronuncia cada palabra con total claridad, en especial los números.';
const VOICES = ['Charon', 'Orus', 'Algenib', 'Iapetus', 'Rasalgethi', 'Sadaltager', 'Gacrux', 'Alnilam', 'Schedar', 'Kore'];

function wavSeconds(buf) {
  // RIFF: busca el chunk "fmt " (byteRate en +8) y "data" (tamaño en +4).
  let byteRate = 48000;
  let dataSize = buf.length - 44;
  for (let i = 12; i < buf.length - 8;) {
    const id = buf.toString('ascii', i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(i + 16);
    if (id === 'data') { dataSize = Math.min(size, buf.length - i - 8); break; }
    i += 8 + size + (size % 2);
  }
  return dataSize / byteRate;
}

async function callTts(body) {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('Falta GOOGLE_AI_API_KEY (la usa el narrador TTS).');
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text.slice(0, 400) }; }
  if (!res.ok) {
    const err = new Error(`Gemini TTS respondió HTTP ${res.status}: ${JSON.stringify(json.error || json).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// Devuelve { wav: Buffer, seconds, costUsd, model, voice }.
async function synthesize({ text, voice = DEFAULT_VOICE, style = DEFAULT_STYLE, model = TTS_MODEL_DEFAULT, log = console.log }) {
  const line = String(text || '').trim();
  if (!line) throw new Error('No hay texto para narrar.');
  const body = {
    model,
    input: [{ type: 'user_input', content: [{ type: 'text', text: line, annotations: [{ type: 'speech_metadata', style: style || DEFAULT_STYLE }] }] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice: voice || DEFAULT_VOICE }] }
  };
  let json;
  try {
    json = await callTts(body);
  } catch (err) {
    if (err.status !== 429 && !(err.status >= 500)) throw err;
    log('[tts] reintento en 20 s:', err.message);
    await new Promise((r) => setTimeout(r, 20000));
    json = await callTts(body);
  }
  let data = null;
  for (const step of json.steps || []) for (const c of step.content || []) if (c && c.data) data = c.data;
  if (!data) throw new Error('Gemini TTS no devolvió audio: ' + JSON.stringify(json).slice(0, 300));
  const wav = Buffer.from(data, 'base64');
  if (wav.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Gemini TTS devolvió un formato inesperado (no WAV).');
  const usage = json.usage || {};
  const price = TTS_PRICE_PER_M[model] || TTS_PRICE_PER_M[TTS_MODEL_DEFAULT];
  const costUsd = ((Number(usage.total_input_tokens) || 300) * price.input + (Number(usage.total_output_tokens) || 250) * price.output) / 1e6;
  return { wav, seconds: wavSeconds(wav), costUsd, model, voice: voice || DEFAULT_VOICE };
}

module.exports = { synthesize, wavSeconds, TTS_MODEL_DEFAULT, DEFAULT_VOICE, DEFAULT_STYLE, VOICES, TTS_PRICE_PER_M };
