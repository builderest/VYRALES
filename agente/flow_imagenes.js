// IMÁGENES CON GOOGLE FLOW (tu cuenta, tu plan) desde un Chrome propio de VYRALES.
//   node agente/flow_imagenes.js login            → abre Flow; inicias sesión TÚ una vez (queda guardada)
//   node agente/flow_imagenes.js prueba           → genera 1 imagen de prueba y la guarda
// El perfil de Chrome vive en %LOCALAPPDATA%\VYRALES_flow_perfil (fuera del repo). A ritmo humano:
// una imagen a la vez, pausas entre pedidos. Si Google pide verificación, la resuelves tú en la ventana.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const PROFILE = path.join(process.env.LOCALAPPDATA || ROOT, 'VYRALES_flow_perfil');
const OUT = path.join(ROOT, '_to_delete', 'flow');
const PW_VERSION = '1.48.2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Formato: vertical 9:16 (Shorts) u horizontal 16:9 (videos largos). flowImages({aspect}) lo cambia.
let ASPECT = process.env.FLOW_ASPECT === '16:9' ? '16:9' : '9:16';
const ruleBaseFor = () => (ASPECT === '16:9' ? ' Horizontal 16:9 landscape widescreen image.' : ' Vertical 9:16 portrait image.') + ' Photorealistic, cinematic documentary, dramatic lighting, sharp detail. Real photograph captured with a real camera — NOT a 3D render, NOT CGI, NOT a video game, NOT an illustration, cartoon or painting; real-world textures, not smooth plastic. No text.';
let RULE_BASE = ruleBaseFor();
// Sin personas SOLO si la escena no las menciona (el oficial del búnker, siluetas, manos…).
const PEOPLE_RE = /\b(person|people|persons|man|men|woman|women|officer|soldier|soldiers|silhouette|silhouettes|child|children|boy|girl|hand|hands|crowd|figure|figures|worker|operator|pilot|scientist|human|humans|hunter|hunters|survivor|survivors|clan|tribe|band|members|family|families|warrior|warriors|villagers|pedestrians|sapiens|hominid|hominids)\b/i;
const ruleFor = (prompt) => RULE_BASE + (PEOPLE_RE.test(prompt) ? '' : ' No people, no hands.');
const RULE = RULE_BASE + ' No people, no hands.';

function loadPlaywright() {
  try { return require('playwright-core'); } catch (_) {}
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-save', 'playwright-core@' + PW_VERSION], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  return require(path.join(ROOT, 'node_modules', 'playwright-core'));
}

// visible=false → ventana fuera de pantalla (en segundo plano, sigue siendo Chrome real).
async function openFlow(visible) {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  let ctx = null;
  for (const channel of ['chrome', 'msedge']) {
    try {
      ctx = await chromium.launchPersistentContext(PROFILE, { channel, headless: false, chromiumSandbox: true, viewport: { width: 1500, height: 900 }, acceptDownloads: true, ignoreDefaultArgs: ['--enable-automation'], args: ['--window-size=1520,1000', '--disable-blink-features=AutomationControlled'].concat(visible ? ['--window-position=40,20'] : ['--window-position=-3000,-3000']) });
      console.log('Navegador:', channel);
      break;
    } catch (e) { console.log('No pude abrir', channel, '→', String(e.message).split('\n')[0]); }
  }
  if (!ctx) throw new Error('No pude abrir Chrome ni Edge');
  const page = ctx.pages()[0] || (await ctx.newPage());
  return { ctx, page };
}

const shot = async (page, name) => { try { await page.screenshot({ path: path.join(OUT, name + '.png') }); } catch (_) {} };
// ¿Estamos dentro de la app de Flow? (la página /about es la portada pública: hay que entrar con
// "Create with Google Flow", que usa la sesión de Google si existe).
async function inApp(page) {
  return page.evaluate(() => !/\/about/.test(location.pathname) && /flow\.google\.com/.test(location.host) && (!!document.querySelector('a[href*="SignOutOptions"]') || /Nuevo proyecto|New project/i.test(document.body.innerText))).catch(() => false);
}
async function enterApp(page) {
  await page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 6; i++) {
    await sleep(2500);
    if (await inApp(page)) return true;
    if (/accounts\.google\.com/.test(page.url())) return false;
    const cta = page.getByText(/Create with Google Flow|Crear con Google Flow|Empezar|Get started/i).first();
    if (await cta.isVisible().catch(() => false)) { await cta.click().catch(() => {}); await sleep(5000); }
  }
  return inApp(page);
}

async function ensureLogin(page, waitMin) {
  if (await enterApp(page)) { console.log('Sesión de Google en Flow: OK'); return true; }
  if (waitMin < 1) return false;
  console.log(`Inicia sesión en la ventana de Chrome que se abrió (tienes ${waitMin} min). Yo no toco tu contraseña.`);
  const t0 = Date.now();
  while (Date.now() - t0 < waitMin * 60000) {
    await sleep(5000);
    if (/flow\.google\.com/.test(page.url()) && (await inApp(page))) { console.log('Sesión de Google: OK (guardada para las próximas veces)'); return true; }
    if (/flow\.google\.com\/about/.test(page.url())) { const cta = page.getByText(/Create with Google Flow|Crear con Google Flow/i).first(); if (await cta.isVisible().catch(() => false)) await cta.click().catch(() => {}); }
  }
  return false;
}

async function newProject(page) {
  if (!(await inApp(page))) await enterApp(page);
  await shot(page, 'inicio');
  const cands = [page.getByRole('button', { name: /nuevo proyecto|new project/i }).first(), page.getByText(/nuevo proyecto|new project/i).first()];
  let clicked = false;
  for (const c of cands) { if (await c.count().catch(() => 0)) { await c.click({ timeout: 15000, force: true }).then(() => { clicked = true; }).catch(() => {}); if (clicked) break; } }
  if (!clicked) {
    const txt = await page.evaluate(() => document.body.innerText.slice(0, 800)).catch(() => '');
    throw new Error('No encontré el botón Nuevo proyecto. URL ' + page.url() + ' · texto: ' + txt.replace(/\s+/g, ' '));
  }
  await page.waitForURL(/\/project\//, { timeout: 30000 });
  await page.waitForSelector('.ProseMirror', { timeout: 30000 });
  await sleep(2000);
  console.log('Proyecto:', page.url());
}

// oct-16: ancho real de la imagen (JPEG/PNG/WEBP) para distinguir la ORIGINAL de la miniatura. Antes se usaba el
// peso (> 60 KB): una imagen casi negra (una estrella sola en el espacio) pesa menos que eso aunque sea la original
// → se descartaba siempre, salía del lote y terminaba guardándose la miniatura de 286x512.
function imgWidth(b) {
  try {
    if (b[0] === 0x89 && b[1] === 0x50) return b.readUInt32BE(16);
    if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') {
      const t = b.slice(12, 16).toString();
      if (t === 'VP8 ') return b.readUInt16LE(26) & 0x3fff;
      if (t === 'VP8L') return 1 + (((b[22] & 0x3f) << 8) | b[21]);
      if (t === 'VP8X') return 1 + b.readUIntLE(24, 3);
    }
    if (b[0] === 0xff && b[1] === 0xd8) { let i = 2; while (i < b.length) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return b.readUInt16BE(i + 7); i += 2 + b.readUInt16BE(i + 2); } }
  } catch (_) {}
  return 0;
}
const esOriginal = (b) => !!b && (imgWidth(b) >= 600 || (imgWidth(b) === 0 && b.length > 60000));

// Clave estable de una imagen de Flow: el id del medio (la firma de la URL cambia cada vez que se refresca).
const mediaKey = (src) => { const m = /\/image\/([0-9a-f-]{36})/i.exec(src) || /\/asb\/([^=?]+)/.exec(src); return m ? m[1] : String(src).split('?')[0]; };
async function imgSrcs(page) {
  // Miniaturas de la cuadrícula del proyecto (no las del chat del agente, que repiten las mismas).
  // oct-16: antes se filtraba por orientación (vertical si 9:16, horizontal si 16:9). Con fotos de referencia Flow a
  // veces entrega en la otra orientación → la imagen YA hecha se ignoraba, se esperaba hasta el tope y se pagaba Gemini
  // (16 imágenes de 1376x768 perdidas así en los últimos trabajos). Ahora vale cualquier imagen de Flow (su CDN o /asb/)
  // de buen tamaño; lo que ya estaba antes del pedido (fotos de referencia incluidas) se descarta con mediaKey.
  return page.evaluate(() => [...new Set([...document.querySelectorAll('img')].filter((i) => i.naturalWidth >= 120 && i.naturalHeight >= 120 && /flow-content\.google|\/asb\/|googleusercontent\.com/i.test(i.currentSrc || i.src) && !/avatar|profile|googleusercontent\.com\/a\/|\/ogw\/|gstatic/i.test(i.currentSrc || i.src)).map((i) => i.currentSrc || i.src))]);
}

// Sube imágenes de referencia (fotos de cara de los personajes) como "ingredientes" del pedido:
// botón "+" del cuadro de texto → "Subir archivo…" → "Añadir a petición".
async function addRefs(page, refs, name) {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-flow-ref-'));
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    const f = path.join(tmp, `ref${i + 1}.${String(r.mimeType || '').includes('png') ? 'png' : 'jpg'}`);
    fs.writeFileSync(f, Buffer.from(r.imageBytes, 'base64'));
    await page.locator('button[aria-label*="ingredientes"], button[aria-label*="ingredients"]').first().click({ timeout: 15000 });
    await sleep(1500);
    await shot(page, `${name}_menu${i + 1}`);
    // 1º: si ya hay un <input type=file> en la página, se le pasa el archivo directo.
    const inputs = page.locator('input[type="file"]');
    if (await inputs.count()) await inputs.first().setInputFiles(f);
    else {
      const up = page.locator('text=/Subir archivo|Upload file|Upload/i').last();
      console.log('  (botón subir:', await up.count(), ')');
      const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), up.click({ force: true })]);
      await fc.setFiles(f);
    }
    // Espera a que termine de subir; luego "Añadir a petición".
    // oct-16: la foto subida aparece en la lista pero NO queda seleccionada, y "Añadir a petición" no hace nada hasta
    // marcarla (12 fallos "locator.click: Timeout 15000ms" → 3 reintentos → Gemini pagado). Se hace clic en ella.
    const add = page.getByRole('button', { name: /Añadir a petición|Add to prompt/i }).first();
    const item = page.getByText(path.basename(f), { exact: true }).first();
    for (let k = 0; k < 30; k++) { await sleep(1000); if (await item.isVisible().catch(() => false)) break; }
    await item.click({ timeout: 10000 }).catch((e) => console.log('  (no pude marcar la foto subida: ' + String(e.message).split('\n')[0] + ')'));
    for (let k = 0; k < 15; k++) { await sleep(1000); if (await add.isEnabled().catch(() => false)) break; }
    await shot(page, `${name}_ref${i + 1}`);
    await add.click({ timeout: 15000 });
    await sleep(1500);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// oct-15 (Franklin, "la revision es lo que mas dura"): antes se esperaban 4 min FIJOS antes de dar
// por fallado un pedido a Flow, en CADA intento (hasta 3 veces con personajes = 12 min solo esperando).
// El propio comentario de flowImages (mas abajo) midio que un pedido que SI sale tarda ~40 s. 90 s deja
// mas del doble de margen y corta mucho antes los que de verdad estan atascados. Si con el tiempo se ve
// que corta pedidos que habrian salido bien pasados los 90 s, se sube este numero (nunca se baja tries).
async function generate(page, ctx, prompt, name, refs, waitSec = 90) {
  if (refs && refs.length) { await addRefs(page, refs, name); await sleep(2000); }
  // Lo que ya hay (incluidas las fotos de referencia recién subidas) NO cuenta como resultado.
  // oct-16: la miniatura de la foto SUBIDA tarda en cargar y a veces aparece después de esta foto de "antes" → se
  // tomaba la propia referencia como resultado. Se espera a que la cuadrícula quede quieta y, además, todo lo que
  // aparezca en los primeros 10 s tras enviar (Flow nunca genera tan rápido) también cuenta como "ya estaba".
  const before = new Set((await imgSrcs(page)).map(mediaKey));
  for (let k = 0; k < 5; k++) { await sleep(1500); const n0 = before.size; (await imgSrcs(page)).forEach((x) => before.add(mediaKey(x))); if (before.size === n0 && k >= 1) break; }
  await page.click('.ProseMirror');
  await page.keyboard.insertText(prompt);
  await sleep(800);
  await shot(page, name + '_1_prompt');
  await page.keyboard.press('Enter');
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) { await sleep(2000); (await imgSrcs(page)).forEach((x) => before.add(mediaKey(x))); }
  let confirmed = false;
  while (Date.now() - t0 < waitSec * 1000) {
    await sleep(4000);
    // El agente de Flow puede pedir confirmación antes de generar: se acepta (es lo que pediste).
    if (!confirmed) {
      const c = page.getByRole('button', { name: /^(Generar|Confirmar|Sí|Continuar|Generate|Confirm)$/i }).first();
      if (await c.isVisible().catch(() => false)) { await c.click().catch(() => {}); confirmed = true; console.log('  (confirmé la generación)'); }
    }
    // Si igual pregunta el formato ("Which aspect ratio…"), se elige el del episodio.
    try {
      const opt = page.getByText(ASPECT === '16:9' ? /^Horizontal widescreen \(16:9\)$|16:9\)$/ : /^Vertical \(9:16\)$/).last();
      if (await page.getByText(/aspect ratio would you like|qué relación de aspecto|which aspect/i).last().isVisible().catch(() => false) && await opt.isVisible().catch(() => false)) {
        await opt.click().catch(() => {}); console.log('  (Flow preguntó el formato → elegí ' + ASPECT + ')'); await sleep(1500);
      }
    } catch (_) {}
    // oct-14: Flow rechaza por política (p. ej. una persona real y famosa por su nombre) → avisar YA, no esperar 4 min.
    // oct-16: "Has alcanzado tu límite de cuota del agente de Flow… vuelve mañana" → no va a generar nada hoy.
    // Antes se esperaba el tope en cada intento (y se reabría Chrome 3 veces). Ahora se avisa al instante.
    if (await page.getByText(/límite de cuota del agente|quota limit for the Flow agent|reached your .*quota|cuota del agente de Flow/i).first().isVisible().catch(() => false)) { await shot(page, name + '_cuota'); throw new Error('CUOTA_FLOW: se acabó la cuota diaria del agente de Flow (vuelve mañana).'); }
    const pol = await page.getByText(/might violate our policies|infringir nuestras pol[ií]ticas/i).first().isVisible().catch(() => false);
    if (pol) { await shot(page, name + '_politica'); throw new Error('POLITICA: Flow rechazó la imagen por sus políticas (suele ser una persona real nombrada).'); }
    const now = (await imgSrcs(page)).filter((s) => !before.has(mediaKey(s)));
    if (now.length) {
      await sleep(3000);
      let src = now[0];
      console.log('  miniatura:', src.slice(0, 200));
      // Abrir la imagen en grande (clic en la miniatura) y tomar la versión de mayor resolución.
      try {
        await page.locator(`img[src="${src.replace(/"/g, '\\"')}"]`).first().click({ timeout: 8000 });
        await sleep(4000);
        // oct-16: antes se tomaba la imagen de MÁS PÍXELES de la página; con foto de referencia del mismo tamaño
        // (768x1376) salía la REFERENCIA en vez de la generada. Ahora: la que se ve MÁS GRANDE en pantalla (el visor),
        // y solo del CDN de Flow.
        const big = await page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => /flow-content\.google|\/asb\//.test(i.currentSrc || i.src)).map((i) => { const r = i.getBoundingClientRect(); return { s: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight, a: r.width * r.height }; }).sort((a, b) => b.a - a.a)[0]);
        console.log('  grande:', big && big.w + 'x' + big.h, big && big.s.slice(0, 200));
        await shot(page, name + '_grande');
        if (big && big.w > 600) src = big.s;
      } catch (e) { console.log('  (no pude abrir en grande:', String(e.message).split('\n')[0], ')'); }
      let buf = null;
      // Las URLs de Google (…/asb/…) dan la ORIGINAL agregando "=s0" (sin eso llega la miniatura de 286 px).
      if (/googleusercontent\.com|flow\.google\.com\/asb\//.test(src)) {
        const full = src.replace(/=[a-z0-9-]+$/i, '') + '=s0';
        try { const r = await ctx.request.get(full); if (r.ok()) { const b = Buffer.from(await r.body()); if (esOriginal(b)) { buf = b; console.log('  original:', b.length, 'bytes', imgWidth(b) + ' px de ancho'); } } } catch (_) {}
      }
      if (!buf) try { const r = await ctx.request.get(src); if (r.ok()) buf = Buffer.from(await r.body()); } catch (_) {}
      if (!buf) {
        const b64 = await page.evaluate(async (u) => { const r = await fetch(u); const b = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }, src).catch(() => null);
        if (b64) buf = Buffer.from(b64, 'base64');
      }
      // Flow puede devolver 2 imágenes por pedido: se espera a que dejen de llegar, para que la 2ª
      // no se tome como resultado del pedido siguiente (EP2: la toma 11 salió igual a la 10).
      let last = (await imgSrcs(page)).length, quiet = 0;
      for (let k = 0; k < 15 && quiet < 3; k++) { await sleep(3000); const c = (await imgSrcs(page)).length; if (c === last) quiet++; else { quiet = 0; last = c; } }
      await shot(page, name + '_2_listo');
      if (!buf) throw new Error('Vi la imagen nueva pero no pude descargarla: ' + src.slice(0, 120));
      if (!esOriginal(buf)) throw new Error('Solo conseguí la miniatura (' + imgWidth(buf) + ' px), no la original: ' + src.slice(0, 120));
      return { buffer: buf, src };
    }
    if ((Date.now() - t0) % 20000 < 4000) await shot(page, name + '_esperando');
  }
  await shot(page, name + '_timeout');
  console.log('imgs:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('img')].map((i) => [i.naturalWidth, i.naturalHeight, (i.currentSrc || i.src).slice(0, 140)]))));
  const txt = await page.evaluate(() => document.body.innerText.slice(-1500)).catch(() => '');
  throw new Error('Flow no devolvió imagen en ' + Math.round(waitSec / 60 * 10) / 10 + ' min. Texto en pantalla: ' + txt.replace(/\s+/g, ' ').slice(-600));
}

// Para el pipeline: genera UNA imagen en Flow (segundo plano; muestra Chrome solo si hay que iniciar sesión).
// Devuelve lo mismo que _image.generateImage: { buffer, mimeType, costUsd, model }.
async function flowImage({ prompt, refs = [], aspect = null, waitSec = 90 }) {
  if (aspect) { ASPECT = aspect === '16:9' ? '16:9' : '9:16'; RULE_BASE = ruleBaseFor(); }
  let { ctx, page } = await openFlow(process.env.FLOW_VISIBLE === '1');
  try {
    let ok = await ensureLogin(page, 0.1);
    if (!ok) {
      console.log('Flow: falta iniciar sesión → muestro la ventana de Chrome (10 min).');
      await ctx.close().catch(() => {});
      ({ ctx, page } = await openFlow(true));
      ok = await ensureLogin(page, 10);
    }
    if (!ok) throw new Error('Flow: no hay sesión de Google.');
    await newProject(page);
    // oct-14: si el prompt nombra el OTRO formato (p. ej. "vertical 9:16" en un largo 16:9), Flow se detiene a preguntar
    // cuál usar y nunca genera (3 fallas seguidas → antes se pagaba Gemini). Se quitan esas frases: manda ASPECT.
    const otro = ASPECT === '16:9' ? /[^.]*\b(9\s*:\s*16|vertical (frame|image|format))\b[^.]*\.?/gi : /[^.]*\b(16\s*:\s*9|widescreen|horizontal (frame|image|format))\b[^.]*\.?/gi;
    const limpio = String(prompt).replace(otro, ' ').replace(/\s{2,}/g, ' ').trim();
    const img = await generate(page, ctx, limpio.replace(/\.?$/, '.') + (refs.length ? RULE_BASE : ruleFor(limpio)), 'pipeline', refs, waitSec);
    const jpg = img.buffer[0] === 0xff && img.buffer[1] === 0xd8;
    return { buffer: img.buffer, mimeType: jpg ? 'image/jpeg' : 'image/png', costUsd: 0, model: 'flow' };
  } finally {
    await ctx.close().catch(() => {});
  }
}
// LOTE (Franklin, oct-10; probado: 3 imágenes en 49 s en vez de ~40 s CADA una): Flow es un agente de chat,
// así que UN mensaje con varias escenas numeradas → genera todas juntas. Pedidos seguidos NO sirven (mientras
// genera, los mensajes nuevos se pierden). Flow NO respeta el orden de las escenas al devolverlas, así que cada
// imagen se empareja con su escena mirándola (Gemini visión, miniaturas, ~$0.002 por lote). Lo que no se pueda
// emparejar se rehace solo, una por una.
let LOTE = Math.max(1, Math.min(30, Number(process.env.FLOW_LOTE) || 20)); // oct-16: 20 por mensaje (probado: 20/20 en 74 s, 10/10 en ~106 s) // let: la prueba de lote (prueba_lote) lo cambia
async function newImages(page, before) {
  const seen = new Set();
  return (await imgSrcs(page)).filter((s) => { const k = mediaKey(s); if (before.has(k) || seen.has(k)) return false; seen.add(k); return true; });
}
async function download(ctx, page, src, full) {
  const url = full && /googleusercontent\.com|flow\.google\.com\/asb\/|\/asb\//.test(src) ? src.replace(/=[a-z0-9-]+$/i, '') + '=s0' : src;
  try { const r = await ctx.request.get(url); if (r.ok()) { const b = Buffer.from(await r.body()); if (b.length > 3000) return b; } } catch (_) {}
  const b64 = await page.evaluate(async (u) => { const r = await fetch(u); const b = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }, url).catch(() => null);
  return b64 ? Buffer.from(b64, 'base64') : null;
}
async function generateBatch(page, ctx, prompts, name, log, refs = null) {
  // oct-16: con referencias (caras de personajes / foto fija del lugar) se suben UNA vez para todo el lote.
  if (refs && refs.length) { await addRefs(page, refs, name); await sleep(2000); }
  const before = new Set((await imgSrcs(page)).map(mediaKey));
  for (let k = 0; k < 5; k++) { await sleep(1500); const n0 = before.size; (await imgSrcs(page)).forEach((x) => before.add(mediaKey(x))); if (before.size === n0 && k >= 1) break; }
  const refTxt = refs && refs.length ? 'Reference images in order: ' + refs.map((r, k) => `image ${k + 1} = ${r.label || 'reference'}`).join('; ') + '. Use them as the exact identity/look of those people and places in every scene where they appear.\n' : '';
  const msg = refTxt + `Create ${prompts.length} separate images, one for EACH scene below. Each scene is its own ${ASPECT === '16:9' ? 'horizontal 16:9 widescreen' : 'vertical 9:16'} photorealistic image; do not combine scenes into one picture and do not skip any scene. Generate all ${prompts.length} now without asking.\n` +
    prompts.map((p, i) => `Scene ${i + 1}: ${String(p).trim().replace(/\.?$/, '.')}${PEOPLE_RE.test(p) ? '' : ' (no people)'}`).join('\n') + '\nStyle for every image:' + RULE_BASE;
  await page.click('.ProseMirror');
  await page.keyboard.insertText(msg);
  await sleep(800);
  await shot(page, name + '_1_prompt');
  await page.keyboard.press('Enter');
  const t0 = Date.now(), maxMs = (3 + prompts.length * 0.75) * 60000;
  if (refs && refs.length) while (Date.now() - t0 < 10000) { await sleep(2000); (await imgSrcs(page)).forEach((x) => before.add(mediaKey(x))); }
  let last = -1, quiet = 0, cur = [];
  while (Date.now() - t0 < maxMs) {
    await sleep(4000);
    const c = page.getByRole('button', { name: /^(Generar|Confirmar|Sí|Continuar|Generate|Confirm|Yes|Continue)$/i }).first();
    if (await c.isVisible().catch(() => false)) { await c.click().catch(() => {}); log('  (confirmé la generación)'); }
    if (await page.getByText(/límite de cuota del agente|quota limit for the Flow agent|cuota del agente de Flow/i).first().isVisible().catch(() => false)) { await shot(page, name + '_cuota'); throw new Error('CUOTA_FLOW: se acabó la cuota diaria del agente de Flow (vuelve mañana).'); }
    cur = await newImages(page, before);
    if (cur.length !== last) { log(`  Flow lote: ${cur.length}/${prompts.length} imágenes (${Math.round((Date.now() - t0) / 1000)} s)`); last = cur.length; quiet = 0; }
    else if (cur.length >= prompts.length) { if (++quiet >= 2) break; }
    else if (cur.length > 0 && ++quiet >= 12) break; // ~48 s sin novedades: Flow ya terminó lo que iba a hacer
  }
  await shot(page, name + '_2_listo');
  const out = [];
  for (const src of cur) { const thumb = await download(ctx, page, src, false); out.push({ src, thumb }); }
  return out;
}
// Empareja miniaturas ↔ escenas mirando las imágenes (Gemini). Devuelve [índice de escena | -1] por imagen.
async function matchScenes(prompts, imgs, log) {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key || !imgs.length) return imgs.map(() => -1);
  let model = 'gemini-3.8-flash'; try { model = require(path.join(ROOT, 'netlify', 'functions', '_publish')).TEXT_MODEL || model; } catch (_) {}
  const parts = [{ text: 'Match each image to the scene it depicts. Scenes:\n' + prompts.map((p, i) => `${i + 1}. ${p}`).join('\n') + `\n\nThen ${imgs.length} images follow, in order. Each scene matches at most one image. If an image matches no scene, use 0. Return ONLY JSON: {"images":[{"image":1,"scene":3}]}` }];
  imgs.forEach((im, i) => { parts.push({ text: `Image ${i + 1}:` }); parts.push({ inline_data: { mime_type: im.thumb && im.thumb[0] === 0x89 ? 'image/png' : 'image/jpeg', data: (im.thumb || Buffer.alloc(0)).toString('base64') } }); });
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }) });
    const j = await res.json();
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + JSON.stringify(j.error || {}).slice(0, 160));
    const out = JSON.parse(j.candidates[0].content.parts.map((p) => p.text || '').join(''));
    const used = new Set(), map = imgs.map(() => -1);
    (out.images || []).forEach((x) => { const i = Number(x.image) - 1, sc = Number(x.scene) - 1; if (i >= 0 && i < imgs.length && sc >= 0 && sc < prompts.length && !used.has(sc) && map[i] === -1) { map[i] = sc; used.add(sc); } });
    return map;
  } catch (e) { log('  (no pude emparejar las imágenes: ' + String(e.message).slice(0, 160) + ')'); return imgs.map(() => -1); }
}

// Varias imágenes en UNA sola sesión de Flow (un proyecto, sin reabrir Chrome): en lotes de LOTE escenas por
// mensaje; lo que falte se rehace una por una.
// prompts: [string] → [{ buffer, mimeType } | { error }] en el mismo orden.
async function flowImages(prompts, log = console.log, onEach = null, opts = {}) {
  ASPECT = opts.aspect === '16:9' ? '16:9' : '9:16'; RULE_BASE = ruleBaseFor();
  // oct-16: cuota del agente agotada hace < 3 h (aviso compartido con _image.js) → no se abre Chrome.
  const FLAG = path.join(OUT, 'cuota_agotada.txt');
  try { if (Date.now() - Number(fs.readFileSync(FLAG, 'utf8')) < 3 * 3600000) { log('Flow: cuota del agente agotada (aviso de hace < 3 h) → no pido nada'); return prompts.map(() => ({ error: 'CUOTA_FLOW: cuota del agente agotada' })); } } catch (_) {}
  if (ASPECT === '16:9') log('Flow: imágenes HORIZONTALES 16:9');
  let { ctx, page } = await openFlow(process.env.FLOW_VISIBLE === '1');
  const out = [];
  try {
    let ok = await ensureLogin(page, 0.1);
    if (!ok) {
      log('Flow: falta iniciar sesión → muestro la ventana de Chrome (10 min).');
      await ctx.close().catch(() => {});
      ({ ctx, page } = await openFlow(true));
      ok = await ensureLogin(page, 10);
    }
    if (!ok) throw new Error('Flow: no hay sesión de Google.');
    await newProject(page);
    const res = new Array(prompts.length).fill(null);
    let cuota = false; // oct-16: con la cuota del agente agotada no se sigue pidiendo
    const finish = async (i, buf) => {
      const jpg = buf[0] === 0xff && buf[1] === 0xd8;
      res[i] = { buffer: buf, mimeType: jpg ? 'image/jpeg' : 'image/png' };
      if (onEach) { try { await onEach(i, res[i]); } catch (e) { log('  (no se pudo guardar al momento: ' + String(e.message).slice(0, 120) + ')'); } }
    };
    if (LOTE > 1 && prompts.length > 1) {
      for (let s0 = 0; s0 < prompts.length; s0 += LOTE) {
        const idx = []; for (let k = s0; k < Math.min(prompts.length, s0 + LOTE); k++) idx.push(k);
        try {
          const t = Date.now();
          const imgs = await generateBatch(page, ctx, idx.map((k) => prompts[k]), 'lote' + (s0 / LOTE + 1), log);
          const map = await matchScenes(idx.map((k) => prompts[k]), imgs, log);
          let n = 0;
          for (let m = 0; m < imgs.length; m++) {
            if (map[m] < 0) continue;
            const buf = await download(ctx, page, imgs[m].src, true);
            if (esOriginal(buf)) { await finish(idx[map[m]], buf); n++; log(`Flow escena ${idx[map[m]] + 1}/${prompts.length}: lista (${buf.length} bytes, en lote)`); }
          }
          log(`Flow lote ${s0 / LOTE + 1}: ${n}/${idx.length} en ${Math.round((Date.now() - t) / 1000)} s`);
        } catch (e) { if (/CUOTA_FLOW/.test(e.message)) { log('Flow: ' + e.message + ' → no sigo pidiendo (cada pedido esperaría en vano).'); cuota = true; break; } log('Flow lote: FALLÓ ' + String(e.message).slice(0, 200) + ' → las de este lote van una por una'); }
        await sleep(2000 + Math.random() * 2000);
      }
    }
    for (let i = 0; i < prompts.length; i++) {
      if (res[i]) { out[i] = res[i]; continue; }
      if (cuota) { out[i] = { error: 'CUOTA_FLOW: se acabó la cuota diaria del agente de Flow (vuelve mañana).' }; continue; }
      try {
        const img = await generate(page, ctx, String(prompts[i]).trim().replace(/\.?$/, '.') + ruleFor(prompts[i]), 'lote' + (i + 1));
        await finish(i, img.buffer); out[i] = res[i];
        log(`Flow ${i + 1}/${prompts.length}: lista una por una (${img.buffer.length} bytes)`);
      } catch (e) { out[i] = { error: e.message }; log(`Flow ${i + 1}/${prompts.length}: FALLÓ ${String(e.message).slice(0, 200)}`); if (/CUOTA_FLOW/.test(e.message)) cuota = true; }
      await sleep(2000 + Math.random() * 2000);
    }
    if (cuota) { try { fs.writeFileSync(FLAG, String(Date.now())); } catch (_) {} }
    return out;
  } finally {
    await ctx.close().catch(() => {});
  }
}
// oct-16 (Franklin: "las de personajes también van en el lote, o al menos todas juntas primero"): tomas CON fotos de
// referencia. Antes cada una abría su propio Chrome (createKeyframe → flowImage) = 1 ventana + 1 mensaje de cuota por toma.
// Ahora: UNA ventana; se agrupan las tomas que usan las MISMAS referencias (misma cara/lugar), se suben una vez y van en
// lotes de LOTE; lo que no salga en el lote se pide de a una en la misma ventana. items: [{ prompt, refs }] →
// [{ buffer, mimeType } | { error }] en el mismo orden.
async function flowImagesConRefs(items, log = console.log, onEach = null, opts = {}) {
  ASPECT = opts.aspect === '16:9' ? '16:9' : '9:16'; RULE_BASE = ruleBaseFor();
  const FLAG = path.join(OUT, 'cuota_agotada.txt');
  try { if (Date.now() - Number(fs.readFileSync(FLAG, 'utf8')) < 3 * 3600000) { log('Flow: cuota del agente agotada (aviso de hace < 3 h) → no pido nada'); return items.map(() => ({ error: 'CUOTA_FLOW: cuota del agente agotada' })); } } catch (_) {}
  const crypto = require('crypto');
  const keyOf = (refs) => (refs || []).map((r) => (r.label || '') + ':' + crypto.createHash('md5').update(String(r.imageBytes || '')).digest('hex')).join('|');
  const groups = new Map();
  items.forEach((it, i) => { const k = keyOf(it.refs); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
  log(`Flow (con referencias): ${items.length} cuadros en ${groups.size} grupo(s) de referencias, una sola ventana`);
  let { ctx, page } = await openFlow(process.env.FLOW_VISIBLE === '1');
  const out = new Array(items.length).fill(null);
  let cuota = false;
  const finish = async (i, buf) => { const jpg = buf[0] === 0xff && buf[1] === 0xd8; out[i] = { buffer: buf, mimeType: jpg ? 'image/jpeg' : 'image/png' }; if (onEach) { try { await onEach(i, out[i]); } catch (e) { log('  (no se pudo guardar al momento: ' + String(e.message).slice(0, 120) + ')'); } } };
  try {
    let ok = await ensureLogin(page, 0.1);
    if (!ok) { await ctx.close().catch(() => {}); ({ ctx, page } = await openFlow(true)); ok = await ensureLogin(page, 10); }
    if (!ok) throw new Error('Flow: no hay sesión de Google.');
    let g = 0;
    for (const [, idxAll] of groups) {
      g++;
      const refs = items[idxAll[0]].refs || [];
      for (let s0 = 0; s0 < idxAll.length && !cuota; s0 += LOTE) {
        const idx = idxAll.slice(s0, s0 + LOTE);
        if (idx.length < 2) continue; // una sola: va directo al paso de a una
        try {
          await newProject(page);
          const t = Date.now();
          const prompts = idx.map((k) => items[k].prompt);
          const imgs = await generateBatch(page, ctx, prompts, 'reflote' + g, log, refs);
          const map = await matchScenes(prompts, imgs, log);
          let n = 0;
          for (let m = 0; m < imgs.length; m++) {
            if (map[m] < 0 || out[idx[map[m]]]) continue;
            const buf = await download(ctx, page, imgs[m].src, true);
            if (esOriginal(buf)) { await finish(idx[map[m]], buf); n++; }
          }
          log(`Flow grupo ${g} (${refs.length} ref.): ${n}/${idx.length} en un mensaje, ${Math.round((Date.now() - t) / 1000)} s`);
        } catch (e) { if (/CUOTA_FLOW/.test(e.message)) { cuota = true; log('Flow: ' + e.message); break; } log('Flow grupo ' + g + ': lote FALLÓ ' + String(e.message).slice(0, 200) + ' → de a una'); }
        await sleep(2000 + Math.random() * 2000);
      }
      for (const i of idxAll) {
        if (out[i] || cuota) continue;
        try { await newProject(page); const img = await generate(page, ctx, String(items[i].prompt).trim().replace(/\.?$/, '.') + RULE_BASE, 'ref' + (i + 1), items[i].refs); await finish(i, img.buffer); log(`Flow ${i + 1}/${items.length}: lista de a una (misma ventana)`); }
        catch (e) { out[i] = { error: e.message }; log(`Flow ${i + 1}/${items.length}: FALLÓ ${String(e.message).slice(0, 200)}`); if (/CUOTA_FLOW/.test(e.message)) cuota = true; }
        await sleep(2000 + Math.random() * 2000);
      }
    }
    if (cuota) { try { fs.writeFileSync(FLAG, String(Date.now())); } catch (_) {} }
    return out.map((x) => x || { error: cuota ? 'CUOTA_FLOW' : 'sin imagen' });
  } finally { await ctx.close().catch(() => {}); }
}
module.exports = { flowImage, flowImages, flowImagesConRefs };

if (require.main === module) (async () => {
  const mode = process.argv[2] || 'prueba';
  // oct-16 (Franklin: "en un solo mensaje generar todas, o de 10 en 10, sin cerrar la ventana"): PRUEBA de lote grande.
  // Usa el MISMO flowImages del pipeline (una sola ventana de Chrome, un mensaje por lote) con 10 escenas fáciles de
  // distinguir, y mide cuántas salen en el lote y cuánto tarda. No toca episodios ni la base de datos.
  // oct-16: prueba del lote CON referencia (la misma cara en 5 escenas distintas, un solo mensaje).
  if (mode === 'prueba_ref') {
    const url = process.argv[3] || 'https://pfwdbdkngmdmoolzflhe.supabase.co/storage/v1/object/public/media/characters/job_la_prueba/1721708b-31d5-42d0-b7a2-1fbef60075d9-1791249285259.jpg';
    const ref = { imageBytes: Buffer.from(await (await fetch(url)).arrayBuffer()).toString('base64'), mimeType: 'image/jpeg', label: 'the woman with the long grey-black braid (face)' };
    const S = ['The woman with the long braid walks through a sunny old hacienda courtyard in a long rust-red dress.',
      'The woman with the long braid kneels in a vegetable garden at dawn, holding a basket of tomatoes.',
      'The woman with the long braid stands on a wooden pier at a calm lake at sunset, looking at the water.',
      'The woman with the long braid sits at a rustic kitchen table by a window, pouring coffee from a clay pot.',
      'The woman with the long braid walks down a rainy city street at night holding a black umbrella.'];
    const t0 = Date.now();
    const r = await flowImagesConRefs(S.map((p) => ({ prompt: p, refs: [ref] })), console.log, async (i, img) => { fs.writeFileSync(path.join(OUT, 'reflote_escena' + (i + 1) + '.jpg'), img.buffer); }, { aspect: '9:16' });
    console.log('RESULTADO: ' + r.filter((x) => x && x.buffer).length + '/' + S.length + ' en ' + Math.round((Date.now() - t0) / 1000) + ' s → _to_delete\\flow\\reflote_escena*.jpg');
    return;
  }
  if (mode === 'prueba_lote') {
    // Cuántas escenas probar: argumento, o el número en _to_delete/flow/prueba_lote_n.txt (para probar >10 sin tocar el agente).
    let N = Number(process.argv[3]) || 0; try { N = N || Number(fs.readFileSync(path.join(OUT, 'prueba_lote_n.txt'), 'utf8')); } catch (_) {}
    N = Math.max(1, Math.min(30, N || 10)); LOTE = N;
    const P0 = [
      'A vast dark nebula of deep blue and violet gas clouds with one sharp diagonal beam of white light across it.',
      'A single rocky planet in black silhouette against deep space, a bright sun peeking from behind its curved edge.',
      'A thick swirling band of golden-orange clouds on the surface of a gas giant planet, filling the frame.',
      'A glowing ring of orange and white energy expanding in the center of a dark empty space.',
      'A single bright white star alone in the center of total black darkness.',
      'A fossil human molar tooth lying on a plain white laboratory table under soft cool light.',
      'The dark mouth of a limestone cave on a dry hillside with holm oak trees, at golden hour.',
      'A rusty old railway track cutting through a deep trench of grey rock walls on a hill.',
      'A blacksmith forge with glowing orange coals and a thick iron bar lying in the fire.',
      'An empty bare concrete gym at dawn with one loaded steel barbell on the dark floor.',
      'A red vintage pickup truck parked alone in a golden wheat field at sunset.',
      'A lighthouse on a rocky cliff at night with its beam crossing a stormy sea.',
      'A single white sailboat on a calm turquoise lagoon seen from above.',
      'A snowy pine forest at dawn with one wooden cabin and smoke from its chimney.',
      'A close view of a green tree frog sitting on a wet leaf in the rain.',
      'An old stone bridge over a narrow river in a misty green valley.',
      'A desert with tall orange sand dunes and one camel walking on the ridge.',
      'A bowl of ramen with an egg and green onions on a dark wooden table.',
      'A brass antique compass lying open on an old paper-free wooden desk.',
      'A herd of wild horses running across a wide grassy plain under dark clouds.'
    ];
    const P = P0.slice(0, N);
    const t0 = Date.now(); const tiempos = [];
    console.log('PRUEBA LOTE: ' + P.length + ' escenas, ' + LOTE + ' por mensaje');
    const r = await flowImages(P, console.log, async (i, img) => {
      tiempos.push(Math.round((Date.now() - t0) / 1000));
      fs.writeFileSync(path.join(OUT, 'lote' + P.length + '_escena' + (i + 1) + (img.mimeType === 'image/png' ? '.png' : '.jpg')), img.buffer);
    }, { aspect: '9:16' });
    const ok = r.filter((x) => x && x.buffer).length;
    console.log('RESULTADO: ' + ok + '/' + P.length + ' imágenes en ' + Math.round((Date.now() - t0) / 1000) + ' s · cada una lista a los (s): ' + tiempos.join(', '));
    console.log('Guardadas en _to_delete\\flow\\lote' + P.length + '_escena*.jpg');
    return;
  }
  // Se muestra solo si hace falta iniciar sesión, si pediste verla (modo "ver"/login) o con FLOW_VISIBLE=1.
  const wantVisible = mode === 'login' || mode === 'ver' || process.env.FLOW_VISIBLE === '1';
  let { ctx, page } = await openFlow(wantVisible);
  try {
    let ok = await ensureLogin(page, wantVisible ? 10 : 0.1);
    if (!ok && !wantVisible) {
      console.log('Falta iniciar sesión → muestro la ventana de Chrome.');
      await ctx.close().catch(() => {});
      ({ ctx, page } = await openFlow(true));
      ok = await ensureLogin(page, 10);
      if (ok) { await ctx.close().catch(() => {}); ({ ctx, page } = await openFlow(false)); ok = await ensureLogin(page, 0.1); console.log(ok ? 'Sesión lista → vuelvo a segundo plano.' : 'En segundo plano no entró a Flow.'); }
    }
    if (!ok) throw new Error('No se inició sesión de Google en 10 min.');
    if (mode === 'login') { console.log('LISTO: sesión guardada en', PROFILE); return; }
    if (mode === 'prueba_lote') {
      // EXPERIMENTO: ¿se pueden pedir varias imágenes sin esperar cada una? A = pedidos seguidos; B = un solo pedido con 3 escenas.
      const info = () => page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.naturalWidth >= 120 && i.naturalHeight > i.naturalWidth && !/avatar|profile|googleusercontent\.com\/a\//i.test(i.src)).map((i) => {
        let el = i, txt = ''; for (let k = 0; k < 8 && el; k++) { el = el.parentElement; if (el && el.innerText && el.innerText.trim().length > 15) { txt = el.innerText.trim().slice(0, 160); break; } }
        return { src: (i.currentSrc || i.src), alt: i.alt || '', aria: i.getAttribute('aria-label') || '', near: txt, w: i.naturalWidth, h: i.naturalHeight };
      }));
      const save = async (tag, list) => { let k = 0; for (const it of list) { k++; try { const full = /googleusercontent|\/asb\//.test(it.src) ? it.src.replace(/=[a-z0-9-]+$/i, '') + '=s0' : it.src; const r = await ctx.request.get(full); fs.writeFileSync(path.join(OUT, `${tag}_${k}.jpg`), Buffer.from(await r.body())); } catch (e) { console.log('no bajó', e.message); } } };
      const waitNew = async (before, want, maxMs) => { const t0 = Date.now(); let last = -1, quiet = 0; let cur = []; while (Date.now() - t0 < maxMs) { await sleep(4000);
          const c = page.getByRole('button', { name: /^(Generar|Confirmar|Sí|Continuar|Generate|Confirm)$/i }).first(); if (await c.isVisible().catch(() => false)) { await c.click().catch(() => {}); console.log('  (confirmé)'); }
          cur = (await info()).filter((x) => !before.has(mediaKey(x.src))); const seen = new Set(); cur = cur.filter((x) => { const k = mediaKey(x.src); if (seen.has(k)) return false; seen.add(k); return true; });
          if (cur.length !== last) { console.log(`  ${Math.round((Date.now() - t0) / 1000)} s: ${cur.length} nuevas`); last = cur.length; quiet = 0; } else if (cur.length >= want) { quiet++; if (quiet >= 3) break; } }
        return cur; };
      // A (ya probado: los pedidos seguidos se PIERDEN mientras Flow genera; se deja como registro)
      await newProject(page);
      if (process.env.FLOW_LOTE_A === '1') {
      let before = new Set((await info()).map((x) => mediaKey(x.src)));
      const A = ['A single shiny red apple on a wooden table.', 'A bright blue vintage car on an empty road.', 'A green parrot perched on a branch.'];
      let t = Date.now();
      for (const pr of A) { await page.click('.ProseMirror'); await page.keyboard.insertText(pr + RULE); await sleep(500); await page.keyboard.press('Enter'); console.log('  enviado:', pr); await sleep(2500); }
      await shot(page, 'loteA_enviado');
      let got = await waitNew(before, 3, 5 * 60000);
      console.log(`A: ${got.length} imágenes en ${Math.round((Date.now() - t) / 1000)} s`); got.forEach((g, i) => console.log('  A', i + 1, g.w + 'x' + g.h, '| alt:', g.alt.slice(0, 80), '| near:', g.near.replace(/\s+/g, ' ').slice(0, 120)));
      await shot(page, 'loteA_fin'); await save('loteA', got);
      }
      // B: un solo pedido con 3 escenas numeradas
      let before = new Set((await info()).map((x) => mediaKey(x.src))), got, t;
      before = new Set((await info()).map((x) => mediaKey(x.src)));
      const B = 'Create 3 separate images, one for each scene (do not combine them into one picture):\nScene 1: a yellow desk lamp glowing in a dark room.\nScene 2: a purple umbrella standing open on a beach.\nScene 3: an orange cat sleeping on a sofa.' + RULE;
      t = Date.now();
      await page.click('.ProseMirror'); await page.keyboard.insertText(B); await sleep(500); await page.keyboard.press('Enter');
      got = await waitNew(before, 3, 5 * 60000);
      console.log(`B: ${got.length} imágenes en ${Math.round((Date.now() - t) / 1000)} s`); got.forEach((g, i) => console.log('  B', i + 1, g.w + 'x' + g.h, '| alt:', g.alt.slice(0, 80), '| near:', g.near.replace(/\s+/g, ' ').slice(0, 120)));
      await shot(page, 'loteB_fin'); await save('loteB', got);
      console.log('LISTO prueba_lote → _to_delete\\flow\\loteA_* y loteB_*');
      return;
    }
    if (mode === 'prueba_ref') {
      await newProject(page);
      const url = process.argv[3] || 'https://pfwdbdkngmdmoolzflhe.supabase.co/storage/v1/object/public/media/characters/job_la_prueba/1721708b-31d5-42d0-b7a2-1fbef60075d9-1791249285259.jpg';
      const b = Buffer.from(await (await fetch(url)).arrayBuffer());
      const t = Date.now();
      const img = await generate(page, ctx, 'Use the uploaded reference photo as the exact face and identity of the woman. She walks through a sunny old hacienda courtyard in a long elegant dress, cinematic medium shot, golden afternoon light.' + RULE_BASE, 'prueba_ref', [{ imageBytes: b.toString('base64'), mimeType: 'image/jpeg', label: 'face' }]);
      fs.writeFileSync(path.join(OUT, 'prueba_ref.png'), img.buffer);
      console.log(`LISTO en ${Math.round((Date.now() - t) / 1000)} s → _to_delete\\flow\\prueba_ref.png (${img.buffer.length} bytes)`);
      return;
    }
    await newProject(page);
    const prompt = 'A giant red squid floating in the dark deep ocean, its long tentacles trailing below, faint blue light from above, floating particles.' + RULE;
    const t = Date.now();
    const img = await generate(page, ctx, prompt, 'prueba');
    const file = path.join(OUT, 'prueba_flow.png');
    fs.writeFileSync(file, img.buffer);
    console.log(`LISTO en ${Math.round((Date.now() - t) / 1000)} s → _to_delete\\flow\\prueba_flow.png (${img.buffer.length} bytes)`);
  } finally {
    await sleep(2000);
    await ctx.close().catch(() => {});
  }
})().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
