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
    else if (def.special === 'render_full' || def.special === 'publish_local' || def.special === 'prueba_ltx' || def.special === 'gen_local' || def.special === 'prueba_flux' || def.special === 'regen_local' || def.special === 'prueba_ltx_voz') {
      // Proceso aparte (siempre con el código más nuevo). Los argumentos ya pasaron la lista blanca.
      const script = { render_full: 'render_local.js', publish_local: 'publish_local.js', prueba_ltx: 'prueba_ltx.js', gen_local: 'gen_local.js', prueba_flux: 'prueba_flux.js', regen_local: 'regen_local.js', prueba_ltx_voz: 'prueba_ltx_voz.js' }[def.special];
      const maxMin = { prueba_ltx: 120, gen_local: 240, regen_local: 120, prueba_ltx_voz: 90 }[def.special] || 30;
      code = await new Promise((resolve) => {
        const p = spawn(process.execPath, [path.join(__dirname, script)].concat(arg ? arg.split(':') : []), { cwd: ROOT, shell: false });
        const timer = setTimeout(() => { add('\n[se canceló: tardó más de ' + maxMin + ' minutos]\n'); p.kill(); }, maxMin * 60000);
        p.stdout.on('data', (d) => add(String(d)));
        p.stderr.on('data', (d) => add(String(d)));
        p.on('error', (e) => { add('ERROR: ' + e.message + '\n'); resolve(1); });
        p.on('close', (c) => { clearTimeout(timer); resolve(c == null ? 1 : c); });
      });
    }
    else if (def.special === 'pc_https') {
      try {
        add(execFileSync(tailscaleExe(), ['serve', '--bg', '8788'], { encoding: 'utf8', timeout: 30000 }) + '\n');
      } catch (err) { add('ERROR: ' + String(err.stdout || '') + String(err.stderr || err.message) + '\n'); code = 1; }
      httpsCheckedAt = 0; refreshHttpsBase();
      add(httpsBase ? '✔ Reproducción desde la PC activa: ' + httpsBase + '\n' : '✖ Todavía no hay dirección https. Revisa arriba el mensaje de Tailscale (puede pedir activar HTTPS en login.tailscale.com → DNS).\n');
    }
    else if (def.special === 'discos') {
      for (const d of 'CDEFGHIJ') {
        try { const s = fs.statfsSync(d + ':\\'); add(d + ':  ' + (s.bavail * s.bsize / 1073741824).toFixed(0) + ' GB libres de ' + (s.blocks * s.bsize / 1073741824).toFixed(0) + ' GB\n'); } catch (_) {}
      }
      add('Videos de VYRALES se guardan en: ' + FINALES + '\n');
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
// Dónde se guardan los videos grandes: VYRALES_FINALES_DIR en el .env (ej. \\\\100.66.84.73\\VYRALES_videos,
// la carpeta compartida de king por Tailscale). Si no está, VYRALE/finales en esta PC.
const FINALES = process.env.VYRALES_FINALES_DIR || path.join(ROOT, 'finales');
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
  ensureLocalServer();
}
// Copia en 127.0.0.1:8788 para "tailscale serve" (HTTPS dentro de Tailscale): la página https://vyrales.app
// solo puede reproducir videos de direcciones https. No se abre a la red: solo Tailscale la publica.
let localServer = null;
function ensureLocalServer() {
  if (localServer) return;
  localServer = http.createServer(serveFile);
  localServer.on('error', (e) => { log('servidor local 8788: ' + e.message); localServer = null; });
  localServer.listen(8788, '127.0.0.1');
}
// Dirección https de esta PC en Tailscale (MagicDNS), si "tailscale serve" está activo.
let httpsBase = null;
let httpsCheckedAt = 0;
function tailscaleExe() { return IS_WIN && fs.existsSync('C:\\Program Files\\Tailscale\\tailscale.exe') ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : 'tailscale'; }
function refreshHttpsBase() {
  if (Date.now() - httpsCheckedAt < 5 * 60000) return;
  httpsCheckedAt = Date.now();
  try {
    const st = JSON.parse(execFileSync(tailscaleExe(), ['serve', 'status', '--json'], { encoding: 'utf8', timeout: 8000 }) || '{}');
    const web = st.Web || {};
    const host = Object.keys(web).find((h) => /:443$/.test(h));
    httpsBase = host ? 'https://' + host.replace(/:443$/, '') : null;
  } catch (_) { httpsBase = null; }
}
function serveFile(req, res) {
  try {
    const u = new URL(req.url, 'http://x');
    const okKey = u.searchParams.get('k') || '';
    const keyOk = okKey.length === FILE_TOKEN.length && crypto.timingSafeEqual(Buffer.from(okKey), Buffer.from(FILE_TOKEN));
    // La página (https://vyrales.app) prueba si la PC responde y reproduce desde aquí.
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (u.pathname === '/ping') { res.writeHead(keyOk ? 200 : 404, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors)); return res.end(keyOk ? '{"ok":true}' : '{}'); }
    if (!keyOk) { res.writeHead(404); return res.end('No encontrado'); }
    let file = null;
    let type = 'video/mp4';
    let dlName = null;
    // "/f/<serie>/<archivo>.mp4" (una carpeta por serie). Solo letras, números, _ y -: nada de "..".
    const m = /^\/f\/((?:[A-Za-z0-9_\-]+\/)?[A-Za-z0-9_\-]+\.mp4)$/.exec(decodeURIComponent(u.pathname));
    if (m) { file = path.join(FINALES, m[1]); dlName = path.basename(m[1]); }
    // "/u?url=<url de Supabase/fal>": la copia guardada en esta PC (para reproducir SIN gastar Supabase).
    if (u.pathname === '/u') {
      const orig = u.searchParams.get('url') || '';
      if (!/^https:\/\//.test(orig)) { res.writeHead(404); return res.end('No encontrado'); }
      file = path.join(CLIP_CACHE, cacheNameFor(orig));
      const ext = path.extname(new URL(orig).pathname).toLowerCase();
      type = { '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
    }
    if (!file || !fs.existsSync(file)) { res.writeHead(404, cors); return res.end('No encontrado'); }
    const size = fs.statSync(file).size;
    const head = Object.assign({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': u.pathname === '/u' ? 'public, max-age=86400' : 'no-store' }, cors);
    if (u.searchParams.get('dl') && dlName) head['Content-Disposition'] = 'attachment; filename="' + dlName + '"';
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
    // Una carpeta por serie: E:\VYRALES_videos\<serie>\<serie>_ep<N>.mp4 (+ .json con la versión).
    const files = [];
    for (const d of fs.readdirSync(FINALES, { withFileTypes: true })) {
      if (d.isDirectory() && !d.name.startsWith('.')) fs.readdirSync(path.join(FINALES, d.name)).filter((f) => /_ep\d+\.mp4$/.test(f)).forEach((f) => files.push(d.name + '/' + f));
      else if (d.isFile() && /\.mp4$/.test(d.name)) files.push(d.name);
    }
    finales = files.map((f) => {
      const st = fs.statSync(path.join(FINALES, f));
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(FINALES, f.replace(/\.mp4$/, '.json')), 'utf8')); } catch (_) {}
      return { name: f, mb: Math.round(st.size / 104857.6) / 10, episode_id: meta.episode_id || null, source: meta.source || null, quality_v: meta.quality_v || 1 };
    });
  } catch (_) {}
  refreshHttpsBase();
  return { base: fileServerIp ? 'http://' + fileServerIp + ':' + FILE_PORT : null, https_base: httpsBase, token: FILE_TOKEN, error: fileServerErr, finales };
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
  // Todas las tomas y videos finales recientes (de fal y de Supabase): la PC los sirve para
  // reproducir en el panel/editor sin gastar las descargas de Supabase (se bajan UNA sola vez).
  const { data: clips } = await sb.from('assets').select('storage_path').in('kind', ['video_clip', 'final_render', 'image']).gt('updated_at', since).limit(1000);
  const todo = (clips || []).map((c) => c.storage_path).filter((u) => /^https:\/\//.test(u || '') && !fs.existsSync(path.join(CLIP_CACHE, cacheNameFor(u))));
  if (!todo.length) return;
  fs.mkdirSync(CLIP_CACHE, { recursive: true });
  let ok = 0;
  for (const url of todo.slice(0, 60)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const dest = path.join(CLIP_CACHE, cacheNameFor(url));
      fs.writeFileSync(dest + '.tmp', Buffer.from(await res.arrayBuffer()));
      fs.renameSync(dest + '.tmp', dest);
      ok++;
    } catch (err) { log('respaldo de toma falló (' + err.message + '): ' + url); }
  }
  log('respaldo de tomas de fal.ai: ' + ok + ' nuevas guardadas en finales/.cache' + (todo.length > 60 ? ' (quedan ' + (todo.length - 60) + ', siguen en 5 min)' : ''));
}

// MUDANZA: si los videos ahora van a otra carpeta (VYRALES_FINALES_DIR, ej. king), lo que quedó en
// VYRALE/finales de esta PC se copia allá, se verifica el tamaño y se borra de aquí (libera disco).
let migrated = false;
function migrateLocalFinales() {
  if (migrated) return;
  migrated = true;
  const local = path.join(ROOT, 'finales');
  if (!process.env.VYRALES_FINALES_DIR || path.resolve(FINALES) === path.resolve(local) || !fs.existsSync(local)) return;
  let moved = 0, mb = 0;
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const src = path.join(dir, e.name), r = path.join(rel, e.name), dst = path.join(FINALES, r);
      if (e.isDirectory()) { walk(src, r); continue; }
      try {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
        if (fs.statSync(dst).size === fs.statSync(src).size) { mb += fs.statSync(src).size / 1048576; fs.unlinkSync(src); moved++; }
      } catch (err) { log('mudanza: no pude mover ' + r + ' (' + err.message + ')'); }
    }
  };
  try { walk(local, ''); } catch (err) { log('mudanza falló: ' + err.message); return; }
  if (moved) log('mudanza: ' + moved + ' archivos (' + mb.toFixed(0) + ' MB) pasados a ' + FINALES + ' y borrados de esta PC');
}
// ORDEN POR SERIE: <serie>_ep<N>.* y prueba_ltx/<serie>_ep... sueltos → carpeta <serie>\ (y <serie>\prueba_ltx\).
let organized = false;
function organizeBySeries() {
  if (organized) return;
  organized = true;
  let n = 0;
  const mv = (src, dst) => { try { fs.mkdirSync(path.dirname(dst), { recursive: true }); if (!fs.existsSync(dst)) { fs.renameSync(src, dst); n++; } } catch (err) { log('orden por serie: no pude mover ' + src + ' (' + err.message + ')'); } };
  try {
    for (const f of fs.readdirSync(FINALES)) {
      const m = /^(.+?)_ep\d+\.(mp4|json)$/.exec(f);
      if (m && fs.statSync(path.join(FINALES, f)).isFile()) mv(path.join(FINALES, f), path.join(FINALES, m[1], f));
    }
    const pr = path.join(FINALES, 'prueba_ltx');
    if (fs.existsSync(pr)) {
      for (const f of fs.readdirSync(pr)) {
        const m = /^(.+?)_ep\d+_/.exec(f);
        if (m) mv(path.join(pr, f), path.join(FINALES, m[1], 'prueba_ltx', f));
      }
      try { if (!fs.readdirSync(pr).filter((x) => x !== 'resumen.json').length) { try { fs.unlinkSync(path.join(pr, 'resumen.json')); } catch (_) {} fs.rmdirSync(pr); } } catch (_) {}
    }
  } catch (_) {}
  if (n) log('orden por serie: ' + n + ' archivos acomodados en carpetas por serie dentro de ' + FINALES);
}

// Si cambian los archivos del agente, se reinicia solo (el bucle de agente_bucle.bat lo vuelve a abrir).
const WATCH = ['agente.js', 'comandos.js'].map((f) => path.join(__dirname, f)).concat(path.join(ROOT, '.env'));
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
    migrateLocalFinales();
    organizeBySeries();
    await queueFullRenders();
    await backupClips();
    // Órdenes viejas (más de 2 min sin atender) no se ejecutan: se marcan vencidas.
    // (Publicar espera hasta 15 min: puede tocarle detrás de un video en calidad completa.)
    await sb.from('agent_jobs').update({ status: 'expired', finished_at: new Date().toISOString() }).eq('status', 'pending').not('command', 'like', 'publish:%').not('command', 'like', 'prueba_%').not('command', 'like', 'gen_local:%').not('command', 'like', 'regen_local:%').lt('created_at', new Date(Date.now() - 120000).toISOString());
    // Pruebas y producciones en la PC esperan hasta 3 h en la fila (king puede estar ocupada con otro episodio).
    for (const pat of ['prueba_%', 'gen_local:%', 'regen_local:%']) await sb.from('agent_jobs').update({ status: 'expired', finished_at: new Date().toISOString() }).eq('status', 'pending').like('command', pat).lt('created_at', new Date(Date.now() - 180 * 60000).toISOString());
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
