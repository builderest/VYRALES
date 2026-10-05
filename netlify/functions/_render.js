// Editor de episodio → video final. Aplica el "plan de edición" que se arma en el dashboard
// (episodes.edit_plan) y produce el final.mp4 con ffmpeg:
//   1. Cada toma: recorte (inicio/fin), volumen, micro-fundido de audio, subtítulo y texto
//      encima (libass), todo normalizado a 720x1280 · 24 fps · AAC estéreo 48 kHz.
//   2. Tarjeta de título al inicio y tarjeta final (fondo negro + texto), opcionales.
//   3. Unión sin recodificar (todas las piezas ya tienen el mismo formato).
//   4. Pasada final de audio: música de fondo opcional (en loop, volumen bajo) y volumen
//      parejo (loudnorm, -14 LUFS como TikTok/Reels).
// No llama a ninguna API de pago. Sin plan → valores por defecto (todas las tomas, sin
// recortes, subtítulos activados, volumen parejo).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const W = 720;
const H = 1280;
const FPS = 24;
const FONT_FILE = 'Montserrat-ExtraBold.ttf';
const FONT_NAME = 'Montserrat Thin ExtraBold'; // nombre de familia real dentro del archivo (fontsource)

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { cwd, maxBuffer: 1024 * 1024 * 100 }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      resolve({ stdout, stderr });
    });
  });
}

// ffmpeg-static no trae ffprobe: la duración sale del encabezado que imprime "ffmpeg -i".
async function probeDuration(file, cwd) {
  let stderr = '';
  try { await run(['-hide_banner', '-i', file], cwd); } catch (err) { stderr = err.stderr || ''; }
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new Error('No pude leer la duración de ' + file);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

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

// --- ASS (subtítulos con estilo TikTok: letra gruesa blanca con borde negro) ---
function assTime(t) {
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
}
function assText(t) {
  return String(t || '').replace(/[{}]/g, '').replace(/\\/g, '/').replace(/\r?\n/g, '\\N').trim();
}
function assFile(events, style) {
  const st = Object.assign({ subSize: 46, subMarginV: 300, color: '&H00FFFFFF' }, style || {});
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Sub,${FONT_NAME},${st.subSize},${st.color},&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,4,1,2,60,60,${st.subMarginV},1`,
    `Style: Top,${FONT_NAME},44,&H0000E1FF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,4,1,8,60,60,170,1`,
    `Style: Card,${FONT_NAME},66,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,70,70,0,1`,
    `Style: CardSmall,${FONT_NAME},40,&H00B4B4B4,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,70,70,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events.map((e) => `Dialogue: 0,${assTime(e.start)},${assTime(e.end)},${e.style},,0,0,${e.marginV || 0},,${e.text}`),
    ''
  ].join('\n');
}

const VIDEO_OUT = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS)];
const AUDIO_OUT = ['-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2'];
const NORMALIZE_V = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}`;

async function renderClip({ cwd, input, out, trimStart, trimEnd, volume, subtitle, overlay, subtitleTiming, style }) {
  const full = await probeDuration(input, cwd);
  const ts = Math.max(0, Math.min(trimStart || 0, full - 1));
  const dur = Math.max(1, full - ts - Math.max(0, trimEnd || 0));
  const events = [];
  if (subtitle) {
    const st = Math.max(0, (subtitleTiming.start) - ts);
    const en = Math.min(dur - 0.05, subtitleTiming.end - ts);
    if (en > st + 0.3) events.push({ start: st, end: en, style: 'Sub', text: assText(subtitle) });
  }
  if (overlay) events.push({ start: 0, end: dur, style: 'Top', text: assText(overlay) });
  let vf = NORMALIZE_V;
  if (events.length) {
    const assName = path.basename(out, '.mp4') + '.ass';
    fs.writeFileSync(path.join(cwd, assName), assFile(events, style));
    vf += `,ass=${assName}:fontsdir=fonts`;
  }
  const FADE = 0.06;
  const af = `aresample=48000,aformat=channel_layouts=stereo,volume=${Number(volume ?? 1).toFixed(2)},afade=t=in:st=0:d=${FADE},afade=t=out:st=${(dur - FADE).toFixed(3)}:d=${FADE}`;
  await run(['-y', '-ss', ts.toFixed(3), '-i', input, '-t', dur.toFixed(3), '-vf', vf, '-af', af, ...VIDEO_OUT, ...AUDIO_OUT, out], cwd);
  return dur;
}

async function renderCard({ cwd, out, lines, seconds }) {
  const dur = Math.max(1, Math.min(6, Number(seconds) || 2));
  const events = [];
  if (lines[0]) events.push({ start: 0, end: dur, style: 'Card', text: assText(lines[0]) });
  if (lines[1]) events.push({ start: 0, end: dur, style: 'CardSmall', text: '\\N\\N\\N\\N' + assText(lines[1]) });
  const assName = path.basename(out, '.mp4') + '.ass';
  fs.writeFileSync(path.join(cwd, assName), assFile(events));
  await run([
    '-y', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}:d=${dur}`,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-t', String(dur), '-vf', `ass=${assName}:fontsdir=fonts`, ...VIDEO_OUT, ...AUDIO_OUT, '-shortest', out
  ], cwd);
  return dur;
}

// Plan por defecto a partir del episodio (todas las tomas en orden, subtítulos con el diálogo).
function defaultPlan(episode) {
  const shots = (Array.isArray(episode.shots) ? episode.shots : []).slice().sort((a, b) => a.n - b.n);
  return {
    version: 1,
    clips: shots.map((s) => ({ shot: s.n, include: true, trim_start: 0, trim_end: 0, volume: 1, subtitle: null, overlay: '' })),
    subtitles: { enabled: true, size: 46, position: 'bottom' },
    audio: { normalize: true, music_url: null, music_volume: 0.12 },
    title_card: { enabled: false, text: '', subtext: '', seconds: 2 },
    end_card: { enabled: false, text: '', subtext: '', seconds: 2 }
  };
}

function dialogueOf(shot) {
  const d = shot && shot.dialogue;
  const list = Array.isArray(d) ? d : (d ? [d] : []);
  return list.map((x) => x && x.line).filter(Boolean).join(' ');
}

// Mezcla el plan guardado sobre el de por defecto (tomas nuevas aparecen al final).
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
  const savedClips = Array.isArray(saved.clips) ? saved.clips : [];
  const known = new Set(savedClips.map((c) => c.shot));
  plan.clips = savedClips.filter((c) => base.clips.some((b) => b.shot === c.shot))
    .concat(base.clips.filter((b) => !known.has(b.shot)));
  return plan;
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('No se pudo descargar ' + url + ' (HTTP ' + res.status + ')');
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// Devuelve la ruta del final.mp4 (en una carpeta temporal que borra el llamador con cleanup()).
async function renderEpisode({ episode, series, log = console.log, fetchFile = download }) {
  const plan = resolvePlan(episode);
  const clipsByShot = {};
  (episode.assets || []).filter((a) => a.kind === 'video_clip' && a.storage_path).forEach((a) => { clipsByShot[a.shot_number] = a; });
  const shotsByN = {};
  (episode.shots || []).forEach((s) => { shotsByN[s.n] = s; });
  const chosen = plan.clips.filter((c) => c.include !== false && clipsByShot[c.shot]);
  if (!chosen.length) throw new Error('No hay tomas con video para unir (o todas están quitadas en el editor).');

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vyrales-render-'));
  const cleanup = () => fs.rmSync(cwd, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(cwd, 'fonts'));
    fs.copyFileSync(findFont(), path.join(cwd, 'fonts', FONT_FILE));
    const parts = [];
    let total = 0;
    const style = { subSize: Number(plan.subtitles.size) || 46, subMarginV: plan.subtitles.position === 'middle' ? 560 : 300 };

    if (plan.title_card.enabled && (plan.title_card.text || plan.title_card.subtext)) {
      log('tarjeta de título...');
      total += await renderCard({ cwd, out: 'p00-title.mp4', lines: [plan.title_card.text, plan.title_card.subtext], seconds: plan.title_card.seconds });
      parts.push('p00-title.mp4');
    }
    let i = 0;
    for (const c of chosen) {
      i++;
      const src = `src-${String(c.shot).padStart(2, '0')}.mp4`;
      log(`toma ${c.shot}: descargando y editando (${i}/${chosen.length})...`);
      await fetchFile(clipsByShot[c.shot].storage_path, path.join(cwd, src));
      const out = `p${String(i).padStart(2, '0')}-shot${c.shot}.mp4`;
      const subtitle = plan.subtitles.enabled ? (c.subtitle != null && c.subtitle !== '' ? c.subtitle : dialogueOf(shotsByN[c.shot])) : '';
      total += await renderClip({
        cwd, input: src, out, trimStart: Number(c.trim_start) || 0, trimEnd: Number(c.trim_end) || 0,
        volume: c.volume == null ? 1 : Number(c.volume), subtitle, overlay: c.overlay || '',
        subtitleTiming: { start: 0.25, end: 6.1 }, style
      });
      parts.push(out);
    }
    if (plan.end_card.enabled && (plan.end_card.text || plan.end_card.subtext)) {
      log('tarjeta final...');
      total += await renderCard({ cwd, out: 'p99-end.mp4', lines: [plan.end_card.text, plan.end_card.subtext], seconds: plan.end_card.seconds });
      parts.push('p99-end.mp4');
    }

    fs.writeFileSync(path.join(cwd, 'list.txt'), parts.map((p) => `file '${p}'`).join('\n'));
    log('uniendo', parts.length, 'piezas...');
    await run(['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'joined.mp4'], cwd);

    const music = plan.audio.music_url;
    const filters = [];
    const args = ['-y', '-i', 'joined.mp4'];
    if (music) {
      log('mezclando música de fondo...');
      await fetchFile(music, path.join(cwd, 'music.audio'));
      args.push('-stream_loop', '-1', '-i', 'music.audio');
      const mv = Math.max(0, Math.min(1, Number(plan.audio.music_volume) || 0.12));
      filters.push(`[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${mv.toFixed(2)},afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[m]`);
      filters.push(`[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mx]`);
    }
    const lastA = music ? '[mx]' : '[0:a]';
    filters.push(`${lastA}${plan.audio.normalize !== false ? 'loudnorm=I=-14:TP=-1.5:LRA=11,' : ''}aresample=48000[aout]`);
    args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', ...AUDIO_OUT, '-t', total.toFixed(3), '-movflags', '+faststart', 'final.mp4');
    log('audio final (música / volumen parejo)...');
    await run(args, cwd);
    return { file: path.join(cwd, 'final.mp4'), seconds: total, pieces: parts.length, cleanup, plan };
  } catch (err) {
    cleanup();
    throw err;
  }
}

module.exports = { renderEpisode, resolvePlan, defaultPlan, dialogueOf };
