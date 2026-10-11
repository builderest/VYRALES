// MEMORIA DE CLAUDE (oct-11, Franklin: "que guarde memoria y aprenda; yo solo reviso, él es el profesional").
// Vive en Supabase Storage (media/memoria/*.json) para que la usen la PC y vyrales.app:
//   lecciones.json  → lo que pasó: correcciones de Franklin (✗ + motivo), arreglos del QA que funcionaron, fallas.
//   reglas.json     → lo que Claude APRENDIÓ (las consolida claude_aprender a partir de las lecciones).
// Todas las llamadas creativas de Claude (guion, prompts, revisión, corrección) leen reglas.json antes de trabajar.
const BUCKET = 'media';
const DIR = 'memoria';
let cache = { at: 0, rules: null };

async function readJson(sb, name, fallback) {
  try {
    const { data, error } = await sb.storage.from(BUCKET).download(DIR + '/' + name + '?t=' + Date.now());
    if (error || !data) return fallback;
    return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8'));
  } catch (_) { return fallback; }
}
async function writeJson(sb, name, obj) {
  const body = Buffer.from(JSON.stringify(obj, null, 1), 'utf8');
  const { error } = await sb.storage.from(BUCKET).upload(DIR + '/' + name, body, { contentType: 'application/json', upsert: true, cacheControl: '0' });
  if (error) throw new Error('memoria: ' + error.message);
}

async function addLesson(sb, lesson) {
  const list = await readJson(sb, 'lecciones.json', []);
  list.push(Object.assign({ at: new Date().toISOString(), consolidated: false }, lesson));
  await writeJson(sb, 'lecciones.json', list.slice(-500));
}
async function getRules(sb) {
  if (cache.rules && Date.now() - cache.at < 120000) return cache.rules;
  const r = await readJson(sb, 'reglas.json', { rules: [] });
  cache = { at: Date.now(), rules: r };
  return r;
}
// Bloque de texto que se antepone a los prompts de Claude.
async function memoryBlock(sb) {
  const r = await getRules(sb);
  const rules = (r.rules || []).filter((x) => x && x.regla);
  if (!rules.length) return '';
  return 'MEMORIA PROFESIONAL (lo que aprendiste de producciones anteriores y de las correcciones de Franklin; cúmplelo siempre):\n' +
    rules.map((x, i) => `${i + 1}. ${x.regla}`).join('\n') + '\n\n';
}
module.exports = { readJson, writeJson, addLesson, getRules, memoryBlock };
