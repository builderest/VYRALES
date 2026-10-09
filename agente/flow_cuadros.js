// CUADROS INICIALES DE UN EPISODIO CON GOOGLE FLOW, TODOS EN UNA SOLA SESIÓN, y luego videos en king.
//   node agente/flow_cuadros.js <episode_id> 1,3,5   (tomas; sin lista = todas)
// Cada toma usa su start_en. El cuadro final se rehace editando el nuevo inicial (FLUX en king). $0.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
(async () => {
  const [epId, list] = process.argv.slice(2);
  if (!/^[0-9a-f-]{36}$/i.test(epId || '')) throw new Error('Uso: node agente/flow_cuadros.js <episode_id> [1,3,5]');
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const { storeKeyframeImage } = require(path.join(ROOT, 'netlify', 'functions', '_keyframe'));
  const { flowImages } = require('./flow_imagenes');
  const supabase = getSupabaseClient();
  const { data: ep } = await supabase.from('episodes').select('id, episode_number, series_id, shots').eq('id', epId).single();
  const { data: series } = await supabase.from('series').select('id, slug').eq('id', ep.series_id).single();
  const want = list ? list.split(',').map(Number) : (ep.shots || []).map((s) => s.n);
  const shots = (ep.shots || []).filter((s) => want.includes(s.n) && (s.start_en || s.action_en));
  console.log('Flow: generando', shots.length, 'cuadros en una sola sesión → tomas', shots.map((s) => s.n).join(','));
  const imgs = await flowImages(shots.map((s) => s.start_en || s.action_en));
  const done = [];
  for (let i = 0; i < shots.length; i++) {
    if (!imgs[i] || imgs[i].error) continue;
    await storeKeyframeImage(supabase, { series, episode: ep, shotN: shots[i].n, image: { imageBytes: imgs[i].buffer.toString('base64'), mimeType: imgs[i].mimeType }, note: 'Google Flow' });
    done.push(shots[i].n);
  }
  // El cuadro final viejo ya no corresponde: se rehace desde el nuevo inicial.
  const { data: fr } = await supabase.from('episodes').select('shots').eq('id', epId).single();
  await supabase.from('episodes').update({ shots: fr.shots.map((x) => (done.includes(x.n) ? Object.assign({}, x, { end_frame_url: null, end_frame_skip: false }) : x)) }).eq('id', epId);
  console.log('Cuadros de Flow guardados:', done.join(',') || 'ninguno');
  if (!done.length) process.exit(1);
  console.log('Ahora los videos en king...');
  execFileSync(process.execPath, [path.join(__dirname, 'regen_local.js'), epId, done.join(',')], { cwd: ROOT, stdio: 'inherit' });
})().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
