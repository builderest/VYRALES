// Puente local hacia king por Tailscale SIN pasar por la red de Windows (oct-14): con ProtonVPN conectado en Cronix,
// el VPN bloquea las conexiones normales a 100.x, pero tailscaled sí llega (por su relay). `tailscale nc` abre la
// conexión desde tailscaled y aquí se expone en 127.0.0.1:<puerto>.
//   node agente/ts_proxy.js test   → prueba /system_stats por el puente y sale
//   require('./ts_proxy').start()  → deja el puente abierto (lo usa agente.js)
const net = require('net');
const { spawn } = require('child_process');
const fs = require('fs');
const TS = fs.existsSync('C:\\Program Files\\Tailscale\\tailscale.exe') ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : 'tailscale';
const HOST = '100.66.84.73', PORT = 8188, LOCAL = 18188;
function start(log = console.log) {
  const srv = net.createServer((sock) => {
    const p = spawn(TS, ['nc', HOST, String(PORT)], { windowsHide: true });
    sock.pipe(p.stdin); p.stdout.pipe(sock);
    const end = () => { try { sock.destroy(); } catch (_) {} try { p.kill(); } catch (_) {} };
    p.on('close', end); sock.on('close', end); sock.on('error', end); p.on('error', (e) => { log('ts_proxy: ' + e.message); end(); });
    p.stderr.on('data', (d) => log('ts_proxy nc: ' + String(d).trim()));
  });
  srv.on('error', (e) => log('ts_proxy no pudo abrir ' + LOCAL + ': ' + e.message));
  srv.listen(LOCAL, '127.0.0.1', () => log('🔌 puente a king por Tailscale: http://127.0.0.1:' + LOCAL));
  return srv;
}
module.exports = { start, LOCAL };
if (require.main === module && process.argv[2] === 'test') {
  const srv = start();
  setTimeout(async () => {
    try { const r = await fetch('http://127.0.0.1:' + LOCAL + '/system_stats', { signal: AbortSignal.timeout(20000) }); const j = await r.json(); console.log('✔ king responde por el puente:', JSON.stringify(j.devices && j.devices.map((d) => d.name))); }
    catch (e) { console.log('✖ no responde por el puente:', e.message); }
    srv.close(); process.exit(0);
  }, 800);
}
