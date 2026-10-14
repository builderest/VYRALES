// 🧠 CEREBRO (lo lanza el agente):
//   node agente/cerebro.js cargar   → lee TODOS los veredictos de la base (QA + aprobaciones/rechazos de Franklin) y piensa
//   node agente/cerebro.js pensar   → igual + Claude escribe un ANÁLISIS (hipótesis, cosas que se confunden). $0 (plan Max)
// Las reglas las deciden los NÚMEROS en _cerebro.js (casos mínimos, tasa vs base, intervalo de confianza, histéresis).
// El análisis de Claude se muestra en el panel pero NO cambia ninguna regla (independencia: datos, no opiniones).
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
const C = require(path.join(ROOT, 'netlify', 'functions', '_cerebro'));
const M = require(path.join(ROOT, 'netlify', 'functions', '_memoria'));
const pct = (x) => (x * 100).toFixed(0) + ' %';

(async () => {
  const mode = process.argv[2] || 'cargar';
  const sb = getSupabaseClient();
  await C.syncFromDb(sb, { log: console.log, reset: true });
  const doc = await C.think(sb, { log: console.log });
  console.log(`\nBASE (PRIMEROS INTENTOS): ${doc.casos} tomas · falla promedio ${pct(doc.base)}` + (doc.reintentos && doc.reintentos.n ? ` · reintentadas: ${doc.reintentos.n}, siguen mal ${pct(doc.reintentos.siguen_mal / doc.reintentos.n)}` : ''));
  const show = (title, list) => { if (!list.length) return; console.log('\n' + title); for (const p of list) console.log(`  ${p.label.padEnd(58).slice(0, 58)} n=${String(p.n).padStart(3)}  falla ${pct(p.rate).padStart(5)}  ${p.lift.toFixed(2)}× base  eps ${p.eps_mal}↑/${p.eps_bien}↓  [${p.state}]`); };
  show('REGLAS ACTIVAS (fallan mucho más que el promedio, con evidencia suficiente):', doc.patterns.filter((p) => p.state === 'activa'));
  show('LO QUE FUNCIONA:', doc.patterns.filter((p) => p.state === 'funciona'));
  show('EN OBSERVACIÓN (pocos casos o diferencia no clara — NO se actúa):', doc.patterns.filter((p) => p.state === 'observacion' && p.n >= 3).slice(0, 12));
  const J = { i: 'imagen', s: 'estilo', a: 'acción', h: 'humo', b: 'roto' };
  const jl = Object.entries(doc.judge || {}).filter(([, v]) => v.revisadas).map(([f, v]) => `${J[f]}: ${v.falsos_positivos}/${v.revisadas} falsos positivos (fiable ${pct(v.fiabilidad)}, acuerdos ${v.acuerdos}${v.usable ? "" : " → AÚN NO USABLE"})`);
  if (jl.length) console.log('\nFIABILIDAD DEL QA (según lo que tú aprobaste igual): ' + jl.join(' · '));
  if (doc.fixes && doc.fixes.length) console.log('\nARREGLOS QUE FUNCIONARON: ' + doc.fixes.slice(0, 6).map((f) => `quitar "${f.label}" arregló ${f.arreglo}/${f.quitado}`).join(' · '));

  if (mode === 'pensar') {
    const { runClaude, parseJson } = require('./_claude');
    const top = doc.patterns.filter((p) => p.n >= 5).slice(0, 30).map((p) => ({ patron: p.label, casos: p.n, falla: Math.round(p.rate * 100), veces_base: +p.lift.toFixed(2), estado: p.state, tipo_de_falla: p.flags }));
    const prompt = `Eres el analista del CEREBRO de VYRALES (documentales hechos con IA: imagen con Flow, video con LTX-2.5 que parte de la imagen y usa cfg = 1).
Estas son las estadísticas REALES de ${doc.casos} tomas revisadas (falla promedio ${Math.round(doc.base * 100)} %). tipo_de_falla: i=imagen no cuadra, s=no realista, a=no se ve la acción, h=humo de relleno, b=algo se rompe/deforma.
${JSON.stringify(top, null, 1)}
Fiabilidad del QA visual según las aprobaciones de Franklin: ${JSON.stringify(doc.judge)}
OJO: si un juez tiene usable=false, esa métrica está SESGADA (solo se registra cuando Franklin aprueba algo que el QA marcó mal; cuando está de acuerdo no hace clic). NO concluyas que el QA no sirve con esa métrica: dilo como dato incompleto.
Arreglos que funcionaron: ${JSON.stringify((doc.fixes || []).slice(0, 10))}

Tu trabajo: PENSAR, no mandar. Las reglas ya las deciden los números; tú NO puedes activarlas ni borrarlas.
- Explica en pocas frases qué está pasando de verdad (causas probables), distinguiendo HECHO (lo que dicen los números) de HIPÓTESIS.
- Señala patrones que se CONFUNDEN entre sí (aparecen juntos y no se sabe cuál causa la falla) y qué dato haría falta para separarlos.
- Di qué experimento barato haría salir de dudas.
- Sé escéptico: con menos de 8 casos, nada es concluyente.
Responde SOLO este JSON: {"resumen":"2-4 frases","hipotesis":["..."],"confusiones":["..."],"experimentos":["..."]}`;
    try {
      const a = parseJson(await runClaude(prompt, { timeoutMin: 8, log: console.log, memory: false }));
      const cur = await M.readJson(sb, C.RULES, doc);
      cur.analisis = Object.assign({ at: new Date().toISOString() }, a);
      await M.writeJson(sb, C.RULES, cur);
      console.log('\nANÁLISIS DE CLAUDE (solo opina, no cambia reglas):\n  ' + (a.resumen || ''));
      for (const h of a.hipotesis || []) console.log('  · hipótesis: ' + h);
      for (const h of a.confusiones || []) console.log('  · se confunden: ' + h);
    } catch (e) { console.log('Análisis de Claude no disponible (' + String(e.message).slice(0, 120) + ') — las reglas igual quedaron calculadas.'); }
  }
  console.log('\nLISTO 🧠');
})().catch((e) => { console.log('ERROR:', e.message); process.exit(1); });
