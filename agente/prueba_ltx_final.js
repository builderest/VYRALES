// PRUEBA: LTX con cuadro INICIAL + cuadro FINAL (lo lanza el agente: node agente/prueba_ltx_final.js [episode_id] [toma_inicio] [toma_fin])
// Usa el cuadro de una toma como inicio y el de otra como final, para ver si LTX llega al cuadro final.
// Deja en <videos>\<serie>\prueba_ltx_final\: con_final.mp4 y solo_inicio.mp4 (para comparar). Gratis (king).
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const FINALES = process.env.VYRALES_FINALES_DIR || path.join(ROOT, 'finales');
async function main() {
  const epId = process.argv[2] || '30fc0466-e501-43ff-be69-3b39b144c475';
  const a = Number(process.argv[3] || 3), b = Number(process.argv[4] || 4);
  const F = path.join(ROOT, 'netlify', 'functions');
  const { getSupabaseClient } = require(path.join(F, '_supabase'));
  const K = require(path.join(F, '_king'));
  const supabase = getSupabaseClient();
  const { data: ep } = await supabase.from('episodes').select('id, shots, series_id, assets(kind, shot_number, storage_path, created_at)').eq('id', epId).single();
  const { data: series } = await supabase.from('series').select('slug, story_bible').eq('id', ep.series_id).single();
  const latest = (n) => (ep.assets || []).filter((x) => x.kind === 'image' && x.shot_number === n && x.storage_path).sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))[0];
  const fa = latest(a), fb = latest(b);
  if (!fa || !fb) throw new Error('faltan cuadros de las tomas ' + a + ' / ' + b);
  const img = async (u) => ({ imageBytes: Buffer.from(await (await fetch(u)).arrayBuffer()).toString('base64'), mimeType: 'image/jpeg' });
  // ¿king tiene los nodos?
  const base = (process.env.VYRALES_GEN_URL || 'http://100.66.84.73:8188').replace(/\/$/, '');
  for (const n of ['LTXVAddGuide', 'LTXVCropGuides']) {
    const r = await fetch(base + '/object_info/' + n).then((x) => x.json()).catch((e) => ({ err: e.message }));
    console.log('nodo', n, r && r[n] ? 'SÍ está en king' : 'NO está en king ' + JSON.stringify(r).slice(0, 120));
  }
  const OUT = path.join(FINALES, series.slug, 'prueba_ltx_final');
  fs.mkdirSync(OUT, { recursive: true });
  const shot = (ep.shots || []).find((s) => s.n === a);
  const prompt = K.ltxPromptFor(shot, series.story_bible || {}) + ' The camera moves continuously and the scene transforms smoothly until it ends exactly on the final composition.';
  const negative = K.ltxNegativeFor(shot, series.story_bible || {});
  const start = await img(fa.storage_path), end = await img(fb.storage_path);
  fs.writeFileSync(path.join(OUT, 'inicio.jpg'), Buffer.from(start.imageBytes, 'base64'));
  fs.writeFileSync(path.join(OUT, 'final.jpg'), Buffer.from(end.imageBytes, 'base64'));
  let t = Date.now();
  const r1 = await K.kingGenerateVideo({ prompt, negative, startImage: start, endImage: end, durationSeconds: 8, log: console.log });
  fs.writeFileSync(path.join(OUT, 'con_final.mp4'), r1.videoBuffer);
  console.log('CON FINAL listo en', Math.round((Date.now() - t) / 1000), 's');
  t = Date.now();
  const r2 = await K.kingGenerateVideo({ prompt, negative, startImage: start, durationSeconds: 8, log: console.log });
  fs.writeFileSync(path.join(OUT, 'solo_inicio.mp4'), r2.videoBuffer);
  console.log('SOLO INICIO listo en', Math.round((Date.now() - t) / 1000), 's');
  console.log('LISTO →', OUT);
}
main().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
