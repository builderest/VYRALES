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
// files: [{ name, buffer }] → se escriben en la carpeta temporal para que Claude los LEA (imágenes para revisar tomas).
// Memoria profesional de Claude (media/memoria/reglas.json): se antepone a cada prompt (salvo memory:false).
async function withMemory(prompt) {
  try {
    const path2 = require('path');
    const { getSupabaseClient } = require(path2.join(__dirname, '..', 'netlify', 'functions', '_supabase'));
    const { memoryBlock } = require(path2.join(__dirname, '..', 'netlify', 'functions', '_memoria'));
    return (await memoryBlock(getSupabaseClient())) + prompt;
  } catch (_) { return prompt; }
}
async function runClaude(prompt, opts = {}) {
  return runClaudeRaw(opts.memory === false ? prompt : await withMemory(prompt), opts);
}
function runClaudeRaw(prompt, { timeoutMin = 12, log = () => {}, files = [], web = false } = {}) {
  const exe = claudePath();
  if (!exe) return Promise.reject(new Error('Claude Code no está instalado en esta PC (usa el botón "Claude: instalar / revisar").'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-claude-'));
  for (const f of files) fs.writeFileSync(path.join(cwd, path.basename(f.name)), f.buffer);
  const env = Object.assign({}, process.env);
  delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; // usar el PLAN, nunca la API
  if (!env.CLAUDE_CODE_MAX_OUTPUT_TOKENS) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '32000'; // guiones largos
  // web:true → se permite WebSearch/WebFetch SOLO para este trabajo (ideas que miran lo viral de afuera). El resto sigue bloqueado.
  const disallowed = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Task'];
  if (!web) disallowed.push('WebFetch', 'WebSearch');
  const allowed = [];
  if (files.length) allowed.push('Read');
  if (web) allowed.push('WebSearch', 'WebFetch');
  const args = ['-p', 'Sigue al pie de la letra las instrucciones del texto que recibiste por la entrada estándar y responde SOLO con el JSON pedido, sin explicaciones ni bloques de código.', '--output-format', 'stream-json', '--verbose', '--disallowedTools', disallowed.join(',')].concat(allowed.length ? ['--allowedTools', allowed.join(',')] : []);
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
      // stream-json: una línea JSON por evento. Las respuestas largas llegan en VARIOS mensajes (Claude sigue
      // cuando llega al máximo de salida) y "result" trae solo el último → se juntan todos los textos en orden.
      // oct-16: con web:true (ideas), Claude escribe comentarios de texto ENTRE búsquedas ("Voy a revisar...")
      // antes del JSON final. Antes se pegaban TODOS los textos seguidos → el comentario quedaba pegado al JSON
      // y lo rompía ("Expected ',' or ']' after array element"). Ahora se reinicia `texts` cada vez que se ve
      // una herramienta (tool_use o su resultado): solo queda el texto de la ÚLTIMA tanda, ya sin más tool calls
      // de por medio (que sigue pudiendo venir partida en varios mensajes si Claude llega al máximo de salida).
      let j = null; let texts = [];
      for (const ln of out.split(/\r?\n/)) {
        let ev = null; try { ev = JSON.parse(ln); } catch (_) { continue; }
        if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
          if (ev.message.content.some((c) => c.type === 'tool_use')) texts = [];
          ev.message.content.forEach((c) => { if (c.type === 'text' && c.text) texts.push(c.text); });
        }
        if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content) && ev.message.content.some((c) => c.type === 'tool_result')) texts = [];
        if (ev.type === 'result') j = ev;
      }
      if (j && j.is_error) return reject(new Error('Claude: ' + String(j.result || j.subtype || 'error').slice(0, 300)));
      if (code !== 0 && !j) {
        const msg = (err || out).slice(-400);
        if (/log ?in|login|authenticat|Invalid API key|credit/i.test(msg)) return reject(new Error('Claude Code no tiene sesión iniciada en esta PC (botón "Claude: iniciar sesión"). Detalle: ' + msg));
        return reject(new Error('Claude terminó con código ' + code + ': ' + msg));
      }
      const text = texts.length ? texts.join('') : (j ? String(j.result || '') : out);
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
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {
      // Diagnóstico (oct-16): muestra el texto ALREDEDOR de la posición donde falló, no solo el arranque.
      const m = /position (\d+)/.exec(e.message || '');
      const pos = m ? Number(m[1]) : 0;
      const ctx = t.slice(a).slice(Math.max(0, pos - 150), pos + 150);
      throw new Error('Claude no devolvió un JSON válido (' + e.message + '). Alrededor del error: …' + ctx + '…');
    }
  }
  throw new Error('Claude no devolvió un JSON válido: ' + t.slice(0, 200));
}

// Para _visual_check.checkVisuals({ llm }) → { out, costUsd: 0 }.
const claudeLlm = (log) => async (prompt) => ({ out: parseJson(await runClaude(prompt, { log })), costUsd: 0 });

module.exports = { claudePath, runClaude, parseJson, claudeLlm };
