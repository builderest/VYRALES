// GRABA EL VIDEO DEMO PARA LA REVISIÓN DE TIKTOK (video.publish / Direct Post).
// Lo lanza el agente: node agente/grabar_demo_tiktok.js [episode_id]
// Abre una ventana de Edge (o Chrome) VISIBLE en esta PC y graba todo el flujo con subtítulos en inglés:
//   1) VYRALES (https://vyrales.app) → Redes → Conectar TikTok
//   2) TÚ inicias sesión en TikTok y le das "Authorize" (el script espera hasta 15 min; no toca tu contraseña)
//   3) Panel PUBLICAR → "Post to TikTok" → muestra cada opción (cuenta, privacidad, interacciones,
//      etiqueta de IA, divulgación comercial, declaración de música) → Post (privacidad "Only me")
//   4) Espera a que TikTok termine y abre tu perfil de TikTok para mostrar el video publicado.
// Resultado: <VYRALES_FINALES_DIR>\tiktok_demo\vyrales_tiktok_demo.mp4 (menos de 50 MB, lo que pide TikTok).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const SITE = (process.env.PUBLIC_BASE_URL || 'https://vyrales.app').replace(/\/$/, '');
const FINALES = process.env.VYRALES_FINALES_DIR || path.join(ROOT, 'finales');
const OUT = path.join(FINALES, 'tiktok_demo');
const DEMO_EP = process.argv[2] || '30fc0466-e501-43ff-be69-3b39b144c475'; // "Cuando el día duraba seis horas"
const PW_VERSION = '1.48.2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadPlaywright() {
  try { return require('playwright-core'); } catch (_) {}
  console.log('Instalando playwright-core@' + PW_VERSION + ' (solo la primera vez; usa el Edge/Chrome que ya tienes)...');
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-save', 'playwright-core@' + PW_VERSION], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  return require(path.join(ROOT, 'node_modules', 'playwright-core'));
}

async function main() {
  if (!/^[0-9a-f-]{36}$/i.test(DEMO_EP)) throw new Error('episode_id no válido');
  const key = process.env.DASHBOARD_KEY;
  if (!key) throw new Error('Falta DASHBOARD_KEY en el .env');
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const supabase = getSupabaseClient();
  const { data: ep, error } = await supabase.from('episodes').select('id, episode_number, series_id, validator_report').eq('id', DEMO_EP).single();
  if (error || !ep) throw new Error('No encontré el episodio del demo');
  const { data: series } = await supabase.from('series').select('slug').eq('id', ep.series_id).single();
  if (!(((ep.validator_report || {}).publish_package || {}).status === 'done')) throw new Error('El episodio no tiene "Preparar textos y portada" hecho.');

  const { chromium } = loadPlaywright();
  fs.mkdirSync(OUT, { recursive: true });
  const rawDir = path.join(OUT, 'raw_' + Date.now());
  let browser = null;
  for (const channel of ['msedge', 'chrome']) {
    try { browser = await chromium.launch({ channel, headless: false, args: ['--window-size=1300,900'] }); console.log('Navegador:', channel); break; }
    catch (e) { console.log('No pude abrir', channel, '→', String(e.message).split('\n')[0]); }
  }
  if (!browser) throw new Error('No encontré Microsoft Edge ni Google Chrome en esta PC.');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: rawDir, size: { width: 1280, height: 800 } }, locale: 'en-US' });
  // Sesión de VYRALES: la misma cookie firmada que da el login (netlify/edge-functions/auth.js).
  const exp = String(Date.now() + 3 * 3600 * 1000);
  const sig = crypto.createHmac('sha256', key).update('vyrales:' + exp).digest('hex');
  await context.addCookies([{ name: 'vyrales_auth', value: exp + '.' + sig, domain: new URL(SITE).hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
  await context.addInitScript((slug) => { try { if (location.hostname.endsWith('vyrales.app')) localStorage.setItem('vyrales_series', slug); window.__ttNoPc = true; } catch (_) {} }, series.slug);
  // __ttNoPc: el video lo sube Netlify (no el agente), porque el agente está ocupado grabando este demo.
  const page = await context.newPage();

  // ---- Subtítulos de narración (en inglés, para el revisor de TikTok) ----
  let caption = '';
  const paint = async () => {
    await page.evaluate((t) => {
      let el = document.getElementById('__demoCap');
      if (!el) { el = document.createElement('div'); el.id = '__demoCap'; document.documentElement.appendChild(el); }
      el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:1100px;width:calc(100% - 60px);z-index:2147483647;background:rgba(0,0,0,.86);color:#fff;font:600 19px/1.35 Arial,sans-serif;padding:12px 18px;border-radius:10px;border:2px solid #fe2c55;text-align:center;pointer-events:none;box-shadow:0 6px 24px rgba(0,0,0,.5)';
      el.textContent = t; el.style.display = t ? 'block' : 'none';
    }, caption).catch(() => {});
  };
  page.on('load', () => { paint(); });
  const cap = async (t, ms = 3500) => { caption = t; console.log('▶', t); await paint(); if (ms) await sleep(ms); };
  const mark = async (loc) => { await loc.scrollIntoViewIfNeeded().catch(() => {}); await loc.evaluate((el) => { el.style.outline = '3px solid #fe2c55'; el.style.outlineOffset = '3px'; setTimeout(() => { el.style.outline = ''; }, 2500); }).catch(() => {}); await sleep(900); };
  const click = async (loc, ms = 1500) => { await mark(loc); await loc.click(); await sleep(ms); };

  try {
    // 1) VYRALES
    await page.goto(SITE + '/', { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    await cap('VYRALES (vyrales.app) is a web app where a creator produces short vertical videos with AI and publishes them to their OWN TikTok account.', 6000);
    await cap('The creator is signed in to VYRALES. Step 1: connect TikTok from the "Redes" (Social accounts) button.', 4000);
    await click(page.locator('button[onclick="openSocialModal()"]').first(), 2500);
    const disc = page.locator('#socialModal button[onclick="disconnectSocial(\'tiktok\')"]');
    if (await disc.count()) {
      await cap('An old TikTok connection exists, so we disconnect it first to show the full authorization flow.', 3000);
      await click(disc, 800);
      await sleep(1300);
      await click(page.locator('#cfOk'), 2500);
      await page.evaluate(() => window.openSocialModal && window.openSocialModal()); await sleep(2500);
    }
    await cap('Click "Conectar TikTok" (Connect TikTok). VYRALES uses TikTok Login Kit (OAuth).', 3500);
    await click(page.locator('#socialModal button[onclick="connectSocial(\'tiktok\')"]'), 500);

    // 2) TikTok: login + consentimiento (lo hace la persona)
    await page.waitForURL(/tiktok\.com/, { timeout: 60000 });
    await sleep(1500);
    await cap('Step 2: the creator logs in to TikTok and reviews the permissions VYRALES requests: user.info.basic (show the account name), video.upload and video.publish (post the creator’s own videos). Then taps "Authorize".', 0);
    console.log('\n>>> ESPERANDO: inicia sesión en TikTok en la ventana del navegador y dale "Authorize" (tienes 15 minutos).\n');
    await page.waitForURL((u) => u.hostname.endsWith(new URL(SITE).hostname) && !/tiktok\.com/.test(u.hostname), { timeout: 15 * 60000 });
    await cap('TikTok sends the creator back to VYRALES and the account is connected.', 4500);
    await page.waitForURL((u) => u.pathname === '/' || u.pathname === '/index.html', { timeout: 30000 }).catch(() => {});
    await sleep(3500);
    await page.evaluate(() => window.openSocialModal && window.openSocialModal()); await sleep(3000);
    await cap('The connected TikTok account is shown in VYRALES.', 3500);
    await page.evaluate(() => { const m = document.getElementById('socialModal'); if (m) m.remove(); });

    // 3) Panel PUBLICAR → Post to TikTok
    await cap('Step 3: the creator opens the PUBLISH panel of a finished video.', 3000);
    await page.evaluate(() => window.goPublish && window.goPublish()); await sleep(2500);
    const postBtn = page.locator('#ttPostBtn_' + DEMO_EP);
    await postBtn.waitFor({ state: 'visible', timeout: 30000 });
    await cap('They click "Post to TikTok". VYRALES first asks TikTok for the creator’s current info (creator_info API).', 3500);
    await click(postBtn, 4000);
    await page.locator('#ttPrivacy').waitFor({ timeout: 30000 });
    await cap('The post screen shows the TikTok account the video will go to (avatar, nickname and username) and a preview of the video.', 5000);
    await page.locator('#ttPreview').evaluate((v) => { v.muted = true; v.play().catch(() => {}); });
    await mark(page.locator('#ttTitle'));
    await cap('The creator can edit the title (caption) before posting.', 2500);
    await page.locator('#ttTitle').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' #vyrales', { delay: 90 });
    await sleep(1200);
    await mark(page.locator('#ttPrivacy'));
    await cap('Privacy has NO default value. The options come from the creator’s privacy_level_options and the creator must choose one. "Post" stays disabled until then.', 5000);
    const opts = await page.locator('#ttPrivacy option:not([disabled])').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    const choice = opts.includes('SELF_ONLY') ? 'SELF_ONLY' : opts[0];
    await page.locator('#ttPrivacy').selectOption(choice);
    await cap('For this demo the creator picks "Only me".', 3000);
    await mark(page.locator('#ttComment').locator('xpath=..'));
    await cap('Comment, Duet and Stitch are all OFF by default. If the creator disabled any of them in TikTok, it is greyed out here.', 4500);
    if (await page.locator('#ttComment').isEnabled()) { await page.locator('#ttComment').check(); await sleep(1200); }
    await mark(page.locator('#ttAigc').locator('xpath=ancestor::div[1]'));
    await cap('AI-generated content: VYRALES videos are made with AI, so the "Creator labeled as AI-generated" label (is_aigc) is turned on.', 5000);
    await mark(page.locator('#ttDisclose').locator('xpath=ancestor::div[1]'));
    await cap('Commercial content disclosure is OFF by default. If turned on, the creator must say whether the video promotes their own brand, a third party, or both.', 5000);
    await page.locator('#ttDisclose').check(); await sleep(2500);
    await cap('Turned on without a choice: "Post" is disabled and TikTok’s prompt is shown.', 3500);
    await page.locator('#ttYourBrand').check(); await sleep(2200);
    await cap('"Your brand" → the video will be labeled "Promotional content".', 3500);
    await page.locator('#ttBranded').check(); await sleep(2200);
    await cap('"Branded content" → labeled "Paid partnership", "Only me" is no longer allowed, and the declaration adds TikTok’s Branded Content Policy.', 5500);
    await page.locator('#ttBranded').uncheck(); await page.locator('#ttYourBrand').uncheck(); await page.locator('#ttDisclose').uncheck(); await sleep(1500);
    if ((await page.locator('#ttPrivacy').inputValue()) !== choice) await page.locator('#ttPrivacy').selectOption(choice);
    await cap('This video is not commercial, so the creator turns disclosure off again.', 3000);
    await mark(page.locator('#ttDeclaration'));
    await cap('Before posting, the creator sees: "By posting, you agree to TikTok’s Music Usage Confirmation."', 4500);
    await cap('The creator clicks "Post". Nothing is posted without this explicit action.', 3000);
    await click(page.locator('#ttSubmit'), 3500);
    await cap('VYRALES uploads the video with the Content Posting API (Direct Post). TikTok may take a few minutes to process it; the creator is told this.', 5000);
    await page.evaluate(() => { const m = document.getElementById('ttModal'); if (m) m.remove(); window.goPublish && window.goPublish(); });

    // 4) Esperar a TikTok (consulta Supabase) y mostrar el resultado
    let run = null;
    for (let i = 0; i < 80; i++) {
      await sleep(6000);
      const { data } = await supabase.from('episodes').select('validator_report').eq('id', DEMO_EP).single();
      run = ((data && data.validator_report) || {}).social_runs; run = run && run.tiktok;
      if (run && run.status !== 'running') break;
    }
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await sleep(4000);
    await page.evaluate(() => window.goPublish && window.goPublish()); await sleep(1500);
    if (!run || run.status === 'error') {
      await cap('Status: ' + ((run && run.error) || 'no answer from TikTok'), 6000);
      throw new Error('La publicación en TikTok falló: ' + ((run && run.error) || 'sin respuesta') + ' (el video demo quedó grabado igual hasta aquí)');
    }
    await cap('VYRALES shows the result of the post in the PUBLISH panel.', 4000);
    const profile = run.url || null;
    if (profile) {
      await cap('Step 4: the video on the creator’s TikTok profile.', 2500);
      await page.goto(profile, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(7000);
      await cap('The video is on the creator’s TikTok account, posted with the privacy the creator chose and the AI-generated label.', 8000);
    }
    await cap('End of demo. VYRALES only posts videos the creator made, to the creator’s own account, after they review every setting and click "Post".', 6000);
  } finally {
    const vidPath = await page.video()?.path().catch(() => null);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    if (vidPath && fs.existsSync(vidPath)) {
      const ffmpeg = require(path.join(ROOT, 'node_modules', 'ffmpeg-static'));
      const out = path.join(OUT, 'vyrales_tiktok_demo.mp4');
      await new Promise((res, rej) => execFile(ffmpeg, ['-y', '-i', vidPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out], { maxBuffer: 1 << 26 }, (e, so, se) => (e ? rej(new Error(String(se).slice(-400))) : res())));
      const mb = fs.statSync(out).size / 1048576;
      console.log(`\nVIDEO DEMO LISTO: ${out} (${mb.toFixed(1)} MB${mb > 50 ? ' — PASA de 50 MB, avísale a Claude' : ''})`);
    } else console.log('No quedó video grabado.');
  }
}

main().catch((err) => { console.error('ERROR:', err.message || err); process.exit(1); });
