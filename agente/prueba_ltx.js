// PRUEBA LTX-2.5 EN LA PC "KING" vs VEO (lo lanza el agente: node agente/prueba_ltx.js [episode_id] [tomas])
// Toma 3 tomas REALES de un episodio (mismo cuadro inicial, mismo guion), las genera con LTX-2.5 en
// el ComfyUI de king por Tailscale y deja en VYRALE/finales/prueba_ltx/:
//   <serie>_ep<N>_t<NN>_veo.mp4   ← la toma original (Veo)
//   <serie>_ep<N>_t<NN>_ltx.mp4   ← la misma toma con LTX-2.5 (sin audio)
//   <serie>_ep<N>_t<NN>_comparar.mp4 ← lado a lado: IZQUIERDA Veo · DERECHA LTX
// No gasta nada (king es tuya). No toca el episodio ni Supabase (solo lee).
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
const TEMPLATE = path.join(__dirname, 'ltx2_api.json');
const OUT = path.join(process.env.VYRALES_FINALES_DIR || path.join(ROOT, 'finales'), 'prueba_ltx');
const ffmpeg = require(path.join(ROOT, 'node_modules', 'ffmpeg-static'));

// Nodos de la plantilla video_ltx2_5_i2v exportada (Workflow → Export (API)).
const N = { image: '395', prompt: '398:376', negative: '398:373', width: '398:372', height: '398:360', duration: '398:362', fps: '398:361', seedA: '398:339', seedB: '398:338', save: '75' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (args) => new Promise((res, rej) => execFile(ffmpeg, args, { maxBuffer: 1 << 26 }, (e, so, se) => (e ? rej(new Error(String(se).slice(-600))) : res())));

// El prompt de Veo trae nombres internos (NeandertalUno) y cosas de diálogo; LTX quiere una
// descripción corta y concreta de lo que pasa en cámara.
function ltxPrompt(shot) {
  const clean = (t) => String(t || '').replace(/\b([A-Z][a-z]+)(Uno|Dos|Tres|Cuatro)\b/g, (_, a, b) => ({ Uno: 'the first ', Dos: 'the second ', Tres: 'the third ', Cuatro: 'the fourth ' }[b] + a.toLowerCase())).replace(/\s+/g, ' ').trim();
  const cam = clean(shot.camera);
  const moving = /push|pull|dolly|pan|tilt|track|zoom|orbit|crane|handheld/i.test(cam);
  // LTX entiende mejor una descripción larga y en orden: cuadro → acción → final, con la cámara
  // y el fondo dichos explícitamente (si no, se acerca solo e inventa el fondo).
  return [
    'The video starts exactly on the provided image and keeps its composition, people, clothing, lighting and background.',
    'Scene at the start: ' + clean(shot.start_en) + '.',
    'Then, slowly and naturally: ' + clean(shot.action_en) + '.',
    'By the end: ' + clean(shot.reaction_en) + '.',
    moving
      ? 'Camera: ' + cam + ', very slow and subtle, the framing stays close to the first frame.'
      : 'Camera: ' + (cam ? cam + '. ' : '') + 'Locked-off tripod shot. The camera does not move at all: no zoom, no push-in, no pan, fixed framing for the whole clip.',
    'The background, rocks, terrain and sky stay exactly the same as in the first frame; nothing new appears or is built.',
    'Photorealistic cinematic documentary footage, natural subtle body motion, consistent faces. Nobody speaks, mouths stay closed. No text, no subtitles.'
  ].join(' ').replace(/\.\s*\./g, '.').replace(/\s+/g, ' ');
}

async function j(url, opts) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(60000) }, opts || {}));
  if (!r.ok) throw new Error(url.replace(GEN, 'king') + ' → HTTP ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return r.json();
}

async function genShot({ shot, frameBuf, tag }) {
  // 1) subir el cuadro inicial a king
  const fd = new FormData();
  fd.append('image', new Blob([frameBuf], { type: 'image/jpeg' }), tag + '.jpg');
  fd.append('overwrite', 'true');
  const up = await j(GEN + '/upload/image', { method: 'POST', body: fd });
  // 2) plantilla con nuestros datos
  const wf = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  wf[N.image].inputs.image = up.subfolder ? up.subfolder + '/' + up.name : up.name;
  wf[N.prompt].inputs.value = ltxPrompt(shot);
  wf[N.negative].inputs.text = 'pc game, console game, video game, cartoon, childish, ugly, text, watermark, subtitles, distorted face, deformed hands, extra fingers, flicker, talking, lip movement';
  wf[N.width].inputs.value = 704;   // vertical 9:16 (múltiplos de 32; la 1ª pasada va a la mitad y el escalador ×2 la sube)
  wf[N.height].inputs.value = 1280;
  wf[N.duration].inputs.value = 8;  // 8 s × 24 fps + 1 = 193 cuadros
  wf[N.seedA].inputs.noise_seed = crypto.randomInt(1, 2 ** 31);
  wf[N.seedB].inputs.noise_seed = crypto.randomInt(1, 2 ** 31);
  wf[N.save].inputs.filename_prefix = 'vyrales/' + tag;
  // Fuerza del cuadro inicial en la 1ª pasada: 0.7 (plantilla) dejaba que LTX se alejara del cuadro
  // (zoom solo, fondo inventado). Con VYRALES_LTX_STRENGTH se puede ajustar sin tocar código.
  wf['398:357'].inputs.strength = Number(process.env.VYRALES_LTX_STRENGTH || 1);
  // 3) encolar y esperar
  const t0 = Date.now();
  const { prompt_id } = await j(GEN + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'vyrales-agente' }) });
  console.log(`  encolado en king (${prompt_id}). Prompt: ${wf[N.prompt].inputs.value}`);
  for (;;) {
    await sleep(5000);
    const h = await j(GEN + '/history/' + prompt_id);
    const item = h[prompt_id];
    if (!item) { if (Date.now() - t0 > 30 * 60000) throw new Error('king tardó más de 30 min'); continue; }
    const st = item.status || {};
    if (st.status_str === 'error') throw new Error('ComfyUI dio error: ' + JSON.stringify((st.messages || []).filter((m) => m[0] === 'execution_error')).slice(0, 600));
    const outs = (item.outputs || {})[N.save] || {};
    const files = [].concat(outs.images || [], outs.videos || [], outs.gifs || []);
    if (!files.length) { if (st.completed) throw new Error('terminó sin video: ' + JSON.stringify(item.outputs).slice(0, 300)); continue; }
    const f = files[0];
    const r = await fetch(`${GEN}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || '')}&type=${encodeURIComponent(f.type || 'output')}`);
    if (!r.ok) throw new Error('no pude bajar el video de king (HTTP ' + r.status + ')');
    return { buf: Buffer.from(await r.arrayBuffer()), seconds: (Date.now() - t0) / 1000, prompt: wf[N.prompt].inputs.value };
  }
}

async function main() {
  const epId = process.argv[2] || 'c95dbf11-396a-4cd3-b358-438fd3251b61';
  const pick = (process.argv[3] || '1,3,9').split(',').map(Number);
  if (!/^[0-9a-f-]{36}$/i.test(epId) || pick.some((n) => !(n >= 1 && n <= 60))) throw new Error('Uso: node agente/prueba_ltx.js <episode_id> 1,3,9');
  if (!fs.existsSync(TEMPLATE)) throw new Error('Falta agente/ltx2_api.json');
  const st = await j(GEN + '/system_stats');
  console.log('king responde ·', st.devices && st.devices[0] && st.devices[0].name);

  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const supabase = getSupabaseClient();
  const { data: ep, error } = await supabase.from('episodes').select('id, episode_number, shots, series_id, assets(kind, shot_number, storage_path, created_at)').eq('id', epId).single();
  if (error || !ep) throw error || new Error('Episodio no encontrado');
  const { data: series } = await supabase.from('series').select('slug').eq('id', ep.series_id).single();
  fs.mkdirSync(OUT, { recursive: true });
  const latest = (kind, n) => (ep.assets || []).filter((a) => a.kind === kind && a.shot_number === n && a.storage_path).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];

  const resumen = [];
  for (const n of pick) {
    const shot = (ep.shots || []).find((s) => s.n === n);
    const frame = latest('image', n);
    const clip = latest('video_clip', n);
    if (!shot || !frame || !clip) { console.log(`toma ${n}: sin guion, cuadro o video Veo; la salto`); continue; }
    const base = `${series.slug}_ep${ep.episode_number}_t${String(n).padStart(2, '0')}` + (process.env.VYRALES_PRUEBA_TAG || '_v2');
    console.log(`\nTOMA ${n}: generando con LTX-2.5 en king...`);
    const frameBuf = Buffer.from(await (await fetch(frame.storage_path)).arrayBuffer());
    const g = await genShot({ shot, frameBuf, tag: base });
    const raw = path.join(OUT, base + '_ltx_raw.mp4');
    fs.writeFileSync(raw, g.buf);
    const ltx = path.join(OUT, base + '_ltx.mp4');
    await run(['-y', '-i', raw, '-an', '-c:v', 'copy', ltx]); // sin el audio de LTX: las voces las pone VYRALES
    fs.unlinkSync(raw);
    const veo = path.join(OUT, base + '_veo.mp4');
    fs.writeFileSync(veo, Buffer.from(await (await fetch(clip.storage_path)).arrayBuffer()));
    // Lado a lado (IZQUIERDA Veo, DERECHA LTX), mismo alto, para verlo en el celular.
    await run(['-y', '-i', veo, '-i', ltx, '-filter_complex', '[0:v]scale=-2:1280,setsar=1,fps=24[a];[1:v]scale=-2:1280,setsar=1,fps=24[b];[a][b]hstack=inputs=2[v]', '-map', '[v]', '-an', '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, base + '_comparar.mp4')]);
    console.log(`TOMA ${n}: LISTA en ${g.seconds.toFixed(0)} s → finales/prueba_ltx/${base}_comparar.mp4`);
    resumen.push({ toma: n, segundos: Math.round(g.seconds), prompt: g.prompt });
  }
  fs.writeFileSync(path.join(OUT, 'resumen.json'), JSON.stringify({ episodio: epId, tomas: resumen, at: new Date().toISOString() }, null, 1));
  console.log('\nLISTO. Tiempos en king:', resumen.map((r) => `T${r.toma} ${r.segundos}s`).join(' · '));
}

main().catch((err) => { console.error('ERROR:', err.message || err); process.exit(1); });
