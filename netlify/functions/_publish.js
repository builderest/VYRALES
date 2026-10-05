// Paquete de publicación de un episodio (TikTok + Instagram Reels):
//   textos (gancho de portada, descripciones, hashtags, comentario fijado) con Gemini 3.8 Flash
//   (~$0.001) + portada 720x1280 (cuadro de la toma 1 + texto grande) con ffmpeg ($0).
// Reglas que se aplican SIEMPRE (no dependen del modelo):
//   - Aviso de contenido hecho con IA en cada descripción (TikTok/Meta exigen etiquetar el
//     contenido realista generado con IA; además hay que activar la etiqueta en la app).
//   - Nada de datos inventados: el modelo solo puede usar lo que dice el guion.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { findFont, FONT_FILE, FONT_NAME } = require('./_render');

const TEXT_MODEL = 'gemini-3.8-flash';
const TEXT_PRICE = { input: 0.75, output: 3.75 }; // USD por 1M tokens (oct-2026)
const AI_DISCLOSURE = '🤖 Recreación hecha con IA (imágenes y voz) con fines educativos, basada en evidencia científica.';

function narrationOf(shots) {
  return (shots || []).map((s) => (Array.isArray(s.dialogue) ? s.dialogue : (s.dialogue ? [s.dialogue] : [])).map((d) => d.line).join(' ')).filter(Boolean);
}

// Título de YouTube (máx. 100): "Título | Parte 1/3 #Shorts". Si viene en MAYÚSCULAS, pasa a tipo oración.
function youtubeTitle(raw, part) {
  let t = String(raw || '').replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
  if (t && t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase();
  const tail = ' | ' + part + ' #Shorts';
  return (t.slice(0, 100 - tail.length) + tail).trim();
}

async function writeTexts({ series, episode, totalEpisodes }) {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('Falta GOOGLE_AI_API_KEY.');
  const lines = narrationOf(episode.shots);
  const prompt = [
    'Eres editor de redes sociales de un canal de documentales cortos verticales en español (Latinoamérica).',
    'Escribe el paquete de publicación de este episodio para TikTok, Instagram/Facebook Reels y YouTube Shorts.',
    'REGLAS: usa SOLO datos que estén en la narración (no inventes cifras ni hechos); tono intrigante pero científicamente prudente; nada de clickbait falso ni promesas que el video no cumple; español neutro; máximo 2 emojis por texto; no menciones que es IA (eso se agrega aparte).',
    '',
    `Serie: ${series.title || series.slug}`,
    series.synopsis ? `Sinopsis: ${series.synopsis}` : '',
    `Episodio ${episode.episode_number} de ${totalEpisodes}: ${episode.title || ''}`,
    'Narración completa del episodio:',
    ...lines.map((l, i) => `${i + 1}. ${l}`),
    '',
    'Devuelve SOLO este JSON:',
    '{',
    '  "cover_text": "texto de portada, máx. 6 palabras, en MAYÚSCULAS, que genere curiosidad",',
    '  "tiktok_caption": "máx. 150 caracteres: gancho + pregunta corta (sin hashtags)",',
    '  "instagram_caption": "3 a 5 líneas: gancho, contexto breve, invitación a seguir la serie (sin hashtags)",',
    '  "youtube_title": "título para YouTube Shorts, máx. 70 caracteres, claro e intrigante, sin hashtags ni emojis",',
    '  "hashtags": ["5 a 8 hashtags relevantes en español e inglés, sin #"],',
    '  "pinned_comment": "una pregunta para que la gente comente",',
    '  "next_hook": "una frase para anunciar el próximo episodio"',
    '}'
  ].filter(Boolean).join('\n');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.8 } })
  });
  const j = await res.json();
  if (!res.ok) throw new Error('Gemini (textos) HTTP ' + res.status + ': ' + JSON.stringify(j.error || j).slice(0, 200));
  const text = j.candidates && j.candidates[0] && j.candidates[0].content.parts.map((p) => p.text || '').join('');
  let out;
  try { out = JSON.parse(text); } catch (_) { throw new Error('Gemini no devolvió JSON válido: ' + String(text).slice(0, 200)); }
  const u = j.usageMetadata || {};
  const costUsd = ((u.promptTokenCount || 1500) * TEXT_PRICE.input + ((u.candidatesTokenCount || 500) + (u.thoughtsTokenCount || 0)) * TEXT_PRICE.output) / 1e6;
  const tags = (Array.isArray(out.hashtags) ? out.hashtags : []).map((t) => '#' + String(t).replace(/^#/, '').replace(/\s+/g, '')).filter((t) => t.length > 1).slice(0, 8);
  const part = `Parte ${episode.episode_number}/${totalEpisodes}`;
  return {
    costUsd,
    cover_text: String(out.cover_text || episode.title || '').toUpperCase().slice(0, 60),
    part,
    tiktok: [String(out.tiktok_caption || '').trim(), part, AI_DISCLOSURE, tags.slice(0, 5).join(' ')].filter(Boolean).join('\n'),
    instagram: [String(out.instagram_caption || '').trim(), '', part + (out.next_hook ? ' · ' + String(out.next_hook).trim() : ''), '', AI_DISCLOSURE, '', tags.join(' ')].join('\n'),
    youtube_title: youtubeTitle(out.youtube_title || out.cover_text || episode.title, part),
    youtube: [String(out.instagram_caption || '').trim(), '', part + (out.next_hook ? ' · ' + String(out.next_hook).trim() : ''), '', AI_DISCLOSURE, '', ['#Shorts'].concat(tags.slice(0, 6)).join(' ')].join('\n'),
    hashtags: tags,
    pinned_comment: String(out.pinned_comment || '').trim(),
    ai_disclosure: AI_DISCLOSURE
  };
}

function run(args, cwd) {
  return new Promise((resolve, reject) => execFile(ffmpegPath, args, { cwd, maxBuffer: 1024 * 1024 * 20 }, (err, so, se) => (err ? reject(Object.assign(err, { stderr: se })) : resolve())));
}

// Portada: cuadro de la toma 1 + texto grande arriba (la parte de abajo la tapan los botones de la app).
async function makeCover({ imageUrl, coverText, part }) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vyrales-cover-'));
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error('No se pudo bajar el cuadro para la portada (HTTP ' + res.status + ')');
    fs.writeFileSync(path.join(cwd, 'in.jpg'), Buffer.from(await res.arrayBuffer()));
    fs.mkdirSync(path.join(cwd, 'fonts'));
    fs.copyFileSync(findFont(), path.join(cwd, 'fonts', FONT_FILE));
    const clean = (t) => String(t || '').replace(/[{}\\]/g, '').trim();
    const ass = [
      '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 720', 'PlayResY: 1280', '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: Big,${FONT_NAME},78,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,6,3,8,50,50,190,1`,
      `Style: Part,${FONT_NAME},40,&H0000E5FF,&H0000E5FF,&H00000000,&H96000000,-1,0,0,0,100,100,2,0,1,4,2,8,50,50,120,1`,
      '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      `Dialogue: 0,0:00:00.00,0:00:05.00,Part,,0,0,0,,${clean(part).toUpperCase()}`,
      `Dialogue: 0,0:00:00.00,0:00:05.00,Big,,0,0,0,,${clean(coverText)}`
    ].join('\n');
    fs.writeFileSync(path.join(cwd, 'c.ass'), ass);
    await run(['-y', '-i', 'in.jpg', '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,eq=brightness=-0.04,ass=c.ass:fontsdir=fonts', '-frames:v', '1', '-q:v', '3', 'cover.jpg'], cwd);
    return fs.readFileSync(path.join(cwd, 'cover.jpg'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

module.exports = { writeTexts, makeCover, youtubeTitle, AI_DISCLOSURE, TEXT_MODEL };
