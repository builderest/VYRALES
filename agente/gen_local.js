// PRODUCIR UN EPISODIO EN LA PC (lo lanza el agente: node agente/gen_local.js <episode_id>)
// Corre el MISMO generador que vyrales.app (generate-media-background.js: cuadros iniciales,
// voces, unión automática, textos para publicar) pero aquí en Cronix y con el proveedor "king":
// cada toma la genera LTX-2.5 en la PC king por Tailscale (gratis). Solo se paga lo de Google
// que no es video: cuadros iniciales (~$0.067 c/u) y voces (~$0.004 c/u).
// Sin el límite de 15 min de Netlify (un episodio de 20 tomas tarda ~30-40 min en king).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
process.env.VYRALES_LOCAL_RUN = '1'; // sin límite de tiempo ni auto-llamadas a Netlify

async function main() {
  const episodeId = process.argv[2];
  if (!/^[0-9a-f-]{36}$/i.test(episodeId || '')) throw new Error('Uso: node agente/gen_local.js <episode_id>');
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const supabase = getSupabaseClient();
  const { data: ep, error } = await supabase.from('episodes').select('id, episode_number, series_id, status').eq('id', episodeId).single();
  if (error || !ep) throw error || new Error('Episodio no encontrado');
  const { data: series } = await supabase.from('series').select('slug, title').eq('id', ep.series_id).single();
  console.log(`Produciendo "${series.title}" EP ${ep.episode_number}${Number(process.argv[3]) ? ' (solo la toma ' + process.argv[3] + ')' : ''} con LTX-2.5 en king...`);
  const { handler } = require(path.join(ROOT, 'netlify', 'functions', 'generate-media-background'));
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify(Object.assign({ series: series.slug, episode_id: episodeId, provider: 'king', force: ep.status === 'generando_media' }, Number(process.argv[3]) ? { shot: Number(process.argv[3]) } : {})), queryStringParameters: {}, headers: {} });
  console.log('RESULTADO', res.statusCode, String(res.body || '').slice(0, 800));
  if (res.statusCode >= 400) process.exit(1);
  // Control de calidad automático: si alguna toma salió corta o congelada, se rehace sola y se vuelve a unir.
  if (!Number(process.argv[3])) {
    try {
      const { handler: regen } = require(path.join(ROOT, 'netlify', 'functions', 'regen-shot-background'));
      const redone = await require('./_qa').qaShots({ supabase, epId: episodeId, handler: regen, log: (...x) => console.log(...x) });
      if (redone.length) {
        const { mergeEpisodeVideo } = require(path.join(ROOT, 'netlify', 'functions', '_merge'));
        const { data: fresh } = await supabase.from('episodes').select('*, assets(*)').eq('id', episodeId).single();
        const { data: sr } = await supabase.from('series').select('id, slug, title, genre, story_bible').eq('id', ep.series_id).single();
        const m = await mergeEpisodeVideo(supabase, { episode: fresh, series: sr, log: (...x) => console.log(...x) });
        console.log('QA: video final unido de nuevo:', m.asset && m.asset.storage_path);
      }
    } catch (e) { console.log('QA: no se pudo (' + String(e.message).slice(0, 200) + ')'); }
  }
}
main().catch((err) => { console.error('ERROR:', err.message || err); process.exit(1); });
