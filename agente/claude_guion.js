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
    try { const { polishLines } = require(path.join(ROOT, 'netlify', 'functions', '_pulir')); const sh = data.episodes[0].shots; const nl = await polishLines(sh.map((x) => (x.dialogue || []).map((d) => d.line).join(' ')), claudeLlm(() => {}), { title: data.episodes[0].title }); sh.forEach((x, i) => { x.dialogue = [{ speaker: 'Narrador', line: nl[i] }]; }); console.log('Narración pulida (sin muletillas ni saltos).'); } catch (e) { console.log('  (pulido: ' + String(e.message).slice(0, 120) + ')'); }
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

// "Detallar con IA" de una toma (gratis): lee shot.detail_request y deja shot.detail_proposal.
async function detalle(epId, n) {
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const { checkVisuals } = require(path.join(ROOT, 'netlify', 'functions', '_visual_check'));
  const sb = getSupabaseClient();
  const { data: ep } = await sb.from('episodes').select('shots, series_id').eq('id', epId).single();
  const { data: series } = await sb.from('series').select('title, slug, story_bible').eq('id', ep.series_id).single();
  const shot = (ep.shots || []).find((s) => s.n === Number(n));
  const req = shot.detail_request || {};
  console.log('Detallando la toma', n, 'con Claude...');
  const vc = await checkVisuals({ series, shots: [Object.assign({}, shot, req.fields || {})], rewriteStart: 'all', allowSplit: false, llm: claudeLlm(console.log), aspect: series.story_bible && series.story_bible.aspect === '16:9' ? '16:9' : '9:16', log: () => {} });
  const c = vc.changes[0] || {};
  const prop = { at: new Date().toISOString(), req_at: req.at || null, problema: c.ok === false ? c.problema : '', fields: { start_en: c.start_en, action_en: c.action_en, reaction_en: c.reaction_en, background_en: c.background_en, end_en: c.end_en } };
  const { data: fr } = await sb.from('episodes').select('shots').eq('id', epId).single();
  await sb.from('episodes').update({ shots: fr.shots.map((s) => (s.n === Number(n) ? Object.assign({}, s, { detail_proposal: prop }) : s)) }).eq('id', epId);
  console.log('LISTO: propuesta guardada (el panel la muestra para que la revises).');
}
// Tomas recién partidas: Claude escribe sus prompts completos y se GUARDAN (gratis).
async function revisar(epId, list) {
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const { checkVisuals, applyChanges } = require(path.join(ROOT, 'netlify', 'functions', '_visual_check'));
  const sb = getSupabaseClient();
  const want = String(list || '').split(',').map(Number).filter(Boolean);
  const { data: ep } = await sb.from('episodes').select('shots, series_id').eq('id', epId).single();
  const { data: series } = await sb.from('series').select('title, slug, story_bible').eq('id', ep.series_id).single();
  const shots = (ep.shots || []).filter((s) => want.includes(s.n));
  console.log('Claude escribe los prompts de las tomas', want.join(','), '...');
  const vc = await checkVisuals({ series, shots, rewriteStart: 'all', allowSplit: false, llm: claudeLlm(console.log), aspect: series.story_bible && series.story_bible.aspect === '16:9' ? '16:9' : '9:16', log: console.log });
  const { data: fr } = await sb.from('episodes').select('shots').eq('id', epId).single();
  const fixed = applyChanges(fr.shots.filter((s) => want.includes(s.n)), vc.changes, { splits: false });
  await sb.from('episodes').update({ shots: fr.shots.map((s) => fixed.find((x) => x.n === s.n) || s) }).eq('id', epId);
  console.log('LISTO: prompts guardados en las tomas', want.join(','));
}
// Pulir la narración de un episodio (sin "Y" muletilla, sin saltos, sin palabras raras). Gratis.
async function pulir(epId) {
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const { polishLines } = require(path.join(ROOT, 'netlify', 'functions', '_pulir'));
  const sb = getSupabaseClient();
  const { data: ep } = await sb.from('episodes').select('title, shots, continuity').eq('id', epId).single();
  const sh = (ep.shots || []).slice().sort((a, b) => a.n - b.n);
  const lineOf = (x) => String(x.voice_part || (x.dialogue || []).map((d) => d.line).join(' ')).trim();
  const lines = sh.map(lineOf);
  const kind = ep.continuity && ep.continuity.kind === 'short_cta' ? 'short_cta' : ep.continuity && ep.continuity.kind === 'largo' ? 'largo' : 'normal';
  console.log('Puliendo la narración de "' + ep.title + '" (' + lines.length + ' líneas, ' + kind + ') con Claude...');
  const nl = await polishLines(lines, claudeLlm(console.log), { kind, title: ep.title });
  let changed = 0;
  const byN = {}; sh.forEach((x, i) => { if (nl[i] !== lines[i]) { changed++; console.log(`  #${x.n}: ${lines[i]}\n     → ${nl[i]}`); } byN[x.n] = nl[i]; });
  const { data: fr } = await sb.from('episodes').select('shots').eq('id', epId).single();
  await sb.from('episodes').update({ shots: fr.shots.map((x) => (byN[x.n] && byN[x.n] !== lineOf(x) ? Object.assign({}, x, x.voice_part ? { voice_part: byN[x.n] } : {}, { dialogue: [{ speaker: ((x.dialogue || [])[0] || {}).speaker || 'Narrador', line: byN[x.n] }] }) : x)) }).eq('id', epId);
  console.log('LISTO: ' + changed + ' línea(s) pulidas.' + (ep.continuity && ep.continuity.voice ? ' (Este episodio ya tenía voz: se ajusta sola al producir, solo las frases cambiadas.)' : ''));
}
// "Generar nuevas ideas" de /analitica.html (gratis).
async function ideas(job) {
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const { uploadFile } = require(path.join(ROOT, 'netlify', 'functions', '_storage'));
  const A = require(path.join(ROOT, 'netlify', 'functions', 'analytics'));
  const sb = getSupabaseClient();
  const save = (obj) => uploadFile(sb, { path: `guiones/${job}.json`, buffer: Buffer.from(JSON.stringify(obj)), contentType: 'application/json' });
  try {
    const { data: u } = sb.storage.from('media').getPublicUrl(`guiones/${job}.req.json`);
    const req = await (await fetch(u.publicUrl + '?t=' + Date.now())).json();
    console.log('Ideas con Claude (leyendo tus estadísticas reales)...');
    const prompt = await A.ideasPrompt(sb, req, await A.collectData(sb));
    const out = parseJson(await runClaude(prompt, { log: console.log }));
    await save({ ok: true, ideas: (out.ideas || []).slice(0, 8), costUsd: 0, model: 'Claude (tu plan)', at: new Date().toISOString() });
    console.log('LISTO:', (out.ideas || []).length, 'ideas');
  } catch (e) { console.log('ERROR:', e.message); await save({ ok: false, error: e.message, at: new Date().toISOString() }).catch(() => {}); process.exit(1); }
}

const mode = process.argv[2];
if (mode === 'pulir') { pulir(process.argv[3]).catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); }); }
else if (mode === 'revisar') { revisar(process.argv[3], process.argv[4]).catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); }); }
else if (mode === 'detalle') { detalle(process.argv[3], process.argv[4]).catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); }); }
else if (mode === 'ideas') { ideas(String(process.argv[3] || '').replace(/[^a-z0-9-]/gi, '')); }
else
(mode === 'diag' ? diag() : mode === 'login' ? Promise.resolve(login()) : job(String(mode || '').replace(/[^a-z0-9-]/gi, '')))
  .catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
