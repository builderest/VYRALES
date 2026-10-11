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
  const tail = (part ? ' | ' + part : '') + ' #Shorts';
  return (t.slice(0, 100 - tail.length) + tail).trim();
}

// Título de documental largo (máx. 100, sin #Shorts).
function longTitle(raw) {
  let t = String(raw || '').replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
  if (t && t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase();
  return t.slice(0, 100).trim();
}
const mmss = (x) => { x = Math.max(0, Math.round(x)); const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = x % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0'); };
// Segundo REAL en el video donde empieza cada toma (misma cuenta que el render: voz continua + entrada).
function shotStartTimes(episode, ordered) {
  const voice = (episode.continuity || {}).voice;
  if (!voice) return null;
  const VF = require('./_voice_full');
  const cuts = VF.shotCutsExact(voice, ordered);
  if (!cuts) return null;
  const out = {}; let t = 0;
  for (const s of ordered) { out[s.n] = t; t += Number(cuts[s.n]) || 0; }
  return out;
}
// Capítulos "0:00 Título" (cada uno en su línea; YouTube exige empezar en 0:00, 3+ capítulos de 10+ s).
function chapterLines(out, lineShots, starts, lang) {
  const cs = Array.isArray(out.chapter_starts) ? out.chapter_starts : [];
  const list = [];
  for (const c of cs) {
    const sh = lineShots[Math.max(0, Math.min(lineShots.length - 1, (Number(c.line) || 1) - 1))];
    const t = list.length ? (starts && sh ? starts[sh.n] : null) : 0;
    const title = String((lang === 'en' ? c.title_en : c.title) || c.title || '').trim();
    if (t == null || !title) continue;
    if (list.length && t < list[list.length - 1].t + 10) continue;
    list.push({ t, title });
  }
  return list.length >= 3 ? list.map((x) => mmss(x.t) + ' ' + x.title) : [];
}
function longTexts({ episode, cont, out, tags, lineShots, ordered, lockedTitle, hook }) {
  const starts = shotStartTimes(episode, ordered);
  const en = cont.english || {};
  const strip = (t) => String(t || '').split('\n').filter((l) => !/^\s*(Cap[ií]tulos|Chapters)\s*:/i.test(l) && !/comentario fijado|pinned comment/i.test(l)).join('\n').trim();
  const chES = chapterLines(out, lineShots, starts, 'es');
  const chEN = chapterLines(out, lineShots, starts, 'en');
  const sources = Array.isArray(cont.sources) ? cont.sources.map(String).filter(Boolean) : [];
  const tagLine = tags.slice(0, 6).join(' ');
  const join = (arr) => arr.filter((x, i, a) => x !== '' || (i > 0 && a[i - 1] !== '')).join('\n').trim();
  const descES = strip(cont.summary || cont.youtube_description) || String(out.instagram_caption || '').trim();
  const descEN = strip(en.description) || String(out.youtube_description_en || '').trim();
  return {
    cta_to_long: null,
    cover_text: String(hook || out.cover_text || episode.title || '').toUpperCase().slice(0, 60),
    part: '',
    tiktok: [String(out.tiktok_caption || '').trim(), AI_DISCLOSURE, tags.slice(0, 5).join(' ')].filter(Boolean).join('\n'),
    instagram: join([String(out.instagram_caption || '').trim(), '', AI_DISCLOSURE, '', tags.join(' ')]),
    youtube_title: longTitle(lockedTitle || out.youtube_title || episode.title),
    youtube: join([descES, '', chES.length ? 'Capítulos:' : '', ...chES, '', sources.length ? '📚 Todas las fuentes científicas están en el comentario fijado.' : '', '', AI_DISCLOSURE, '', tagLine]),
    youtube_title_en: longTitle(en.title || out.youtube_title_en || out.youtube_title),
    youtube_en: join([descEN, '', chEN.length ? 'Chapters:' : '', ...chEN, '', sources.length ? '📚 All scientific sources are in the pinned comment.' : '', '', '🤖 AI-made recreation (images and voice) for educational purposes, based on scientific evidence.', '', tagLine]),
    chapters_es: chES, chapters_en: chEN,
    hashtags: tags,
    pinned_comment: sources.length ? ['📚 Fuentes científicas / Scientific sources:', ...sources.map((x, i) => (i + 1) + '. ' + x)].join('\n') : String(out.pinned_comment || '').trim(),
    ai_disclosure: AI_DISCLOSURE,
    landscape: true
  };
}

async function writeTexts({ series, episode, totalEpisodes }) {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('Falta GOOGLE_AI_API_KEY.');
  const cont = episode.continuity || {};
  // Documental LARGO (Franklin, oct-11): sin #Shorts ni "Parte 1/5", capítulos con los tiempos REALES del video,
  // fuentes en el comentario fijado, y título/descripción en inglés (de la pista inglesa).
  const isLong = cont.kind === 'largo';
  const chapters = Array.isArray(cont.chapters) ? cont.chapters.map(String) : [];
  const ordered = (episode.shots || []).slice().sort((a, b) => a.n - b.n);
  const lineShots = ordered.filter((s) => narrationOf([s]).length);
  const lines = lineShots.map((s) => narrationOf([s]).join(' '));
  const hook = String(cont.hook_text || '').trim();
  // Video suelto o Short que lleva al largo: sin "Parte 2/5" ni "próximo episodio" (Franklin, oct-11: el Short del largo salía con "Parte 2/5").
  const single = !(totalEpisodes > 1) || !!(cont.cta_to_long || cont.kind === 'short_cta');
  const lockedTitle = cont.title_locked && episode.title ? String(episode.title).trim() : '';
  const prompt = [
    'Eres editor de redes sociales de un canal de documentales cortos verticales en español (Latinoamérica).',
    'Escribe el paquete de publicación de este episodio para TikTok, Instagram/Facebook Reels y YouTube Shorts.',
    'REGLAS: usa SOLO datos que estén en la narración (no inventes cifras ni hechos); tono intrigante pero científicamente prudente; nada de clickbait falso ni promesas que el video no cumple; español neutro; máximo 2 emojis por texto; no menciones que es IA (eso se agrega aparte).',
    '',
    `Serie: ${series.title || series.slug}`,
    series.synopsis ? `Sinopsis: ${series.synopsis}` : '',
    `Episodio ${episode.episode_number} de ${totalEpisodes}: ${episode.title || ''}`,
    hook ? `TEMA GANCHO del video (lo que más llama la atención): "${hook}". El youtube_title y el cover_text EMPIEZAN con ese tema (p. ej. "La Tercera Guerra Mundial…").` : '',
    lockedTitle ? `Título ya elegido por el creador (úsalo tal cual como youtube_title): "${lockedTitle}"` : '',
    single || isLong ? 'Es un video suelto (no una serie por partes): no hables de "partes" ni de "próximo episodio"; invita a seguir el canal.' : '',
    isLong ? 'Es un DOCUMENTAL LARGO HORIZONTAL de YouTube (no un Short): el youtube_title puede tener hasta 90 caracteres.' : '',
    isLong && chapters.length ? `Capítulos del documental (en orden): ${JSON.stringify(chapters)}. En "chapter_starts" di en qué número de línea de la narración EMPIEZA cada capítulo (el primero en la línea 1) y su título en inglés natural.` : '',
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
    '  "youtube_title_en": "el mismo título de YouTube en inglés natural (no literal), máx. 90 caracteres",',
    '  "youtube_description_en": "la misma descripción en inglés natural de documental (2–4 frases), sin hashtags",',
    '  "pinned_comment": "una pregunta para que la gente comente",',
    '  "next_hook": "una frase para anunciar el próximo episodio"' + (isLong && chapters.length ? ',' : ''),
    isLong && chapters.length ? '  "chapter_starts": [{"title": "capítulo tal cual", "line": 1, "title_en": "..."}]' : '',
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
  if (isLong) return Object.assign({ costUsd }, longTexts({ episode, cont, out, tags, lineShots, ordered, lockedTitle, hook }));
  const part = single ? '' : `Parte ${episode.episode_number}/${totalEpisodes}`;
  // Shorts que llevan al video largo: la llamada a la acción también en los textos (Franklin: "entra al enlace que te dejo aquí abajo").
  const ctaLong = !!(cont.cta_to_long || cont.kind === 'short_cta');
  const CTA = '👇 Si quieres ver la historia completa, entra al enlace que te dejo aquí abajo.';
  return {
    costUsd,
    cta_to_long: ctaLong ? CTA : null,
    cover_text: String(hook || out.cover_text || episode.title || '').toUpperCase().slice(0, 60),
    part,
    tiktok: [String(out.tiktok_caption || '').trim(), ctaLong ? CTA : '', part, AI_DISCLOSURE, tags.slice(0, 5).join(' ')].filter(Boolean).join('\n'),
    instagram: [String(out.instagram_caption || '').trim(), ctaLong ? '\n' + CTA : '', '', single ? '' : part + (out.next_hook ? ' · ' + String(out.next_hook).trim() : ''), '', AI_DISCLOSURE, '', tags.join(' ')].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n'),
    youtube_title: youtubeTitle(lockedTitle || out.youtube_title || out.cover_text || episode.title, part),
    youtube: [String(out.instagram_caption || '').trim(), '', single ? '' : part + (out.next_hook ? ' · ' + String(out.next_hook).trim() : ''), '', AI_DISCLOSURE, '', ['#Shorts'].concat(tags.slice(0, 6)).join(' ')].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n'),
    // Inglés (Franklin, oct-11: títulos y descripciones en los DOS idiomas en YouTube; YouTube muestra el de su idioma).
    youtube_title_en: youtubeTitle(String(out.youtube_title_en || '').trim() || lockedTitle || out.youtube_title || episode.title, single ? '' : `Part ${episode.episode_number}/${totalEpisodes}`),
    youtube_en: [String(out.youtube_description_en || '').trim(), ctaLong ? '\n👇 Want the full story? The link is right below.' : '', '', 'Made with AI.', '', ['#Shorts'].concat(tags.slice(0, 6)).join(' ')].filter((x, i, a) => x !== '' || (a[i - 1] !== '' && i > 0)).join('\n').trim(),
    hashtags: tags,
    pinned_comment: ctaLong ? '👇 La historia completa está aquí: (pega aquí el enlace del video largo)' : String(out.pinned_comment || '').trim(),
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
      // Portada: texto GRANDE y al CENTRO (no arriba), "PARTE N/M" justo encima, todo en un bloque.
      `Style: Big,${FONT_NAME},112,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,8,4,5,40,40,0,1`,
      `Style: Part,${FONT_NAME},58,&H0000E5FF,&H0000E5FF,&H00000000,&H96000000,-1,0,0,0,100,100,2,0,1,6,3,5,40,40,0,1`,
      '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      `Dialogue: 0,0:00:00.00,0:00:05.00,Big,,0,0,0,,{\\an5\\pos(360,610)}${part ? `{\\rPart}${clean(part).toUpperCase()}\\N{\\rBig}` : ''}${clean(coverText)}`
    ].join('\n');
    fs.writeFileSync(path.join(cwd, 'c.ass'), ass);
    await run(['-y', '-i', 'in.jpg', '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,eq=brightness=-0.07,ass=c.ass:fontsdir=fonts', '-frames:v', '1', '-q:v', '3', 'cover.jpg'], cwd);
    return fs.readFileSync(path.join(cwd, 'cover.jpg'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

module.exports = { writeTexts, makeCover, youtubeTitle, AI_DISCLOSURE, TEXT_MODEL };
