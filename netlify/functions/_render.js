// Editor de episodio → video final. Aplica el "plan de edición" que se arma en el dashboard
// (episodes.edit_plan) y produce el final.mp4 con ffmpeg (libass para los textos):
//   1. Cada toma: recorte, velocidad (0.5×–2×), zoom suave opcional, volumen, fundidos,
//      subtítulo (estilos TikTok, palabra por palabra, color por personaje) y texto arriba.
//      Todo normalizado a 720x1280 · 24 fps · AAC estéreo 48 kHz.
//   2. Tarjetas de título y final (opcionales).
//   3. Unión: sin recodificar si no hay fundidos cruzados; con xfade/acrossfade si los hay.
//   4. Audio final: música en loop (opcional) y volumen parejo (loudnorm, -14 LUFS).
// No llama a ninguna API de pago.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { narrationConfig, castMode } = require('./_series');

const W = 720;
const H = 1280;
const FPS = 24;
const FONT_FILE = 'Montserrat-ExtraBold.ttf';
const FONT_NAME = 'Montserrat Thin ExtraBold'; // nombre de familia real dentro del archivo (fontsource)
const SPEECH = [0.25, 6.1];
const MAX_UPLOAD_MB = 45; // límite de Supabase Storage del proyecto: 50 MB por archivo
// Transiciones con encimado (xfade de ffmpeg). 'cut' = corte directo; 'fade_black' = baja a
// negro y sube (sin encimar, con fade en cada toma).
const XFADE = { crossfade: 'fade', dissolve: 'dissolve', slide: 'slideleft', slide_up: 'slideup', wipe: 'wipeleft', zoom: 'zoomin', circle: 'circleopen', blur: 'hblur', flash: 'fadewhite' }; // el diálogo se dice entre 0 y 6 s de cada toma (así lo pide el prompt)

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { cwd, maxBuffer: 1024 * 1024 * 100 }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      resolve({ stdout, stderr });
    });
  });
}

// ffmpeg-static no trae ffprobe: la duración sale del encabezado que imprime "ffmpeg -i".
async function probeMedia(file, cwd) {
  let stderr = '';
  try { await run(['-hide_banner', '-i', file], cwd); } catch (err) { stderr = err.stderr || ''; }
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new Error('No pude leer la duración de ' + file);
  // Los videos de fal.ai pedidos SIN audio no traen pista de audio: hay que poner silencio.
  return { duration: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]), hasAudio: /Stream #\d+:\d+.*Audio:/.test(stderr) };
}
async function probeDuration(file, cwd) { return (await probeMedia(file, cwd)).duration; }

function findFont() {
  const candidates = [
    path.join(__dirname, 'assets', 'fonts', FONT_FILE),
    path.join(process.cwd(), 'netlify', 'functions', 'assets', 'fonts', FONT_FILE),
    path.join(__dirname, '..', '..', 'netlify', 'functions', 'assets', 'fonts', FONT_FILE),
    path.join(process.env.LAMBDA_TASK_ROOT || '/var/task', 'netlify', 'functions', 'assets', 'fonts', FONT_FILE)
  ];
  const found = candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } });
  if (!found) throw new Error('No encontré la fuente ' + FONT_FILE + ' (netlify/functions/assets/fonts).');
  return found;
}

// ---------- Subtítulos (ASS) ----------
// Colores ASS = &HAABBGGRR
const SPEAKER_COLORS = ['&H00FFFFFF', '&H00FFF08C', '&H00B98CFF', '&H0080FFB4', '&H00FF9EC4', '&H0080C8FF']; // blanco, celeste, rosa, verde, lila, naranja (el amarillo queda para el resaltado)
const STYLES = {
  classic: { primary: '&H00FFFFFF', highlight: '&H0000E1FF', outline: '&H00000000', back: '&H64000000', border: 1, outlineW: 4, shadow: 1 },
  yellow: { primary: '&H0000E1FF', highlight: '&H00FFFFFF', outline: '&H00000000', back: '&H64000000', border: 1, outlineW: 4, shadow: 1 },
  box: { primary: '&H00FFFFFF', highlight: '&H0000E1FF', outline: '&H96000000', back: '&H96000000', border: 3, outlineW: 10, shadow: 0 }
};

function assTime(t) {
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
}
function clean(t) { return String(t || '').replace(/[{}]/g, '').replace(/\\/g, '/').replace(/\s+/g, ' ').trim(); }

// Palabra por palabra: cada palabra se resalta en su turno ({\k} en centésimas). Sin la
// transcripción real, el tiempo se reparte según el largo de cada palabra dentro de la
// ventana en que se dice el diálogo.
function karaoke(text, seconds) {
  const words = clean(text).split(' ').filter(Boolean);
  const weights = words.map((w) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length) + 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const cs = Math.max(10, Math.round(seconds * 100));
  let used = 0;
  return words.map((w, i) => {
    const d = i === words.length - 1 ? cs - used : Math.round((weights[i] / total) * cs);
    used += d;
    return `{\\k${d}}${w}`;
  }).join(' ');
}

function assHeader(sub) {
  const st = STYLES[sub.style] || STYLES.classic;
  const size = Number(sub.size) || 38;
  const mv = Math.round(sub.margin_v);
  // Con karaoke, PrimaryColour = color ya dicho (resaltado) y SecondaryColour = aún no dicho.
  const primary = sub.karaoke ? st.highlight : st.primary;
  const secondary = sub.karaoke ? st.primary : '&H000000FF';
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Sub,${FONT_NAME},${size},${primary},${secondary},${st.outline},${st.back},0,0,0,0,100,100,0,0,${st.border},${st.outlineW},${st.shadow},2,60,60,${mv},1`,
    `Style: Top,${FONT_NAME},44,&H0000E1FF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,4,1,8,60,60,170,1`,
    `Style: Card,${FONT_NAME},66,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,70,70,0,1`,
    `Style: CardSmall,${FONT_NAME},40,&H00B4B4B4,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,70,70,0,1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
}
const dialogueLine = (e) => `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},${e.style},,0,0,0,,${e.text}`;

function subtitleText(text, seconds, sub, color) {
  let body = sub.karaoke ? karaoke(text, seconds) : clean(text);
  if (sub.speaker_colors && color && !sub.karaoke) body = `{\\c${color.replace('&H00', '&H')}}` + body;
  if (sub.speaker_colors && color && sub.karaoke) body = `{\\2c${color.replace('&H00', '&H')}}` + body;
  const pop = sub.animation === 'pop' ? '{\\fscx70\\fscy70\\t(0,140,\\fscx100\\fscy100)}' : '';
  return pop + body;
}

// ---------- Piezas ----------
const VIDEO_OUT = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS)];
const AUDIO_OUT = ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'];
const NORMALIZE_V = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

// Narración con voz fija (TTS): empieza a NARR_START s de la toma y debe terminar antes del
// final (o antes del fundido cruzado). Si no cabe, se acelera hasta NARR_MAX_TEMPO.
const NARR_START = 0.3;
const NARR_MAX_TEMPO = 1.2;

async function renderClip({ cwd, input, out, c, subtitle, speakerColor, sub, fadeIn, fadeOut, narration = null, muteOriginal = false, tailReserve = 0 }) {
  const probe = await probeMedia(input, cwd);
  const full = probe.duration;
  const ts = Math.max(0, Math.min(Number(c.trim_start) || 0, full - 1));
  const srcDur = Math.max(1, full - ts - Math.max(0, Number(c.trim_end) || 0));
  const speed = Math.min(2, Math.max(0.5, Number(c.speed) || 1));
  const dur = srcDur / speed;

  // Narración: cuánto dura ya ajustada a la toma.
  let narr = null;
  if (narration && narration.file) {
    const nSecs = Number(narration.seconds) || (await probeDuration(narration.file, cwd));
    let avail = Math.max(1, dur - NARR_START - Math.max(0.15, tailReserve));
    // Diálogo doblado: la boca se mueve en 0–6 s (prompt), así que la voz se ajusta a esa ventana.
    if (narration.window) avail = Math.min(avail, Math.max(1, narration.window - NARR_START));
    const tempo = Math.min(NARR_MAX_TEMPO, Math.max(1, nSecs / avail));
    narr = { file: narration.file, tempo, seconds: nSecs / tempo };
  }

  const events = [];
  if (subtitle) {
    // Con narración TTS el subtítulo sigue a la voz real; si no, la ventana fija del prompt (0–6 s).
    const st = narr ? NARR_START : Math.max(0, (SPEECH[0] - ts) / speed);
    const en = narr ? Math.min(dur - 0.05, NARR_START + narr.seconds) : Math.min(dur - 0.05, (SPEECH[1] - ts) / speed);
    if (en > st + 0.3) events.push({ start: st, end: en, style: 'Sub', text: subtitleText(subtitle, en - st, sub, speakerColor) });
  }
  if (c.overlay) events.push({ start: 0, end: dur, style: 'Top', text: clean(c.overlay) });

  const vf = [];
  if (speed !== 1) vf.push(`setpts=PTS/${speed}`);
  vf.push(NORMALIZE_V);
  if (c.zoom) {
    // Zoom suave (Ken Burns): de 1.00 a 1.08 durante la toma, centrado.
    const frames = Math.max(1, Math.round(dur * FPS));
    vf.push(`scale=${W * 2}:${H * 2},zoompan=z='1+0.08*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}`);
  } else {
    vf.push(`fps=${FPS}`);
  }
  if (fadeIn) vf.push(`fade=t=in:st=0:d=${fadeIn}`);
  if (fadeOut) vf.push(`fade=t=out:st=${Math.max(0, dur - fadeOut).toFixed(3)}:d=${fadeOut}`);
  if (events.length) {
    const assName = path.basename(out, '.mp4') + '.ass';
    fs.writeFileSync(path.join(cwd, assName), [...assHeader(sub), ...events.map(dialogueLine), ''].join('\n'));
    vf.push(`ass=${assName}:fontsdir=fonts`);
  }
  const AF = 0.06;
  const fades = `afade=t=in:st=0:d=${fadeIn || AF},afade=t=out:st=${Math.max(0, dur - (fadeOut || AF)).toFixed(3)}:d=${fadeOut || AF}`;
  // Audio original de la toma (ambiente). Se silencia si trae la voz vieja de Veo y ahora
  // narra el TTS (si no, se oirían dos narradores). Sin pista de audio → silencio.
  const vol = muteOriginal ? 0 : Number(c.volume == null ? 1 : c.volume);
  const inputs = ['-ss', ts.toFixed(3), '-t', srcDur.toFixed(3), '-i', input];
  const fc = [`[0:v]${vf.join(',')}[v]`];
  let origLabel = '0:a';
  if (!probe.hasAudio) {
    inputs.push('-f', 'lavfi', '-t', dur.toFixed(3), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    origLabel = (inputs.filter((x) => x === '-i').length - 1) + ':a';
  }
  const oa = ['aresample=48000', 'aformat=channel_layouts=stereo'];
  if (speed !== 1 && probe.hasAudio) oa.push(`atempo=${speed}`);
  oa.push(`volume=${vol.toFixed(2)}`);
  if (narr) {
    inputs.push('-i', narr.file);
    const ni = inputs.filter((x) => x === '-i').length - 1;
    const ms = Math.round(NARR_START * 1000);
    fc.push(`[${origLabel}]${oa.join(',')}[ao]`);
    fc.push(`[${ni}:a]aresample=48000,aformat=channel_layouts=stereo${narr.tempo > 1.001 ? `,atempo=${narr.tempo.toFixed(3)}` : ''},adelay=${ms}|${ms},apad[an]`);
    fc.push(`[ao][an]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,${fades}[a]`);
  } else {
    fc.push(`[${origLabel}]${oa.join(',')},${fades}[a]`);
  }
  await run(['-y', ...inputs, '-filter_complex', fc.join(';'), '-map', '[v]', '-map', '[a]', '-t', dur.toFixed(3), ...VIDEO_OUT, ...AUDIO_OUT, out], cwd);
  return { dur, narr: narr ? { start: NARR_START, seconds: narr.seconds, file: narr.file, tempo: narr.tempo } : null };
}

async function renderCard({ cwd, out, lines, seconds, sub }) {
  const dur = Math.max(1, Math.min(6, Number(seconds) || 2));
  const events = [];
  if (lines[0]) events.push({ start: 0, end: dur, style: 'Card', text: clean(lines[0]) });
  if (lines[1]) events.push({ start: 0, end: dur, style: 'CardSmall', text: '\\N\\N\\N\\N' + clean(lines[1]) });
  const assName = path.basename(out, '.mp4') + '.ass';
  fs.writeFileSync(path.join(cwd, assName), [...assHeader(sub), ...events.map(dialogueLine), ''].join('\n'));
  await run([
    '-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}:d=${dur}`,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-t', String(dur), '-vf', `ass=${assName}:fontsdir=fonts`, ...VIDEO_OUT, ...AUDIO_OUT, '-shortest', out
  ], cwd);
  return dur;
}

// ---------- Plan ----------
function defaultPlan(episode) {
  const shots = (Array.isArray(episode.shots) ? episode.shots : []).slice().sort((a, b) => a.n - b.n);
  return {
    version: 2,
    clips: shots.map((s) => ({ shot: s.n, include: true, trim_start: 0, trim_end: 0, volume: 1, speed: 1, zoom: false, transition: 'cut', transition_s: 0.4, subtitle: null, overlay: '' })),
    subtitles: { enabled: true, size: 38, margin_v: 180, style: 'classic', karaoke: false, speaker_colors: false, animation: 'none' },
    audio: { normalize: true, music_url: null, music_volume: 0.12, duck: true },
    title_card: { enabled: false, text: '', subtext: '', seconds: 2 },
    end_card: { enabled: false, text: '', subtext: '', seconds: 2 }
  };
}

function dialogueOf(shot) {
  const d = shot && shot.dialogue;
  const list = Array.isArray(d) ? d : (d ? [d] : []);
  return list.map((x) => x && x.line).filter(Boolean).join(' ');
}
function speakerOf(shot) {
  const d = shot && shot.dialogue;
  const list = Array.isArray(d) ? d : (d ? [d] : []);
  return (list[0] && list[0].speaker) || '';
}

function resolvePlan(episode) {
  const base = defaultPlan(episode);
  const saved = episode.edit_plan || null;
  if (!saved) return base;
  const plan = Object.assign({}, base, saved, {
    subtitles: Object.assign({}, base.subtitles, saved.subtitles),
    audio: Object.assign({}, base.audio, saved.audio),
    title_card: Object.assign({}, base.title_card, saved.title_card),
    end_card: Object.assign({}, base.end_card, saved.end_card)
  });
  if (saved.subtitles && saved.subtitles.margin_v == null) plan.subtitles.margin_v = saved.subtitles.position === 'middle' ? 560 : 300;
  const savedClips = Array.isArray(saved.clips) ? saved.clips : [];
  const known = new Set(savedClips.map((c) => c.shot));
  const defaults = Object.fromEntries(base.clips.map((b) => [b.shot, b]));
  plan.clips = savedClips.filter((c) => defaults[c.shot]).map((c) => Object.assign({}, defaults[c.shot], c))
    .concat(base.clips.filter((b) => !known.has(b.shot)));
  return plan;
}

// Con límite de tiempo y 3 intentos: una descarga que se quedaba colgada (sin error) dejaba
// la unión "corriendo" para siempre (Job EP1: se trabó en la toma 15).
async function download(url, dest) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('No se pudo descargar ' + url + ' (HTTP ' + res.status + ')');
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error('No se pudo descargar ' + url + ' tras 3 intentos: ' + (lastErr && lastErr.message));
}

// ---------- Episodio ----------
async function renderEpisode({ episode, series, log = console.log, fetchFile = download }) {
  const plan = resolvePlan(episode);
  const sub = Object.assign({}, plan.subtitles, { margin_v: Math.min(1150, Math.max(20, Number(plan.subtitles.margin_v) || 180)) });
  const clipsByShot = {};
  (episode.assets || []).filter((a) => a.kind === 'video_clip' && a.storage_path).forEach((a) => { clipsByShot[a.shot_number] = a; });
  const shotsByN = {};
  (episode.shots || []).forEach((s) => { shotsByN[s.n] = s; });
  const chosen = plan.clips.filter((c) => c.include !== false && clipsByShot[c.shot]);
  if (!chosen.length) throw new Error('No hay tomas con video para unir (o todas están quitadas en el editor).');

  // Color por personaje: en el orden en que hablan por primera vez.
  const speakers = [];
  chosen.forEach((c) => { const s = speakerOf(shotsByN[c.shot]); if (s && !speakers.includes(s)) speakers.push(s); });

  const ttsMode = !!narrationConfig(series && series.story_bible);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vyrales-render-'));
  const cleanup = () => fs.rmSync(cwd, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(cwd, 'fonts'));
    fs.copyFileSync(findFont(), path.join(cwd, 'fonts', FONT_FILE));
    // parts: { file, dur, xfade (segundos de fundido cruzado CON la pieza siguiente) }
    const parts = [];

    if (plan.title_card.enabled && (plan.title_card.text || plan.title_card.subtext)) {
      log('tarjeta de título...');
      parts.push({ file: 'p00-title.mp4', dur: await renderCard({ cwd, out: 'p00-title.mp4', lines: [plan.title_card.text, plan.title_card.subtext], seconds: plan.title_card.seconds, sub }), xfade: 0 });
    }
    let i = 0;
    for (const c of chosen) {
      i++;
      const prev = chosen[i - 2];
      const src = `src-${String(c.shot).padStart(2, '0')}.mp4`;
      log(`toma ${c.shot}: descargando y editando (${i}/${chosen.length})...`);
      await fetchFile(clipsByShot[c.shot].storage_path, path.join(cwd, src));
      const out = `p${String(i).padStart(2, '0')}-shot${c.shot}.mp4`;
      const shot = shotsByN[c.shot];
      const subtitle = sub.enabled ? (c.subtitle != null && c.subtitle !== '' ? c.subtitle : dialogueOf(shot)) : '';
      const spk = speakerOf(shot);
      const tSec = (x) => Math.min(1.5, Math.max(0.2, Number(x && x.transition_s) || 0.4));
      const fadeIn = prev && prev.transition === 'fade_black' ? tSec(prev) / 2 : 0;
      const fadeOut = c.transition === 'fade_black' && i < chosen.length ? tSec(c) / 2 : 0;
      // Narrador con voz fija: se baja la narración de la toma (si ya se generó).
      let narration = null;
      if (ttsMode && shot && shot.narration && shot.narration.url) {
        const nf = `narr-${String(c.shot).padStart(2, '0')}.wav`;
        await fetchFile(shot.narration.url, path.join(cwd, nf));
        narration = { file: nf, seconds: shot.narration.seconds, window: castMode(series && series.story_bible) ? 6.6 : 0 };
      } else if (ttsMode) {
        log(`toma ${c.shot}: AVISO — no tiene narración generada, va sin voz.`);
      }
      // Clips generados ANTES del narrador TTS traen la voz de Veo pegada: se silencia su audio.
      // Voces fijas para todos: se calla cualquier voz que traiga el clip (por si se generó con audio).
      const muteOriginal = !!(narration && (castMode(series && series.story_bible) || /Voice-over narration/i.test(clipsByShot[c.shot].prompt || '')));
      const tailReserve = XFADE[c.transition] && i < chosen.length ? tSec(c) : 0;
      const r = await renderClip({ cwd, input: src, out, c, subtitle, speakerColor: spk ? SPEAKER_COLORS[speakers.indexOf(spk) % SPEAKER_COLORS.length] : null, sub, fadeIn, fadeOut, narration, muteOriginal, tailReserve });
      const dur = r.dur;
      if (r.narr && r.narr.tempo > 1.001) log(`toma ${c.shot}: narración acelerada ${r.narr.tempo.toFixed(2)}x para que quepa.`);
      parts.push({ file: out, dur, narr: r.narr, xfade: XFADE[c.transition] && i < chosen.length ? Math.min(tSec(c), dur / 2) : 0, xname: XFADE[c.transition] || 'fade' });
    }
    if (plan.end_card.enabled && (plan.end_card.text || plan.end_card.subtext)) {
      log('tarjeta final...');
      parts.push({ file: 'p99-end.mp4', dur: await renderCard({ cwd, out: 'p99-end.mp4', lines: [plan.end_card.text, plan.end_card.subtext], seconds: plan.end_card.seconds, sub }), xfade: 0 });
    }

    let total = parts.reduce((s, p) => s + p.dur, 0) - parts.reduce((s, p) => s + p.xfade, 0);
    if (parts.some((p) => p.xfade > 0)) {
      // Fundidos cruzados: xfade (video) + acrossfade (audio) encadenados.
      log('uniendo', parts.length, 'piezas con fundidos cruzados...');
      const inputs = parts.flatMap((p) => ['-i', p.file]);
      // Misma base de tiempo en todas las entradas (xfade la exige).
      const f = parts.map((_, k) => `[${k}:v]settb=AVTB,setpts=PTS-STARTPTS,fps=${FPS}[iv${k}];[${k}:a]asetpts=PTS-STARTPTS[ia${k}]`);
      let vPrev = '[iv0]';
      let aPrev = '[ia0]';
      let offset = parts[0].dur;
      for (let k = 1; k < parts.length; k++) {
        const x = parts[k - 1].xfade;
        const vOut = `[v${k}]`;
        const aOut = `[a${k}]`;
        if (x > 0) {
          offset -= x;
          f.push(`${vPrev}[iv${k}]xfade=transition=${parts[k - 1].xname}:duration=${x.toFixed(3)}:offset=${offset.toFixed(3)}${vOut}`);
          f.push(`${aPrev}[ia${k}]acrossfade=d=${x.toFixed(3)}${aOut}`);
        } else {
          f.push(`${vPrev}[iv${k}]concat=n=2:v=1:a=0,settb=AVTB,fps=${FPS}${vOut}`);
          f.push(`${aPrev}[ia${k}]concat=n=2:v=0:a=1${aOut}`);
        }
        offset += parts[k].dur;
        vPrev = vOut;
        aPrev = aOut;
      }
      await run(['-y', ...inputs, '-filter_complex', f.join(';'), '-map', vPrev, '-map', aPrev, ...VIDEO_OUT, ...AUDIO_OUT, 'joined.mp4'], cwd);
    } else {
      fs.writeFileSync(path.join(cwd, 'list.txt'), parts.map((p) => `file '${p.file}'`).join('\n'));
      log('uniendo', parts.length, 'piezas...');
      await run(['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'joined.mp4'], cwd);
    }

    const music = plan.audio.music_url;
    const filters = [];
    const args = ['-y', '-i', 'joined.mp4'];
    if (music) {
      log('mezclando música de fondo...');
      await fetchFile(music, path.join(cwd, 'music.audio'));
      args.push('-stream_loop', '-1', '-i', 'music.audio');
      const mv = Math.max(0, Math.min(1, Number(plan.audio.music_volume) || 0.12));
      filters.push(`[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${mv.toFixed(2)},afade=t=in:st=0:d=1,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[m0]`);
      // Ducking estilo documental: la música baja sola mientras habla el narrador y sube en
      // las pausas. La "llave" es la pista de narración puesta en su minuto exacto.
      const windows = [];
      let at = 0;
      parts.forEach((p) => { if (p.narr) windows.push({ file: p.narr.file, start: at + p.narr.start, tempo: p.narr.tempo }); at += p.dur - p.xfade; });
      if (plan.audio.duck !== false && windows.length) {
        const keyLabels = [];
        windows.forEach((w, k) => {
          args.push('-i', w.file);
          const ms = Math.round(w.start * 1000);
          filters.push(`[${k + 2}:a]aresample=48000,aformat=channel_layouts=stereo${w.tempo > 1.001 ? `,atempo=${w.tempo.toFixed(3)}` : ''},adelay=${ms}|${ms}[k${k}]`);
          keyLabels.push(`[k${k}]`);
        });
        filters.push(`${keyLabels.join('')}amix=inputs=${keyLabels.length}:duration=longest:dropout_transition=0:normalize=0,apad[key]`);
        filters.push(`[m0][key]sidechaincompress=threshold=0.02:ratio=4:attack=120:release=1200:makeup=1[m]`);
        log('música con ducking bajo', windows.length, 'narraciones.');
      } else {
        filters.push('[m0]anull[m]');
      }
      filters.push(`[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mx]`);
    }
    const lastA = music ? '[mx]' : '[0:a]';
    filters.push(`${lastA}${plan.audio.normalize !== false ? 'loudnorm=I=-14:TP=-1.5:LRA=11,' : ''}aresample=48000[aout]`);
    args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', ...AUDIO_OUT, '-t', total.toFixed(3), '-movflags', '+faststart', 'final.mp4');
    log('audio final (música / volumen parejo)...');
    await run(args, cwd);
    // Supabase rechaza archivos de más de 50 MB (probado: 45 MB OK, 55 MB → 413). Un episodio de
    // 2:40 salía en ~87 MB y la subida fallaba sin video final. Si pasa de MAX_UPLOAD_MB se
    // recomprime al bitrate justo para quedar debajo (en 720p vertical no se nota).
    let finalName = 'final.mp4';
    const sizeMb = fs.statSync(path.join(cwd, finalName)).size / 1048576;
    if (sizeMb > MAX_UPLOAD_MB) {
      const audioK = 160;
      const videoK = Math.max(600, Math.floor((MAX_UPLOAD_MB * 0.94 * 8 * 1024) / total - audioK));
      log(`el video final pesa ${sizeMb.toFixed(0)} MB (límite ${MAX_UPLOAD_MB}); recomprimiendo a ${videoK} kb/s...`);
      await run(['-y', '-i', 'final.mp4', '-c:v', 'libx264', '-preset', 'medium', '-b:v', videoK + 'k', '-maxrate', Math.round(videoK * 1.3) + 'k', '-bufsize', (videoK * 2) + 'k', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', 'final-small.mp4'], cwd);
      finalName = 'final-small.mp4';
      log(`recomprimido: ${(fs.statSync(path.join(cwd, finalName)).size / 1048576).toFixed(1)} MB`);
    }
    return { file: path.join(cwd, finalName), seconds: total, pieces: parts.length, cleanup, plan };
  } catch (err) {
    cleanup();
    throw err;
  }
}

module.exports = { renderEpisode, resolvePlan, defaultPlan, dialogueOf, findFont, FONT_FILE, FONT_NAME };
