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
const RULE = ' Vertical 9:16 portrait image. Photorealistic, cinematic nature documentary, dramatic lighting, sharp detail. No people, no hands, no text.';

function loadPlaywright() {
  try { return require('playwright-core'); } catch (_) {}
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-save', 'playwright-core@' + PW_VERSION], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  return require(path.join(ROOT, 'node_modules', 'playwright-core'));
}

async function openFlow() {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  let ctx = null;
  for (const channel of ['chrome', 'msedge']) {
    try {
      ctx = await chromium.launchPersistentContext(PROFILE, { channel, headless: false, viewport: { width: 1500, height: 900 }, acceptDownloads: true, ignoreDefaultArgs: ['--enable-automation'], args: ['--window-size=1520,1000', '--disable-blink-features=AutomationControlled'] });
      console.log('Navegador:', channel);
      break;
    } catch (e) { console.log('No pude abrir', channel, '→', String(e.message).split('\n')[0]); }
  }
  if (!ctx) throw new Error('No pude abrir Chrome ni Edge');
  const page = ctx.pages()[0] || (await ctx.newPage());
  return { ctx, page };
}

const shot = async (page, name) => { try { await page.screenshot({ path: path.join(OUT, name + '.png') }); } catch (_) {} };
async function loggedIn(page) {
  return page.evaluate(() => !!document.querySelector('a[href*="SignOutOptions"], [aria-label*="Cuenta de Google"], [aria-label*="Google Account"]')).catch(() => false);
}

async function ensureLogin(page, waitMin) {
  await page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  if (await loggedIn(page)) { console.log('Sesión de Google: OK'); return true; }
  console.log(`Inicia sesión en la ventana de Chrome que se abrió (tienes ${waitMin} min). Yo no toco tu contraseña.`);
  const t0 = Date.now();
  while (Date.now() - t0 < waitMin * 60000) {
    await sleep(5000);
    const url = page.url();
    if (/flow\.google\.com/.test(url) && (await loggedIn(page))) { console.log('Sesión de Google: OK (guardada para las próximas veces)'); return true; }
  }
  return false;
}

async function newProject(page) {
  await page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  const btn = page.getByText(/Nuevo proyecto|New project/i).first();
  await btn.click({ timeout: 20000 });
  await page.waitForURL(/\/project\//, { timeout: 30000 });
  await page.waitForSelector('.ProseMirror', { timeout: 30000 });
  await sleep(2000);
  console.log('Proyecto:', page.url());
}

async function imgSrcs(page) {
  return page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.naturalWidth >= 300 && i.naturalHeight >= 300).map((i) => i.currentSrc || i.src));
}

async function generate(page, ctx, prompt, name) {
  const before = new Set(await imgSrcs(page));
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
      const src = now[0];
      let buf = null;
      try { const r = await ctx.request.get(src); if (r.ok()) buf = Buffer.from(await r.body()); } catch (_) {}
      if (!buf) {
        const b64 = await page.evaluate(async (u) => { const r = await fetch(u); const b = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }, src).catch(() => null);
        if (b64) buf = Buffer.from(b64, 'base64');
      }
      await shot(page, name + '_2_listo');
      if (!buf) throw new Error('Vi la imagen nueva pero no pude descargarla: ' + src.slice(0, 120));
      return { buffer: buf, src };
    }
    if ((Date.now() - t0) % 20000 < 4000) await shot(page, name + '_esperando');
  }
  await shot(page, name + '_timeout');
  const txt = await page.evaluate(() => document.body.innerText.slice(-1500)).catch(() => '');
  throw new Error('Flow no devolvió imagen en 4 min. Texto en pantalla: ' + txt.replace(/\s+/g, ' ').slice(-600));
}

(async () => {
  const mode = process.argv[2] || 'prueba';
  const { ctx, page } = await openFlow();
  try {
    const ok = await ensureLogin(page, mode === 'login' ? 10 : 3);
    if (!ok) throw new Error('No hay sesión de Google en el Chrome de VYRALES. Corre primero: flow_login');
    if (mode === 'login') { console.log('LISTO: sesión guardada en', PROFILE); return; }
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
