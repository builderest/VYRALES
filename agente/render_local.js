// RENDER EN CALIDAD COMPLETA EN TU PC (lo lanza el agente: node agente/render_local.js <episode_id>)
// Supabase gratis no acepta archivos de más de 50 MB, así que el video final que se sube allá va
// recomprimido. Este script arma el MISMO video (mismo plan del editor, mismas voces y música),
// pero sin recomprimir y con mejor calidad, y lo guarda en VYRALE/finales/<serie>_ep<N>.mp4.
// No sube nada, no genera voces ni música (usa las que ya existen): costo $0.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
// Calidad: más lento que en Netlify, pero la PC no tiene límite de 15 min.
process.env.VYRALES_X264_PRESET = process.env.VYRALES_X264_PRESET || 'medium';
process.env.VYRALES_CRF = process.env.VYRALES_CRF || '18';

const FINALES = path.join(ROOT, 'finales');
// Versión de la receta de calidad: si sube, el agente rehace los finales que tenía (2 = 1080x1920).
const QUALITY_V = 2;
const fileNameFor = (slug, n) => `${slug}_ep${n}.mp4`;

async function main() {
  const episodeId = process.argv[2];
  if (!/^[0-9a-f-]{36}$/i.test(episodeId || '')) throw new Error('Uso: node agente/render_local.js <episode_id>');
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const { renderEpisode, run, download } = require(path.join(ROOT, 'netlify', 'functions', '_render'));
  // Caché local de tomas/voces/música: cada archivo de Supabase se baja UNA sola vez a la PC.
  // (Supabase gratis da 5 GB al mes de descargas; rehacer un final bajaba ~100 MB cada vez.)
  // Las URLs de Supabase cambian cuando el archivo cambia (-v<fecha>), así que la caché nunca queda vieja.
  const CACHE = path.join(ROOT, 'finales', '.cache');
  fs.mkdirSync(CACHE, { recursive: true });
  const cachedFetch = async (url, dest) => {
    const key = require('crypto').createHash('sha1').update(url).digest('hex') + path.extname(new URL(url).pathname).slice(0, 6);
    const hit = path.join(CACHE, key);
    if (!fs.existsSync(hit)) { await download(url, hit + '.tmp'); fs.renameSync(hit + '.tmp', hit); }
    fs.copyFileSync(hit, dest);
  };
  const supabase = getSupabaseClient();

  const { data: ep, error } = await supabase.from('episodes').select('*, assets(*)').eq('id', episodeId).single();
  if (error || !ep) throw error || new Error('Episodio no encontrado');
  const { data: series, error: sErr } = await supabase.from('series').select('id, slug, title, genre, story_bible').eq('id', ep.series_id).single();
  if (sErr || !series) throw sErr || new Error('Serie no encontrada');
  const fin = (ep.assets || []).find((a) => a.kind === 'final_render');

  // Misma música que usó la unión en Netlify (si el editor no eligió una: la primera de la biblioteca).
  const plan = ep.edit_plan || {};
  const lib = (series.story_bible && series.story_bible.music_tracks) || [];
  if (!(plan.audio && plan.audio.music_url) && lib[0] && lib[0].url) {
    ep.edit_plan = Object.assign({}, plan, { audio: Object.assign({ normalize: true, duck: true, music_volume: 0.2 }, plan.audio || {}, { music_url: lib[0].url, music_name: lib[0].name }) });
  }

  console.log(`Calidad completa: "${series.title}" EP ${ep.episode_number} (preset ${process.env.VYRALES_X264_PRESET}, crf ${process.env.VYRALES_CRF})`);
  const t0 = Date.now();
  const result = await renderEpisode({ episode: ep, series, log: (...a) => console.log(...a), maxMb: Infinity, fetchFile: cachedFetch });
  try {
    fs.mkdirSync(FINALES, { recursive: true });
    const name = fileNameFor(series.slug, ep.episode_number);
    const dest = path.join(FINALES, name);
    const tmp = dest + '.part.mp4';
    // Subida a 1080x1920: las tomas de Veo vienen en 720x1280 y YouTube/TikTok comprimen MUCHO
    // más fuerte los videos de 720p (un Short en 720p se ve borroso). Escalado lanczos + nitidez
    // suave, calidad alta (crf 18). El audio se copia tal cual.
    console.log('subiendo a 1080x1920 para las redes...');
    await run(['-y', '-i', result.file, '-vf', 'scale=1080:1920:flags=lanczos,unsharp=5:5:0.4:5:5:0.0',
      '-c:v', 'libx264', '-preset', process.env.VYRALES_X264_PRESET, '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy', '-movflags', '+faststart', tmp], path.dirname(result.file));
    fs.renameSync(tmp, dest); // el archivo aparece completo de una vez (nunca a medias)
    // Marca de qué versión del video final es (si se vuelve a unir en Netlify, la PC lo rehace).
    fs.writeFileSync(dest.replace(/\.mp4$/, '.json'), JSON.stringify({
      episode_id: ep.id, series: series.slug, episode_number: ep.episode_number,
      source: fin ? fin.storage_path : null, quality_v: QUALITY_V, seconds: result.seconds, rendered_at: new Date().toISOString()
    }, null, 1));
    const mb = fs.statSync(dest).size / 1048576;
    console.log(`LISTO: finales/${name} · ${mb.toFixed(1)} MB · ${result.seconds.toFixed(1)} s · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  } finally {
    if (result.cleanup) result.cleanup();
  }
}

main().catch((err) => { console.error('ERROR:', err.message || err); process.exit(1); });
