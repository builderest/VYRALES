// AGENTE DE VYRALES — corre en TU PC y ejecuta los botones de "Terminal" de vyrales.app.
//   Arrancar:  node agente/agente.js      (o doble clic en INICIAR_AGENTE.bat)
// Cómo funciona (sin abrir puertos ni exponer tu PC):
//   1. Cada 3 s le pregunta a Supabase si hay órdenes nuevas en agent_jobs.
//   2. Solo ejecuta comandos de la LISTA BLANCA (agente/comandos.js); cualquier otro nombre se rechaza.
//   3. Va escribiendo la salida en Supabase; la página la muestra como una terminal.
// Usa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY del .env del proyecto (no salen de tu PC).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const COMMANDS = require('./comandos');

// --- .env (sin dependencias) ---
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const { createClient } = require(path.join(ROOT, 'node_modules', '@supabase', 'supabase-js'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

const MAX_OUT = 20000; // caracteres guardados por orden
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// --- servidor local (npm run dev) manejado por el agente ---
let dev = null;
let devLog = [];
const pushDevLog = (chunk) => { devLog = devLog.concat(String(chunk).split(/\r?\n/)).slice(-400); };
function devStart() {
  if (dev) return 'El servidor local ya está corriendo (pid ' + dev.pid + ').';
  // npm en Windows es un .cmd: necesita shell. El texto es FIJO (no viene de la página).
  dev = spawn(IS_WIN ? 'npm run dev' : 'npm', IS_WIN ? [] : ['run', 'dev'], { cwd: ROOT, shell: IS_WIN, detached: !IS_WIN });
  devLog = [];
  dev.stdout.on('data', pushDevLog);
  dev.stderr.on('data', pushDevLog);
  dev.on('exit', (code) => { pushDevLog('[servidor local terminó con código ' + code + ']'); dev = null; });
  return 'Servidor local iniciado (pid ' + dev.pid + '). Abre http://localhost:8888 en este PC. Mira "Ver log" en unos segundos.';
}
function devStop() {
  if (!dev) return 'El servidor local no estaba corriendo (o no lo inició el agente).';
  const pid = dev.pid;
  try {
    if (IS_WIN) execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGTERM');
  } catch (_) {}
  dev = null;
  return 'Servidor local detenido (pid ' + pid + ').';
}

// --- ejecución de una orden ---
async function runJob(job) {
  const def = COMMANDS[job.command];
  let out = '';
  let flushT = 0;
  const flush = async (force) => {
    if (!force && Date.now() - flushT < 1000) return;
    flushT = Date.now();
    await sb.from('agent_jobs').update({ output: out.slice(-MAX_OUT) }).eq('id', job.id);
  };
  const add = (t) => { out += t; flush(false); };
  await sb.from('agent_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', job.id);
  log('▶', job.command);
  let code = 0;
  try {
    if (!def) throw new Error('Comando no permitido: ' + job.command);
    if (def.special === 'dev_start') add(devStart() + '\n');
    else if (def.special === 'dev_stop') add(devStop() + '\n');
    else if (def.special === 'dev_restart') { add(devStop() + '\n'); await new Promise((r) => setTimeout(r, 1500)); add(devStart() + '\n'); }
    else if (def.special === 'dev_log') add((devLog.length ? devLog.slice(-120).join('\n') : '(sin log: el servidor local no lo inició el agente)') + '\n');
    else {
      for (const [cmd, args] of def.steps) {
        add('$ ' + cmd + ' ' + args.join(' ') + '\n');
        code = await new Promise((resolve) => {
          const p = spawn(cmd, args, { cwd: ROOT, shell: false, env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }) });
          const timer = setTimeout(() => { add('\n[se canceló: tardó más de 3 minutos]\n'); p.kill(); }, 180000);
          p.stdout.on('data', (d) => add(String(d)));
          p.stderr.on('data', (d) => add(String(d)));
          p.on('error', (e) => { add('ERROR: ' + e.message + '\n'); resolve(1); });
          p.on('close', (c) => { clearTimeout(timer); resolve(c == null ? 1 : c); });
        });
        add('\n');
        if (code !== 0) break;
      }
    }
  } catch (err) {
    add('ERROR: ' + err.message + '\n');
    code = 1;
  }
  await sb.from('agent_jobs').update({ status: code === 0 ? 'done' : 'error', exit_code: code, output: out.slice(-MAX_OUT), finished_at: new Date().toISOString() }).eq('id', job.id);
  log(code === 0 ? '✔' : '✖', job.command, '(código ' + code + ')');
}

// --- bucle principal ---
let busy = false;
async function tick() {
  let mine = false;
  try {
    await sb.from('agent_state').upsert({ id: 1, last_seen: new Date().toISOString(), host: os.hostname(), info: { commands: Object.keys(COMMANDS), dev_running: !!dev, platform: process.platform } });
    if (busy) return;
    // Órdenes viejas (más de 2 min sin atender) no se ejecutan: se marcan vencidas.
    await sb.from('agent_jobs').update({ status: 'expired', finished_at: new Date().toISOString() }).eq('status', 'pending').lt('created_at', new Date(Date.now() - 120000).toISOString());
    const { data } = await sb.from('agent_jobs').select('*').eq('status', 'pending').order('created_at').limit(1);
    const job = data && data[0];
    if (!job) return;
    // "Reclamar" la orden (si hubiera dos agentes, solo uno la toma).
    const { data: claimed } = await sb.from('agent_jobs').update({ status: 'running' }).eq('id', job.id).eq('status', 'pending').select();
    if (!claimed || !claimed.length) return;
    busy = true; mine = true;
    await runJob(job);
  } catch (err) {
    log('error:', err.message);
  } finally {
    if (mine) busy = false;
  }
}
log('Agente de VYRALES activo en', ROOT, '— comandos:', Object.keys(COMMANDS).join(', '));
log('Deja esta ventana abierta. Para apagarlo: Ctrl+C.');
setInterval(tick, 3000);
tick();
process.on('SIGINT', () => { devStop(); process.exit(0); });
