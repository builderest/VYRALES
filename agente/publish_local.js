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
const FINALES = path.join(ROOT, 'finales');

async function main() {
  const [epId, platform, privacy] = process.argv.slice(2);
  if (!/^[0-9a-f-]{36}$/i.test(epId || '') || !['tiktok', 'youtube'].includes(platform)) throw new Error('Uso: node agente/publish_local.js <episode_id> <tiktok|youtube> [private]');
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const { runPublish } = require(path.join(ROOT, 'netlify', 'functions', 'social-publish-background'));
  const supabase = getSupabaseClient();

  // El archivo local tiene que ser de la MISMA versión del video final (si no, se usa el de Supabase).
  const loadVideo = async (final) => {
    for (const f of fs.readdirSync(FINALES).filter((x) => /\.json$/.test(x))) {
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(FINALES, f), 'utf8')); } catch (_) { continue; }
      const mp4 = path.join(FINALES, f.replace(/\.json$/, '.mp4'));
      if (meta.episode_id === epId && meta.source === final.storage_path && fs.existsSync(mp4)) {
        const buf = fs.readFileSync(mp4);
        console.log(`Subiendo finales/${path.basename(mp4)} (${(buf.length / 1048576).toFixed(1)} MB, calidad completa) a ${platform}...`);
        return buf;
      }
    }
    throw new Error('No encontré en finales/ la versión en calidad completa de este video final (¿se volvió a unir?). Dale publicar otra vez en un minuto.');
  };
  const r = await runPublish({ supabase, epId, platform, privacy: privacy === 'private' ? 'private' : undefined, loadVideo, quality: 'completa', log: (...a) => console.log(...a) });
  if (!r.ok) throw new Error(r.error);
  console.log('LISTO: publicado desde la PC en calidad completa.');
}

main().catch((err) => { console.error('ERROR:', err.message || err); process.exit(1); });
