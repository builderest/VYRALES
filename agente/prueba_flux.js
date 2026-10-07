// PRUEBA DE CUADROS INICIALES CON FLUX.2 KLEIN EN LA PC "KING" vs GEMINI
// (lo lanza el agente: node agente/prueba_flux.js [episode_id] [tomas])
// Mismo guion, mismas fotos de cara y misma imagen del lugar que usa Gemini. Deja en
// <videos>\<serie>\prueba_flux\:  t<NN>_gemini.jpg · t<NN>_flux.png · t<NN>_comparar.jpg (IZQ Gemini · DER Flux)
// Gratis (king). No toca el episodio (solo lee).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const GEN = (process.env.VYRALES_GEN_URL || 'http://100.66.84.73:8188').replace(/\/$/, '');
const FINALES = process.env.VYRALES_FINALES_DIR || path.join(ROOT, 'finales');
const TEMPLATE = path.join(__dirname, 'flux2_edit_api.json');
const ffmpeg = require(path.join(ROOT, 'node_modules', 'ffmpeg-static'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (args) => new Promise((res, rej) => execFile(ffmpeg, args, { maxBuffer: 1 << 26 }, (e, so, se) => (e ? rej(new Error(String(se).slice(-500))) : res())));

async function j(url, opts) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(60000) }, opts || {}));
  if (!r.ok) throw new Error('king ' + url.replace(GEN, '') + ' → HTTP ' + r.status + ' ' + (await r.text()).slice(0, 400));
  return r.json();
}
async function upload(buf, mime, name) {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type: mime || 'image/jpeg' }), name);
  fd.append('overwrite', 'true');
  const up = await j(GEN + '/upload/image', { method: 'POST', body: fd });
  return up.subfolder ? up.subfolder + '/' + up.name : up.name;
}

// Plantilla "Flux.2 [Klein] 4B: Image Edit" con UNA referencia → N referencias encadenadas
// (fotos de cara + imagen del lugar) y salida vertical 768×1344 (~1 MP, 9:16).
function buildGraph(refNames, prompt, tag) {
  const wf = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  delete wf['81']; // segunda LoadImage de la plantilla que no está conectada
  wf['76'].inputs.image = refNames[0];
  let pos = ['75:124', 0];
  let neg = ['75:122', 0];
  refNames.slice(1).forEach((name, i) => {
    const k = 'vy' + (i + 2);
    wf[k + 'load'] = { class_type: 'LoadImage', inputs: { image: name } };
    wf[k + 'scale'] = { class_type: 'ImageScaleToTotalPixels', inputs: { upscale_method: 'lanczos', megapixels: 1, resolution_steps: 1, image: [k + 'load', 0] } };
    wf[k + 'enc'] = { class_type: 'VAEEncode', inputs: { pixels: [k + 'scale', 0], vae: ['75:72', 0] } };
    wf[k + 'pos'] = { class_type: 'ReferenceLatent', inputs: { conditioning: pos, latent: [k + 'enc', 0] } };
    wf[k + 'neg'] = { class_type: 'ReferenceLatent', inputs: { conditioning: neg, latent: [k + 'enc', 0] } };
    pos = [k + 'pos', 0];
    neg = [k + 'neg', 0];
  });
  wf['75:63'].inputs.positive = pos;
  wf['75:63'].inputs.negative = neg;
  wf['75:80'].inputs.upscale_method = 'lanczos';
  // Tamaño fijo vertical (la plantilla copiaba el tamaño de la 1ª referencia).
  wf['75:66'].inputs.width = 768; wf['75:66'].inputs.height = 1344;
  wf['75:62'].inputs.width = 768; wf['75:62'].inputs.height = 1344;
  wf['75:74'].inputs.text = prompt;
  wf['75:67'].inputs.text = 'text, letters, watermark, logo, collage, split screen, panels, border, deformed hands, extra fingers, extra limbs, distorted face, cartoon, plastic skin';
  wf['75:73'].inputs.noise_seed = crypto.randomInt(1, 2 ** 31);
  wf['9'].inputs.filename_prefix = 'vyrales/' + tag;
  return wf;
}

async function main() {
  const epId = process.argv[2] || '324819f9-f86c-499b-ab9f-c2233d9d2f95';
  const pick = (process.argv[3] || '2,8,10').split(',').map(Number);
  if (!/^[0-9a-f-]{36}$/i.test(epId)) throw new Error('Uso: node agente/prueba_flux.js <episode_id> 2,8,10');
  if (!fs.existsSync(TEMPLATE)) throw new Error('Falta agente/flux2_edit_api.json');
  const st = await j(GEN + '/system_stats');
  console.log('king responde ·', st.devices && st.devices[0] && st.devices[0].name);

  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const { keyframeReferences, effectiveKeyframePrompt } = require(path.join(ROOT, 'netlify', 'functions', '_keyframe'));
  const supabase = getSupabaseClient();
  const { data: ep, error } = await supabase.from('episodes').select('id, episode_number, shots, series_id, assets(kind, shot_number, storage_path, created_at)').eq('id', epId).single();
  if (error || !ep) throw error || new Error('Episodio no encontrado');
  const { data: series } = await supabase.from('series').select('id, slug, story_bible, visual_memory').eq('id', ep.series_id).single();
  const { data: characters } = await supabase.from('characters').select('name, fixed_prompt_tag, profile, reference_image_url').eq('series_id', series.id);
  const OUT = path.join(FINALES, series.slug, 'prueba_flux');
  fs.mkdirSync(OUT, { recursive: true });

  const tiempos = [];
  for (const n of pick) {
    const shot = (ep.shots || []).find((s) => s.n === n);
    if (!shot) { console.log('toma', n, 'no existe'); continue; }
    const base = `ep${ep.episode_number}_t${String(n).padStart(2, '0')}`;
    console.log(`\nTOMA ${n} (${shot.location}, ${(shot.characters || []).join(' + ')})`);
    const { refs, hasLocationRef } = await keyframeReferences(shot, characters, series.visual_memory);
    const names = [];
    for (let i = 0; i < refs.length; i++) names.push(await upload(Buffer.from(refs[i].imageBytes, 'base64'), refs[i].mimeType, `${series.slug}_${base}_ref${i + 1}.jpg`));
    const prompt = 'Reference images in order: ' + refs.map((r, i) => `image ${i + 1} = ${r.label}`).join('; ') + '. ' + effectiveKeyframePrompt(shot, characters, series.story_bible, hasLocationRef);
    const t0 = Date.now();
    const { prompt_id } = await j(GEN + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: buildGraph(names, prompt, base), client_id: 'vyrales' }) });
    let img = null;
    for (;;) {
      await sleep(3000);
      if (Date.now() - t0 > 15 * 60000) throw new Error('king tardó más de 15 min');
      const item = (await j(GEN + '/history/' + prompt_id))[prompt_id];
      if (!item) continue;
      const s = item.status || {};
      if (s.status_str === 'error') throw new Error('ComfyUI dio error: ' + JSON.stringify((s.messages || []).filter((m) => m[0] === 'execution_error')).slice(0, 700));
      const f = (((item.outputs || {})['9'] || {}).images || [])[0];
      if (!f) { if (s.completed) throw new Error('terminó sin imagen'); continue; }
      const r = await fetch(`${GEN}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || '')}&type=${encodeURIComponent(f.type || 'output')}`);
      img = Buffer.from(await r.arrayBuffer());
      break;
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    const fluxPath = path.join(OUT, base + '_flux.png');
    fs.writeFileSync(fluxPath, img);
    const gem = (ep.assets || []).filter((a) => a.kind === 'image' && a.shot_number === n && a.storage_path).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (gem) {
      const gemPath = path.join(OUT, base + '_gemini.jpg');
      fs.writeFileSync(gemPath, Buffer.from(await (await fetch(gem.storage_path)).arrayBuffer()));
      await run(['-y', '-i', gemPath, '-i', fluxPath, '-filter_complex', '[0:v]scale=-2:1344,setsar=1[a];[1:v]scale=-2:1344,setsar=1[b];[a][b]hstack=inputs=2', '-q:v', '3', path.join(OUT, base + '_comparar.jpg')]);
    }
    console.log(`TOMA ${n}: LISTA en ${secs} s → ${series.slug}\\prueba_flux\\${base}_comparar.jpg`);
    tiempos.push(`T${n} ${secs}s`);
  }
  console.log('\nLISTO. Tiempos en king:', tiempos.join(' · '));
}

main().catch((err) => { console.error('ERROR:', err.message || err); process.exit(1); });
