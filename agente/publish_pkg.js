// Rehace el paquete de publicación (textos + portada) de un episodio en la PC: node agente/publish_pkg.js <episode_id>
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
(async () => {
  const epId = process.argv[2];
  const { handler } = require(path.join(ROOT, 'netlify', 'functions', 'publish-package-background'));
  const r = await handler({ httpMethod: 'POST', body: JSON.stringify({ episode_id: epId }) });
  console.log('RESULTADO', r.statusCode, r.body);
  if (r.statusCode >= 400) process.exit(1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
