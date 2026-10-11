// CLAUDE CODE EN LA PC, CON EL PLAN DE CLAUDE DE FRANKLIN (oct-10: "¿por qué cobra? que el guionista se conecte
// a mi PC"). Se usa el CLI oficial (`claude -p`, modo sin preguntas): no hay API ni cobro por guion; cada
// pedido gasta un poco del límite de uso del plan. IMPORTANTE: si existe ANTHROPIC_API_KEY en el entorno,
// Claude Code cobra por API en vez de usar el plan → aquí se BORRA del entorno del proceso hijo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');

function claudePath() {
  try {
    const out = execSync(process.platform === 'win32' ? 'where claude' : 'command -v claude', { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/);
    // En Windows "where" puede devolver "claude" (sin extensión, script de bash) y "claude.cmd": se prefiere .cmd/.exe.
    return out.find((p) => /\.(cmd|exe)$/i.test(p)) || out[0] || null;
  } catch (_) { return null; }
}

// Manda `prompt` por stdin a `claude -p` y devuelve el texto de la respuesta. Corre en una carpeta temporal vacía
// (no puede tocar el proyecto) y sin herramientas.
function runClaude(prompt, { timeoutMin = 12, log = () => {} } = {}) {
  const exe = claudePath();
  if (!exe) return Promise.reject(new Error('Claude Code no está instalado en esta PC (usa el botón "Claude: instalar / revisar").'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-claude-'));
  const env = Object.assign({}, process.env);
  delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; // usar el PLAN, nunca la API
  const args = ['-p', 'Sigue al pie de la letra las instrucciones del texto que recibiste por la entrada estándar y responde SOLO con el JSON pedido, sin explicaciones ni bloques de código.', '--output-format', 'json', '--disallowedTools', 'Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task'];
  return new Promise((resolve, reject) => {
    // claude.cmd (npm en Windows) necesita shell: los argumentos con espacios van entre comillas (si no, se parten).
    const viaShell = /\.cmd$/i.test(exe);
    const p = viaShell
      ? spawn(`"${exe}" ` + args.map((a) => (/[\s,]/.test(a) ? `"${a.replace(/"/g, '')}"` : a)).join(' '), { cwd, env, shell: true, windowsHide: true })
      : spawn(exe, args, { cwd, env, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('Claude tardó más de ' + timeoutMin + ' min.')); }, timeoutMin * 60000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch (_) {}
      let j = null; try { j = JSON.parse(out); } catch (_) {}
      if (j && j.is_error) return reject(new Error('Claude: ' + String(j.result || j.subtype || 'error').slice(0, 300)));
      if (code !== 0 && !j) {
        const msg = (err || out).slice(-400);
        if (/log ?in|login|authenticat|Invalid API key|credit/i.test(msg)) return reject(new Error('Claude Code no tiene sesión iniciada en esta PC (botón "Claude: iniciar sesión"). Detalle: ' + msg));
        return reject(new Error('Claude terminó con código ' + code + ': ' + msg));
      }
      const text = j ? String(j.result || '') : out;
      log(`  Claude respondió (${text.length} caracteres${j && j.duration_ms ? ', ' + Math.round(j.duration_ms / 1000) + ' s' : ''})`);
      resolve(text);
    });
    p.stdin.end(prompt);
  });
}

// Saca el JSON de la respuesta (aunque venga con texto o ``` alrededor).
function parseJson(text) {
  const t = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch (_) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('Claude no devolvió un JSON válido: ' + t.slice(0, 200));
}

// Para _visual_check.checkVisuals({ llm }) → { out, costUsd: 0 }.
const claudeLlm = (log) => async (prompt) => ({ out: parseJson(await runClaude(prompt, { log })), costUsd: 0 });

module.exports = { claudePath, runClaude, parseJson, claudeLlm };
