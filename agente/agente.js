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
const http = require('http');
const crypto = require('crypto');
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
  // "nombre" o "nombre:argumento" (el argumento solo si el comando lo declara y pasa su validación).
  const [name, arg] = String(job.command).split(/:(.*)/s);
  const def0 = Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : null;
  const def = def0 && (def0.arg ? def0.arg.test(arg || '') : arg === undefined) ? def0 : null;
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
    else if (def.special === 'render_full' || def.special === 'publish_local') {
      // Proceso aparte (siempre con el código más nuevo) y hasta 30 min. Los argumentos ya pasaron la lista blanca.
      const script = def.special === 'render_full' ? 'render_local.js' : 'publish_local.js';
      code = await new Promise((resolve) => {
        const p = spawn(process.execPath, [path.join(__dirname, script)].concat(arg.split(':')), { cwd: ROOT, shell: false });
        const timer = setTimeout(() => { add('\n[se canceló: tardó más de 30 minutos]\n'); p.kill(); }, 30 * 60000);
        p.stdout.on('data', (d) => add(String(d)));
        p.stderr.on('data', (d) => add(String(d)));
        p.on('error', (e) => { add('ERROR: ' + e.message + '\n'); resolve(1); });
        p.on('close', (c) => { clearTimeout(timer); resolve(c == null ? 1 : c); });
      });
    }
    else if (def.special === 'gen_estado') {
      // PC generadora (ComfyUI con LTX-2/Wan) por Tailscale. Dirección en .env: VYRALES_GEN_URL.
      const base = process.env.VYRALES_GEN_URL || 'http://100.66.84.73:8188';
      add('Probando ' + base + ' ...\n');
      try {
        const st = await (await fetch(base + '/system_stats', { signal: AbortSignal.timeout(8000) })).json();
        const q = await (await fetch(base + '/queue', { signal: AbortSignal.timeout(8000) })).json();
        (st.devices || []).forEach((d) => add('✔ GPU: ' + d.name + ' · VRAM libre ' + (d.vram_free / 1073741824).toFixed(1) + ' / ' + (d.vram_total / 1073741824).toFixed(1) + ' GB\n'));
        add('✔ ComfyUI ' + ((st.system && st.system.comfyui_version) || '') + ' · RAM libre ' + (((st.system && st.system.ram_free) || 0) / 1073741824).toFixed(1) + ' GB\n');
        add('Cola: ' + ((q.queue_running || []).length) + ' generando, ' + ((q.queue_pending || []).length) + ' esperando\n');
        // Modelos instalados (para elegir el de video y saber cuáles ocupan espacio sin usarse).
        for (const folder of ['checkpoints', 'diffusion_models', 'unet', 'loras', 'text_encoders', 'vae']) {
          try {
            const list = await (await fetch(base + '/models/' + folder, { signal: AbortSignal.timeout(8000) })).json();
            if (Array.isArray(list) && list.length) add('\n[' + folder + '] ' + list.length + '\n  ' + list.join('\n  ') + '\n');
          } catch (_) {}
        }
        // Plantillas de video que el usuario guardó en ComfyUI.
        try {
          const wf = await (await fetch(base + '/api/userdata?dir=workflows&recurse=true', { signal: AbortSignal.timeout(8000) })).json();
          if (Array.isArray(wf) && wf.length) add('\n[flujos guardados] ' + wf.length + '\n  ' + wf.join('\n  ') + '\n');
        } catch (_) {}
        add(fs.existsSync(path.join(__dirname, 'ltx2_api.json')) ? '✔ Plantilla agente/ltx2_api.json encontrada\n' : '✖ Falta agente/ltx2_api.json (exportar desde ComfyUI de king: Workflow -> Export (API))\n');
      } catch (err) {
        add('✖ No responde (' + err.message + ').\n  Revisa: Tailscale encendido en king y Cronix, e INSTALAR_EN_KING.bat ejecutado en king.\n');
        code = 1;
      }
    }
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

// --- videos finales en CALIDAD COMPLETA (VYRALE/finales) y descarga desde el teléfono por Tailscale ---
// Cada vez que hay un video final nuevo en Supabase (que va recomprimido por el límite de 50 MB),
// el agente lo vuelve a armar aquí sin recomprimir (render_local.js) y lo sirve SOLO dentro de tu
// red de Tailscale (escucha en la IP 100.x de este PC, no en internet ni en tu Wi-Fi), con llave.
const FINALES = path.join(ROOT, 'finales');
const FILE_PORT = 8787;
const TOKEN_FILE = path.join(__dirname, '.llave_descargas');
const FILE_TOKEN = (() => {
  try { const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); if (/^[0-9a-f]{40}$/.test(t)) return t; } catch (_) {}
  const t = crypto.randomBytes(20).toString('hex');
  fs.writeFileSync(TOKEN_FILE, t);
  return t;
})();
function tailscaleIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      const [p1, p2] = a.address.split('.').map(Number);
      if (p1 === 100 && p2 >= 64 && p2 <= 127) return a.address; // 100.64.0.0/10 = Tailscale
    }
  }
  return null;
}
let fileServer = null;
let fileServerIp = null;
let fileServerErr = null;
function ensureFileServer() {
  const ip = tailscaleIp();
  if (fileServer && ip === fileServerIp) return;
  if (fileServer) { try { fileServer.close(); } catch (_) {} fileServer = null; fileServerIp = null; }
  if (!ip) { fileServerErr = 'Tailscale no está conectado en este PC'; return; }
  const srv = http.createServer(serveFile);
  srv.on('error', (e) => { fileServerErr = e.message; fileServer = null; fileServerIp = null; log('descargas: ' + e.message); });
  srv.listen(FILE_PORT, ip, () => { fileServerErr = null; log('descargas en calidad completa: http://' + ip + ':' + FILE_PORT + ' (solo Tailscale)'); });
  fileServer = srv; fileServerIp = ip;
}
function serveFile(req, res) {
  try {
    const u = new URL(req.url, 'http://x');
    const m = /^\/f\/([A-Za-z0-9_\-]+\.mp4)$/.exec(u.pathname);
    const okKey = u.searchParams.get('k') || '';
    if (!m || okKey.length !== FILE_TOKEN.length || !crypto.timingSafeEqual(Buffer.from(okKey), Buffer.from(FILE_TOKEN))) { res.writeHead(404); return res.end('No encontrado'); }
    const file = path.join(FINALES, m[1]);
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('No encontrado'); }
    const size = fs.statSync(file).size;
    const head = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    if (u.searchParams.get('dl')) head['Content-Disposition'] = 'attachment; filename="' + m[1] + '"';
    // Safari (iPhone) pide el video por pedazos (Range): sin esto no lo reproduce.
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (r) {
      let start = r[1] === '' ? Math.max(0, size - Number(r[2])) : Number(r[1]);
      let end = r[1] !== '' && r[2] !== '' ? Math.min(Number(r[2]), size - 1) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }); return res.end(); }
      res.writeHead(206, Object.assign(head, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 }));
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, Object.assign(head, { 'Content-Length': size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (err) { res.writeHead(500); res.end('Error'); }
}
function filesInfo() {
  ensureFileServer();
  let finales = [];
  try {
    finales = fs.readdirSync(FINALES).filter((f) => /\.mp4$/.test(f)).map((f) => {
      const st = fs.statSync(path.join(FINALES, f));
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(FINALES, f.replace(/\.mp4$/, '.json')), 'utf8')); } catch (_) {}
      return { name: f, mb: Math.round(st.size / 104857.6) / 10, episode_id: meta.episode_id || null, source: meta.source || null, quality_v: meta.quality_v || 1 };
    });
  } catch (_) {}
  return { base: fileServerIp ? 'http://' + fileServerIp + ':' + FILE_PORT : null, token: FILE_TOKEN, error: fileServerErr, finales };
}
// Encola "render_full" para los videos finales (últimos 10 días) que todavía no están en calidad
// completa en la PC o que cambiaron desde entonces. Uno a la vez; revisa cada minuto.
let lastScan = 0;
const QUALITY_V = 2; // igual que en render_local.js
const failedRenders = {}; // source → veces que falló (no reintentar en bucle)
async function queueFullRenders() {
  if (Date.now() - lastScan < 60000) return;
  lastScan = Date.now();
  const since = new Date(Date.now() - 10 * 86400000).toISOString();
  const { data: fins } = await sb.from('assets').select('episode_id, storage_path, updated_at').eq('kind', 'final_render').gt('updated_at', since).order('updated_at', { ascending: false }).limit(20);
  const have = {};
  // Si la receta de calidad cambió (QUALITY_V en render_local.js), también se rehace.
  filesInfo().finales.forEach((f) => { if (f.episode_id && f.quality_v >= QUALITY_V) have[f.episode_id] = f.source; });
  const todo = (fins || []).find((a) => have[a.episode_id] !== a.storage_path && (failedRenders[a.storage_path] || 0) < 2);
  if (!todo) return;
  const { data: open } = await sb.from('agent_jobs').select('id').in('status', ['pending', 'running']).limit(1);
  if (open && open.length) return;
  failedRenders[todo.storage_path] = (failedRenders[todo.storage_path] || 0) + 1;
  await sb.from('agent_jobs').insert({ command: 'render_full:' + todo.episode_id });
  log('nuevo video final: preparando calidad completa (episodio ' + todo.episode_id + ')');
}
// RESPALDO de las tomas que viven en fal.ai (desde oct-2026 ya no se copian a Supabase): cada 5 min
// baja a VYRALE/finales/.cache las que falten. Mismo nombre de caché que render_local.js
// (sha1 de la URL), así los renders en la PC tampoco las vuelven a bajar.
const CLIP_CACHE = path.join(FINALES, '.cache');
const cacheNameFor = (url) => crypto.createHash('sha1').update(url).digest('hex') + path.extname(new URL(url).pathname).slice(0, 6);
let lastBackup = 0;
async function backupClips() {
  if (Date.now() - lastBackup < 5 * 60000) return;
  lastBackup = Date.now();
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const { data: clips } = await sb.from('assets').select('storage_path').eq('kind', 'video_clip').gt('created_at', since).not('storage_path', 'like', '%supabase.co%').limit(500);
  const todo = (clips || []).map((c) => c.storage_path).filter((u) => /^https:\/\//.test(u || '') && !fs.existsSync(path.join(CLIP_CACHE, cacheNameFor(u))));
  if (!todo.length) return;
  fs.mkdirSync(CLIP_CACHE, { recursive: true });
  let ok = 0;
  for (const url of todo.slice(0, 20)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const dest = path.join(CLIP_CACHE, cacheNameFor(url));
      fs.writeFileSync(dest + '.tmp', Buffer.from(await res.arrayBuffer()));
      fs.renameSync(dest + '.tmp', dest);
      ok++;
    } catch (err) { log('respaldo de toma falló (' + err.message + '): ' + url); }
  }
  log('respaldo de tomas de fal.ai: ' + ok + ' nuevas guardadas en finales/.cache' + (todo.length > 20 ? ' (quedan ' + (todo.length - 20) + ', siguen en 5 min)' : ''));
}

// Si cambian los archivos del agente, se reinicia solo (el bucle de agente_bucle.bat lo vuelve a abrir).
const WATCH = ['agente.js', 'comandos.js'].map((f) => path.join(__dirname, f));
const startMtimes = WATCH.map((f) => { try { return fs.statSync(f).mtimeMs; } catch (_) { return 0; } });
function codeChanged() { return WATCH.some((f, i) => { try { return fs.statSync(f).mtimeMs !== startMtimes[i]; } catch (_) { return false; } }); }

// --- bucle principal ---
let busy = false;
async function tick() {
  let mine = false;
  try {
    await sb.from('agent_state').upsert({ id: 1, last_seen: new Date().toISOString(), host: os.hostname(), info: { commands: Object.keys(COMMANDS), dev_running: !!dev, platform: process.platform, files: filesInfo() } });
    if (busy) return;
    if (codeChanged()) { log('el código del agente cambió: reiniciando para cargarlo...'); devStop(); process.exit(0); }
    await queueFullRenders();
    await backupClips();
    // Órdenes viejas (más de 2 min sin atender) no se ejecutan: se marcan vencidas.
    // (Publicar espera hasta 15 min: puede tocarle detrás de un video en calidad completa.)
    await sb.from('agent_jobs').update({ status: 'expired', finished_at: new Date().toISOString() }).eq('status', 'pending').not('command', 'like', 'publish:%').lt('created_at', new Date(Date.now() - 120000).toISOString());
    await sb.from('agent_jobs').update({ status: 'expired', finished_at: new Date().toISOString() }).eq('status', 'pending').like('command', 'publish:%').lt('created_at', new Date(Date.now() - 15 * 60000).toISOString());
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
