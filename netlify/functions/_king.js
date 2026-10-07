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
// Negativo armado según la serie y la toma (ltxNegativeFor):
const NEG_BASE = 'pc game, console game, video game, ugly, text, watermark, subtitles, letters, distorted face, changing face, deformed hands, extra fingers, extra limbs, flicker, morphing, outfit change, barefoot, bare feet';
const NEG_REAL = 'cartoon, childish';                                        // no en series animadas (Dulce Engaño es 3D)
const NEG_ANIMATED = 'live action, photorealistic, real human skin, style change'; // series animadas: que no se vuelva "real"
const NEG_ANCIENT = 'new buildings, brick walls, road, dirt road, path, vehicles'; // solo series prehistóricas
const NEG_SILENT = 'talking, lip movement';                                  // solo si nadie habla en cuadro
const NEGATIVE = [NEG_BASE, NEG_REAL, NEG_SILENT, NEG_ANCIENT].join(', ');
const isAnimated = (sb) => /animat|\b3d\b|pixar|cartoon|anime/i.test(String((sb || {}).visual_style || ''));
const isAncient = (sb) => /neandert|prehist|paleol|stone age|homo sapiens/i.test(JSON.stringify(sb || {}));
// ¿Alguien habla EN CUADRO en esta toma? (voces fijas para todos y la línea no es del narrador en off)
function speaksOnScreen(shot, sb) {
  const { castMode, extraOf, isVoiceover } = require('./_series');
  if (!castMode(sb || {})) return false;
  const d = shot && shot.dialogue;
  const list = (Array.isArray(d) ? d : d ? [d] : []).filter((x) => x && x.line);
  return list.some((x) => !isVoiceover(extraOf(sb || {}, x.speaker)));
}
function ltxNegativeFor(shot, sb) {
  return [NEG_BASE, isAnimated(sb) ? NEG_ANIMATED : NEG_REAL, speaksOnScreen(shot, sb) ? '' : NEG_SILENT, isAncient(sb) ? NEG_ANCIENT : ''].filter(Boolean).join(', ');
}

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
  // LTX no sabe quién es "Valentina": cada nombre se cambia por lo que lleva puesto
  // ("the person in a mustard-yellow cardigan over a white t-shirt"), así sabe a quién mover y quién habla.
  const who = whoMap(shot);
  const named = (t) => who.reduce((acc, [re, desc]) => acc.replace(re, desc), clean(t));
  const speaker = speaksOnScreen(shot, sb) ? speakerDesc(shot, who) : '';
  // Fondo: el del guion (background_en) o, en guiones viejos, la descripción del lugar en la biblia.
  const locVisual = (() => { const l = sb.locations && shot.location && sb.locations[shot.location]; return l ? (typeof l === 'string' ? l : l.visual) : ''; })();
  const bg = shot.background_en || locVisual;
  return [
    'The video starts exactly on the provided image and keeps its composition, people, clothing, lighting and background.',
    // Si el usuario editó el prompt de la toma en el panel, esa descripción manda.
    ...(shot.prompt_override && shot.prompt_override.trim()
      ? ['Scene: ' + named(stripVeoSpeech(shot.prompt_override)).slice(0, 1400).replace(/[^.]*$/, '')]
      : [
        shot.start_en ? 'Scene at the start: ' + named(shot.start_en) + '.' : '',
        shot.action_en ? 'Then, slowly and naturally: ' + named(shot.action_en) + '.' : '',
        shot.reaction_en ? 'By the end: ' + named(shot.reaction_en) + '.' : ''
      ]),
    moving
      ? 'Camera: ' + cam + ', very slow and subtle; the framing stays close to the first frame.'
      : 'Camera: ' + (cam ? cam + '. ' : '') + 'Locked-off tripod shot. The camera does not move at all: no zoom, no push-in, no pan, fixed framing for the whole clip.',
    // Ropa de cada personaje (LTX inventaba pies descalzos o cambiaba la ropa al moverse: EP3 T2/T9).
    wardrobeLine(shot),
    bg ? 'Background: ' + clean(bg).replace(/[.\s]*$/, '') + '; it stays exactly the same as in the first frame, nothing new appears.' : 'The background, walls, terrain and sky stay exactly the same as in the first frame; nothing new appears or is built.',
    // Estilo de la serie SIN lo de ropa ("period-appropriate hide garments" vestía de pieles a la científica moderna) ni el formato.
    sb.visual_style ? clean(sb.visual_style).split(/,\s*/).filter((x) => !/garment|cloth|outfit|wear|hide|vertical|9:16|framing|aspect/i.test(x)).join(', ').slice(0, 260).replace(/,[^,]*$/, (m) => (clean(sb.visual_style).length > 260 ? '' : m)).replace(/[,.\s]*$/, '.') : 'Photorealistic cinematic footage.',
    isAnimated(sb) ? 'The whole clip keeps exactly the same 3D animated look as the first frame; it never turns live action.' : '',
    // Voces fijas para todos: el que habla mueve la boca en 0–6 s (ahí el render pone su voz); si no, bocas cerradas.
    speaksOnScreen(shot, sb)
      ? 'Natural subtle body motion, consistent faces. ' + (speaker ? speaker.charAt(0).toUpperCase() + speaker.slice(1) + ' is the one who talks' : 'The character who speaks talks') + ', with natural, clearly visible lip movement from the start until about second 6, then stops talking and closes the mouth; any other person keeps the mouth closed. No text, no subtitles.'
      : 'Natural subtle body motion, consistent faces. Nobody speaks, mouths stay closed. No text, no subtitles.'
  ].filter(Boolean).join(' ').replace(/\.\s*\./g, '.').replace(/\s+/g, ' ');
}

// [nombre → "the person in <primera prenda>"] desde shot.wardrobe (nombre completo y nombre de pila).
function whoMap(shot) {
  const out = [];
  Object.entries(shot.wardrobe || {}).forEach(([name, outfit]) => {
    const first = String(outfit || '').split(',')[0].trim().replace(/\.$/, '');
    if (!first) return;
    const desc = 'the person in ' + first;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const full = String(name).trim();
    const given = full.split(/\s+/)[0];
    out.push([new RegExp('\\b' + esc(full) + "(?:'s)?\\b", 'g'), desc]);
    if (given.length >= 3 && given !== full) out.push([new RegExp('\\b' + esc(given) + "(?:'s)?\\b", 'g'), desc]);
  });
  return out;
}
function speakerDesc(shot, who) {
  const d = shot.dialogue;
  const sp = ((Array.isArray(d) ? d : d ? [d] : []).find((x) => x && x.line) || {}).speaker || '';
  const hit = who.find(([re]) => { re.lastIndex = 0; return re.test(sp); });
  if (hit) { hit[0].lastIndex = 0; return hit[1]; }
  return '';
}
// Prompts viejos de Veo traen la línea hablada y la voz: 'says in a warm voice: "Hola"'. LTX no hace audio
// y el texto entre comillas lo empuja a escribir letras: se cambia por "talks".
function stripVeoSpeech(t) {
  return String(t || '')
    .replace(/\b(says|whispers|shouts|asks|replies|murmurs|exclaims)\b[^."]*?:\s*"[^"]*"/gi, 'talks, lips moving naturally. ')
    .replace(/"[^"]*"/g, '')
    .replace(/\s+/g, ' ');
}

function wardrobeLine(shot) {
  const w = shot.wardrobe || {};
  const items = Object.values(w).filter(Boolean);
  if (!items.length) return '';
  // Calzado SIEMPRE (EP3 T1: la ropa no lo decía y LTX la puso a caminar descalza y en shorts).
  const barefoot = items.some((o) => /barefoot/i.test(o));
  return 'Clothing stays exactly the same for the whole clip, nothing is shortened or removed: ' + items.map((o) => String(o).replace(/\.$/, '')).join('; ') + '.' +
    (barefoot ? '' : ' Everyone keeps closed footwear on at all times; nobody is barefoot; long trousers stay long.');
}

async function j(url, opts) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(60000) }, opts || {}));
  if (!r.ok) throw new Error('king ' + url.replace(GEN(), '') + ' → HTTP ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return r.json();
}

// startImage: { imageBytes (base64), mimeType }. Devuelve { videoBuffer } SIN audio.
async function kingGenerateVideo({ prompt, negative = null, startImage, durationSeconds = 8, log = console.log }) {
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
  wf[N.negative].inputs.text = negative || NEGATIVE;
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

module.exports = { kingGenerateVideo, ltxPromptFor, ltxNegativeFor, speaksOnScreen };
