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
const { ensureMediaBucket, uploadClip } = require('./_storage');

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

    const listPath = path.join(workDir, 'list.txt');
    fs.writeFileSync(listPath, localFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));

    const outputPath = path.join(workDir, 'final.mp4');
    log('uniendo', clips.length, 'tomas con ffmpeg (recodificando — cada toma viene de una llamada distinta a Veo)...');
    await run(ffmpegPath, [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outputPath
    ]);

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

module.exports = { mergeEpisodeVideo };
