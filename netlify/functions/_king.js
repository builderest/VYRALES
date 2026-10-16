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
// LTX (destilado, cfg = 1) HACE lo que lee: "the lake stays completely steady", "the clouds stay still"
// congelaban TODA la toma (Toba largo T16/T33, oct-2026). En la acción y el final se quitan las frases de quietud
// y se dejan solo los movimientos.
const STILL_RE = /\b(stay|stays|staying|remain|remains|remaining|keep|keeps|kept|hold|holds|rest|rests|sit|sits)\b[^.;]*\b(still|steady|steadily|fixed|motionless|unchanged|unmoving|frozen|static|in place|completely|perfectly|exactly)\b|\b(motionless|frozen|static|unmoving|locked)\b/i;
// Adjetivos sueltos de quietud dentro de una frase con movimiento ("at an easy steady pace") se borran, no la frase.
const STILL_WORD_RE = /\b(completely |perfectly )?(still|steady|steadily)\s*/gi;
// Humo/neblina/polvo de relleno ("golden haze drifts", "mist drifts gently", "dust motes float") salían como humo
// blanco innecesario (Toba largo T30–T32). Solo se dejan si la escena de verdad trata de humo, ceniza, fuego, etc.
const HAZE_RE = /\b(haze|hazy|mist|misty|fog|foggy|smoke|smoky|steam|dust|motes?)\b/i;
const HAZE_SCENE_RE = /\b(smoke|ash|ashes|ashfall|eruption|erupt|volcan\w*|plume|fire|flames?|burn\w*|explosion|blast|steam|geyser|fog|mist|dust ?storm|sandstorm|haze|smog|cloud of|collaps\w*|landslide|rockfall|avalanche|debris|crumbl\w*|demoli\w*|cave-?in)\b/i;
const hazeScene = (shot) => HAZE_SCENE_RE.test([shot.start_en, shot.scene_es, shot.visual_es, ((Array.isArray(shot.dialogue) ? shot.dialogue : [shot.dialogue]).find((d) => d && d.line) || {}).line].filter(Boolean).join(' '));
function onlyMotion(t, shot) {
  // 1) Por cláusulas (; / punto / "while"): la cláusula de quietud se va ENTERA con su lista ("the skulls, maps and monitor stay still").
  // 2) Dentro de cada cláusula, por comas: se quitan pedazos de humo de relleno o de quietud; "waves wash in" (3 palabras) se queda.
  const clauses = String(t || '').split(/;|\.\s+|,?\s+while\s+/i).map((x) => x.trim()).filter((x) => x && !STILL_RE.test(x));
  const keep = [];
  for (const c of clauses) for (const x of c.split(/,\s+/)) {
    const y = x.trim();
    if (y.split(/\s+/).length < 2 || STILL_RE.test(y) || (shot && !hazeScene(shot) && HAZE_RE.test(y))) continue;
    keep.push(y.replace(/^(?:and|while|then)\s+/i, '').replace(/\bvery slowly\b/gi, 'clearly').replace(STILL_WORD_RE, '').replace(/\s+/g, ' ').replace(/[.\s]+$/, ''));
  }
  return keep.join(', ');
}
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// PROMPT PARA LTX-2.5 (destilado, cfg = 1) — REESCRITO oct-16 tras la prueba A/B en king (tomas 19/36/79/89/107 del EP 34,
// misma imagen y misma semilla; ver CAMBIOS.md). Lo que rompía las tomas con el prompt anterior (HECHO, en los videos):
//  1) "Scene at the start" describía OTRA imagen cuando Franklin subió la suya (start_en viejo): LTX empuja hacia el texto →
//     cambia de lugar, aparecen/desaparecen personas (T36 saltó a una cantera; T19 perdió obreros).
//  2) El "By the end" (reaction_en) pedía gestos que la acción no pedía (T36 "pointing", T19 "palms flat on the rock") → los hacía.
//  3) Cámara impuesta ("slow lateral drift" automático) + ~100 palabras de relleno → la cámara viajaba de más.
//  4) Se recortaban frases con palabras de quietud → la acción llegaba incompleta o sin sentido (T89).
//  5) Listas "No grabbing, no tapping…" dentro de la acción: con cfg = 1 NOMBRAR algo lo provoca (T79 agarró con dedos doblados).
// Ahora: imagen → UNA acción (completa, tal cual) → final coherente → cámara de la toma → 2–3 líneas cortas de continuidad.
// Objetivo: 100–200 palabras, todo en afirmativo.
const META_SENT_RE = /^(no |not |do not|don'?t|never|without |avoid|preserve|keep (the )?(exact|original|same)|locked(-off)? (documentary )?camera|static (documentary )?(shot|camera)|continuous (photorealistic )?shot|photorealistic|realistic breathing|all (movements|motion)|natural documentary realism|quiet archaeological realism|authentic|restrained|the movement is (restrained|careful|subtle)|cinematic|documentary (style|realism|footage)|minimal (realistic )?motion|subtle (dust|natural)|slight dust)/i;
const NEG_LIST_RE = /\b(no|without)\s+\w+(?:\s+\w+)?\s*,\s*(no|without)\s+\w+/i; // "no grabbing, no tapping"
const SYNC_RE = /,?\s*\b(together|in unison|in sync|simultaneously|at the same time|all at once|in the same (?:\w+\s+){0,2}(?:arc|rhythm|motion|movement|direction|way))\b/gi;
const STEADY_CAM_RE = /\b(locked(-off)?\s+(close-?up\s+)?camera|static\s+(documentary\s+)?(camera|shot)|camera\s+(holds|stays|remains)\s+(steady|still|fixed)|fixed\s+camera|tripod|locked-off)\b/i;
const GESTURE_RE = /\b(point(s|ing|ed)?|rais(e|es|ed|ing)\s+(an?|his|her|their|one|both|right|left)?\s*(arm|arms|hand|hands)|arms? raised|reach(es|ing|ed)?\s+(out|for|toward|towards|into|up|down)|grab(s|bing|bed)?|touch(es|ing|ed)?|palms?\s+(flat\s+)?(on|against)|hands?\s+(flat\s+)?(on|against)\s+the\s+(rock|wall)|walk(s|ing|ed)?\s+(away|off|out)|wav(e|es|ing))\b/i;
const sentencesOf = (t) => String(t || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z])/).map((x) => x.trim()).filter(Boolean);
// Limpia acción/final: quita frases-instrucción (meta), listas de prohibiciones y palabras de sincronía. NO toca la acción.
function cleanMotion(t) {
  return sentencesOf(t).filter((s) => !META_SENT_RE.test(s) && !NEG_LIST_RE.test(s) && !/^(the\s+)?camera\b/i.test(s))
    // La cámara la decide SOLO la línea "Camera:" (antes la acción decía "the camera pushes in" y la línea "lateral drift").
    .map((s) => s.replace(/,?\s*\b(while|as|and)\s+the camera\s+[^,.;]*/gi, ''))
    // Cláusulas en negativo dentro de una frase (", without touching the marks", ", no sudden motion"): con cfg = 1 nombrar lo
    // que no debe pasar lo provoca → se quita SOLO esa cláusula.
    .map((s) => s.replace(/,?\s*\b(without|never)\s+[^,.;]*/gi, '').replace(/,\s*no\s+[^,.;]*/gi, '').replace(SYNC_RE, '').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').replace(/\s+([.!?])$/, '$1'))
    .filter((s) => s.split(/\s+/).length >= 3).join(' ').trim();
}
// Descripción del cuadro: sin el relleno de estilo fotográfico que el guionista repite en cada start_en.
function cleanStart(t) {
  return String(t || '')
    .replace(/\b(extreme\s+)?(medium|wide|close)[- ]?(wide\s+|up\s+)?shot\s+\d+\s?mm\s*[,:]?\s*/gi, '')
    .replace(/\bclose-?up\s+\d+\s?mm\s*[:,]?\s*/gi, 'Close-up: ')
    .replace(/,?\s*photorealistic documentary photograph,?\s*shot on a real camera,?\s*natural imperfect textures,?\s*real lighting\.?/gi, '')
    .replace(/^\s*photorealistic documentary photograph[^.]*\.\s*/i, '')
    .replace(/,?\s*\b(horizontal|vertical)\s+(16:9|9:16)\s+(widescreen\s+|landscape\s+|portrait\s+)*(frame|image|composition|format)\b\.?/gi, '')
    .replace(/\bfrozen\s+(mid-?(fall|air|motion|collapse))/gi, 'in the middle of falling').replace(/\b(frozen|motionless|suspended)\s+(in\s+)?(mid-?air|time)\b/gi, 'falling')
    .replace(/\s+([.,])/g, '$1').replace(/\s{2,}/g, ' ').replace(/^[\s,.:]+/, '').trim();
}
function ltxPromptFor(shot, storyBible) {
  const sb = storyBible || {};
  // "NeandertalUno" → "the first neandertal" (nombres internos que LTX no entiende).
  const clean = (t) => String(t || '').replace(/\b([A-Z][a-z]+)(Uno|Dos|Tres|Cuatro)\b/g, (_, a, b) => ({ Uno: 'the first ', Dos: 'the second ', Tres: 'the third ', Cuatro: 'the fourth ' }[b] + a.toLowerCase())).replace(/\s+/g, ' ').trim();
  if (shot.ltx_en) return clean(shot.ltx_en); // si el guion trae un prompt propio para LTX, manda ese
  const dynamic = sb.format === 'narrado_unico';
  // LTX no sabe quién es "Valentina": cada nombre se cambia por lo que lleva puesto.
  const who = whoMap(shot);
  const named = (t) => who.reduce((acc, [re, desc]) => acc.replace(re, desc), clean(t));
  const speaker = speaksOnScreen(shot, sb) ? speakerDesc(shot, who) : '';
  const { ltxVoiceMode } = require('./_series');
  const line = (() => { const d = shot.dialogue; return (Array.isArray(d) ? d : d ? [d] : []).find((x) => x && x.line) || null; })();
  const vc = line && sb.voice_cast && sb.voice_cast[line.speaker];
  const sayLine = ltxVoiceMode(sb) && speaker && line
    ? (speaker.charAt(0).toUpperCase() + speaker.slice(1)) + ' says in Spanish' + (vc && vc.desc ? ', with ' + clean(vc.desc).replace(/^an?\s+/i, 'a ') : '') + ', calmly and clearly, the whole sentence: "' + String(line.line).replace(/"/g, '') + '" Only this person speaks.'
    : '';
  const ambient = (() => { const l = sb.locations && shot.location && sb.locations[shot.location]; return l && typeof l === 'object' ? l.ambient : ''; })();
  const soundLine = ltxVoiceMode(sb) ? 'Sound: ' + (ambient ? clean(ambient) + ', ' : '') + 'soft and quiet' + (sayLine ? ', with the spoken words clear on top.' : '.') : '';
  const hasPeople = (shot.characters || []).length > 0 || /\b(person|people|man|men|woman|women|child|children|boy|girl|silhouette|silhouettes|guard|crowd|hunter|hunters|survivor|survivors|clan|tribe|band|family|forager|foragers|artisan|figures|soldier|soldiers|officer|members|researchers?|workers?|astronauts?|pilots?|homo sapiens|humans? (?:figure|being)s?)\b/i.test([shot.start_en, shot.action_en, shot.prompt_override].join(' '));

  // 1) LA IMAGEN. Si la imagen la subió Franklin (own_image), el start_en es de OTRA imagen → no se describe: manda la foto.
  // Con prompt editado a mano en el panel (prompt_override), ese texto manda y describe la escena entera.
  const override = !!(shot.prompt_override && shot.prompt_override.trim());
  const startTxt = shot.own_image || override ? '' : cleanStart(named(shot.start_en));
  const opening = startTxt
    ? 'The video starts on the provided image: ' + startTxt.replace(/[.\s]*$/, '.')
    : 'The video starts on the provided image and keeps its place, ' + (hasPeople ? 'people, clothing, ' : '') + 'objects and light.';

  // 2) LA ACCIÓN, completa (sin recortes por palabras de quietud), sin frases-instrucción ni prohibiciones.
  const actionRaw = override ? stripVeoSpeech(shot.prompt_override) : (shot.action_en || '');
  const action = cleanMotion(named(actionRaw));
  // 3) EL FINAL: solo si no pide un gesto que la acción no pidió (T36: el final decía "pointing" y la acción no).
  let ending = override ? '' : cleanMotion(named(shot.reaction_en || ''));
  if (ending) { const g = ending.match(GESTURE_RE); if (g && !new RegExp('\\b' + g[1].slice(0, 4), 'i').test(action)) ending = ''; }

  // 4) CÁMARA de la toma (no se impone ninguna). Si la acción pide cámara fija, manda eso. Movimientos que LTX rompe
  //    (push-in, dolly, órbita, dron…) se cambian por un desplazamiento lateral (regla LTX-SAFE #4).
  const cam0 = named(shot.camera).replace(/,?\s*\b(?:no zoom|without zoom(?:ing)?|kept unchanged|unchanged|held)\b/gi, '').replace(/[,\s]+$/, '');
  const { safeCamera } = require('./_ltx_safe');
  let camera;
  if (STEADY_CAM_RE.test(actionRaw) || /^(the camera )?(static|locked|fixed|still|holds steady|stays steady)\b/i.test(cam0) || !cam0) camera = 'The camera holds steady.';
  else camera = 'Camera: ' + (dynamic ? safeCamera(cam0, shot) : cam0 + ', slow and subtle') + '.';

  const parts = [
    opening,
    action ? (action.charAt(0).toUpperCase() + action.slice(1)).replace(/([^.!?])$/, '$1.') : '',
    shot.camera_only ? 'The ' + (/model|maqueta/i.test(shot.start_en || '') ? 'museum model' : 'main object') + ' is a solid rigid object with the same shape and details from the first frame to the last; only the camera moves around it.' : '',
    shot.qa_boost && action && !shot.camera_only ? 'The main action happens fully and clearly within the clip.' : '',
    ending ? 'By the end, ' + ending.replace(/^(the shot ends with|by the end,?)\s+/i, '').replace(/^(A|An|The|He|She|It|They|His|Her|Its|Their|Both|Each|One|Two|Three|All|Only|Every|This|That|These|Those|Some|Most|Several|Everyone|Nobody|Smoke|Dust|Flames|Fire)\b/, (m) => m.toLowerCase()).replace(/[.\s]*$/, '.') : '',
    camera,
    // Continuidad (evidencia previa, en afirmativo y corto):
    wardrobeLine(shot),
    hasPeople ? 'The same people stay in the shot with the same faces and clothing' + (speaksOnScreen(shot, sb) ? '.' : ', mouths closed.') : '',
    !hasPeople && !shot.camera_only ? 'One continuous shot; the place and everything in it keep their shape.' : '',
    hasPeople && (shot.characters || []).length && !dynamic ? 'Objects the characters hold stay in the same hands; papers and letters are plain and blank.' : '',
    hasPeople && !dynamic ? 'Acting is subtle and restrained' + (isAnimated(sb) ? ', like a premium animated feature' : '') + '.' : '',
    speaksOnScreen(shot, sb) && speaker ? (speaker.charAt(0).toUpperCase() + speaker.slice(1)) + ' keeps the head turned toward whoever they are talking to.' + (sayLine ? ' ' + sayLine : '') : '',
    soundLine,
    isAnimated(sb) ? 'The whole clip keeps the same stylized 3D animated look as the first frame.' : (sb.visual_style ? String(clean(sb.visual_style).split(/,\s*/)[0]).replace(/[.\s]*$/, '.') : 'Photorealistic footage.')
  ].filter(Boolean);
  let out = parts.join(' ').replace(/\.\s*\./g, '.')
    // Con cfg = 1 nombrar texto/letras/logos los hace aparecer (aunque sea "no text").
    .replace(/,?\s*(?:with\s+|and\s+)?(?:no|without)\s+(?:any\s+)?(?:readable\s+|visible\s+|on-screen\s+)?(?:text|writing|words|letters|logos?|captions|subtitles|watermarks?)\b(?:\s*(?:,|or|and)\s*(?:no\s+)?(?:readable\s+)?(?:text|writing|words|letters|logos?|captions|subtitles|watermarks?)\b)*/gi, '')
    .replace(/\s+/g, ' ').trim();
  // Tope de largo: si se pasa de ~220 palabras, la descripción del cuadro se recorta a sus 2 primeras frases.
  if (out.split(/\s+/).length > 220 && startTxt) out = out.replace(startTxt.replace(/[.\s]*$/, '.'), sentencesOf(startTxt).slice(0, 2).join(' ').replace(/[.\s]*$/, '.'));
  return out;
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

// Tamaño de una imagen JPEG/PNG (para saber si la toma es horizontal 16:9 o vertical 9:16 sin pasar más datos).
function imageSize(b64) {
  try {
    const b = Buffer.from(b64, 'base64');
    if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    let i = 2;
    while (i < b.length) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; const len = b.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + len; }
  } catch (_) {}
  return null;
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
  // 9:16 (Shorts) o 16:9 (videos largos), según la imagen inicial (la 1ª pasada va a la mitad; el escalador ×2 la sube)
  const isz = imageSize(startImage.imageBytes);
  const wide = !!(isz && isz.w > isz.h * 1.15);
  wf[N.width].inputs.value = wide ? 1280 : 704;
  wf[N.height].inputs.value = wide ? 704 : 1280;
  if (wide) log('  LTX en horizontal 16:9');
  // oct-16 (Franklin): MÁXIMO 8 s por clip. LTX aguanta más, pero con más segundos inventa movimiento para llenar el tiempo
  // (prueba A/B T79: la mano llegó y siguió hasta salirse del cuadro). Cualquier segundo entero vale en esta instalación:
  // la plantilla pide seg × 24 + 1 cuadros, que cumple la regla 8n+1 de LTX. Lo que necesite más, se parte en varias tomas.
  // El tope de 8 s lo pone kingSecondsFor; aquí solo el límite físico (con una excepción: ver kingSecondsFor).
  wf[N.duration].inputs.value = Math.max(2, Math.min(15, Math.round(Number(durationSeconds) || 8)));
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
// oct-16 (Franklin): máximo 8 s por clip (antes 15). Si la voz dura más, el render ajusta la velocidad (hasta 0.6×) y el
// guionista debe partir la línea en dos tomas (regla LTX-SAFE de duración). shot.seconds (si el guion lo trae) manda.
function kingSecondsFor(shot) {
  if (!shot) return 8;
  if (Number(shot.seconds) > 0) return Math.max(2, Math.min(8, Math.round(Number(shot.seconds)))); // voz continua: tomas cortas tipo anime (2 s)
  let voice = Number(shot.narration && shot.narration.seconds) || 0;
  if (!voice) {
    const d = shot.dialogue;
    const words = (Array.isArray(d) ? d : d ? [d] : []).map((x) => (x && x.line) || '').join(' ').split(/\s+/).filter(Boolean).length;
    voice = words / 1.9;
  }
  const need = voice + 1.3;
  // Excepción: el render solo puede ralentizar hasta 0.6× (si no, la voz continua se adelanta y TODO lo que sigue queda
  // desfasado). Si la línea es tan larga que 8 s no alcanzan ni a 0.6×, se da lo justo para no desfasar (≈1 % de las tomas;
  // esas deberían partirse en el guion).
  return Math.max(4, Math.min(8, Math.ceil(need)), Math.ceil(need * 0.6));
}

module.exports = { kingSecondsFor, kingGenerateVideo, ltxPromptFor, ltxNegativeFor, speaksOnScreen, NEG_BASE };
