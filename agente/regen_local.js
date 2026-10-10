// REHACER TOMAS EN LA PC KING (lo lanza el agente: node agente/regen_local.js <episode_id> <tomas> [tomas_con_cuadro_nuevo])
//   ej.: node agente/regen_local.js 3248...  2,9,10  8   → rehace los videos 2, 9, 10 y 8 (a la 8 también el cuadro)
// Usa el mismo regen-shot-background de vyrales.app con el proveedor "king" (LTX, gratis) y el prompt
// corregido. Al final vuelve a unir el video final (y el agente rehace la calidad completa solo).
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
process.env.VYRALES_LOCAL_RUN = '1';
const nums = (s) => String(s || '').split(',').map(Number).filter((n) => n >= 1 && n <= 60);

async function main() {
  const [epId, a, b] = process.argv.slice(2);
  if (!/^[0-9a-f-]{36}$/i.test(epId || '')) throw new Error('Uso: node agente/regen_local.js <episode_id> 2,9,10 8');
  const videoOnly = nums(a);
  const withFrame = nums(b);
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const supabase = getSupabaseClient();
  const { data: ep } = await supabase.from('episodes').select('id, episode_number, series_id, assets(id, kind, shot_number, created_at)').eq('id', epId).single();
  const { data: series } = await supabase.from('series').select('id, slug, title, genre, story_bible').eq('id', ep.series_id).single();
  const { handler } = require(path.join(ROOT, 'netlify', 'functions', 'regen-shot-background'));
  const todo = [...withFrame.map((n) => [n, true]), ...videoOnly.filter((n) => !withFrame.includes(n)).map((n) => [n, false])].sort((x, y) => x[0] - y[0]);
  const fallas = [];
  for (const [n, frame] of todo) {
    const asset = (ep.assets || []).filter((x) => x.kind === 'video_clip' && x.shot_number === n).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))[0];
    if (!asset) { console.log(`toma ${n}: no tiene video, la salto`); continue; }
    console.log(`\nTOMA ${n}: rehaciendo ${frame ? 'cuadro inicial + video' : 'video'} en king...`);
    const r = await handler({ httpMethod: 'POST', body: JSON.stringify({ assetId: asset.id, provider: 'king', new_frame: frame }) });
    if (r.statusCode >= 400) { console.log(`TOMA ${n}: FALLÓ ${String(r.body).slice(0, 300)}`); fallas.push(n); } else console.log(`TOMA ${n}: lista ✅`);
  }
  // Control de calidad automático (duración contra la voz + clips congelados).
  try { await require('./_qa').qaShots({ supabase, epId, handler, log: (...x) => console.log(...x) }); }
  catch (e) { console.log('QA: no se pudo (' + String(e.message).slice(0, 200) + ')'); }
  console.log('\nUniendo el video final de nuevo...');
  const { mergeEpisodeVideo } = require(path.join(ROOT, 'netlify', 'functions', '_merge'));
  const { data: fresh } = await supabase.from('episodes').select('*, assets(*)').eq('id', epId).single();
  const res = await mergeEpisodeVideo(supabase, { episode: fresh, series, log: (...x) => console.log(...x) });
  console.log('LISTO. Video final:', res.asset && res.asset.storage_path, fallas.length ? '· fallaron: ' + fallas.join(', ') : '');
  if (fallas.length) process.exit(1);
}
main().catch((err) => { console.error('ERROR:', err.message || err); process.exit(1); });
