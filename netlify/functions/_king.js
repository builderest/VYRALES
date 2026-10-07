// Proveedor de video "king": LTX-2.5 en el ComfyUI de la PC king, por Tailscale. GRATIS (solo luz).
// Solo funciona cuando el código corre en Cronix (el agente: agente/gen_local.js), porque Netlify
// no puede llegar a la red de Tailscale. Plantilla: agente/ltx2_api.json (Workflow → Export (API)).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const GEN = () => (process.env.VYRALES_GEN_URL || 'http://100.66.84.73:8188').replace(/\/$/, '');
const TEMPLATE = path.join(__dirname, '..', '..', 'agente', 'ltx2_api.json');
// Nodos de la plantilla video_ltx2_5_i2v.
const N = { image: '395', prompt: '398:376', negative: '398:373', width: '398:372', height: '398:360', duration: '398:362', seedA: '398:339', seedB: '398:338', strength: '398:357', save: '75' };
const NEGATIVE = 'pc game, console game, video game, cartoon, childish, ugly, text, watermark, subtitles, letters, distorted face, changing face, deformed hands, extra fingers, extra limbs, flicker, morphing, talking, lip movement, new buildings, brick walls, road, dirt road, path, vehicles, outfit change, barefoot, bare feet';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// El prompt de Veo es para Veo. LTX entiende mejor una descripción larga y en orden
// (cuadro → acción → final) con la cámara y el fondo dichos de forma explícita: si no, se
// acerca solo e inventa cosas en el fondo (probado en la PC king, oct-2026).
function ltxPromptFor(shot, storyBible) {
  const sb = storyBible || {};
  const names = {};
  // "NeandertalUno" → "the first neandertal" (nombres internos que LTX no entiende).
  const clean = (t) => String(t || '').replace(/\b([A-Z][a-z]+)(Uno|Dos|Tres|Cuatro)\b/g, (_, a, b) => ({ Uno: 'the first ', Dos: 'the second ', Tres: 'the third ', Cuatro: 'the fourth ' }[b] + a.toLowerCase())).replace(/\s+/g, ' ').trim();
  if (shot.ltx_en) return clean(shot.ltx_en); // si el guion trae un prompt propio para LTX, manda ese
  const cam = clean(shot.camera);
  const moving = /push|pull|dolly|pan|tilt|track|zoom|orbit|crane|handheld/i.test(cam);
  void names;
  return [
    'The video starts exactly on the provided image and keeps its composition, people, clothing, lighting and background.',
    // Si el usuario editó el prompt de la toma en el panel, esa descripción manda.
    ...(shot.prompt_override && shot.prompt_override.trim()
      ? ['Scene: ' + clean(shot.prompt_override).slice(0, 1200)]
      : [
        shot.start_en ? 'Scene at the start: ' + clean(shot.start_en) + '.' : '',
        shot.action_en ? 'Then, slowly and naturally: ' + clean(shot.action_en) + '.' : '',
        shot.reaction_en ? 'By the end: ' + clean(shot.reaction_en) + '.' : ''
      ]),
    moving
      ? 'Camera: ' + cam + ', very slow and subtle; the framing stays close to the first frame.'
      : 'Camera: ' + (cam ? cam + '. ' : '') + 'Locked-off tripod shot. The camera does not move at all: no zoom, no push-in, no pan, fixed framing for the whole clip.',
    // Ropa de cada personaje (LTX inventaba pies descalzos o cambiaba la ropa al moverse: EP3 T2/T9).
    wardrobeLine(shot),
    shot.background_en ? 'Background: ' + clean(shot.background_en) + ', it stays exactly the same.' : 'The background, walls, terrain and sky stay exactly the same as in the first frame; nothing new appears or is built.',
    // Estilo de la serie SIN lo de ropa ("period-appropriate hide garments" vestía de pieles a la científica moderna).
    sb.visual_style ? clean(sb.visual_style).split(/,\s*/).filter((x) => !/garment|cloth|outfit|wear|hide/i.test(x)).join(', ').slice(0, 200).replace(/[,.\s]*$/, '.') : 'Photorealistic cinematic footage.',
    'Natural subtle body motion, consistent faces. Nobody speaks, mouths stay closed. No text, no subtitles.'
  ].filter(Boolean).join(' ').replace(/\.\s*\./g, '.').replace(/\s+/g, ' ');
}

function wardrobeLine(shot) {
  const w = shot.wardrobe || {};
  const items = Object.values(w).filter(Boolean);
  if (!items.length) return '';
  const feet = items.some((o) => /shoe|boot|footwear|sandal|sneaker|slipper/i.test(o));
  return 'Clothing stays exactly the same for the whole clip: ' + items.map((o) => String(o).replace(/\.$/, '')).join('; ') + '.' + (feet ? ' Everyone keeps their footwear on; nobody is barefoot.' : '');
}

async function j(url, opts) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(60000) }, opts || {}));
  if (!r.ok) throw new Error('king ' + url.replace(GEN(), '') + ' → HTTP ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return r.json();
}

// startImage: { imageBytes (base64), mimeType }. Devuelve { videoBuffer } SIN audio.
async function kingGenerateVideo({ prompt, startImage, durationSeconds = 8, log = console.log }) {
  if (!startImage || !startImage.imageBytes) throw new Error('Con la PC king cada toma necesita su cuadro inicial (memoria visual).');
  if (!fs.existsSync(TEMPLATE)) throw new Error('Falta agente/ltx2_api.json (plantilla de LTX exportada desde ComfyUI).');
  const base = GEN();
  const tag = 'vyrales_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const fd = new FormData();
  fd.append('image', new Blob([Buffer.from(startImage.imageBytes, 'base64')], { type: startImage.mimeType || 'image/jpeg' }), tag + '.jpg');
  fd.append('overwrite', 'true');
  const up = await j(base + '/upload/image', { method: 'POST', body: fd });

  const wf = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  wf[N.image].inputs.image = up.subfolder ? up.subfolder + '/' + up.name : up.name;
  wf[N.prompt].inputs.value = prompt;
  wf[N.negative].inputs.text = NEGATIVE;
  wf[N.width].inputs.value = 704;   // 9:16 (la 1ª pasada va a la mitad; el escalador ×2 la sube)
  wf[N.height].inputs.value = 1280;
  wf[N.duration].inputs.value = Math.max(2, Math.min(10, Number(durationSeconds) || 8));
  wf[N.seedA].inputs.noise_seed = crypto.randomInt(1, 2 ** 31);
  wf[N.seedB].inputs.noise_seed = crypto.randomInt(1, 2 ** 31);
  wf[N.strength].inputs.strength = Number(process.env.VYRALES_LTX_STRENGTH || 1);
  wf[N.save].inputs.filename_prefix = 'vyrales/' + tag;

  const t0 = Date.now();
  const { prompt_id } = await j(base + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'vyrales' }) });
  log('[king] encolado', prompt_id);
  for (;;) {
    await sleep(5000);
    if (Date.now() - t0 > 30 * 60000) throw new Error('king tardó más de 30 min con la toma');
    const item = (await j(base + '/history/' + prompt_id))[prompt_id];
    if (!item) continue;
    const st = item.status || {};
    if (st.status_str === 'error') throw new Error('ComfyUI (king) dio error: ' + JSON.stringify((st.messages || []).filter((m) => m[0] === 'execution_error')).slice(0, 500));
    const outs = (item.outputs || {})[N.save] || {};
    const files = [].concat(outs.images || [], outs.videos || [], outs.gifs || []);
    if (!files.length) { if (st.completed) throw new Error('king terminó sin video'); continue; }
    const f = files[0];
    const r = await fetch(`${base}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || '')}&type=${encodeURIComponent(f.type || 'output')}`);
    if (!r.ok) throw new Error('no pude bajar el video de king (HTTP ' + r.status + ')');
    const raw = Buffer.from(await r.arrayBuffer());
    log('[king] listo en', Math.round((Date.now() - t0) / 1000), 's');
    return { videoBuffer: await stripAudio(raw) };
  }
}

// LTX genera audio; VYRALES pone sus propias voces y música → se quita.
async function stripAudio(buf) {
  const ffmpeg = require('ffmpeg-static');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyrales-king-'));
  const a = path.join(dir, 'in.mp4');
  const b = path.join(dir, 'out.mp4');
  fs.writeFileSync(a, buf);
  try {
    await new Promise((res, rej) => execFile(ffmpeg, ['-y', '-i', a, '-an', '-c:v', 'copy', '-movflags', '+faststart', b], (e, so, se) => (e ? rej(new Error(String(se).slice(-400))) : res())));
    return fs.readFileSync(b);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = { kingGenerateVideo, ltxPromptFor };
