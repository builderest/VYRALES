// ✈️ PRE-VUELO (Franklin oct-14: "que salga perfecto desde la primera toma"). Lo lanza el agente: node agente/preflight.js <episode_id>
// ANTES de gastar cuadros o video: el cerebro marca las tomas con patrones de riesgo (con su evidencia) y Claude ($0, tu
// plan) las corrige con el CAMBIO MÍNIMO (misma narración, mismo sujeto, mismo personaje y lugar). Lo que no tiene riesgo
// no se toca. Cada corrección queda en shot.preflight (antes → después) y en el diario del cerebro.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
process.env.VYRALES_LOCAL_RUN = '1';
const F = (n) => require(path.join(ROOT, 'netlify', 'functions', n));
const { runClaude, parseJson } = require('./_claude');
// Riesgos que el pre-vuelo corrige (la cámara que se acerca la arregla sola _king.js con safeCamera).
const RIESGOS = ['vehiculo=true', 'movimiento_sutil=true', 'objeto_fragil=true', 'multitud=true', 'personas=p4mas', 'multi_accion=true', 'fondo_recargado=true', 'texto=true', 'gesto_fino=true', 'sujeto_sale=true', 'explosion_fx=true'];

(async () => {
  const epId = process.argv[2];
  if (!/^[0-9a-f-]{36}$/i.test(epId || '')) throw new Error('Uso: node agente/preflight.js <episode_id>');
  const sb = F('_supabase').getSupabaseClient();
  const C = F('_cerebro');
  const lineOf = F('_visual_check').lineOf;
  const doc = await C.loadRules(sb);
  const by = Object.fromEntries(((doc && doc.patterns) || []).map((p) => [p.key, p]));
  const { data: ep } = await sb.from('episodes').select('id, episode_number, title, shots').eq('id', epId).single();
  const shots = ep.shots || [];
  const risky = shots.map((sh) => ({ sh, keys: C.keysOf(C.featuresOf(sh)).filter((k) => RIESGOS.includes(k)) })).filter((x) => x.keys.length && !x.sh.camera_only && !(x.sh.preflight && x.sh.preflight.at));
  console.log(`✈️ Pre-vuelo EP ${ep.episode_number} "${ep.title}": ${shots.length} tomas, ${risky.length} con riesgo → las corrijo antes de producir`);
  if (!risky.length) { console.log('LISTO: nada que corregir.'); return; }
  const LTX = F('_ltx_safe').LTX_SAFE;
  const pc = (x) => Math.round((x || 0) * 100) + ' %';
  const fixes = {};
  for (let i = 0; i < risky.length; i += 6) {
    const group = risky.slice(i, i + 6);
    const desc = group.map(({ sh, keys }) => {
      const ctxA = shots.find((x) => x.n === sh.n - 1), ctxB = shots.find((x) => x.n === sh.n + 1);
      return `TOMA ${sh.n}${(sh.characters || []).length ? ' · personaje fijo: ' + sh.characters.join(', ') : ''}${sh.location && sh.location !== 'escena' ? ' · lugar fijo: ' + sh.location : ''}
  Narración (FIJA, no se cambia): "${lineOf(sh)}"
  Contexto: antes "${ctxA ? lineOf(ctxA) : ''}" · después "${ctxB ? lineOf(ctxB) : ''}"
  Imagen actual (start_en): ${sh.start_en || ''}
  Cámara actual: ${sh.camera || ''}
  Acción actual (action_en): ${sh.action_en || ''}
  Final actual (reaction_en): ${sh.reaction_en || ''}
  RIESGOS (evidencia del cerebro):
${keys.map((k) => { const p = by[k] || {}; const I = C.INFO[k] || {}; return `   - ${I.label || k}${p.n ? ': falla ' + pc(p.rate) + ' en ' + p.n + ' tomas' : ''} → ${I.arreglo || ''}`; }).join('\n')}`;
    }).join('\n\n');
    const prompt = `Eres el director de fotografía de VYRALES (documentales: imagen con Flow, video con LTX-2.5 cfg=1). PRE-VUELO: estas tomas todavía NO se han producido. Tienen patrones que, según la evidencia, hacen que LTX falle. Corrígelas AHORA para que salgan bien a la primera.
Reglas del pre-vuelo:
- El CAMBIO MÍNIMO que quite el riesgo. No reinventes la toma. La imagen sigue mostrando EXACTAMENTE lo que dice la narración.
- Mismo sujeto, mismo personaje fijo y mismo lugar fijo (si los hay). Si la narración NECESITA el elemento riesgoso (ej. habla del carro), hazlo seguro según el arreglo (carro detenido o lejano con cámara lateral; un detalle grande que se mueve).
- start_en 45–80 palabras, action_en 25–45 palabras detallada sobre UN sujeto, reaction_en 12–25 palabras, camera: un movimiento corto que no se acerca ni se aleja.
- Si una toma en realidad no tiene el riesgo (falsa alarma), devuélvela igual y pon "sin_cambio": true.

${LTX}

TOMAS:
${desc}

Responde SOLO este JSON: {"tomas":[{"n":1,"start_en":"...","camera":"...","action_en":"...","reaction_en":"...","sin_cambio":false,"cambio":"una frase: qué cambiaste y por qué"}]}`;
    try {
      const out = parseJson(await runClaude(prompt, { timeoutMin: 10, log: () => {} }));
      for (const t of (out.tomas || [])) if (t && t.n != null) fixes[Number(t.n)] = t;
      console.log(`  corregidas ${Math.min(i + 6, risky.length)}/${risky.length}`);
    } catch (e) { console.log(`  grupo ${i / 6 + 1} falló (${String(e.message).slice(0, 140)}) → esas tomas quedan como estaban`); }
  }
  // Guardar: solo campos de prompt; la imagen se marca para rehacer si cambió start_en (aún no hay cuadros, no cuesta).
  const { data: fr } = await sb.from('episodes').select('shots').eq('id', epId).single();
  let cambiadas = 0, iguales = 0;
  const next = (fr.shots || []).map((x) => {
    const t = fixes[x.n]; if (!t) return x;
    if (t.sin_cambio || !t.action_en) { iguales++; return Object.assign({}, x, { preflight: { at: new Date().toISOString(), sin_cambio: true } }); }
    const r = risky.find((y) => y.sh.n === x.n) || { keys: [] };
    const antes = { start_en: x.start_en, camera: x.camera, action_en: x.action_en, reaction_en: x.reaction_en };
    const despues = { start_en: String(t.start_en || x.start_en).trim(), camera: String(t.camera || x.camera).trim(), action_en: String(t.action_en).trim(), reaction_en: String(t.reaction_en || x.reaction_en || '').trim() };
    cambiadas++;
    console.log(`  T${x.n} [${r.keys.map((k) => (C.INFO[k] || {}).label || k).join(', ')}] → ${String(t.cambio || '').slice(0, 160)}`);
    return Object.assign({}, x, despues, { frame_stale: despues.start_en !== x.start_en ? true : x.frame_stale, preflight: { at: new Date().toISOString(), riesgos: r.keys, cambio: String(t.cambio || '').slice(0, 300), antes } });
  });
  await sb.from('episodes').update({ shots: next }).eq('id', epId);
  // ¿Quedó algún riesgo después de corregir?
  const quedan = next.filter((x) => C.keysOf(C.featuresOf(x)).some((k) => RIESGOS.includes(k)) && !x.camera_only).map((x) => 'T' + x.n);
  await C.addDiary(sb, { ep: epId, n: 0, mode: 'preflight', why: `pre-vuelo: ${cambiadas} tomas corregidas antes de producir, ${iguales} eran falsa alarma${quedan.length ? '; quedan con riesgo: ' + quedan.join(' ') : ''}` });
  console.log(`LISTO: pre-vuelo con ${cambiadas} toma(s) corregida(s), ${iguales} sin cambio${quedan.length ? '. Siguen con algún riesgo (la narración lo exige o Claude no lo quitó): ' + quedan.join(' ') : '. Ninguna toma quedó con riesgo.'}`);
})().catch((e) => { console.log('ERROR:', e.message); process.exit(1); });
