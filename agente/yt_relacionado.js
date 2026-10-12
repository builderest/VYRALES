// "VIDEO RELACIONADO" de un Short de YouTube → su video largo (Franklin, oct-11: en los Shorts los enlaces del texto no
// se pueden tocar; el botón ▶ "video relacionado" sí). La API de YouTube no tiene ese campo, así que se pone en
// YouTube Studio con el Chrome propio del agente (perfil propio VYRALES_yt_perfil; sesión de la cuenta del canal).
// Uso: yt_relacionado:<short_ep>[:ver]   (":ver" muestra la ventana, p. ej. para iniciar sesión la primera vez).
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2'); }
const F = path.join(ROOT, 'netlify/functions');
// Perfil PROPIO (no el de Flow): así puede correr mientras Flow genera imágenes. Sesión: la del canal de YouTube.
const PROFILE = path.join(process.env.LOCALAPPDATA || ROOT, 'VYRALES_yt_perfil');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function loadPlaywright() { try { return require('playwright-core'); } catch (_) {} return require(path.join(ROOT, 'node_modules', 'playwright-core')); }

(async () => {
  const [epId, mode] = process.argv.slice(2);
  const sb = require(F + '/_supabase').getSupabaseClient();
  const { data: ep } = await sb.from('episodes').select('id, title, continuity, validator_report').eq('id', epId).single();
  const shortId = ((((ep.validator_report || {}).social_runs || {}).youtube) || {}).video_id;
  const parent = (ep.continuity || {}).parent_episode_id;
  if (!shortId) throw new Error('Este Short todavía no está en YouTube.');
  if (!parent) throw new Error('Este Short no tiene video largo.');
  const { data: lg } = await sb.from('episodes').select('validator_report').eq('id', parent).single();
  const longId = ((((lg.validator_report || {}).social_runs || {}).youtube) || {}).video_id;
  if (!longId) throw new Error('El video largo todavía no está en YouTube.');
  // Título real del largo en YouTube (así aparece en el selector de Studio).
  const tk = await require(F + '/_social').youtubeAccessToken(sb);
  const v = await (await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=' + longId, { headers: { Authorization: 'Bearer ' + tk } })).json();
  const longTitle = v.items && v.items[0] && v.items[0].snippet.title;
  if (!longTitle) throw new Error('No encontré el video largo ' + longId + ' en YouTube.');
  if (v.items[0].status.privacyStatus !== 'public') console.log('AVISO: el largo no es público todavía (Studio puede no dejar elegirlo).');
  console.log(`Short ${shortId} → video relacionado: "${longTitle}" (${longId})`);

  const { chromium } = loadPlaywright();
  let ctx = null;
  for (const channel of ['chrome', 'msedge']) {
    try { ctx = await chromium.launchPersistentContext(PROFILE, { channel, headless: false, viewport: { width: 1500, height: 900 }, ignoreDefaultArgs: ['--enable-automation'], args: ['--window-size=1520,1000', '--disable-blink-features=AutomationControlled'].concat(mode === 'ver' ? ['--window-position=40,20'] : ['--window-position=-3000,-3000']) }); break; }
    catch (e) { console.log('No pude abrir', channel, '→', String(e.message).split('\n')[0]); }
  }
  if (!ctx) throw new Error('No pude abrir Chrome ni Edge (¿está abierto el perfil de YouTube en otra ventana?).');
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    await page.goto('https://studio.youtube.com/video/' + shortId + '/edit', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const trigger = page.locator('ytcp-shorts-content-links-picker #linked-video-editor-link');
    try { await trigger.waitFor({ timeout: mode === 'ver' ? 300000 : 75000 }); }
    catch (_) { try { await page.screenshot({ path: path.join(ROOT, 'publicar', 'yt_relacionado_error.png') }); console.log('captura: publicar/yt_relacionado_error.png'); } catch (_) {} throw new Error(/accounts\.google\.com/.test(page.url()) ? 'El Chrome del agente no tiene sesión en YouTube. Corre "yt_relacionado:' + epId + ':ver" e inicia sesión con la cuenta del canal (una sola vez).' : 'No apareció el campo "Video relacionado" en Studio (' + page.url().slice(0, 80) + ').'); }
    const cur = (await trigger.innerText().catch(() => '')) || '';
    if (cur.includes(longTitle.slice(0, 30))) { console.log('Ya tenía puesto el video relacionado ✅'); return; }
    await trigger.click();
    const dlg = page.locator('ytcp-video-pick-dialog');
    await dlg.locator('#search-yours').waitFor({ timeout: 20000 });
    await dlg.locator('#search-yours').fill(longTitle.slice(0, 40));
    await sleep(2500);
    const card = dlg.locator('ytcp-entity-card').filter({ hasText: longTitle.slice(0, 30) }).first();
    await card.waitFor({ timeout: 20000 });
    await card.click();
    await sleep(1500);
    const save = page.locator('ytcp-button#save');
    if ((await save.getAttribute('aria-disabled')) === 'true') throw new Error('Studio no activó "Guardar" después de elegir el video.');
    await save.click();
    for (let i = 0; i < 30; i++) { await sleep(1000); if ((await save.getAttribute('aria-disabled')) === 'true') break; }
    const now = (await trigger.innerText().catch(() => '')) || '';
    if (!now.includes(longTitle.slice(0, 30))) throw new Error('Se guardó pero el campo no muestra el video (' + now.slice(0, 60) + ').');
    console.log('LISTO: video relacionado puesto en el Short ✅ https://youtube.com/shorts/' + shortId);
  } finally { await ctx.close().catch(() => {}); }
})().catch((e) => { console.log('ERROR', e.message); process.exit(1); });
