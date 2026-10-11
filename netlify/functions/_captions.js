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
// Sube (o reemplaza) una pista de subtítulos en un video de YouTube. Necesita el permiso youtube.force-ssl.
async function youtubeCaption(supabase, { videoId, language, name, srt, log = console.log }) {
  const token = await require('./_social').youtubeAccessToken(supabase);
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
  log(`YouTube: subtítulos ${language} ${prev ? 'reemplazados' : 'subidos'} ✅`);
  return JSON.parse(t).id;
}
// Arma (y guarda) las pistas ES/EN del episodio. ES: tiempos por palabra de la voz. EN: palabras de la voz inglesa
// ya colocada sobre el video (english.words; si no hay, se alinea una vez con Whisper local en inglés).
async function ensureSubtitles(supabase, episode, log = console.log) {
  const cont = episode.continuity || {};
  const voice = cont.voice; const en = cont.english;
  if (!voice || !Array.isArray(voice.words) || !voice.words.length) throw new Error('La voz no tiene tiempos por palabra.');
  const out = { es: buildSrt(voice.words) };
  if (en && en.voice_url && Array.isArray(en.lines)) {
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
    if (words) out.en = buildSrt(words);
  }
  const { uploadFile } = require('./_storage');
  const { data: se } = await supabase.from('series').select('slug').eq('id', episode.series_id).single();
  const base = `${se.slug}/ep${episode.episode_number}/subs-${Date.now()}`;
  const subs = { at: new Date().toISOString() };
  for (const k of Object.keys(out)) subs[k + '_url'] = await uploadFile(supabase, { path: `${base}-${k}.srt`, buffer: Buffer.from(out[k], 'utf8'), contentType: 'text/plain; charset=utf-8' });
  const { data: fr2 } = await supabase.from('episodes').select('continuity').eq('id', episode.id).single();
  await supabase.from('episodes').update({ continuity: Object.assign({}, (fr2 && fr2.continuity) || {}, { subtitles: subs }) }).eq('id', episode.id);
  log('subtítulos listos:', Object.keys(out).join(' + '), '(' + out.es.split('\n\n').length + ' bloques ES)');
  return out;
}
// Sube las pistas a un video de YouTube.
async function uploadSubtitles(supabase, { videoId, subs, log = console.log }) {
  if (subs.es) await youtubeCaption(supabase, { videoId, language: 'es', name: 'Español', srt: subs.es, log });
  if (subs.en) await youtubeCaption(supabase, { videoId, language: 'en', name: 'English', srt: subs.en, log });
}
module.exports = { buildSrt, youtubeCaption, ensureSubtitles, uploadSubtitles };
