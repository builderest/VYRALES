// Subtítulos CC para YouTube (documental largo): pistas ES/EN que YouTube muestra según el idioma del espectador.
// Los tiempos salen de la alineación por palabra (Whisper local) + LEAD (la voz empieza a los 0.6 s del video).
const { LEAD } = require('./_voice_full');
const ts = (x) => { x = Math.max(0, x); const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = Math.floor(x % 60), ms = Math.round((x - Math.floor(x)) * 1000); const p = (n, k = 2) => String(n).padStart(k, '0'); return `${p(h)}:${p(m)}:${p(s)},${p(Math.min(999, ms), 3)}`; };
// Agrupa palabras en bloques de máx. 2 líneas de ~42 caracteres (estándar de subtítulos), cortando en puntuación.
function buildSrt(words, { lead = LEAD, maxChars = 84, maxSec = 6 } = {}) {
  const ws = (words || []).filter((w) => w && w.word != null && Number.isFinite(Number(w.start)));
  const blocks = []; let cur = [];
  const flush = () => { if (cur.length) blocks.push(cur); cur = []; };
  for (const w of ws) {
    const txt = cur.map((x) => x.word).concat(w.word).join(' ');
    if (cur.length && (txt.length > maxChars || Number(w.end) - Number(cur[0].start) > maxSec)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(String(w.word)) || (/[,;:]$/.test(String(w.word)) && cur.map((x) => x.word).join(' ').length > 45)) flush();
  }
  flush();
  const wrap = (t) => { if (t.length <= 42) return t; const mid = t.length / 2; let best = -1; for (let i = 0; i < t.length; i++) if (t[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i; return best > 0 ? t.slice(0, best) + '\n' + t.slice(best + 1) : t; };
  return blocks.map((b, i) => {
    const st = lead + Number(b[0].start);
    const nextSt = i + 1 < blocks.length ? lead + Number(blocks[i + 1][0].start) : Infinity;
    const en = Math.min(nextSt - 0.04, lead + Number(b[b.length - 1].end) + 0.6);
    return `${i + 1}\n${ts(st)} --> ${ts(Math.max(st + 0.5, en))}\n${wrap(b.map((x) => x.word).join(' '))}\n`;
  }).join('\n');
}
// oct-14 (Franklin: "los subtítulos de YouTube se pueden poner con colores" → sí, para los LARGOS): formato YTT/SRV3
// de YouTube (colores, contorno, fuente, posición). Mismos bloques y tiempos que el SRT; letra blanca en negrita con
// contorno negro, sin caja. Franklin (oct-14): "están blancas, ponle colores más llamativos" → texto AMARILLO y
// números/nombres propios en MORADO-ROSA (como su referencia).
// oct-14 (Franklin: "¿se puede que vayan apareciendo cuando va hablando, en YouTube?" → sí): con tiempos por palabra,
// cada bloque se escribe palabra por palabra (una entrada YTT por palabra con el texto acumulado hasta esa palabra).
// Las pistas traducidas no tienen tiempo por palabra → salen por bloque (yttFromSrt).
function buildYtt(words, opts = {}) {
  const lead = opts.lead != null ? opts.lead : LEAD;
  const srt = buildSrt(words, opts);
  const ws = (words || []).filter((w) => w && w.word != null && Number.isFinite(Number(w.start)));
  const toMs = (x) => { const m = /(\d+):(\d+):(\d+),(\d+)/.exec(x); return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4]; };
  let wi = 0; const ps = [];
  for (const b of srt.trim().split(/\n\n+/)) {
    const L = b.split('\n'); const [a, z] = L[1].split(' --> '); const st = toMs(a), en = toMs(z);
    const toks = []; L.slice(2).forEach((line, li) => line.split(' ').forEach((w, k) => toks.push({ w, nl: li > 0 && k === 0 })));
    const all = toks.map((x) => x.w);
    const starts = toks.map((_, k) => { const w = ws[wi + k]; return w ? Math.round((lead + Number(w.start)) * 1000) : st; });
    wi += toks.length;
    for (let k = 0; k < toks.length; k++) {
      const t0 = Math.max(st, k === 0 ? st : starts[k]);
      const t1 = k + 1 < toks.length ? Math.max(t0 + 60, Math.min(en, starts[k + 1])) : en;
      if (t1 <= t0) continue;
      ps.push(pYtt(t0, t1 - t0, toks.slice(0, k + 1), all));
    }
  }
  return yttDoc(ps);
}
const yttEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const yttDestaca = (w, i, arr) => /\d/.test(w) || (i > 0 && /^[A-ZÁÉÍÓÚÑ][\wáéíóúñ'’-]{2,}/.test(w) && !/[.!?…]$/.test(arr[i - 1] || ''));
function pYtt(t, d, toks, all) {
  const segs = [];
  toks.forEach((x, i) => { const pen = yttDestaca(x.w, i, all) ? 2 : 1; const txt = (x.nl ? '\n' : (i > 0 ? ' ' : '')) + x.w; if (segs.length && segs[segs.length - 1].pen === pen) segs[segs.length - 1].txt += txt; else segs.push({ pen, txt }); });
  return `<p t="${t}" d="${d}" wp="1" ws="1">` + segs.map((s) => `<s p="${s.pen}">${yttEsc(s.txt)}</s>`).join('') + '</p>';
}
function yttDoc(ps) {
  return '<?xml version="1.0" encoding="utf-8"?>\n<timedtext format="3">\n<head>\n' +
    '<pen id="1" b="1" fc="#FFE14D" fo="254" bo="0" et="3" ec="#000000" fs="4" sz="115"/>\n' +
    '<pen id="2" b="1" fc="#E040FB" fo="254" bo="0" et="3" ec="#000000" fs="4" sz="115"/>\n' +
    '<wp id="1" ap="7" ah="50" av="96"/>\n<ws id="1" ju="2"/>\n</head>\n<body>\n' + ps.join('\n') + '\n</body>\n</timedtext>\n';
}
function yttFromSrt(srt) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toMs = (x) => { const m = /(\d+):(\d+):(\d+),(\d+)/.exec(x); return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4]; };
  const destaca = (w, i, arr) => /\d/.test(w) || (i > 0 && /^[A-ZÁÉÍÓÚÑ][\wáéíóúñ'’-]{2,}/.test(w) && !/[.!?…]$/.test(arr[i - 1] || ''));
  const ps = srt.trim().split(/\n\n+/).map((b) => {
    const L = b.split('\n'); const [a, z] = L[1].split(' --> ');
    const st = toMs(a), d = Math.max(300, toMs(z) - st);
    const segs = []; let i = 0;
    L.slice(2).forEach((line, li) => {
      const ws = line.split(' ');
      ws.forEach((w, k) => { const all = L.slice(2).join(' ').split(' '); const pen = destaca(w, i, all) ? 1 : 0; i++; const txt = (li > 0 && k === 0 ? '\n' : (k > 0 ? ' ' : '')) + w; if (segs.length && segs[segs.length - 1].pen === pen) segs[segs.length - 1].txt += txt; else segs.push({ pen, txt }); });
    });
    return `<p t="${st}" d="${d}" wp="1" ws="1">` + segs.map((s) => `<s p="${s.pen + 1}">${esc(s.txt)}</s>`).join('') + '</p>';
  });
  return '<?xml version="1.0" encoding="utf-8"?>\n<timedtext format="3">\n<head>\n' +
    '<pen id="1" b="1" fc="#FFE14D" fo="254" bo="0" et="3" ec="#000000" fs="4" sz="115"/>\n' +
    '<pen id="2" b="1" fc="#E040FB" fo="254" bo="0" et="3" ec="#000000" fs="4" sz="115"/>\n' +
    '<wp id="1" ap="7" ah="50" av="96"/>\n<ws id="1" ju="2"/>\n</head>\n<body>\n' + ps.join('\n') + '\n</body>\n</timedtext>\n';
}
// oct-14 (Franklin: "los que son en inglés también traen la traducción al español, ¿verdad?" → antes NO): la pista del
// OTRO idioma se traduce bloque por bloque con los MISMOS tiempos. Si el video tiene voz inglesa alineada, el inglés sale
// de esa voz (como antes). Claude en la PC ($0); fuera de la PC no se traduce (no se paga).
async function translateSrt(srt, from, to, log = console.log) {
  const blocks = srt.trim().split(/\n\n+/).map((b) => b.split('\n'));
  const texts = blocks.map((L) => L.slice(2).join(' '));
  let C = null; try { C = require(require('path').join(__dirname, '..', '..', 'agente', '_claude.js')); } catch (_) {}
  if (!C || !process.env.VYRALES_LOCAL_RUN) { log('subtítulos: la traducción ' + from + '→' + to + ' se hace en la PC (Claude, $0); aquí se omite.'); return null; }
  const name = { es: 'Spanish (neutral Latin American)', en: 'natural American English' };
  const out = [];
  for (let i = 0; i < texts.length; i += 80) {
    const part = texts.slice(i, i + 80);
    const prompt = `Translate these ${part.length} documentary subtitle lines from ${name[from] || from} into ${name[to] || to}. They are consecutive pieces of ONE narration: keep the meaning and flow, natural and human (not word for word), each line about as short as the original so it can be read in the same time. Keep numbers and names. Return ONLY JSON: {"lines":["...", ...]} with exactly ${part.length} strings, same order.\n\n` + JSON.stringify(part);
    const j = C.parseJson(await C.runClaude(prompt, { timeoutMin: 8, memory: false }));
    if (!j || !Array.isArray(j.lines) || j.lines.length !== part.length) throw new Error('la traducción no devolvió ' + part.length + ' líneas');
    out.push(...j.lines);
  }
  const wrap = (s) => { s = String(s).replace(/\s+/g, ' ').trim(); if (s.length <= 42) return s; const mid = s.length / 2; let best = -1; for (let i = 0; i < s.length; i++) if (s[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i; return best > 0 ? s.slice(0, best) + '\n' + s.slice(best + 1) : s; };
  log('subtítulos: traducidos ' + from + '→' + to + ' (' + out.length + ' bloques, Claude $0)');
  return blocks.map((L, k) => `${L[0]}\n${L[1]}\n${wrap(out[k])}\n`).join('\n');
}
// Sube (o reemplaza) una pista de subtítulos en un video de YouTube. Necesita el permiso youtube.force-ssl.
async function youtubeCaption(supabase, { videoId, language, name, srt, log = console.log }) {
  const SOC = require('./_social');
  return SOC.withYoutubeFallback(supabase, log, async (platform) => {
    const token = await SOC.youtubeAccessToken(supabase, platform);
    const H = { Authorization: `Bearer ${token}` };
    // Si ya hay una pista nuestra en ese idioma, se reemplaza (no se duplican).
    const list = await (await fetch(`https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}`, { headers: H })).json();
    const prev = (list.items || []).find((c) => c.snippet && c.snippet.language === language && c.snippet.trackKind !== 'asr');
    const meta = prev ? { id: prev.id, snippet: { isDraft: false } } : { snippet: { videoId, language, name, isDraft: false } };
    const boundary = 'vyrales' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from(srt, 'utf8'), Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart`, { method: prev ? 'PUT' : 'POST', headers: Object.assign({ 'Content-Type': `multipart/related; boundary=${boundary}` }, H), body });
    const t = await r.text();
    if (!r.ok) throw new Error('subtítulos ' + language + ' HTTP ' + r.status + ': ' + t.slice(0, 200));
    log(`YouTube: subtítulos ${language} ${prev ? 'reemplazados' : 'subidos'} ✅` + (platform === 'youtube_backup' ? ' (respaldo)' : ''));
    return JSON.parse(t).id;
  });
}
// Arma (y guarda) las pistas ES/EN del episodio. ES: tiempos por palabra de la voz. EN: palabras de la voz inglesa
// ya colocada sobre el video (english.words; si no hay, se alinea una vez con Whisper local en inglés).
async function ensureSubtitles(supabase, episode, log = console.log) {
  const cont = episode.continuity || {};
  const voice = cont.voice; const en = cont.english;
  if (!voice || !Array.isArray(voice.words) || !voice.words.length) throw new Error('La voz no tiene tiempos por palabra.');
  // Idioma de la voz = idioma de la serie (VYRALES 'es', MindFuel 'en').
  const { data: serL } = await supabase.from('series').select('language').eq('id', episode.series_id).single();
  const main = (serL && serL.language) === 'en' ? 'en' : 'es', other = main === 'es' ? 'en' : 'es';
  const out = { [main]: buildSrt(voice.words) };
  const ytt = { [main]: buildYtt(voice.words) }; // oct-14: lo que se sube a YouTube va con colores y letra grande
  if (main === 'es' && en && en.voice_url && Array.isArray(en.lines)) {
    let words = Array.isArray(en.words) && en.words.length ? en.words : null;
    if (!words) {
      log('subtítulos: alineando la voz inglesa (Whisper local, ~2 min)...');
      const wav = Buffer.from(await (await fetch(en.voice_url)).arrayBuffer());
      words = await require('./_align').alignWords(wav, en.lines.map((l) => l.en).join(' '), log, 'english');
      if (words) {
        const { data: fr } = await supabase.from('episodes').select('continuity').eq('id', episode.id).single();
        const c2 = (fr && fr.continuity) || {};
        await supabase.from('episodes').update({ continuity: Object.assign({}, c2, { english: Object.assign({}, c2.english, { words }) }) }).eq('id', episode.id);
      }
    }
    if (words) { out.en = buildSrt(words); ytt.en = buildYtt(words); }
  }
  if (!out[other]) { try { const tr = await translateSrt(out[main], main, other, log); if (tr) { out[other] = tr; ytt[other] = yttFromSrt(tr); } } catch (e) { log('subtítulos: no pude traducir (' + String(e.message).slice(0, 120) + ')'); } }
  const { uploadFile } = require('./_storage');
  const { data: se } = await supabase.from('series').select('slug').eq('id', episode.series_id).single();
  const base = `${se.slug}/ep${episode.episode_number}/subs-${Date.now()}`;
  const subs = { at: new Date().toISOString() };
  for (const k of ['es', 'en'].filter((x) => out[x])) subs[k + '_url'] = await uploadFile(supabase, { path: `${base}-${k}.srt`, buffer: Buffer.from(out[k], 'utf8'), contentType: 'text/plain; charset=utf-8' });
  const { data: fr2 } = await supabase.from('episodes').select('continuity').eq('id', episode.id).single();
  await supabase.from('episodes').update({ continuity: Object.assign({}, (fr2 && fr2.continuity) || {}, { subtitles: subs }) }).eq('id', episode.id);
  log('subtítulos listos:', ['es', 'en'].filter((x) => out[x]).join(' + '), '(' + out.es.split('\n\n').length + ' bloques ES)');
  return Object.assign(out, { es_ytt: ytt.es, en_ytt: ytt.en });
}
// Sube las pistas a un video de YouTube.
async function uploadSubtitles(supabase, { videoId, subs, log = console.log }) {
  if (subs.es) await youtubeCaption(supabase, { videoId, language: 'es', name: 'Español', srt: subs.es_ytt || subs.es, log });
  if (subs.en) await youtubeCaption(supabase, { videoId, language: 'en', name: 'English', srt: subs.en_ytt || subs.en, log });
}
module.exports = { buildYtt, buildSrt, youtubeCaption, ensureSubtitles, uploadSubtitles };
