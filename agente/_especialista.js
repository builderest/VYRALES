// 🔧 ESPECIALISTA DE REPARACIÓN (Franklin oct-14): "el 2º intento salía PEOR que el 1º; tiene que tener memoria, saber
// por qué y dónde falló, y decidir con precisión para no cometer el mismo error dos veces".
// Usa: la BITÁCORA de la toma (sh.qa.attempts: qué se probó y qué pasó) + el CEREBRO (patrones con evidencia).
// Decide UNA de estas jugadas (y lo anota en el diario del cerebro):
//   azar        → toma limpia, 1ª reparación y SOLO faltó movimiento: mismo prompt, MISMA imagen, otra semilla.
//   patron      → la toma tiene patrones que fallan más que el promedio: se corrige ESO (y nada más).
//   estructura  → tiene patrones que casi nunca se arreglan reintentando: cambio de estructura (imagen nueva sin ese
//                 elemento, partir la toma o solo cámara), no un retoque.
//   nuevo       → no hay patrón conocido: el cambio más pequeño que elimine el fallo concreto.
//   seguro      → ya fallaron 2 reparaciones: versión mínima (un sujeto, un movimiento grande, fondo simple).
//   humano      → la evidencia dice que seguir reintentando es tiempo perdido: se deja marcada para Franklin.
//   no_fiable   → el QA marcó algo en lo que el juez NO es fiable (según tus aprobaciones): no se rehace, se marca.
// Nunca repite un enfoque ya probado y, al final, el QA se queda con el MEJOR intento (nunca va para atrás).
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'netlify', 'functions', '_cerebro'));

const FLAG_ES = { image_ok: 'la imagen no muestra lo que dice la narración', style_ok: 'no parece real (3D/render)', action_ok: 'no se ve la acción del sujeto', haze: 'humo/niebla de relleno', broken: 'algo se deforma, aparece o desaparece' };
function failing(v) { return Object.keys(FLAG_ES).filter((k) => (k === 'haze' || k === 'broken') ? v[k] === true : v[k] === false); }
// Puntaje de un intento: más bajo = mejor. 0 = perfecto.
function score(v) { return v ? (v.image_ok === false ? 3 : 0) + (v.style_ok === false ? 3 : 0) + (v.broken === true ? 3 : 0) + (v.action_ok === false ? 2 : 0) + (v.haze === true ? 1 : 0) : 99; }
const JUDGE_KEY = { image_ok: 'i', style_ok: 's', action_ok: 'a', haze: 'h', broken: 'b' };

function decide({ sh, verdict, attempts = [], doc = null, freeFrame = true, keepImage = false }) {
  const keys = new Set(C.keysOf(C.featuresOf(sh)));
  const pats = (doc && doc.patterns) || [];
  const present = pats.filter((p) => keys.has(p.key));
  const activas = present.filter((p) => p.state === 'activa');
  // Sospechosos: no son regla para el guionista (falta evidencia), pero para reparar ESTA toma son la mejor pista.
  const sospechosos = present.filter((p) => p.state !== 'activa' && p.state !== 'funciona' && p.n >= C.MIN_N && p.lift >= 1.3 && (C.INFO[p.key]));
  const duros = present.filter((p) => p.reintento && p.reintento.n >= C.MIN_N && p.reintento.util < 0.25 && C.INFO[p.key]);
  const fallas = failing(verdict || {});
  const reparaciones = attempts.filter((a) => a.mode).length; // intentos de REPARACIÓN ya hechos (no cuenta el original)
  const imgBad = !!(verdict && (verdict.image_ok === false || verdict.style_ok === false));
  const canNewImage = freeFrame && !keepImage;
  // ¿El juez es fiable en lo que marcó? Solo si la métrica es usable (evidencia de los dos lados).
  const judge = (doc && doc.judge) || {};
  const dudosas = fallas.filter((f) => { const j = judge[JUDGE_KEY[f]]; return j && j.usable && j.fiabilidad != null && j.fiabilidad < 0.5; });
  const out = { fallas, activas: activas.map((p) => p.key), sospechosos: sospechosos.map((p) => p.key), duros: duros.map((p) => p.key) };

  // oct-16: la "fiabilidad" se calculó con el juez VIEJO, que marcaba detalles menores (fondo, gestos) que Franklin aprobaba.
  // Ahora el juez separa lo menor (minor: true → se acepta solo). Si dice explícitamente minor: false, es un problema real
  // (cambia de lugar, se deforma el sujeto, se va a negro) y SÍ se rehace.
  if (fallas.length && dudosas.length === fallas.length && !(verdict && verdict.minor === false)) return Object.assign(out, { mode: 'no_fiable', rewrite: false, regen: false, newFrame: false, why: 'el QA marcó ' + fallas.join(', ') + ' y en eso el juez no es fiable según tus aprobaciones' });
  // Ya se intentó una reparación de estructura/patrón y siguió con lo mismo, y la evidencia dice que reintentar no sirve.
  const last = attempts.filter((a) => a.mode).slice(-1)[0];
  if (duros.length && last && (last.mode === 'estructura' || last.mode === 'seguro') && score(verdict) > 0) return Object.assign(out, { mode: 'humano', rewrite: false, regen: false, newFrame: false, why: 'reintentar "' + duros.map((p) => p.label).join(', ') + '" casi nunca funciona (' + duros.map((p) => Math.round(p.reintento.util * 100) + ' %').join(', ') + ' de éxito) y ya se probó un cambio de estructura' });
  if (reparaciones >= 2) return Object.assign(out, { mode: 'seguro', rewrite: true, regen: true, newFrame: canNewImage, why: '2 reparaciones sin éxito → versión mínima y segura' });
  if (duros.length) return Object.assign(out, { mode: 'estructura', rewrite: true, regen: true, newFrame: canNewImage, why: 'tiene "' + duros.map((p) => p.label).join(', ') + '": reintentar con un retoque casi nunca lo arregla → cambio de estructura' });
  if (activas.length || sospechosos.length) {
    const enImagen = activas.concat(sospechosos).some((p) => p.en_imagen);
    return Object.assign(out, { mode: 'patron', rewrite: true, regen: true, newFrame: canNewImage && (imgBad || enImagen), why: 'patrones con evidencia: ' + activas.concat(sospechosos).map((p) => p.label + ' (' + Math.round(p.rate * 100) + ' %)').join(', ') });
  }
  // Azar SOLO si lo único que falló es que no se vio el movimiento: una deformación (algo se rompe, aparece o desaparece)
  // casi nunca es azar, la causa está en el contenido → va a corrección mínima apuntando a lo que se rompió.
  if (!reparaciones && fallas.length && fallas.every((f) => f === 'action_ok')) return Object.assign(out, { mode: 'azar', rewrite: false, regen: true, newFrame: false, why: 'toma limpia (ningún patrón de riesgo) y solo faltó movimiento: probablemente el azar de LTX → misma imagen y prompt, otra semilla' });
  return Object.assign(out, { mode: 'nuevo', rewrite: true, regen: true, newFrame: canNewImage && imgBad, why: 'sin patrón conocido → el cambio más pequeño que elimine: ' + fallas.map((f) => FLAG_ES[f]).join('; ') });
}

// Texto extra para el reparador (rewriteShot): bitácora + lo que dice el cerebro + la jugada elegida.
function instructions(dec, attempts, doc) {
  const by = Object.fromEntries(((doc && doc.patterns) || []).map((p) => [p.key, p]));
  const L = [];
  L.push('=== ESPECIALISTA DE REPARACIÓN (memoria de esta toma) ===');
  const hist = attempts.filter((a) => a.verdict);
  if (hist.length) {
    L.push('INTENTOS ANTERIORES DE ESTA TOMA (NO repitas ninguno de estos enfoques; cada uno ya falló):');
    hist.forEach((a) => L.push(`- Intento ${a.try}${a.mode ? ' (' + a.mode + ')' : ' (original)'}: cámara "${(a.prompt && a.prompt.camera) || ''}" · acción "${String((a.prompt && a.prompt.action_en) || '').slice(0, 160)}"${a.newFrame ? ' · imagen nueva' : ''} → ${a.verdict && score(a.verdict) === 0 ? 'bien' : 'falló: ' + (a.reason || failing(a.verdict).map((f) => FLAG_ES[f]).join('; '))}`));
  }
  const fix = (k) => by[k] && C.INFO[k] ? `- ${C.INFO[k].label}: falla ${Math.round(by[k].rate * 100)} % en ${by[k].n} tomas → ${C.INFO[k].arreglo}` : '';
  if (dec.activas.length || dec.sospechosos.length) { L.push('LO QUE DICE LA EVIDENCIA SOBRE ESTA TOMA (corrige justo esto):'); dec.activas.concat(dec.sospechosos).forEach((k) => { const t = fix(k); if (t) L.push(t); }); }
  if (dec.duros.length) { L.push('ESTO CASI NUNCA SE ARREGLA CON UN RETOQUE (hay que QUITARLO de la toma o partirla):'); dec.duros.forEach((k) => { const t = fix(k); if (t) L.push(t + ` (reintentos que funcionaron: ${Math.round(by[k].reintento.util * 100)} %)`); }); }
  const jug = {
    patron: 'JUGADA: corrige SOLO los patrones de arriba; deja igual todo lo que no tiene que ver.',
    estructura: 'JUGADA: cambio de ESTRUCTURA: quita de la imagen y de la acción el elemento difícil (o parte la toma, o hazla de solo cámara si el sujeto es un objeto). Un retoque del mismo enfoque NO sirve.',
    nuevo: 'JUGADA: el cambio MÁS PEQUEÑO que elimine el fallo concreto. No reinventes la toma.',
    seguro: 'JUGADA: VERSIÓN MÍNIMA Y SEGURA: un solo sujeto grande y claro, UN movimiento grande y simple, cámara "slow lateral drift", fondo simple de 2 elementos, nada pequeño ni frágil, sin otras personas. Mejor simple y bien que ambicioso y roto.'
  }[dec.mode];
  if (jug) L.push(jug);
  return L.join('\n');
}

module.exports = { decide, instructions, score, failing, FLAG_ES };
