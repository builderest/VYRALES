// PISTA DE AUDIO EN INGLÉS de un episodio (lo lanza el agente: node agente/voz_ingles.js <episode_id>)
// 1) Claude ($0) traduce cada frase a inglés natural de documental, con duración parecida al español,
//    + título y descripción en inglés.  2) Gemini TTS: UNA sola toma en inglés con la misma voz (~$0.35).
// 3) Whisper alinea el inglés; cada frase se coloca donde empieza su frase en español (y se acelera un poco si no
//    cabe en su toma) → voz inglesa con la MISMA línea de tiempo que la española.
// 4) Se renderiza el episodio con esa voz (mismas tomas, música y letras en español) y se saca SOLO el audio
//    → archivo para subir en YouTube Studio como pista de audio en inglés.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
process.env.VYRALES_LOCAL_RUN = '1';
const F = (n) => require(path.join(ROOT, 'netlify', 'functions', n));
const ffmpeg = require(path.join(ROOT, 'node_modules', 'ffmpeg-static'));
const ff = (args) => new Promise((res, rej) => execFile(ffmpeg, ['-y', '-v', 'error'].concat(args), { maxBuffer: 1 << 26 }, (e, so, se) => (e ? rej(new Error(String(se || e.message).slice(-400))) : res())));
const { runClaude, parseJson } = require('./_claude');
const lineOf = (x) => String(x.voice_part || (Array.isArray(x.dialogue) ? x.dialogue : x.dialogue ? [x.dialogue] : []).map((d) => d && d.line).filter(Boolean).join(' ')).trim();
const wc = (t) => String(t).split(/\s+/).filter(Boolean).length;

(async () => {
  const epId = process.argv[2];
  const sb = F('_supabase').getSupabaseClient();
  const { data: ep } = await sb.from('episodes').select('*, assets(*)').eq('id', epId).single();
  const { data: series } = await sb.from('series').select('*').eq('id', ep.series_id).single();
  const voice = ep.continuity && ep.continuity.voice;
  if (!voice || !voice.url || !Array.isArray(voice.words)) throw new Error('El episodio no tiene voz continua con tiempos por palabra.');
  const shots = (ep.shots || []).slice().sort((a, b) => a.n - b.n).filter((s) => lineOf(s));
  // Ventana de cada frase en la voz española (por conteo de palabras, como se alineó).
  let wi = 0; const W = voice.words;
  const es = shots.map((s) => { const n = wc(lineOf(s)); const a = W[wi], b = W[Math.min(W.length - 1, wi + n - 1)]; wi += n; return { n: s.n, es: lineOf(s), start: a ? a.start : 0, end: b ? b.end : 0 }; });
  es.forEach((x, i) => { x.slot = (i + 1 < es.length ? es[i + 1].start : voice.seconds) - x.start; });

  // Si ya hay voz inglesa para este mismo guion (p. ej. solo cambió la voz española), se REUSA la traducción y el
  // audio inglés ($0) y solo se vuelve a colocar cada frase en su nuevo lugar. "voz_ingles:<ep>:nueva" fuerza todo de nuevo.
  const prevEn = ep.continuity && ep.continuity.english;
  const reuse = process.argv[3] !== 'nueva' && prevEn && prevEn.voice_url && Array.isArray(prevEn.lines) && prevEn.lines.length === es.length && es.every((x, i) => Number(prevEn.lines[i].n) === x.n && (!prevEn.lines[i].es || prevEn.lines[i].es === x.es));
  let tr, lines, r;
  const cfg = (series.story_bible && series.story_bible.narration) || {};
  if (reuse) {
    console.log('Reuso la traducción y la voz inglesa ya hechas ($0); solo las vuelvo a colocar sobre la voz española nueva.');
    tr = { title_en: prevEn.title || '', description_en: prevEn.description || '' };
    const enBy0 = Object.fromEntries(prevEn.lines.map((l) => [Number(l.n), String(l.en || '').trim()]));
    lines = es.map((x) => Object.assign(x, { en: enBy0[x.n] || '' }));
    const wav0 = Buffer.from(await (await fetch(prevEn.raw_url || prevEn.voice_url)).arrayBuffer()); // raw_url = la toma inglesa original (voice_url ya viene colocada)
    r = { wav: wav0, seconds: F('_tts').wavSeconds(wav0), costUsd: 0 };
  } else {
  // 1) Traducción
  console.log(`Traduciendo ${es.length} frases al inglés con Claude ($0)...`);
  const prompt = `Translate this Spanish documentary narration into natural, human, engaging English, as a professional English-speaking documentary narrator would say it (not word for word, no robotic phrasing).
Each line must keep its meaning AND fit roughly the same speaking time as the Spanish: use at most the max_words given for that line (English is spoken at ~2.6 words per second).
Keep proper names. The final call to action must be exactly: "If you want more stories like this, told in full, subscribe to the channel."
Also write an English YouTube title (max 90 characters, same hook as the Spanish) and an English description (2–3 short paragraphs).
Spanish title: ${ep.title || ''}
Lines (JSON): ${JSON.stringify(es.map((x) => ({ n: x.n, es: x.es, max_words: Math.max(3, Math.floor(x.slot * 2.6)) })))}
Reply ONLY with JSON: {"title_en":"...","description_en":"...","lines":[{"n":1,"en":"..."}]}`;
  tr = parseJson(await runClaude(prompt, { timeoutMin: 20, log: console.log }));
  const enBy = Object.fromEntries((tr.lines || []).map((l) => [Number(l.n), String(l.en || '').trim()]));
  lines = es.map((x) => Object.assign(x, { en: enBy[x.n] || '' }));
  if (lines.some((x) => !x.en)) throw new Error('Faltan traducciones en ' + lines.filter((x) => !x.en).map((x) => x.n).join(','));

  // 2) Voz inglesa en una sola toma
  const enText0 = lines.map((x) => x.en).join(' ');
  console.log(`Voz en inglés: ${wc(enText)} palabras en UNA toma (voz ${cfg.voice})...`);
  const { synthesize } = F('_tts');
  r = await synthesize({ text: enText0, voice: cfg.voice, style: 'Speak in natural American English, warm, calm and captivating, like a premium documentary narrator; steady pace.', model: cfg.model, log: console.log });
  await F('_spend').logSpend(sb, { seriesId: series.id, episodeId: ep.id, shotNumber: 0, kind: 'narration', model: 'tts_' + r.model, costUsd: r.costUsd, note: 'voz en inglés (una toma)' });
  console.log(`  listo: ${Math.round(r.seconds)} s · $${r.costUsd.toFixed(3)}`);
  }
  const enText = lines.map((x) => x.en).join(' ');

  // 3) Alinear y colocar cada frase en su lugar del español
  const words = await F('_align').alignWords(r.wav, enText, console.log, 'english');
  if (!words) throw new Error('No pude alinear la voz en inglés.');
  const { parseWav, buildWav } = F('_voice_patch');
  const src = parseWav(r.wav); const sr = src.sr;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-en-'));
  const out = new Int16Array(Math.ceil(voice.seconds * sr) + sr);
  let k = 0, stretched = 0, tooLong = [];
  for (const [i, x] of lines.entries()) {
    const n = wc(x.en); const a = words[k], b = words[Math.min(words.length - 1, k + n - 1)]; k += n;
    const nextStart = i + 1 < lines.length ? words[Math.min(words.length - 1, k)].start : r.seconds;
    const s0 = Math.max(0, a.start - 0.05), s1 = Math.min(r.seconds, Math.max(b.end + 0.12, Math.min(nextStart, b.end + 0.3)));
    let seg = src.pcm.subarray(Math.floor(s0 * sr), Math.floor(s1 * sr));
    const dur = seg.length / sr, room = Math.max(0.5, x.slot - 0.08);
    if (dur > room) {
      const tempo = Math.min(1.3, dur / room);
      const fi = path.join(tmp, `i${i}.wav`), fo = path.join(tmp, `o${i}.wav`);
      fs.writeFileSync(fi, buildWav(sr, seg));
      await ff(['-i', fi, '-filter:a', `atempo=${tempo.toFixed(3)}`, '-ar', String(sr), '-ac', '1', fo]);
      seg = parseWav(fs.readFileSync(fo)).pcm; stretched++;
      if (seg.length / sr > room + 0.05) tooLong.push(x.n);
    }
    const at = Math.floor(x.start * sr);
    const maxLen = Math.min(seg.length, Math.floor((x.start + x.slot) * sr) - at);
    out.set(seg.subarray(0, Math.max(0, maxLen)), at);
  }
  const enWav = buildWav(sr, out.subarray(0, Math.ceil(voice.seconds * sr)));
  console.log(`Sincronizada: ${stretched} frase(s) aceleradas un poco${tooLong.length ? '; recortadas por no caber: tomas ' + tooLong.join(',') : ''}`);
  const keyV = `${series.slug}/ep${ep.episode_number}/voz-en-v${Date.now()}.wav`;
  const urlV = await F('_storage').uploadFile(sb, { path: keyV, buffer: enWav, contentType: 'audio/wav' });

  // 4) Render con la voz inglesa y extraer solo el audio
  console.log('Renderizando el audio final en inglés (mismas tomas y música)...');
  const epEn = JSON.parse(JSON.stringify(ep)); epEn.continuity.voice = Object.assign({}, voice, { url: urlV });
  const res = await F('_render').renderEpisode({ episode: epEn, series, log: console.log, maxMb: Infinity });
  const audioOut = path.join(tmp, 'audio-en.m4a');
  await ff(['-i', res.file, '-vn', '-c:a', 'aac', '-b:a', '160k', audioOut]);
  try { res.cleanup && res.cleanup(); } catch (_) {}
  const keyA = `${series.slug}/ep${ep.episode_number}/audio-en-v${Date.now()}.m4a`;
  const urlA = await F('_storage').uploadFile(sb, { path: keyA, buffer: fs.readFileSync(audioOut), contentType: 'audio/mp4' });
  const { data: fr } = await sb.from('episodes').select('continuity').eq('id', ep.id).single();
  await sb.from('episodes').update({ continuity: Object.assign({}, fr.continuity, { english: { raw_url: (reuse ? (prevEn.raw_url || null) : await F('_storage').uploadFile(sb, { path: keyV.replace(/\.wav$/, '-toma.wav'), buffer: r.wav, contentType: 'audio/wav' })), voice_url: urlV, audio_url: urlA, title: tr.title_en || '', description: tr.description_en || '', lines: lines.map((x) => ({ n: x.n, es: x.es, en: x.en })), at: new Date().toISOString() } }) }).eq('id', ep.id);
  console.log('LISTO. Pista de audio en inglés:', urlA);
  console.log('Título EN:', tr.title_en);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
