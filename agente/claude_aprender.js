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
  // 🧠 oct-14 · OBJECIONES (regla de Franklin): una regla nueva suya queda "evaluando"; aquí el cerebro la revisa contra la
  // evidencia, el maestro LTX-SAFE y las reglas que ya existen. Si no está de acuerdo, NO la activa: deja una objeción en el
  // Dashboard con el porqué y la mejor solución (Franklin decide: hazlo igual / usa la propuesta / tienes razón).
  const C = require(path.join(ROOT, 'netlify', 'functions', '_cerebro'));
  {
    const memE = await M.readJson(sb, 'reglas.json', { rules: [] });
    const pend = (memE.rules || []).filter((r) => r.estado === 'evaluando');
    if (pend.length) {
      const doc = await C.loadRules(sb).catch(() => null);
      const ev = doc && doc.patterns ? doc.patterns.filter((p) => p.n >= 8).slice(0, 25).map((p) => `${p.label}: falla ${Math.round(p.rate * 100)} % en ${p.n} tomas (${p.lift.toFixed(1)}× el promedio ${Math.round((doc.base || 0) * 100)} %) [${p.state}]`).join('\n') : '(sin datos)';
      const activas = (memE.rules || []).filter((r) => !r.estado).map((r) => '- ' + r.regla).join('\n');
      const prompt = `Eres el director experto de VYRALES (documentales con IA: imagen con Flow, video con LTX-2.5 cfg=1). Franklin, el dueño, propone reglas nuevas. Él mismo pidió: "si no estás de acuerdo porque no funcionaría o contradice lo que ya tenemos, tienes toda la libertad de decirme que no y explicarme por qué y cuál sería la mejor solución; yo puedo cometer errores y tú eres el experto".
Juzga cada regla con EVIDENCIA, no por cortesía. Objeta solo si (a) contradice la evidencia de abajo, (b) contradice una regla vigente o el maestro LTX-SAFE, o (c) es técnicamente mala para LTX. Si es buena o no hay datos en contra, ACÉPTALA. Si objetas, propón una versión mejor de la regla.

EVIDENCIA DEL CEREBRO (primeros intentos):
${ev}

MAESTRO LTX-SAFE:
${require(path.join(ROOT, 'netlify', 'functions', '_ltx_safe')).LTX_SAFE}

REGLAS VIGENTES:
${activas}

REGLAS NUEVAS DE FRANKLIN A JUZGAR:
${pend.map((r, i) => (i + 1) + '. ' + r.regla).join('\n')}

Responde SOLO este JSON: {"veredictos":[{"n":1,"veredicto":"acepto|objeto","razon":"1-3 frases claras, con datos si hay","propuesta":"regla mejorada (solo si objetas)"}]}`;
      try {
        const out = parseJson(await runClaude(prompt, { timeoutMin: 6, log: console.log, memory: false }));
        const vs = out.veredictos || [];
        const rules = (memE.rules || []).slice();
        for (let k = 0; k < pend.length; k++) {
          const v = vs.find((x) => Number(x.n) === k + 1) || { veredicto: 'acepto' };
          const i = rules.findIndex((r) => r.regla === pend[k].regla && r.estado === 'evaluando');
          if (i < 0) continue;
          if (v.veredicto === 'objeto') {
            rules[i] = Object.assign({}, rules[i], { estado: 'en_disputa' });
            await C.addObjecion(sb, { tipo: 'regla', regla: pend[k].regla, pedido: 'Regla nueva: ' + pend[k].regla, resumen: String(v.razon || '').slice(0, 600), propuesta: v.propuesta ? 'Mejor así: ' + v.propuesta : '', propuesta_regla: v.propuesta || '' });
            console.log('🧠 OBJETO la regla de Franklin: ' + pend[k].regla.slice(0, 90) + '\n   porque: ' + String(v.razon || '').slice(0, 200));
          } else { const r = Object.assign({}, rules[i]); delete r.estado; rules[i] = r; console.log('🧠 acepto la regla: ' + pend[k].regla.slice(0, 90)); }
        }
        await M.writeJson(sb, 'reglas.json', Object.assign({}, memE, { rules, updated_at: new Date().toISOString() }));
      } catch (e) { console.log('No pude evaluar las reglas nuevas (' + String(e.message).slice(0, 120) + ') → quedan "evaluando" hasta la próxima vez.'); }
    }
  }
  // 🧠 oct-14: las fallas/arreglos del QA ("qa_falla", "qa_arreglo") ya NO se vuelven reglas por sí solas: eran casos
  // sueltos. Ahora las aprende el CEREBRO (_cerebro.js) con estadística. Aquí solo se consolidan las correcciones
  // de Franklin (el dueño). Las del QA se marcan como procesadas para que no se acumulen.
  const isQa = (l) => /^qa_/.test(String(l.source || ''));
  const qaFresh = lessons.filter((l) => !l.consolidated && isQa(l));
  if (qaFresh.length) {
    const ids0 = new Set(qaFresh.map((l) => l.at + '|' + (l.toma || '')));
    await M.writeJson(sb, 'lecciones.json', lessons.map((l) => (ids0.has(l.at + '|' + (l.toma || '')) ? Object.assign({}, l, { consolidated: true, por: 'cerebro' }) : l)));
    console.log(`${qaFresh.length} lección(es) del QA → las maneja el cerebro con evidencia (no se vuelven reglas sueltas).`);
  }
  const fresh = lessons.filter((l) => !l.consolidated && !isQa(l));
  if (!fresh.length) { console.log('No hay correcciones nuevas de Franklin.'); return; }
  const cur0 = await M.readJson(sb, 'reglas.json', { rules: [], updated_at: null });
  const fijas = (cur0.rules || []).filter((r) => r.estado || r.forzada); // no las reescribe Claude
  const cur = Object.assign({}, cur0, { rules: (cur0.rules || []).filter((r) => !r.estado && !r.forzada) });
  console.log(`Aprendiendo de ${fresh.length} lección(es) nuevas; reglas actuales: ${(cur.rules || []).length}`);
  const prompt = `Eres el director profesional de VYRALES: documentales narrados hechos con IA (guion con Claude, imágenes con Google Flow, video con LTX-2.5 que parte de la imagen y HACE todo lo que lee porque usa cfg = 1).
Tu trabajo ahora: APRENDER de lo que pasó y actualizar tu memoria profesional, para que el próximo video salga perfecto sin que Franklin tenga que corregir.

Tus reglas actuales (JSON):
${JSON.stringify(cur.rules || [], null, 1)}

Correcciones nuevas de Franklin ("franklin" = corrección del dueño, manda sobre todo; "franklin_edicion" = cómo cambió él una toma a mano). Las fallas del QA NO van aquí: las aprende el cerebro con estadística.
${JSON.stringify(fresh.map((l) => { const o = Object.assign({}, l); delete o.consolidated; return o; }), null, 1)}

Devuelve la lista COMPLETA y actualizada de reglas:
- Cada regla: corta (máx. 2 frases), general (sirve para cualquier video, no solo esa toma), accionable, en español, con el porqué.
- Lo que dijo Franklin tiene prioridad; si contradice una regla vieja, reemplázala.
- Une duplicados, quita lo que ya no aplica, máximo 40 reglas, las más importantes primero.
- No cambies nunca la regla de que la narración no se toca ni la de que cada imagen muestra lo que dice su narración.
- INDEPENDENCIA (pedido de Franklin): si una corrección suya contradice la evidencia del cerebro o una regla que funciona, NO la conviertas en regla: ponla en "objeciones" con la razón y la mejor solución. Él decide después.
Responde SOLO este JSON: {"rules":[{"regla":"...","por_que":"...","origen":"franklin|qa|sistema"}],"objeciones":[{"pedido":"lo que dijo Franklin","razon":"...","propuesta":"regla mejor"}],"aprendido":"una frase con lo nuevo que aprendiste"}`;
  const out = parseJson(await runClaude(prompt, { timeoutMin: 8, log: console.log, memory: false }));
  const rules = (out.rules || []).filter((r) => r && r.regla).slice(0, 40).map((r) => ({ regla: String(r.regla).slice(0, 400), por_que: String(r.por_que || '').slice(0, 300), origen: String(r.origen || '') }));
  if (!rules.length) throw new Error('Claude no devolvió reglas.');
  for (const ob of (out.objeciones || [])) { try { await C.addObjecion(sb, { tipo: 'leccion', regla: String(ob.pedido || '').slice(0, 400), pedido: 'Corrección tuya: ' + String(ob.pedido || '').slice(0, 300), resumen: String(ob.razon || '').slice(0, 600), propuesta: ob.propuesta ? 'Mejor así: ' + ob.propuesta : '', propuesta_regla: ob.propuesta || '' }); console.log('🧠 objeción a una corrección: ' + String(ob.pedido || '').slice(0, 90)); } catch (_) {} }
  for (const fx of fijas) if (!rules.some((r) => r.regla === fx.regla)) rules.push(fx); // se conservan evaluando / en disputa / forzadas
  const history = (cur.history || []).concat([{ at: new Date().toISOString(), aprendido: String(out.aprendido || ''), lecciones: fresh.length }]).slice(-50);
  await M.writeJson(sb, 'reglas.json', { rules, updated_at: new Date().toISOString(), history });
  const ids = new Set(fresh.map((l) => l.at + '|' + (l.toma || '')));
  const latest = await M.readJson(sb, 'lecciones.json', []);
  await M.writeJson(sb, 'lecciones.json', latest.map((l) => (ids.has(l.at + '|' + (l.toma || '')) ? Object.assign({}, l, { consolidated: true }) : l)));
  console.log('Aprendido:', out.aprendido || '');
  console.log('Reglas ahora:', rules.length);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
