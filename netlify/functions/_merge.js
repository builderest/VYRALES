// Lógica compartida para unir las tomas de video de un episodio en un solo video final
// con ffmpeg. La usan DOS disparadores:
//   1. generate-media-background.js — automático, justo después de que Veo termina TODAS
//      las tomas con éxito (así el episodio llega a "en_revision" con el video ya unido,
//      sin que nadie tenga que apretar un botón).
//   2. merge-episode.js — botón manual "Unir/Rehacer" en el dashboard, por si el automático
//      falló o regeneraste una toma individual y quieres actualizar el video completo.
// No llama a Veo ni a ninguna API de pago — solo procesamiento local con ffmpeg-static.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { ensureMediaBucket, uploadClip, removeByPublicUrl } = require('./_storage');
const { narrationConfig } = require('./_series');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 100 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('No se pudo descargar ' + url + ' (HTTP ' + res.status + ')');
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

// episode: fila de `episodes` con `assets` ya cargados (select('*, assets(*)')).
// series: { slug } de la serie a la que pertenece el episodio.
// log: función de logging opcional (por defecto console.log) para que el llamador pueda
// prefijar sus propios logs.
async function mergeEpisodeVideo(supabase, { episode, series, log = console.log }) {
  // Documentales con narrador de voz fija: la unión simple de abajo NO lleva la voz (los clips
  // vienen sin narración). Se usa el renderizador del editor, que mezcla narración + música.
  if (narrationConfig(series && series.story_bible)) return mergeWithNarration(supabase, { episode, series, log });
  // Modo voz de LTX: la voz ya viene en cada clip; igual se usa el renderizador del editor
  // (karaoke que sigue a la voz, transiciones, música, cierre) en vez de la unión simple.
  const sbm = (series && series.story_bible) || {};
  if (sbm.narration && sbm.narration.engine === 'ltx') return mergeWithNarration(supabase, { episode, series, log, skipNarration: true });
  const clips = (episode.assets || [])
    .filter((a) => a.kind === 'video_clip' && a.storage_path)
    .sort((a, b) => (a.shot_number || 0) - (b.shot_number || 0));
  if (clips.length === 0) {
    throw new Error('Este episodio no tiene tomas de video generadas todavía.');
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyrales-merge-'));
  try {
    const localFiles = [];
    for (const clip of clips) {
      const dest = path.join(workDir, `shot-${String(clip.shot_number).padStart(2, '0')}.mp4`);
      log('descargando toma', clip.shot_number, '...');
      await downloadToFile(clip.storage_path, dest);
      localFiles.push(dest);
    }

    const outputPath = path.join(workDir, 'final.mp4');

    // Unión con micro-fundido de audio (0.08 s) al inicio y final de cada toma: evita el
    // "clic" que se oye cuando se corta el audio de golpe entre clips de Veo. El video va
    // con corte directo (lo normal en microdramas verticales).
    // El fade-out sin conocer la duración se hace con areverse → fade-in → areverse.
    const FADE = 0.08;
    const inputs = localFiles.flatMap((f) => ['-i', f]);
    const chains = localFiles.map((_, i) =>
      `[${i}:v]setpts=PTS-STARTPTS,setsar=1[v${i}];` +
      `[${i}:a]aresample=48000,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${FADE},areverse,afade=t=in:st=0:d=${FADE},areverse[a${i}]`
    );
    const concatInputs = localFiles.map((_, i) => `[v${i}][a${i}]`).join('');
    const filter = `${chains.join(';')};${concatInputs}concat=n=${localFiles.length}:v=1:a=1[v][a]`;

    log('uniendo', clips.length, 'tomas con ffmpeg (corte directo + micro-fundido de audio)...');
    try {
      await run(ffmpegPath, [
        '-y', ...inputs,
        '-filter_complex', filter,
        '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart',
        outputPath
      ]);
    } catch (err) {
      // Respaldo: si algún clip vino sin pista de audio (u otro formato raro), se une como
      // antes, sin fundidos, para no dejar el episodio sin video final.
      log('la unión con fundidos falló, usando unión simple de respaldo:', (err.stderr || err.message || '').slice(-300));
      const listPath = path.join(workDir, 'list.txt');
      fs.writeFileSync(listPath, localFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
      await run(ffmpegPath, [
        '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart',
        outputPath
      ]);
    }

    await ensureMediaBucket(supabase);
    const finalBuffer = fs.readFileSync(outputPath);
    const storagePath = `${series.slug}/ep${episode.episode_number}/final.mp4`;
    const publicUrl = await uploadClip(supabase, { path: storagePath, buffer: finalBuffer });

    // Si ya había un final_render de un intento anterior, lo reemplaza en vez de duplicar
    // la fila (pasa si se corre dos veces, o si se usa el botón "Rehacer").
    const { data: existing } = await supabase
      .from('assets')
      .select('id')
      .eq('episode_id', episode.id)
      .eq('kind', 'final_render')
      .maybeSingle();

    let asset;
    if (existing) {
      const { data, error } = await supabase
        .from('assets')
        .update({ storage_path: publicUrl, cost_usd: 0, approved: false, approved_at: null })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      asset = data;
    } else {
      const { data, error } = await supabase
        .from('assets')
        .insert({
          episode_id: episode.id,
          kind: 'final_render',
          model: 'other',
          storage_path: publicUrl,
          cost_usd: 0,
          approved: false
        })
        .select()
        .single();
      if (error) throw error;
      asset = data;
    }

    log('video final listo:', publicUrl);
    return { asset, shots_joined: clips.length };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function mergeWithNarration(supabase, { episode, series, log, skipNarration = false }) {
  // 1) Narraciones que falten o estén desactualizadas (~$0.004 c/u): sin ellas el video saldría mudo.
  const VF = require('./_voice_full');
  if (!skipNarration && VF.continuousMode(series.story_bible)) {
    // Voz continua: UNA voz para todo el video (se genera si falta o si cambió el texto).
    await VF.ensureFullVoice(supabase, { episode, series, log });
    skipNarration = true;
  }
  if (!skipNarration) {
  const { handler: narrate } = require('./narration-background');
  log('narrador de voz fija: revisando narraciones que falten...');
  const nr = await narrate({ httpMethod: 'POST', body: JSON.stringify({ episode_id: episode.id }) });
  const nb = JSON.parse(nr.body || '{}');
  if (nr.statusCode !== 200) throw new Error('No se pudo generar la narración: ' + (nb.error || nr.statusCode));
  if ((nb.created || []).length) log('narraciones generadas ahora:', nb.created.map((c) => 'T' + c.shot).join(', '));
  if ((nb.failed || []).length) throw new Error('Fallaron narraciones: ' + nb.failed.map((f) => 'T' + f.shot + ' ' + f.error).join(' | '));
  }
  // 2) Render con el plan del editor (o el plan por defecto): voz, ducking, subtítulos, -14 LUFS.
  const { data: fresh, error } = await supabase.from('episodes').select('*, assets(*)').eq('id', episode.id).single();
  if (error || !fresh) throw error || new Error('No se pudo releer el episodio.');
  // Sin música elegida en el editor → la última pista de la biblioteca de la serie (si hay).
  const plan = fresh.edit_plan || {};
  let lib = (series.story_bible && series.story_bible.music_tracks) || [];
  if (!(plan.audio && plan.audio.music_url) && !lib.length) {
    // Automático: la serie no tiene música → se genera una pista con Lyria (~$0.08) según el
    // tono y el género, y queda en la biblioteca para los demás episodios.
    try {
      const sbx = series.story_bible || {};
      const prompt = `Instrumental background score, no vocals, for a ${series.genre || 'dramatic'} vertical short series. Mood: ${String(sbx.tone || '').slice(0, 300)}. Cinematic and emotional, steady low intensity so a voice can speak over it, gradual build, no abrupt drops.`;
      log('la serie no tiene música: generando una pista con Lyria...');
      const { handler: makeMusic } = require('./music-generate-background');
      const mr = await makeMusic({ httpMethod: 'POST', body: JSON.stringify({ series: series.slug, prompt, name: 'Tema de ' + (series.title || series.slug) }) });
      if (mr.statusCode === 200) {
        const { data: sNow } = await supabase.from('series').select('story_bible').eq('slug', series.slug).single();
        lib = (sNow && sNow.story_bible && sNow.story_bible.music_tracks) || [];
      } else log('no se pudo generar música (el video sale sin música):', mr.body);
    } catch (err) { log('no se pudo generar música (el video sale sin música):', err.message); }
  }
  if (!(plan.audio && plan.audio.music_url) && lib[0] && lib[0].url) {
    fresh.edit_plan = Object.assign({}, plan, { audio: Object.assign({ normalize: true, duck: true, music_volume: 0.2 }, plan.audio || {}, { music_url: lib[0].url, music_name: lib[0].name }) });
    log('música de la biblioteca de la serie:', lib[0].name);
  }
  const { renderEpisode, withTotalEpisodes } = require('./_render');
  await withTotalEpisodes(supabase, fresh);
  const result = await renderEpisode({ episode: fresh, series, log });
  try {
    await ensureMediaBucket(supabase);
    const url = await uploadClip(supabase, { path: `${series.slug}/ep${fresh.episode_number}/final-v${Date.now()}.mp4`, buffer: fs.readFileSync(result.file) });
    const old = (fresh.assets || []).find((a) => a.kind === 'final_render');
    let asset;
    if (old) {
      const { data, error: uErr } = await supabase.from('assets').update({ storage_path: url, cost_usd: 0, approved: false, approved_at: null }).eq('id', old.id).select().single();
      if (uErr) throw uErr;
      asset = data;
      if (old.storage_path && old.storage_path !== url) await removeByPublicUrl(supabase, old.storage_path, log);
    } else {
      const { data, error: iErr } = await supabase.from('assets').insert({ episode_id: fresh.id, kind: 'final_render', model: 'other', storage_path: url, cost_usd: 0, approved: false }).select().single();
      if (iErr) throw iErr;
      asset = data;
    }
    await supabase.from('episodes').update({ final_video_path: url }).eq('id', fresh.id);
    log('video final con narración listo:', url, result.seconds.toFixed(1) + ' s');
    return { asset, shots_joined: result.pieces };
  } finally {
    result.cleanup();
  }
}

module.exports = { mergeEpisodeVideo };
