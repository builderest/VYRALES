// CLAUDE APRENDE (lo lanza el agente: node agente/claude_aprender.js)
// Lee las lecciones nuevas (correcciones de Franklin, arreglos del QA que funcionaron, fallas) y actualiza su
// memoria profesional (media/memoria/reglas.json): reglas cortas, generales, sin duplicados. $0 (plan Max).
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
const M = require(path.join(ROOT, 'netlify', 'functions', '_memoria'));
const { runClaude, parseJson } = require('./_claude');

(async () => {
  const sb = getSupabaseClient();
  const lessons = await M.readJson(sb, 'lecciones.json', []);
  const fresh = lessons.filter((l) => !l.consolidated);
  if (!fresh.length) { console.log('No hay lecciones nuevas.'); return; }
  const cur = await M.readJson(sb, 'reglas.json', { rules: [], updated_at: null });
  console.log(`Aprendiendo de ${fresh.length} lección(es) nuevas; reglas actuales: ${(cur.rules || []).length}`);
  const prompt = `Eres el director profesional de VYRALES: documentales narrados hechos con IA (guion con Claude, imágenes con Google Flow, video con LTX-2.5 que parte de la imagen y HACE todo lo que lee porque usa cfg = 1).
Tu trabajo ahora: APRENDER de lo que pasó y actualizar tu memoria profesional, para que el próximo video salga perfecto sin que Franklin tenga que corregir.

Tus reglas actuales (JSON):
${JSON.stringify(cur.rules || [], null, 1)}

Lecciones nuevas (lo que pasó; "franklin" = corrección del dueño, manda sobre todo; "franklin_edicion" = cómo cambió él una toma a mano; "qa_arreglo" = problema y la solución que FUNCIONÓ; "qa_falla" = lo que no se pudo arreglar):
${JSON.stringify(fresh.map((l) => { const o = Object.assign({}, l); delete o.consolidated; return o; }), null, 1)}

Devuelve la lista COMPLETA y actualizada de reglas:
- Cada regla: corta (máx. 2 frases), general (sirve para cualquier video, no solo esa toma), accionable, en español, con el porqué.
- Lo que dijo Franklin tiene prioridad; si contradice una regla vieja, reemplázala.
- Une duplicados, quita lo que ya no aplica, máximo 40 reglas, las más importantes primero.
- No cambies nunca la regla de que la narración no se toca ni la de que cada imagen muestra lo que dice su narración.
Responde SOLO este JSON: {"rules":[{"regla":"...","por_que":"...","origen":"franklin|qa|sistema"}],"aprendido":"una frase con lo nuevo que aprendiste"}`;
  const out = parseJson(await runClaude(prompt, { timeoutMin: 8, log: console.log, memory: false }));
  const rules = (out.rules || []).filter((r) => r && r.regla).slice(0, 40).map((r) => ({ regla: String(r.regla).slice(0, 400), por_que: String(r.por_que || '').slice(0, 300), origen: String(r.origen || '') }));
  if (!rules.length) throw new Error('Claude no devolvió reglas.');
  const history = (cur.history || []).concat([{ at: new Date().toISOString(), aprendido: String(out.aprendido || ''), lecciones: fresh.length }]).slice(-50);
  await M.writeJson(sb, 'reglas.json', { rules, updated_at: new Date().toISOString(), history });
  const ids = new Set(fresh.map((l) => l.at + '|' + (l.toma || '')));
  const latest = await M.readJson(sb, 'lecciones.json', []);
  await M.writeJson(sb, 'lecciones.json', latest.map((l) => (ids.has(l.at + '|' + (l.toma || '')) ? Object.assign({}, l, { consolidated: true }) : l)));
  console.log('Aprendido:', out.aprendido || '');
  console.log('Reglas ahora:', rules.length);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
