// GUIONISTA PROFESIONAL CON CLAUDE EN LA PC (plan de Claude de Franklin, $0 por guion).
//   node agente/claude_guion.js diag        → revisa si Claude Code está instalado (si no, lo instala) y si tiene sesión
//   node agente/claude_guion.js login       → abre una ventana de Claude Code para que inicies sesión UNA vez
//   node agente/claude_guion.js <job>       → escribe el guion de la idea guardada en media/guiones/<job>.req.json
//                                             y deja el resultado en media/guiones/<job>.json (lo lee /analitica.html)
// Mismo guionista maestro que el botón PROMPT + revisor IMAGEN = NARRACIÓN (prompts súper detallados), ambos con Claude.
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
process.env.VYRALES_LOCAL_RUN = '1';
const { claudePath, runClaude, parseJson, claudeLlm } = require('./_claude');

async function diag() {
  let exe = claudePath();
  if (!exe) {
    console.log('Claude Code no está instalado → lo instalo con npm (versión oficial de Anthropic)...');
    try { execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'inherit', timeout: 10 * 60000, shell: true }); } catch (e) { console.log('No se pudo instalar:', String(e.message).split('\n')[0]); }
    exe = claudePath();
  }
  if (!exe) { console.log('✖ Claude Code sigue sin estar instalado. Instálalo a mano: https://docs.claude.com/en/docs/claude-code'); process.exit(1); }
  console.log('✔ Claude Code:', exe);
  try { console.log('  versión:', execSync(`"${exe}" --version`, { encoding: 'utf8', timeout: 30000, shell: true }).trim()); } catch (_) {}
  if (process.env.ANTHROPIC_API_KEY) console.log('  (hay ANTHROPIC_API_KEY en el .env: VYRALES la quita al llamar a Claude, para usar tu PLAN y no la API)');
  console.log('Probando una respuesta corta con tu plan...');
  try {
    const t = Date.now();
    const r = await runClaude('Responde SOLO este JSON: {"ok": true, "saludo": "listo"}', { timeoutMin: 3 });
    console.log('✔ Claude respondió en', Math.round((Date.now() - t) / 1000), 's:', JSON.stringify(parseJson(r)));
    console.log('LISTO: el guionista con Claude funciona en esta PC ($0 por guion, usa tu plan).');
  } catch (e) {
    console.log('✖', e.message);
    console.log('→ Dale al botón "Claude: iniciar sesión" (se abre una ventana en Cronix; escribe /login si no te lo pide solo) y vuelve a probar.');
    process.exit(1);
  }
}

function login() {
  const exe = claudePath();
  if (!exe) { console.log('Primero instala Claude Code (botón "Claude: instalar / revisar").'); process.exit(1); }
  const env = Object.assign({}, process.env); delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
  if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '"Claude - iniciar sesion (VYRALES)"', 'cmd', '/k', `"${exe}"`], { detached: true, stdio: 'ignore', env, cwd: require('os').homedir(), shell: false, windowsVerbatimArguments: true }).unref();
  else spawn(exe, [], { detached: true, stdio: 'ignore', env }).unref();
  console.log('Abrí una ventana de Claude Code en esta PC. Inicia sesión con tu cuenta de Claude (elige la opción de tu SUSCRIPCIÓN, no la de API). Cuando termine, cierra la ventana y dale "Claude: instalar / revisar" para probar.');
}

async function job(id) {
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const { uploadFile } = require(path.join(ROOT, 'netlify', 'functions', '_storage'));
  const { ideaPrompt, finishScript } = require(path.join(ROOT, 'netlify', 'functions', 'idea-script-background'));
  const supabase = getSupabaseClient();
  const save = (obj) => uploadFile(supabase, { path: `guiones/${id}.json`, buffer: Buffer.from(JSON.stringify(obj)), contentType: 'application/json' });
  try {
    const { data: u } = supabase.storage.from('media').getPublicUrl(`guiones/${id}.req.json`);
    const req = await (await fetch(u.publicUrl + '?t=' + Date.now())).json();
    const idea = req.idea || {};
    console.log('Guionista Claude →', idea.titulo || '(sin título)');
    const { tipo, prompt } = ideaPrompt(idea);
    const t = Date.now();
    let data;
    for (let k = 1; k <= 2 && !data; k++) {
      try { data = parseJson(await runClaude(prompt, { log: console.log })); }
      catch (e) { console.log(`  intento ${k}: ${String(e.message).slice(0, 200)}`); if (k === 2 || /instalado|sesión/.test(e.message)) throw e; }
    }
    console.log('Guion escrito en', Math.round((Date.now() - t) / 1000), 's. Revisor IMAGEN = NARRACIÓN (prompts detallados) con Claude...');
    const { validation } = await finishScript(data, { idea, tipo, llm: claudeLlm(console.log) });
    const ep = data.episodes[0];
    console.log(`Listo: "${ep.title}" · ${ep.shots.length} tomas · validación ${validation.ok ? 'OK' : 'con errores: ' + (validation.errors || []).join(' · ')}`);
    try { const { logSpend } = require(path.join(ROOT, 'netlify', 'functions', '_spend')); await logSpend(supabase, { kind: 'text', model: 'claude_plan', costUsd: 0, note: 'guion desde idea (Claude en la PC): ' + String(idea.titulo || '').slice(0, 60) }); } catch (_) {}
    await save({ ok: true, tipo, model: 'Claude (tu plan)', costUsd: 0, validation, series: data, at: new Date().toISOString() });
  } catch (e) {
    console.log('ERROR:', e.message);
    await save({ ok: false, error: e.message, engine: 'claude', at: new Date().toISOString() }).catch(() => {});
    process.exit(1);
  }
}

const mode = process.argv[2];
(mode === 'diag' ? diag() : mode === 'login' ? Promise.resolve(login()) : job(String(mode || '').replace(/[^a-z0-9-]/gi, '')))
  .catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
