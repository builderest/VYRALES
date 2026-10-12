// PUBLICAR DESDE TU PC EN CALIDAD COMPLETA (lo lanza el agente: node agente/publish_local.js <episode_id> <tiktok|youtube> [private])
// Usa exactamente la misma lógica que el botón de vyrales.app (social-publish-background.js:
// mismos textos, misma etiqueta de IA, mismas cuentas conectadas), pero el video sale del archivo
// sin recomprimir de VYRALE/finales en vez del de Supabase (que va recomprimido por el límite de 50 MB).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
// Dónde se guardan los videos grandes: VYRALES_FINALES_DIR en el .env (ej. \\\\100.66.84.73\\VYRALES_videos,
// la carpeta compartida de king por Tailscale). Si no está, VYRALE/finales en esta PC.
const FINALES = process.env.VYRALES_FINALES_DIR || path.join(ROOT, 'finales');

async function main() {
  const [epId, platform, privacy] = process.argv.slice(2);
  if (!/^[0-9a-f-]{36}$/i.test(epId || '') || !['tiktok', 'youtube', 'facebook', 'instagram'].includes(platform)) throw new Error('Uso: node agente/publish_local.js <episode_id> <tiktok|youtube|facebook|instagram> [private]');
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const { runPublish } = require(path.join(ROOT, 'netlify', 'functions', 'social-publish-background'));
  const supabase = getSupabaseClient();

  // El archivo local tiene que ser de la MISMA versión del video final (si no, se usa el de Supabase).
  const loadVideo = async (final) => {
    // Busca en la carpeta de cada serie (y en la raíz, por si quedó algo viejo).
    const jsons = [];
    for (const d of fs.readdirSync(FINALES, { withFileTypes: true })) {
      if (d.isDirectory() && !d.name.startsWith('.')) fs.readdirSync(path.join(FINALES, d.name)).filter((x) => /_ep\d+(-nuevo)?\.json$/.test(x)).forEach((x) => jsons.push(path.join(FINALES, d.name, x)));
      else if (d.isFile() && /\.json$/.test(d.name)) jsons.push(path.join(FINALES, d.name));
    }
    // Si el archivo estaba abierto, render_local deja la versión nueva como "-nuevo": se usa la más reciente (rendered_at).
    const when = (jf) => { try { return String(JSON.parse(fs.readFileSync(jf, 'utf8')).rendered_at || ''); } catch (_) { return ''; } };
    jsons.sort((a, b) => when(b).localeCompare(when(a)));
    for (const jf of jsons) {
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch (_) { continue; }
      const mp4 = jf.replace(/\.json$/, '.mp4');
      if (meta.episode_id === epId && meta.source === final.storage_path && fs.existsSync(mp4)) {
        const buf = fs.readFileSync(mp4);
        console.log(`Subiendo finales/${path.basename(mp4)} (${(buf.length / 1048576).toFixed(1)} MB, calidad completa) a ${platform}...`);
        return buf;
      }
    }
    throw new Error('No encontré en finales/ la versión en calidad completa de este video final (¿se volvió a unir?). Dale publicar otra vez en un minuto.');
  };
  const r = await runPublish({ supabase, epId, platform, privacy: privacy === 'public' ? 'public' : privacy === 'private' ? 'private' : undefined, loadVideo, quality: 'completa', log: (...a) => console.log(...a) });
  if (!r.ok) throw new Error(r.error);
  console.log('LISTO: publicado desde la PC en calidad completa.');
  // YouTube (largo y Short): portada épica automática (Claude elige el cuadro y el texto; portada_yt.js).
  if (platform === 'youtube') {
    const { data: e2 } = await supabase.from('episodes').select('continuity, validator_report').eq('id', epId).single();
    const vid = (((e2.validator_report || {}).social_runs || {}).youtube || {}).video_id;
    if (vid && (e2.continuity || {}).parent_episode_id) {
      // Short que lleva al largo: "video relacionado" en Studio (el único enlace que se puede tocar en un Short).
      console.log('Poniendo el video relacionado (el largo) en el Short...');
      const { spawnSync } = require('child_process');
      const pr = spawnSync(process.execPath, [path.join(__dirname, 'yt_relacionado.js'), epId], { encoding: 'utf8', timeout: 8 * 60000 });
      console.log(String(pr.stdout || '').split(/\r?\n/).filter((l) => /relacionado|LISTO|ERROR|AVISO/.test(l)).join('\n'));
    }
    if (vid) { // largo (1280x720) y Short (1080x1920): siempre portada épica (Franklin, oct-12)
      console.log('Haciendo la portada de YouTube...');
      const { spawnSync } = require('child_process');
      const pr = spawnSync(process.execPath, [path.join(__dirname, 'portada_yt.js'), epId, vid], { encoding: 'utf8', timeout: 25 * 60000 });
      console.log(String(pr.stdout || '').split(/\r?\n/).filter((l) => /Elegidas|Ganadora|Portada|portada|ERROR/.test(l)).join('\n'));
    }
  }
}

main().catch((err) => { console.error('ERROR:', err.message || err); process.exit(1); });
