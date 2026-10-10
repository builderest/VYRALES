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
const NEG_BASE = 'pc game, console game, video game, ugly, text, watermark, subtitles, captions, on-screen words, letters, readable writing, looking at the camera, eye contact with the viewer, breaking the fourth wall, turning back to the camera, moving portrait, living photo, painting comes alive, exaggerated expression, grimace, screaming, wide open mouth, crying face, object disappears, distorted face, changing face, deformed hands, extra fingers, extra limbs, flicker, morphing, outfit change, barefoot, bare feet';
const NEG_REAL = 'cartoon, childish';                                        // no en series animadas (Dulce Engaño es 3D)
const NEG_ANIMATED = 'live action, photorealistic, real human skin, style change'; // series animadas: que no se vuelva "real"
const NEG_ANCIENT = 'new buildings, brick walls, road, dirt road, path, vehicles'; // solo series prehistóricas
const NEG_SILENT = 'talking, lip movement';                                  // solo si nadie habla en cuadro
const NEGATIVE = [NEG_BASE, NEG_REAL, NEG_SILENT, NEG_ANCIENT].join(', ');
const isAnimated = (sb) => /animat|\b3d\b|pixar|cartoon|anime/i.test(String((sb || {}).visual_style || ''));
const isAncient = (sb) => /neandert|prehist|paleol|stone age|homo sapiens/i.test(JSON.stringify(sb || {}));
// ¿Alguien habla EN CUADRO en esta toma? (voces fijas para todos y la línea no es del narrador en off)
function speaksOnScreen(shot, sb) {
  const { castMode, extraOf, isVoiceover, ltxVoiceMode } = require('./_series');
  if (!castMode(sb || {}) && !ltxVoiceMode(sb || {})) return false;
  // lip_sync: false = la voz va encima pero en cuadro no se le ve hablar (de espaldas/perfil). LTX, al
  // pedirle que hable, la giraba hacia la cámara (EP1 Dulce T1: dejaba de mirar la foto de la mamá).
  if (shot && shot.lip_sync === false) return false;
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
  const MOVE_RE = /push|pull|dolly|pan|tilt|track|zoom|orbit|crane|handheld|fpv|drone|fly|follow|glide|rise|rush|slide|sink|descend|move/i;
  // Videos narrados de curiosidades (sin personajes): cámara con energía, se mueve de verdad.
  // En novelas con personas se mantiene lenta (con gente, el movimiento fuerte deforma caras e inventa fondos).
  const dynamic = sb.format === 'narrado_unico';
  // Narrados: NUNCA cámara fija ("static" dejaba la toma como una foto quieta: EP2 depredadores T7/T11/T16).
  const cam0 = clean(shot.camera);
  const cam = dynamic && !MOVE_RE.test(cam0) ? [cam0.replace(/\bstatic\b/ig, '').replace(/^[,\s]+|[,\s]+$/g, '').replace(/,\s*,/g, ','), 'slow steady push-in'].filter(Boolean).join(', ') : cam0;
  const moving = MOVE_RE.test(cam);
  // Primeros planos (ojo, dientes, ventosas): movimiento suave. Con "energía" LTX los hacía explotar (EP2 T10/T11).
  const gentle = dynamic && /close[- ]?up|macro|eye|very slow|slow/i.test(cam + ' ' + (shot.start_en || ''));
  void names;
  // LTX no sabe quién es "Valentina": cada nombre se cambia por lo que lleva puesto
  // ("the person in a mustard-yellow cardigan over a white t-shirt"), así sabe a quién mover y quién habla.
  const who = whoMap(shot);
  const named = (t) => who.reduce((acc, [re, desc]) => acc.replace(re, desc), clean(t));
  const speaker = speaksOnScreen(shot, sb) ? speakerDesc(shot, who) : '';
  // Fondo: el del guion (background_en) o, en guiones viejos, la descripción del lugar en la biblia.
  const locVisual = (() => { const l = sb.locations && shot.location && sb.locations[shot.location]; return l ? (typeof l === 'string' ? l : l.visual) : ''; })();
  const bg = shot.background_en || locVisual;
  // Modo voz de LTX: la línea va dicha EN el video (en español, con la voz descrita del personaje).
  const { ltxVoiceMode } = require('./_series');
  const line = (() => { const d = shot.dialogue; return (Array.isArray(d) ? d : d ? [d] : []).find((x) => x && x.line) || null; })();
  const vc = line && sb.voice_cast && sb.voice_cast[line.speaker];
  const sayLine = ltxVoiceMode(sb) && speaker && line
    ? (speaker.charAt(0).toUpperCase() + speaker.slice(1)) + ' says in Spanish' + (vc && vc.desc ? ', with ' + clean(vc.desc).replace(/^an?\s+/i, 'a ') : '') + ', calmly and clearly, the whole sentence: "' + String(line.line).replace(/"/g, '') + '" Only this person speaks.'
    : '';
  const ambient = (() => { const l = sb.locations && shot.location && sb.locations[shot.location]; return l && typeof l === 'object' ? l.ambient : ''; })();
  const soundLine = ltxVoiceMode(sb) ? 'Sound: ' + (ambient ? clean(ambient) + ', ' : '') + 'soft and quiet' + (sayLine ? ', with the spoken words clear on top.' : '.') : '';
  // Tomas sin personas (espacio, paisajes, animales: curiosidades): nada de frases de gente/ropa/actuación,
  // que con cfg = 1 pueden hacer aparecer personas donde no hay.
  const hasPeople = (shot.characters || []).length > 0 || /\b(person|people|man|men|woman|women|child|children|boy|girl|silhouette|guard|crowd)\b/i.test([shot.start_en, shot.action_en, shot.prompt_override].join(' '));
  return [
    hasPeople ? 'The video starts exactly on the provided image and keeps its composition, people, clothing, lighting and background.' : 'The video starts exactly on the provided image and keeps its composition, lighting and background.',
    // Si el usuario editó el prompt de la toma en el panel, esa descripción manda.
    ...(shot.prompt_override && shot.prompt_override.trim()
      ? ['Scene: ' + named(stripVeoSpeech(shot.prompt_override)).slice(0, 2200).replace(/[^.]*$/, '')]
      : [
        shot.start_en ? 'Scene at the start: ' + named(shot.start_en) + '.' : '',
        shot.action_en ? (dynamic ? 'Then: ' : 'Then, slowly and naturally: ') + named(shot.action_en) + '.' : '',
        shot.reaction_en ? 'By the end: ' + named(shot.reaction_en) + '.' : ''
      ]),
    moving
      ? (dynamic ? 'Camera: ' + cam + (gentle ? '. The camera moves slowly and smoothly; the subject stays whole, sharp and in the same place for the whole clip.' : '. The camera moves clearly, smoothly and with energy through the scene, like a premium cinematic documentary shot; strong sense of depth and motion from the first second.') : 'Camera: ' + cam + ', very slow and subtle; the framing stays close to the first frame.')
      : 'Camera: ' + (cam ? cam + '. ' : '') + 'Locked-off tripod shot with the same fixed framing from the first frame to the last frame.',
    // Narrados sin personas: todo se mueve todo el tiempo (si no, el fondo queda como foto quieta).
    dynamic && !hasPeople ? (gentle ? (/\b(animal|creature|dinosaur|whale|shark|octopus|squid|orca|bird|fish|mammal|eye|skin)\b/i.test([shot.start_en, shot.action_en].join(' ')) ? 'Gentle natural life in the scene: the animal skin and body move softly, tiny particles drift slowly in the water.' : 'Gentle ambient life: lights glow and flicker softly, fine dust drifts in the air; everything stays solid and in place.') : (/\b(animal|creature|dinosaur|whale|shark|octopus|squid|orca|bird|fish|mammal|beast|monster)\b/i.test([shot.start_en, shot.action_en].join(' ')) ? 'Everything keeps moving for the whole clip: the animal moves its body continuously, water particles, bubbles, dust and light rays drift, waves and clouds move.' : 'The scene stays alive for the whole clip with natural ambient motion: lights flicker, dust and haze drift softly; machines, walls and objects stay solid and intact.')) : '',
    // Ropa de cada personaje (LTX inventaba pies descalzos o cambiaba la ropa al moverse: EP3 T2/T9).
    wardrobeLine(shot),
    bg ? 'Background: ' + clean(bg).replace(/[.\s]*$/, '') + (dynamic ? '; the same place throughout the shot.' : '; it stays exactly as in the first frame.') : (dynamic ? '' : 'The background, walls, terrain and sky stay exactly as in the first frame.'),
    // Estilo de la serie SIN lo de ropa ("period-appropriate hide garments" vestía de pieles a la científica moderna) ni el formato.
    sb.visual_style ? clean(sb.visual_style).split(/,\s*/).filter((x) => !/garment|cloth|outfit|wear|hide|vertical|9:16|framing|aspect/i.test(x)).join(', ').slice(0, 260).replace(/,[^,]*$/, (m) => (clean(sb.visual_style).length > 260 ? '' : m)).replace(/[,.\s]*$/, '.') : 'Photorealistic cinematic footage.',
    isAnimated(sb) ? 'The whole clip keeps exactly the same stylized 3D animated look as the first frame.' : '',
    // IMPORTANTE (HECHO, oct-2026): la plantilla usa el modelo DESTILADO con cfg = 1, así que el prompt
    // NEGATIVO NO HACE NADA y nombrar algo en el positivo (aunque sea "no subtitles", "nobody is barefoot")
    // lo PROVOCA: EP1 Dulce salió con subtítulos inventados (hasta en chino) y con pies descalzos.
    // Todo se pide en AFIRMATIVO: lo que sí debe verse.
    hasPeople ? 'Objects that the characters hold at the start (trays, envelopes, letters, phones, cups) stay in the same hands for the whole clip. Papers and letters are plain and blank.' : '',
    hasPeople ? 'Acting is subtle and restrained' + (isAnimated(sb) ? ', like a premium animated feature' : '') + ': small natural expressions with the eyes and brows, lips relaxed.' : '',
    // Voces fijas para todos: el que habla mueve la boca en 0–6 s (ahí el render pone su voz); si no, bocas cerradas.
    speaksOnScreen(shot, sb)
      ? 'Natural subtle body motion, consistent faces. ' + (speaker ? speaker.charAt(0).toUpperCase() + speaker.slice(1) : 'The character who speaks') + ' keeps the head and eyes turned toward whoever or whatever the action says they are talking to, from the first frame to the last frame' + (sayLine ? '. ' + sayLine + ' ' : ', and moves the lips softly and naturally as if talking quietly during the first 6 seconds, then closes the mouth. ') + 'Everyone else keeps the mouth closed. Photos, paintings and screens on the walls are still pictures. ' + soundLine + ' Clean cinematic image.'
      : (hasPeople ? 'Natural subtle body motion, consistent faces, mouths closed. ' : (dynamic ? (gentle ? 'Slow, smooth, continuous natural motion. ' : (/\b(animal|creature|dinosaur|whale|shark|octopus|squid|orca|bird|fish|mammal|beast|monster|storm|fire|explosion|asteroid|waves|running|fight)\b/i.test([shot.start_en, shot.action_en].join(' ')) ? 'Constant, vivid, powerful motion in every part of the frame from the first second to the last: the scene feels alive and spectacular. ' : 'Smooth, continuous, cinematic motion from the first second to the last. ')) : 'Smooth, continuous, natural motion. ')) + soundLine + ' Clean cinematic image.'
  ].filter(Boolean).join(' ').replace(/\.\s*\./g, '.')
    // Guiones con "no readable text, no logos": con cfg = 1 nombrar texto/letras/logos los hace aparecer.
    .replace(/,?\s*(?:with\s+|and\s+)?(?:no|without)\s+(?:any\s+)?(?:readable\s+|visible\s+|on-screen\s+)?(?:text|writing|words|letters|logos?|captions|subtitles|watermarks?)\b(?:\s*(?:,|or|and)\s*(?:no\s+)?(?:readable\s+)?(?:text|writing|words|letters|logos?|captions|subtitles|watermarks?)\b)*/gi, '')
    .replace(/\s+/g, ' ');
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
    .replace(/Audio:[\s\S]*?(?=A clean cinematic frame|$)/i, '') // la parte de sonido del prompt de Veo no le sirve a LTX
    .replace(/\b(says|whispers|shouts|asks|replies|murmurs|exclaims)\b[^."]*?:\s*"[^"]*"/gi, 'talks, lips moving naturally. ')
    .replace(/"[^"]*"/g, '')
    // frases en negativo ("free of any on-screen text, captions…", "never looks into the camera") provocan eso mismo en LTX
    .split(/(?<=\.)\s+/).filter((x) => !/caption|subtitle|on-screen text|watermark|logo|unreadable|never|\bno\b|without/i.test(x)).join(' ')
    .replace(/\s+/g, ' ');
}

function wardrobeLine(shot) {
  const w = shot.wardrobe || {};
  const items = Object.values(w).filter(Boolean);
  if (!items.length) return '';
  // Calzado SIEMPRE (EP3 T1: la ropa no lo decía y LTX la puso a caminar descalza y en shorts).
  const barefoot = items.some((o) => /barefoot/i.test(o));
  // En afirmativo (cfg = 1: "nobody is barefoot" dejaba descalza a Valentina en EP1 T3).
  return 'Clothing stays exactly the same for the whole clip: ' + items.map((o) => String(o).replace(/\.$/, '')).join('; ') + '.' +
    (barefoot ? '' : ' Everyone wears closed shoes on their feet the whole time, and trousers stay full length.');
}

async function j(url, opts) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(60000) }, opts || {}));
  if (!r.ok) throw new Error('king ' + url.replace(GEN(), '') + ' → HTTP ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return r.json();
}

// startImage: { imageBytes (base64), mimeType }. Devuelve { videoBuffer } SIN audio.
// endImage (opcional): cuadro FINAL. LTX va del cuadro inicial al final (LTXVAddGuide frame_idx=-1 en las dos
// pasadas y LTXVCropGuides antes de escalar/decodificar). Así la toma termina exactamente donde dice el guion.
function addEndFrame(wf, imageName, strength) {
  wf['vy:endload'] = { class_type: 'LoadImage', inputs: { image: imageName } };
  wf['vy:endresize'] = JSON.parse(JSON.stringify(wf['398:351'])); wf['vy:endresize'].inputs.input = ['vy:endload', 0];
  wf['vy:endpre'] = JSON.parse(JSON.stringify(wf['398:350'])); wf['vy:endpre'].inputs.image = ['vy:endresize', 0];
  // Pasada 1 (media resolución)
  wf['vy:guideA'] = { class_type: 'LTXVAddGuide', inputs: { positive: ['398:365', 0], negative: ['398:365', 1], vae: ['398:385', 0], latent: ['398:357', 0], image: ['vy:endpre', 0], frame_idx: -1, strength } };
  wf['398:377'].inputs.video_latent = ['vy:guideA', 2];
  wf['398:388'].inputs.positive = ['vy:guideA', 0]; wf['398:388'].inputs.negative = ['vy:guideA', 1];
  wf['vy:cropA'] = { class_type: 'LTXVCropGuides', inputs: { positive: ['vy:guideA', 0], negative: ['vy:guideA', 1], latent: ['398:367', 0] } };
  wf['398:348'].inputs.samples = ['vy:cropA', 2];
  // Pasada 2 (resolución completa)
  wf['vy:guideB'] = { class_type: 'LTXVAddGuide', inputs: { positive: ['vy:cropA', 0], negative: ['vy:cropA', 1], vae: ['398:385', 0], latent: ['398:349', 0], image: ['vy:endpre', 0], frame_idx: -1, strength } };
  wf['398:340'].inputs.video_latent = ['vy:guideB', 2];
  wf['398:391'].inputs.positive = ['vy:guideB', 0]; wf['398:391'].inputs.negative = ['vy:guideB', 1];
  wf['vy:cropB'] = { class_type: 'LTXVCropGuides', inputs: { positive: ['vy:guideB', 0], negative: ['vy:guideB', 1], latent: ['398:369', 0] } };
  wf['398:374'].inputs.samples = ['vy:cropB', 2];
}

async function kingGenerateVideo({ prompt, negative = null, startImage, endImage = null, durationSeconds = 8, keepAudio = false, log = console.log }) {
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
  // LTX en king aguanta hasta 16 s por toma (probado por Franklin; tarda más).
  wf[N.duration].inputs.value = Math.max(2, Math.min(16, Math.round(Number(durationSeconds) || 8)));
  wf[N.seedA].inputs.noise_seed = crypto.randomInt(1, 2 ** 31);
  wf[N.seedB].inputs.noise_seed = crypto.randomInt(1, 2 ** 31);
  wf[N.strength].inputs.strength = Number(process.env.VYRALES_LTX_STRENGTH || 1);
  wf[N.save].inputs.filename_prefix = 'vyrales/' + tag;
  if (endImage && endImage.imageBytes) {
    const fe = new FormData();
    fe.append('image', new Blob([Buffer.from(endImage.imageBytes, 'base64')], { type: endImage.mimeType || 'image/jpeg' }), tag + '_fin.jpg');
    fe.append('overwrite', 'true');
    const upE = await j(base + '/upload/image', { method: 'POST', body: fe });
    addEndFrame(wf, upE.subfolder ? upE.subfolder + '/' + upE.name : upE.name, Number(process.env.VYRALES_LTX_END_STRENGTH || 1));
    log('[king] con cuadro FINAL');
  }

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
    return { videoBuffer: keepAudio ? raw : await stripAudio(raw) };
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

// Duración de la toma en king según lo que dura la voz: así una frase buena no se acorta ni se acelera.
// Usa la narración ya generada si existe; si no, estima ~1.9 palabras por segundo (voz de documental).
// Mínimo 8 s, máximo 16 s. shot.seconds (si el guion lo trae) manda.
function kingSecondsFor(shot) {
  if (!shot) return 8;
  if (Number(shot.seconds) > 0) return Math.max(2, Math.min(16, Math.round(Number(shot.seconds)))); // voz continua: tomas cortas tipo anime (2 s)
  let voice = Number(shot.narration && shot.narration.seconds) || 0;
  if (!voice) {
    const d = shot.dialogue;
    const words = (Array.isArray(d) ? d : d ? [d] : []).map((x) => (x && x.line) || '').join(' ').split(/\s+/).filter(Boolean).length;
    voice = words / 1.9;
  }
  return Math.max(8, Math.min(16, Math.ceil(voice + 1.3)));
}

module.exports = { kingSecondsFor, kingGenerateVideo, ltxPromptFor, ltxNegativeFor, speaksOnScreen, NEG_BASE };
