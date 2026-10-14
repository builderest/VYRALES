// MEMORIA DE CLAUDE (oct-11, Franklin: "que guarde memoria y aprenda; yo solo reviso, él es el profesional").
// Vive en Supabase Storage (media/memoria/*.json) para que la usen la PC y vyrales.app.
// oct-13 · POR CANAL con base compartida (opción A de Franklin):
//   - El canal principal (admin) usa memoria/ (lo de siempre).
//   - Cada canal usa memoria/<ws>/ para lo SUYO, y ADEMÁS lee las reglas GENERALES del principal (oficio: ritmo
//     de voz, prompts, QA…). Así un canal nuevo arranca con experiencia pero se especializa aparte.
//   - Cada canal tiene su IDENTIDAD (workspaces.settings.identidad): de qué trata el canal. Va primero, siempre.
const BUCKET = 'media';
const BASE = 'memoria';
let cache = {}; // por carpeta: { '<dir>': { at, rules } }

function wsNow() { try { const T = require('./_tenant'); return T.currentWs(); } catch (_) { return null; } }
function dirOf(ws) { const T = (() => { try { return require('./_tenant'); } catch (_) { return null; } })(); return (ws && T && ws !== T.ADMIN_WS) ? BASE + '/' + ws : BASE; }
function dir() { return dirOf(wsNow()); }

async function download(sb, d, name, fallback) {
  try {
    const { data, error } = await sb.storage.from(BUCKET).download(d + '/' + name + '?t=' + Date.now());
    if (error || !data) return fallback;
    return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'));
  } catch (_) { return fallback; }
}
async function readJson(sb, name, fallback) { return download(sb, dir(), name, fallback); }
async function writeJson(sb, name, obj) {
  const body = Buffer.from(JSON.stringify(obj, null, 1), 'utf8');
  const { error } = await sb.storage.from(BUCKET).upload(dir() + '/' + name, body, { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw new Error('memoria: ' + error.message);
}

async function addLesson(sb, lesson) {
  const list = await readJson(sb, 'lecciones.json', []);
  list.push(Object.assign({ at: new Date().toISOString(), consolidated: false }, lesson));
  await writeJson(sb, 'lecciones.json', list.slice(-500));
}
async function getRules(sb) {
  const d = dir();
  const c = cache[d];
  if (c && c.rules && Date.now() - c.at < 120000) return c.rules;
  const r = await download(sb, d, 'reglas.json', { rules: [] });
  cache[d] = { at: Date.now(), rules: r };
  return r;
}

// Identidad del canal (de qué trata): workspaces.settings.identidad. Solo para canales (no el principal).
async function identidad(sb, ws) {
  try {
    const T = require('./_tenant');
    if (!ws || ws === T.ADMIN_WS) return '';
    const { data } = await sb.from('workspaces').select('settings, name').eq('id', ws).maybeSingle();
    const txt = data && data.settings && data.settings.identidad;
    return txt ? 'IDENTIDAD DEL CANAL "' + (data.name || '') + '" (manda sobre todo: el tema, el tono y los ejemplos de este canal son ESTOS, no los de otros canales):\n' + String(txt).slice(0, 800) + '\n\n' : '';
  } catch (_) { return ''; }
}

// Bloque de texto que se antepone a los prompts de Claude: identidad del canal + reglas generales + reglas del canal.
async function memoryBlock(sb) {
  const ws = wsNow();
  const T = (() => { try { return require('./_tenant'); } catch (_) { return null; } })();
  const esCanal = !!(ws && T && ws !== T.ADMIN_WS);
  const ident = esCanal ? await identidad(sb, ws) : '';
  // Reglas generales del principal (oficio) — las lee también el canal (opción A).
  const generales = esCanal ? ((await download(sb, BASE, 'reglas.json', { rules: [] })).rules || []) : [];
  const propias = ((await getRules(sb)).rules || []);
  const seen = new Set();
  const all = [];
  // Reglas "evaluando" (recién agregadas) o "en_disputa" (el cerebro objetó) todavía NO se usan.
  for (const x of generales.concat(propias)) { const t = x && !x.estado && x.regla; if (t && !seen.has(t)) { seen.add(t); all.push(t); } }
  let block = ident;
  if (all.length) {
    block += 'MEMORIA PROFESIONAL (lo que aprendiste de producciones anteriores y de las correcciones de Franklin; cúmplelo siempre):\n' +
      all.map((t, i) => `${i + 1}. ${t}`).join('\n') + '\n\n';
  }
  // 🧠 CEREBRO (oct-14): en vez de las últimas fallas sueltas (anécdotas que podían ser casos aislados), van SOLO
  // las reglas COMPROBADAS con evidencia (casos mínimos, ≥ 2 episodios, tasa de falla vs la base) y lo que funciona.
  try { block += await require('./_cerebro').cerebroBlock(sb); } catch (_) {}
  return block;
}
module.exports = { readJson, writeJson, addLesson, getRules, memoryBlock, identidad };
