// PRUEBA: cuadros inicial + final con FLUX.2 Klein en king para videos de naturaleza (sin caras). Gratis.
// Inicial = texto→imagen. Final = edición del inicial (misma escena, acción avanzada).
// Deja los PNG en <repo>\_to_delete\flux_nat\  (node agente/prueba_flux_nat.js)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const GEN = (process.env.VYRALES_GEN_URL || 'http://100.66.84.73:8188').replace(/\/$/, '');
const TEMPLATE = path.join(__dirname, 'flux2_edit_api.json');
const OUT = path.join(ROOT, '_to_delete', 'flux_nat');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RULE = ' Vertical 9:16, photorealistic, cinematic nature documentary photo, dramatic lighting, sharp detail. No people, no hands, no humans, no text.';
const NEG = 'people, human, hands, fingers, man, woman, human eye, text, letters, watermark, logo, collage, split screen, border, cartoon, cgi, plastic';
const SHOTS = [
  { n: 10, start: "Close-up of the side of a giant red squid's head in the dark deep ocean, its enormous round eye the size of a dinner plate, glossy black pupil, wet red spotted squid skin around it, floating particles. It is a squid eye, not a human eye.",
    end: 'Same squid, same lighting, camera much closer: the giant squid eye fills most of the frame, huge glossy black pupil, red spotted squid skin around it.' },
  { n: 8, start: "Underwater close-up of a great white shark's head swimming toward the camera in blue ocean water, mouth starting to open, sun rays from above, bubbles.",
    end: 'Same shark, same water and light, camera closer: the jaws are wide open showing rows of serrated triangular teeth one behind another.' },
  { n: 3, start: 'Underwater view looking up toward the bright sunlit surface: five dark silhouettes of ocean predators side by side, a giant octopus, a great white shark, a giant squid, an orca and a sperm whale, sun rays falling between them, floating particles.',
    end: 'Same scene, camera pulled back and lower, the five predator silhouettes have swum forward and spread apart, sun rays shifted, more particles.' },
];
async function j(url, opts) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(60000) }, opts || {}));
  if (!r.ok) throw new Error('king ' + url.replace(GEN, '') + ' → HTTP ' + r.status + ' ' + (await r.text()).slice(0, 400));
  return r.json();
}
async function upload(buf, name) {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type: 'image/png' }), name);
  fd.append('overwrite', 'true');
  const up = await j(GEN + '/upload/image', { method: 'POST', body: fd });
  return up.subfolder ? up.subfolder + '/' + up.name : up.name;
}
function graph(prompt, refName, tag) {
  const wf = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  delete wf['81'];
  if (refName) {
    wf['76'].inputs.image = refName;
    wf['75:63'].inputs.positive = ['75:124', 0];
    wf['75:63'].inputs.negative = ['75:122', 0];
  } else {
    for (const k of ['76', '75:80', '75:100', '75:123', '75:122', '75:124']) delete wf[k];
    wf['75:63'].inputs.positive = ['75:74', 0];
    wf['75:63'].inputs.negative = ['75:67', 0];
  }
  wf['75:66'].inputs.width = 768; wf['75:66'].inputs.height = 1344;
  wf['75:62'].inputs.width = 768; wf['75:62'].inputs.height = 1344;
  wf['75:74'].inputs.text = prompt;
  wf['75:67'].inputs.text = NEG;
  wf['75:73'].inputs.noise_seed = crypto.randomInt(1, 2 ** 31);
  wf['9'].inputs.filename_prefix = 'vyrales/' + tag;
  return wf;
}
async function render(wf) {
  const t0 = Date.now();
  const { prompt_id } = await j(GEN + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'vyrales' }) });
  for (;;) {
    await sleep(3000);
    if (Date.now() - t0 > 10 * 60000) throw new Error('king tardó más de 10 min');
    const item = (await j(GEN + '/history/' + prompt_id))[prompt_id];
    if (!item) continue;
    const s = item.status || {};
    if (s.status_str === 'error') throw new Error('ComfyUI error: ' + JSON.stringify((s.messages || []).filter((m) => m[0] === 'execution_error')).slice(0, 700));
    const f = (((item.outputs || {})['9'] || {}).images || [])[0];
    if (!f) { if (s.completed) throw new Error('terminó sin imagen'); continue; }
    const r = await fetch(`${GEN}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || '')}&type=${encodeURIComponent(f.type || 'output')}`);
    return { buf: Buffer.from(await r.arrayBuffer()), secs: Math.round((Date.now() - t0) / 1000) };
  }
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const st = await j(GEN + '/system_stats');
  console.log('king responde ·', st.devices && st.devices[0] && st.devices[0].name);
  for (const s of SHOTS) {
    const a = await render(graph(s.start + RULE, null, `nat_t${s.n}_ini`));
    fs.writeFileSync(path.join(OUT, `t${s.n}_inicio.png`), a.buf);
    console.log(`TOMA ${s.n}: inicio en ${a.secs}s`);
    const ref = await upload(a.buf, `nat_t${s.n}_ini.png`);
    const b = await render(graph('Edit this image: ' + s.end + RULE, ref, `nat_t${s.n}_fin`));
    fs.writeFileSync(path.join(OUT, `t${s.n}_final.png`), b.buf);
    console.log(`TOMA ${s.n}: final en ${b.secs}s`);
  }
  console.log('LISTO → _to_delete\\flux_nat');
})().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
