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
const RULE_BASE = ' Vertical 9:16 portrait image. Photorealistic, cinematic documentary, dramatic lighting, sharp detail. No text.';
// Sin personas SOLO si la escena no las menciona (el oficial del búnker, siluetas, manos…).
const PEOPLE_RE = /\b(person|people|man|men|woman|women|officer|soldier|silhouette|child|boy|girl|hand|hands|crowd|figure|worker|operator|pilot|scientist)\b/i;
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

async function imgSrcs(page) {
  // Miniaturas de la cuadrícula del proyecto (no las del chat del agente, que repiten las mismas).
  return page.evaluate(() => [...new Set([...document.querySelectorAll('img')].filter((i) => i.naturalWidth >= 120 && i.naturalHeight > i.naturalWidth && !/avatar|profile|googleusercontent\.com\/a\//i.test(i.src)).map((i) => i.currentSrc || i.src))]);
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
    await sleep(1200);
    const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), page.getByText(/Subir archivo|Upload file/i).first().click()]);
    await fc.setFiles(f);
    // Espera a que termine de subir y queden seleccionada; luego "Añadir a petición".
    const add = page.getByRole('button', { name: /Añadir a petición|Add to prompt/i }).first();
    for (let k = 0; k < 30; k++) { await sleep(1000); if (await add.isEnabled().catch(() => false)) break; }
    await shot(page, `${name}_ref${i + 1}`);
    await add.click({ timeout: 15000 });
    await sleep(1500);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function generate(page, ctx, prompt, name, refs) {
  const before = new Set(await imgSrcs(page));
  if (refs && refs.length) await addRefs(page, refs, name);
  await page.click('.ProseMirror');
  await page.keyboard.insertText(prompt);
  await sleep(800);
  await shot(page, name + '_1_prompt');
  await page.keyboard.press('Enter');
  const t0 = Date.now();
  let confirmed = false;
  while (Date.now() - t0 < 4 * 60000) {
    await sleep(4000);
    // El agente de Flow puede pedir confirmación antes de generar: se acepta (es lo que pediste).
    if (!confirmed) {
      const c = page.getByRole('button', { name: /^(Generar|Confirmar|Sí|Continuar|Generate|Confirm)$/i }).first();
      if (await c.isVisible().catch(() => false)) { await c.click().catch(() => {}); confirmed = true; console.log('  (confirmé la generación)'); }
    }
    const now = (await imgSrcs(page)).filter((s) => !before.has(s));
    if (now.length) {
      await sleep(3000);
      let src = now[0];
      console.log('  miniatura:', src.slice(0, 200));
      // Abrir la imagen en grande (clic en la miniatura) y tomar la versión de mayor resolución.
      try {
        await page.locator(`img[src="${src.replace(/"/g, '\\"')}"]`).first().click({ timeout: 8000 });
        await sleep(4000);
        const big = await page.evaluate(() => [...document.querySelectorAll('img')].map((i) => ({ s: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight })).sort((a, b) => b.w * b.h - a.w * a.h)[0]);
        console.log('  grande:', big && big.w + 'x' + big.h, big && big.s.slice(0, 200));
        await shot(page, name + '_grande');
        if (big && big.w > 600) src = big.s;
      } catch (e) { console.log('  (no pude abrir en grande:', String(e.message).split('\n')[0], ')'); }
      let buf = null;
      // Las URLs de Google (…/asb/…) dan la ORIGINAL agregando "=s0" (sin eso llega la miniatura de 286 px).
      if (/googleusercontent\.com|flow\.google\.com\/asb\//.test(src)) {
        const full = src.replace(/=[a-z0-9-]+$/i, '') + '=s0';
        try { const r = await ctx.request.get(full); if (r.ok()) { const b = Buffer.from(await r.body()); if (b.length > 60000) { buf = b; console.log('  original:', b.length, 'bytes'); } } } catch (_) {}
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
      return { buffer: buf, src };
    }
    if ((Date.now() - t0) % 20000 < 4000) await shot(page, name + '_esperando');
  }
  await shot(page, name + '_timeout');
  console.log('imgs:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('img')].map((i) => [i.naturalWidth, i.naturalHeight, (i.currentSrc || i.src).slice(0, 140)]))));
  const txt = await page.evaluate(() => document.body.innerText.slice(-1500)).catch(() => '');
  throw new Error('Flow no devolvió imagen en 4 min. Texto en pantalla: ' + txt.replace(/\s+/g, ' ').slice(-600));
}

// Para el pipeline: genera UNA imagen en Flow (segundo plano; muestra Chrome solo si hay que iniciar sesión).
// Devuelve lo mismo que _image.generateImage: { buffer, mimeType, costUsd, model }.
async function flowImage({ prompt, refs = [] }) {
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
    const img = await generate(page, ctx, String(prompt).trim().replace(/\.?$/, '.') + (refs.length ? RULE_BASE : ruleFor(prompt)), 'pipeline', refs);
    const jpg = img.buffer[0] === 0xff && img.buffer[1] === 0xd8;
    return { buffer: img.buffer, mimeType: jpg ? 'image/jpeg' : 'image/png', costUsd: 0, model: 'flow' };
  } finally {
    await ctx.close().catch(() => {});
  }
}
// Varias imágenes en UNA sola sesión de Flow (un proyecto, sin reabrir Chrome): se mandan una tras otra.
// prompts: [string] → [{ buffer, mimeType } | { error }] en el mismo orden.
async function flowImages(prompts, log = console.log) {
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
    for (let i = 0; i < prompts.length; i++) {
      try {
        const img = await generate(page, ctx, String(prompts[i]).trim().replace(/\.?$/, '.') + ruleFor(prompts[i]), 'lote' + (i + 1));
        const jpg = img.buffer[0] === 0xff && img.buffer[1] === 0xd8;
        out.push({ buffer: img.buffer, mimeType: jpg ? 'image/jpeg' : 'image/png' });
        log(`Flow ${i + 1}/${prompts.length}: lista (${img.buffer.length} bytes)`);
      } catch (e) { out.push({ error: e.message }); log(`Flow ${i + 1}/${prompts.length}: FALLÓ ${String(e.message).slice(0, 200)}`); }
      await sleep(2000 + Math.random() * 2000);
    }
    return out;
  } finally {
    await ctx.close().catch(() => {});
  }
}
module.exports = { flowImage, flowImages };

if (require.main === module) (async () => {
  const mode = process.argv[2] || 'prueba';
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
