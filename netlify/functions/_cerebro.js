// 🧠 CEREBRO DE VYRALES (Franklin oct-14): aprende CON EVIDENCIA, no con anécdotas.
// "Que no se lleve solo de lo que le digan sino de lo que funciona: si algo salió bien muchas veces y mal una sola
//  vez, no tiene que coger ese consejo." → Las REGLAS las deciden los NÚMEROS (casos, tasa de falla vs la base,
//  intervalo de confianza). Claude puede opinar en un análisis aparte, pero su opinión NO cambia ninguna regla.
//
// Archivos (Supabase Storage, misma carpeta que la memoria del canal — ver _memoria.js):
//   cerebro_evidencia.json  → cada veredicto (QA o Franklin) con los rasgos de la toma. Nada se borra (tope 8000).
//   cerebro_reglas.json     → estado de cada patrón (activa / funciona / observación / degradada) + estadísticas.
//   cerebro_diario.json     → lo que decidió el especialista en cada reparación (para verlo en el panel).
//
// Fases: F1 rasgos + evidencia · F2 patrones con umbrales · (F3 especialista en agente/_especialista.js) · F4 cerebroBlock.
const M = require('./_memoria');

const EVID = 'cerebro_evidencia.json';
const RULES = 'cerebro_reglas.json';
const DIARY = 'cerebro_diario.json';
const OBJ = 'cerebro_objeciones.json'; // cuando el cerebro NO está de acuerdo con un cambio de Franklin
const MIN_N = 8;            // mínimo de casos para que un patrón cuente (una falla suelta NUNCA cambia nada)
const PROMOTE_LIFT = 1.5;   // falla ≥ 1.5× la base (y su intervalo de confianza por encima de la base, en ≥ 2 episodios) → regla activa
const DEMOTE_LIFT = 1.2;    // una regla activa que baja de 1.2× la base → degradada (histéresis: no oscila)
const GOOD_RATIO = 0.6;     // falla ≤ 60 % de la base (y el intervalo por debajo de la base) → "funciona"
const FRANKLIN_W = 3;       // un veredicto de Franklin pesa como 3 del QA
const MIN_EPS = 2;          // el patrón tiene que repetirse en ≥ 2 episodios distintos (no es cosa de UN episodio)
const MIN_ACUERDOS = 3;     // fiabilidad del juez: hace falta ver también cuando Franklin COINCIDE con el QA (sus ✗)

// ───────────────────────── F1 · RASGOS DE UNA TOMA (sin IA, determinista, $0) ─────────────────────────
const low = (s) => String(s || '').toLowerCase();
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const lineOf = (sh) => String(sh.voice_part || (Array.isArray(sh.dialogue) ? sh.dialogue : sh.dialogue ? [sh.dialogue] : []).map((d) => d && d.line).filter(Boolean).join(' ')).trim();
const NUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, several: 4, many: 6, dozens: 20, dozen: 12, hundreds: 100, thousands: 1000 };
const PEOPLE_PL = 'men|women|people|persons|soldiers|scientists|engineers|pilots|workers|guards|officers|delegates|leaders|children|boys|girls|figures|physicists|technicians|villagers|prisoners|sailors|miners|students|officials|generals|agents|police|policemen|journalists|doctors|nurses|farmers|hunters|survivors|refugees|crew members|spectators';
const PEOPLE_SG = /\b(man|woman|person|soldier|scientist|engineer|pilot|worker|guard|officer|delegate|leader|boy|girl|child|figure|physicist|technician|prisoner|sailor|miner|official|general|agent|policeman|journalist|doctor|nurse|farmer|hunter|survivor|narco|drug lord|inmate)\b/g;

function peopleBucket(all) {
  if (/\b(crowd|crowds|audience|rows of (?:people|men|soldiers|delegates)|army|spectators|hall full|packed hall|mob|masses)\b/.test(all)) return 'p4mas';
  let max = 0;
  const re = new RegExp('\\b(two|three|four|five|six|seven|eight|nine|ten|twelve|several|many|dozens|dozen|hundreds|thousands|\\d+)\\s+(?:[a-z-]+\\s+){0,3}(' + PEOPLE_PL + ')\\b', 'g');
  for (const m of all.matchAll(re)) { const v = NUM[m[1]] || Number(m[1]) || 0; if (v > max) max = v; }
  if (max >= 4) return 'p4mas';
  if (max >= 2 || /\b(both|pair of|couple of|two of them)\b/.test(all)) return 'p2_3';
  if (new RegExp('\\b(' + PEOPLE_PL + ')\\b').test(all)) return 'p2_3';
  const sg = new Set((all.match(PEOPLE_SG) || []));
  if (sg.size >= 2) return 'p2_3';
  return sg.size ? 'p1' : 'p0';
}

function featuresOf(sh) {
  const cam = low(sh.camera), act = low(sh.action_en), img = low(sh.start_en), all = img + ' ' + act;
  const narr = low(lineOf(sh));
  const hazeNarr = /humo|niebla|neblina|polvo|vapor|fuego|incendi|explo|tormenta|ceniza|nube|bruma|erupci/.test(narr);
  const acerca = /push[- ]?in|dolly|zoom|pull[- ]?(?:back|out)|crane|\brises?\b|rising|\bboom\b/.test(cam);
  const sigue = /track|follow|alongside|orbit|arc(?:s|ing)?\s+around|\bfpv\b|drone|fly/.test(cam);
  const fuerte = /\b(walk|walks|walking|run|runs|stride|strides|steps|falls|fall|rolls|rises|climbs|pushes|pulls|turns|kneels|lifts|swings|waves|billows|explodes|charges|drives|marches|collapses|crashes|surges|races|digs|throws|bends)\b/.test(act);
  return {
    cam_acerca: acerca,
    cam_sigue: sigue,
    cam_lateral: !acerca && !sigue && /drift|lateral|\bpan\b|truck|sway/.test(cam),
    multi_accion: /\bwhile\b|\bmeanwhile\b|\bthe other\b|\bas (?:the|his|her) (?:others?|second|rest)\b|,\s*and the (?!camera)/.test(act),
    personas: peopleBucket(all),
    multitud: /\b(crowd|crowds|audience|delegates|rows of|dozens|hundreds|thousands|army|spectators|hall full|mob)\b/.test(all),
    objeto_fragil: /\b(paper|papers|letter|letters|document|documents|map|maps|globe|seal|seals|rope|ropes|wire|wires|cable|cables|book|books|screen|screens|television|televisions|tv|monitor|monitors|clock|sign|banner|poster|chart|blueprint|blueprints|drafting|switch|switches|gauge|gauges|dial|dials|newspaper|pen|telephone|phone|folder|envelope|notebook)\b/.test(all),
    texto: /\b(text|lettering|writing|written|label|headline|newspaper|inscription|sign reads|words on)\b/.test(all),
    humo_relleno: !hazeNarr && /\b(haze|hazy|mist|misty|fog|foggy|smoke|smoky|dust|steam)\b/.test(all),
    fondo_recargado: /\b(dome|domes|tower|towers|balcony|balconies|columns|colonnade|skyline|cathedral|palace|rows of windows|chandelier|chandeliers|ornate)\b/.test(img),
    accion_larga: words(sh.action_en) > 40,
    gesto_fino: /\b(finger|fingers|signs the|signing|writes|writing|types|typing|flips|presses|turns the dial|hand pushes|slides the|passes the|hands over|taps)\b/.test(act),
    sujeto_sale: /\b(out of (?:the )?frame|exits|leaves the frame|walks away|disappears|enters the frame|into (?:the )?frame|off-screen)\b/.test(act),
    movimiento_sutil: !fuerte && /\b(slightly|subtle|subtly|gently|breathes|blinks|stares|looks at|gazes|watches|glances)\b/.test(act),
    personaje_fijo: Array.isArray(sh.characters) && sh.characters.length > 0,
    plano_cerrado: /close[- ]?up|macro|\b85mm|\b100mm/.test(img + ' ' + cam),
    plano_abierto: /wide shot|extreme wide|aerial|establishing|\b24mm|\b16mm|\b14mm/.test(img),
    explosion_fx: /explo|blast|fireball|mushroom cloud|detonat|shockwave/.test(all),
    // Vehículo que SE DESPLAZA en la toma (un bote como escenario no cuenta): sustantivo + verbo de desplazamiento.
    vehiculo: /\b(plane|planes|bomber|bombers|aircraft|jet|jets|car|cars|truck|trucks|sedan|train|ship|ships|boat|boats|tank|tanks|helicopter|rocket|missile|vehicle|convoy)\b[^.;]{0,70}\b(drives?|driving|rolls?|rolling|flies|flying|fly|soars?|takes? off|lands?|landing|speeds?|races?|sails?|sailing|moves? (?:forward|along|across|toward|away)|glides?|gliding|taxis?|cruises?|climbs?|dives?|launch(?:es)?|streaks?|advances?|pulls? (?:away|out|in))\b/.test(act),
    solo_camara: !!sh.camera_only
  };
}

// Qué significa cada patrón y qué hacer (para el guionista, el reparador y el panel).
const INFO = {
  'cam_acerca=true': { label: 'Cámara que se acerca o se aleja (push-in, zoom, grúa)', regla: 'No uses cámaras que se acerquen o se alejen (push-in, dolly, zoom, crane, pull-back).', arreglo: 'Cambia la cámara por "slow lateral drift to the left/right" y pon el movimiento en el sujeto.', en_imagen: false },
  'cam_sigue=true': { label: 'Cámara que sigue o rodea al sujeto (tracking, órbita, dron)', regla: 'No uses cámaras de seguimiento, órbita, dron o FPV.', arreglo: 'Cámara "slow lateral drift" corta; el sujeto se mueve poco y queda dentro del cuadro.', en_imagen: false },
  'multi_accion=true': { label: 'Varias acciones distintas en una toma ("while…", "the other…")', regla: 'Una toma = un sujeto con UNA acción; nunca dos personas o grupos haciendo cosas distintas.', arreglo: 'Deja UN solo sujeto con UNA acción; lo demás queda de fondo sin acción propia, o parte la toma.', en_imagen: false },
  'personas=p4mas': { label: '4 o más personas en la toma', regla: 'Máximo 3 personas visibles; LTX cambia el número de personas y deforma grupos grandes.', arreglo: 'Reduce a 1–3 personas en la imagen (nueva imagen) haciendo el mismo movimiento.', en_imagen: true },
  'personas=p2_3': { label: '2 o 3 personas en la toma', regla: 'Con 2–3 personas, que hagan exactamente el mismo movimiento juntas.', arreglo: 'Que todas hagan la MISMA acción, o deja una sola persona.', en_imagen: true },
  'multitud=true': { label: 'Multitudes (delegados, público, filas de soldados)', regla: 'Multitudes solo lejanas y pequeñas; lo que se mueve es la luz o una bandera, nunca la gente.', arreglo: 'Plano general con la multitud lejana y quieta; que se mueva una bandera, el humo de la narración o la cámara lateral.', en_imagen: true },
  'objeto_fragil=true': { label: 'Objetos frágiles (papel, mapa, pantalla, cuerda, reloj…)', regla: 'Sin papeles, mapas, globos, pantallas, relojes, cuerdas ni cables: LTX los deforma o los hace desaparecer.', arreglo: 'Quita el objeto frágil de la imagen y de la acción; si la narración trata de él, grande, central y rígido con solo cámara.', en_imagen: true },
  'texto=true': { label: 'Texto o letras en la escena', regla: 'Nada con letras: LTX inventa texto.', arreglo: 'Quita letreros, pantallas con letras y periódicos.', en_imagen: true },
  'humo_relleno=true': { label: 'Humo, niebla o polvo que la narración no pide', regla: 'Aire limpio: humo/niebla/polvo solo si la narración los nombra.', arreglo: 'Quita humo, niebla y polvo de la imagen y de la acción.', en_imagen: true },
  'fondo_recargado=true': { label: 'Fondo recargado (cúpulas, torres, palcos, columnas)', regla: 'Fondo simple de 2–3 elementos grandes; nada de arquitectura recargada.', arreglo: 'Simplifica el fondo (pared lisa, cielo, pinos) en una imagen nueva.', en_imagen: true },
  'accion_larga=true': { label: 'Acción detallada (más de 40 palabras)', regla: 'Acción detallada y concreta sobre UN sujeto.', arreglo: 'Describe con detalle concreto qué se mueve y hacia dónde.', en_imagen: false },
  'gesto_fino=true': { label: 'Gestos finos (dedos, firmar, pasar papeles, interruptores)', regla: 'Acciones de cuerpo entero, nunca gestos finos con los dedos o las manos.', arreglo: 'Cambia el gesto por un movimiento grande (se inclina, gira, camina 2 pasos).', en_imagen: false },
  'sujeto_sale=true': { label: 'El sujeto sale o entra del cuadro', regla: 'El sujeto queda entero dentro del cuadro todo el clip.', arreglo: 'Que se mueva poco y dentro del cuadro (2–3 pasos, de lado).', en_imagen: false },
  'vehiculo=true': { label: 'Vehículo que se desplaza (avión, carro, barco, tren)', regla: 'Evita que un vehículo se desplace por la toma: LTX lo deforma o lo hace girar raro.', arreglo: 'Vehículo detenido o lejano con cámara lateral, o un detalle cercano que se mueve (hélice que gira, rueda, humo del escape si la narración lo pide).', en_imagen: false },
  'explosion_fx=true': { label: 'Explosión, bola de fuego u onda expansiva', regla: 'Explosiones: plano general lejano de la nube creciendo, sin gente ni edificios pequeños delante.', arreglo: 'Plano general fijo y lejano de la nube que crece (billows, swells and expands), sin elementos pequeños alrededor.', en_imagen: true },
  'movimiento_sutil=true': { label: 'Movimiento demasiado sutil (mira, respira, levemente)', regla: 'El movimiento tiene que verse: grande y claro.', arreglo: 'Dale una acción física clara y visible al sujeto.', en_imagen: false }
};
const labelOf = (key) => (INFO[key] && INFO[key].label) || key.replace('=true', '').replace(/_/g, ' ');
function keysOf(f) { return Object.entries(f || {}).filter(([, v]) => v !== false && v != null && v !== '').map(([k, v]) => k + '=' + (v === true ? 'true' : v)); }

// Veredicto → banderas compactas. ok = sin ningún problema.
function verdictFlags(v) {
  const fl = { i: v.image_ok === false, s: v.style_ok === false, a: v.action_ok === false, h: v.haze === true, b: v.broken === true };
  return { fl, ok: !(fl.i || fl.s || fl.a || fl.h || fl.b) };
}

// ───────────────────────── F1 · REGISTRO DE EVIDENCIA ─────────────────────────
// obs: { ep, n, clip, try, src: 'qa'|'franklin', verdict:{image_ok,…} | ok, reason, shot }
function makeObs(o) {
  const sh = o.shot || {};
  const { fl, ok } = o.verdict ? verdictFlags(o.verdict) : { fl: o.fl || {}, ok: !!o.ok };
  return {
    k: [o.ep, o.n, o.clip || '', o.src || 'qa', o.try || 0, o.tag || ''].join('|'),
    at: o.at || new Date().toISOString(), ep: o.ep, n: o.n, clip: o.clip || null, try: o.try || 0,
    src: o.src || 'qa', ok, fl, r: String(o.reason || '').slice(0, 220),
    f: featuresOf(sh), cam: String(sh.camera || '').slice(0, 90), act: String(sh.action_en || '').slice(0, 160),
    forz: !!sh.franklin_forzado // Franklin lo hizo igual aunque el cerebro objetó → experimento: ¿quién tenía razón?
  };
}
async function recordMany(sb, list) {
  if (!list || !list.length) return 0;
  const ev = await M.readJson(sb, EVID, []);
  const seen = new Set(ev.map((e) => e.k));
  let added = 0;
  for (const o of list) { const x = makeObs(o); if (seen.has(x.k)) continue; seen.add(x.k); ev.push(x); added++; }
  if (added) await M.writeJson(sb, EVID, ev.slice(-8000));
  return added;
}
const recordVerdict = (sb, o) => recordMany(sb, [o]);

// Lee la base: veredictos del QA guardados en cada toma (shots[].qa) + señales de Franklin (aprobó el clip / lo marcó mal).
async function syncFromDb(sb, { log = () => {}, seriesIds = null, reset = false } = {}) {
  let q = sb.from('episodes').select('id, series_id, shots, assets(id, kind, shot_number, approved, approved_at, updated_at)');
  if (seriesIds && seriesIds.length) q = q.in('series_id', seriesIds);
  const { data: eps, error } = await q;
  if (error) throw new Error(error.message);
  const list = [];
  for (const ep of eps || []) {
    // Aprobaciones MASIVAS ("aprobar todas" antes de publicar: EP 11 = 121 clips en 3 minutos) NO son una revisión toma
    // por toma → no cuentan como opinión de Franklin. Solo cuenta la aprobación individual (≤ 2 clips en ese minuto).
    const perMin = {};
    for (const a of ep.assets || []) if (a.kind === 'video_clip' && a.approved && a.approved_at) { const m = String(a.approved_at).slice(0, 16); perMin[m] = (perMin[m] || 0) + 1; }
    const individual = (a) => !!(a && a.approved && a.approved_at && perMin[String(a.approved_at).slice(0, 16)] <= 2);
    for (const sh of ep.shots || []) {
      const qa = sh.qa; if (!qa) continue;
      const clip = (ep.assets || []).find((a) => a.id === qa.clip_id);
      // Intentos guardados por el especialista (F3): cada uno es un caso.
      for (const at of (qa.attempts || [])) if (at && at.verdict) list.push({ ep: ep.id, n: sh.n, clip: at.clip || null, try: at.try || 0, src: 'qa', verdict: at.verdict, reason: at.reason, shot: Object.assign({}, sh, at.prompt || {}), at: at.at, tag: 'att' });
      // Toma reintentada UNA vez: su prompt original está en qa_rewrite_from y su primer intento FALLÓ (por eso se
      // reintentó) → se recupera como caso de primer intento, sin el sesgo de los reintentos.
      if (Number(qa.tries) === 1 && sh.qa_rewrite_from && !(qa.attempts || []).length) list.push({ ep: ep.id, n: sh.n, clip: qa.clip_id, try: 0, src: 'qa', ok: false, fl: {}, reason: 'primer intento (falló y se reintentó)', shot: Object.assign({}, sh, sh.qa_rewrite_from), at: qa.at, tag: 'orig' });
      // Veredicto del QA sobre el clip actual.
      if (qa.clip_id && (qa.ok === true || qa.ok === false)) list.push({ ep: ep.id, n: sh.n, clip: qa.clip_id, try: Number(qa.tries) || 0, src: 'qa', verdict: qa, reason: qa.reason, shot: sh, at: qa.at });
      // Franklin APROBÓ este clip → vale como "bien" con peso 3, y si el QA lo había marcado mal es un falso positivo del QA.
      if (individual(clip)) list.push({ ep: ep.id, n: sh.n, clip: clip.id, try: Number(qa.tries) || 0, src: 'franklin', ok: true, fl: {}, reason: qa.ok === false ? 'Franklin aprobó lo que el QA marcó mal: ' + (qa.reason || '') : 'aprobada por Franklin', shot: sh, at: clip.approved_at, tag: qa.ok === false ? 'fp:' + Object.entries(verdictFlags(qa).fl).filter(([, v]) => v).map(([k]) => k).join('') : 'ok' });
      // Franklin la marcó mal a mano.
      if (qa.force && qa.force_reason) list.push({ ep: ep.id, n: sh.n, clip: qa.clip_id, try: Number(qa.tries) || 0, src: 'franklin', ok: false, fl: { a: true }, reason: 'Franklin: ' + qa.force_reason, shot: sh, at: qa.at, tag: 'force' });
    }
  }
  if (reset) {
    // Reconstruir desde cero (la base es la fuente: el especialista guarda cada intento en shots[].qa.attempts).
    // Se conservan solo los registros en vivo de Franklin (aprobar/rechazar UNA toma desde el panel).
    const ev = await M.readJson(sb, EVID, []);
    const live = ev.filter((e) => e.src === 'franklin' && /\|live$/.test(e.k));
    await M.writeJson(sb, EVID, live);
  }
  const added = await recordMany(sb, list);
  log(`🧠 evidencia: ${list.length} veredictos leídos de la base${reset ? ' (reconstruida desde cero)' : ''}, ${added} nuevos guardados`);
  return added;
}

// Franklin decide EN VIVO sobre UNA toma (aprobar 1 clip, o marcarla mal con ✗) → evidencia de peso ×3 al instante.
// (Las aprobaciones masivas "aprobar todas" NO pasan por aquí: no son una revisión toma por toma.)
async function franklinLive(sb, { episodeId, shotNumber, clipId, ok, reason = '' }) {
  try {
    const { data: ep } = await sb.from('episodes').select('id, shots').eq('id', episodeId).single();
    const sh = ((ep && ep.shots) || []).find((x) => x.n === shotNumber) || {};
    const tries = Number((sh.qa || {}).tries) || 0;
    return await recordMany(sb, [{ ep: episodeId, n: shotNumber, clip: clipId, try: tries, src: 'franklin', ok: !!ok, fl: ok ? {} : { a: true }, reason: (ok ? 'Franklin aprobó esta toma' : 'Franklin la marcó mal: ') + (ok ? '' : reason), shot: sh, tag: 'live' }]);
  } catch (_) { return 0; }
}

// ───────────────────────── F2 · MOTOR DE PATRONES ─────────────────────────
function wilson(p, n, z = 1.64) { // intervalo de confianza ~90 % de una proporción
  if (!n) return { lo: 0, hi: 1 };
  const d = 1 + z * z / n, c = p + z * z / (2 * n), r = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { lo: Math.max(0, (c - r) / d), hi: Math.min(1, (c + r) / d) };
}

function computeStats(ev) {
  const w = (e) => (e.src === 'franklin' ? FRANKLIN_W : 1);
  // Se cuenta el ÚLTIMO veredicto de cada (episodio, toma, clip): si Franklin opinó, manda el suyo.
  const last = new Map();
  for (const e of ev) {
    const key = e.ep + '|' + e.n + '|' + (e.clip || e.k) + '|' + (e.try || 0);
    const cur = last.get(key);
    if (!cur || (e.src === 'franklin' && cur.src !== 'franklin') || (e.src === cur.src && String(e.at) >= String(cur.at))) last.set(key, e);
  }
  const all = [...last.values()];
  // Las reglas para el guionista se calculan con PRIMEROS intentos (la meta es salir bien a la primera, y los reintentos
  // traen sesgo: el reparador les pone cámara lateral, así que "lateral" parecía mala sin serlo).
  const rows = all.filter((e) => !e.try);
  const retried = all.filter((e) => e.try > 0);
  let W = 0, WF = 0;
  for (const e of rows) { W += w(e); if (!e.ok) WF += w(e); }
  const base = W ? WF / W : 0;
  const by = {};
  for (const e of rows) for (const k of keysOf(e.f)) {
    const s = by[k] || (by[k] = { key: k, n: 0, w: 0, wf: 0, flags: { i: 0, s: 0, a: 0, h: 0, b: 0 }, eps: {} });
    s.n++; s.w += w(e); if (!e.ok) { s.wf += w(e); for (const f of Object.keys(s.flags)) if (e.fl && e.fl[f]) s.flags[f]++; }
    const pe = s.eps[e.ep] || (s.eps[e.ep] = { n: 0, w: 0, wf: 0 }); pe.n++; pe.w += w(e); if (!e.ok) pe.wf += w(e);
  }
  const patterns = Object.values(by).map((s) => {
    const rate = s.w ? s.wf / s.w : 0; const ci = wilson(rate, s.n);
    // ¿En cuántos episodios distintos se repite? (≥ 3 casos en ese episodio). Un patrón que solo aparece en UN episodio
    // puede ser cosa de ese episodio, no del patrón → no se activa (independencia ante casos aislados).
    const epList = Object.values(s.eps).filter((x) => x.n >= 3);
    const epsMal = epList.filter((x) => x.w && x.wf / x.w > base).length;
    const epsBien = epList.filter((x) => x.w && x.wf / x.w < base).length;
    // ¿Sirve REINTENTAR este patrón? (estado final de las tomas que se reintentaron y lo tienen)
    const rr = retried.filter((e) => keysOf(e.f).includes(s.key));
    const reintento = rr.length ? { n: rr.length, siguen_mal: rr.filter((e) => !e.ok).length, util: 1 - rr.filter((e) => !e.ok).length / rr.length } : null;
    return { key: s.key, label: labelOf(s.key), n: s.n, fails: Math.round(s.wf), rate, lo: ci.lo, hi: ci.hi, lift: base ? rate / base : 0, flags: s.flags, episodios: Object.keys(s.eps).length, eps_mal: epsMal, eps_bien: epsBien, reintento };
  }).sort((a, b) => b.lift - a.lift);
  const reint = retried.length ? { n: retried.length, siguen_mal: retried.filter((e) => !e.ok).length } : { n: 0, siguen_mal: 0 };
  // Fiabilidad del JUEZ (el QA visual), por bandera: de los clips que el QA marcó mal y Franklin revisó,
  // ¿cuántos aprobó él igual? (= falso positivo del QA). Así el cerebro sabe cuándo NO creerle al QA.
  const k3 = (e) => e.ep + '|' + e.n + '|' + e.clip + '|' + (e.try || 0);
  const franklinAny = new Set(ev.filter((e) => e.src === 'franklin').map(k3));
  const franklinOk = new Set(ev.filter((e) => e.src === 'franklin' && e.ok).map(k3));
  const franklinBad = new Set(ev.filter((e) => e.src === 'franklin' && !e.ok).map(k3));
  const judge = {};
  for (const f of ['i', 's', 'a', 'h', 'b']) {
    const clips = new Set(ev.filter((e) => e.src === 'qa' && !e.ok && e.fl && e.fl[f] && franklinAny.has(k3(e))).map(k3));
    const fp = [...clips].filter((c) => franklinOk.has(c)).length;
    const acuerdos = [...clips].filter((c) => franklinBad.has(c)).length;
    // Usable solo con evidencia de los DOS lados (si no, está sesgada: solo vemos cuando Franklin NO coincide).
    judge[f] = { revisadas: clips.size, falsos_positivos: fp, acuerdos, fiabilidad: clips.size ? 1 - fp / clips.size : null, usable: clips.size >= MIN_N && acuerdos >= MIN_ACUERDOS };
  }
  // Cambios que Franklin FORZÓ contra la objeción del cerebro: ¿cómo salieron? (si salen bien, el cerebro se equivocaba)
  const fz = all.filter((e) => e.forz);
  const forzados = { n: fz.length, bien: fz.filter((e) => e.ok).length };
  return { n: rows.length, base, patterns, judge, reintentos: reint, forzados };
}

// Arreglos que funcionaron: en la bitácora de una toma, qué rasgos se QUITARON entre un intento malo y el bueno.
function fixStats(ev) {
  const byShot = {};
  for (const e of ev) if (e.src === 'qa') (byShot[e.ep + '|' + e.n] = byShot[e.ep + '|' + e.n] || []).push(e);
  const out = {};
  for (const list of Object.values(byShot)) {
    list.sort((a, b) => (a.try - b.try) || String(a.at).localeCompare(String(b.at)));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i]; if (a.ok) continue;
      const ka = new Set(keysOf(a.f)), kb = new Set(keysOf(b.f));
      for (const k of ka) if (!kb.has(k)) { const s = out[k] || (out[k] = { key: k, label: labelOf(k), quitado: 0, arreglo: 0 }); s.quitado++; if (b.ok) s.arreglo++; }
    }
  }
  return Object.values(out).filter((s) => s.quitado >= 3).map((s) => Object.assign(s, { tasa: s.arreglo / s.quitado })).sort((a, b) => b.tasa - a.tasa);
}

// Decide el estado de cada patrón con HISTÉRESIS. Solo los números mandan.
function decideStates(stats, prev) {
  const old = Object.fromEntries(((prev && prev.patterns) || []).map((p) => [p.key, p]));
  const now = new Date().toISOString();
  return stats.patterns.map((p) => {
    const was = old[p.key] ? old[p.key].state : 'observacion';
    let state = 'observacion';
    if (p.n >= MIN_N) {
      if (p.lift >= PROMOTE_LIFT && p.lo > stats.base && p.eps_mal >= MIN_EPS) state = 'activa';
      else if (was === 'activa' && p.lift >= DEMOTE_LIFT && p.eps_mal >= MIN_EPS) state = 'activa'; // sigue activa hasta caer bajo 1.3×
      else if (was === 'activa' && p.lift < DEMOTE_LIFT) state = 'degradada';          // dejó de fallar más que el promedio
      else if (p.rate <= stats.base * GOOD_RATIO && p.hi < stats.base && p.eps_bien >= MIN_EPS) state = 'funciona';
      else if (was === 'degradada') state = 'degradada';
    }
    const info = INFO[p.key] || {};
    return Object.assign({}, p, { state, since: state === was && old[p.key] ? old[p.key].since : now, regla: info.regla || '', arreglo: info.arreglo || '', en_imagen: !!info.en_imagen });
  });
}

async function think(sb, { log = () => {} } = {}) {
  const ev = await M.readJson(sb, EVID, []);
  const prev = await M.readJson(sb, RULES, null);
  const stats = computeStats(ev);
  const patterns = decideStates(stats, prev);
  const fixes = fixStats(ev);
  const changes = [];
  const oldState = Object.fromEntries(((prev && prev.patterns) || []).map((p) => [p.key, p.state]));
  for (const p of patterns) if ((oldState[p.key] || 'observacion') !== p.state) changes.push({ key: p.key, label: p.label, de: oldState[p.key] || 'observacion', a: p.state, n: p.n, rate: p.rate, lift: p.lift });
  const doc = {
    updated_at: new Date().toISOString(), casos: stats.n, evidencia: ev.length, base: stats.base,
    umbrales: { MIN_N, MIN_EPS, PROMOTE_LIFT, DEMOTE_LIFT, GOOD_RATIO, FRANKLIN_W, MIN_ACUERDOS },
    patterns, judge: stats.judge, fixes, reintentos: stats.reintentos, forzados: stats.forzados, analisis: (prev && prev.analisis) || null,
    history: ((prev && prev.history) || []).concat(changes.length ? [{ at: new Date().toISOString(), cambios: changes }] : []).slice(-60)
  };
  await M.writeJson(sb, RULES, doc);
  cache = {};
  log(`🧠 pensé con ${stats.n} casos (base de falla ${(stats.base * 100).toFixed(0)} %): ${patterns.filter((p) => p.state === 'activa').length} reglas activas, ${patterns.filter((p) => p.state === 'funciona').length} patrones que funcionan` + (changes.length ? `; cambios: ${changes.map((c) => c.label + ' ' + c.de + '→' + c.a).join(' · ')}` : ''));
  return doc;
}

let cache = {};
async function loadRules(sb) {
  const c = cache.rules;
  if (c && Date.now() - c.at < 120000) return c.doc;
  const doc = await M.readJson(sb, RULES, null);
  cache.rules = { at: Date.now(), doc };
  return doc;
}

// Riesgo de una toma según lo aprendido: qué reglas activas toca.
function risksFor(sh, doc) {
  if (!doc) return [];
  const ks = new Set(keysOf(featuresOf(sh)));
  return (doc.patterns || []).filter((p) => p.state === 'activa' && ks.has(p.key));
}

async function addDiary(sb, entry) {
  try {
    const d = await M.readJson(sb, DIARY, []);
    d.push(Object.assign({ at: new Date().toISOString() }, entry));
    await M.writeJson(sb, DIARY, d.slice(-400));
  } catch (_) {}
}

// ───────────────────────── OBJECIONES: el cerebro le puede decir que NO a Franklin ─────────────────────────
// Regla de Franklin (oct-14): "si intento cambiar algo y él no está de acuerdo porque no funcionaría o contradice lo que
// ya tenemos, tiene toda la libertad de decirme que no y no hacerlo, o avisarme en el Dashboard por qué y cuál sería la
// mejor solución; yo puedo cometer errores". Salvaguarda: Franklin conserva "hazlo igual" (el cerebro también se puede
// equivocar), y lo forzado se mide como experimento (doc.forzados).
// Solo se juzga lo que el cambio AGREGA o QUITA (no lo que ya estaba):
//   'no'    → agrega un patrón con evidencia fuerte (regla ACTIVA): no se aplica hasta que Franklin confirme.
//   'aviso' → agrega algo sospechoso (en observación, n≥8, ≥1.3×) o QUITA algo que funciona: se aplica y se avisa.
function judgeChange(before, after, doc) {
  const pats = (doc && doc.patterns) || [];
  const by = Object.fromEntries(pats.map((p) => [p.key, p]));
  const kb = new Set(keysOf(featuresOf(before || {}))), ka = new Set(keysOf(featuresOf(after || {})));
  const motivos = [];
  for (const k of ka) {
    if (kb.has(k) || !INFO[k]) continue;
    const p = by[k]; if (!p) continue;
    if (p.state === 'activa') motivos.push({ tipo: 'no', key: k, label: p.label, rate: p.rate, n: p.n, lift: p.lift, eps: p.eps_mal, propuesta: INFO[k].arreglo });
    else if (p.state !== 'funciona' && p.n >= MIN_N && p.lift >= 1.3) motivos.push({ tipo: 'aviso', key: k, label: p.label, rate: p.rate, n: p.n, lift: p.lift, eps: p.eps_mal, propuesta: INFO[k].arreglo });
  }
  for (const k of kb) {
    if (ka.has(k)) continue;
    const p = by[k];
    if (p && p.state === 'funciona') motivos.push({ tipo: 'aviso', quita: true, key: k, label: p.label, rate: p.rate, n: p.n, lift: p.lift, propuesta: 'Mantén "' + p.label + '": es de lo que mejor funciona.' });
  }
  const pc = (x) => Math.round(x * 100) + ' %';
  const linea = (m) => m.quita
    ? `Tu cambio QUITA "${m.label}", que funciona: falla solo ${pc(m.rate)} en ${m.n} tomas (${m.lift.toFixed(1)}× el promedio).`
    : `Tu cambio AGREGA "${m.label}": falla ${pc(m.rate)} en ${m.n} tomas (${m.lift.toFixed(1)}× el promedio${m.tipo === 'no' ? '; comprobado en ' + m.eps + ' episodios' : '; todavía en observación'}).`;
  const nivel = motivos.some((m) => m.tipo === 'no') ? 'no' : motivos.length ? 'aviso' : 'ok';
  return { nivel, motivos, resumen: motivos.map(linea).join('\n'), propuesta: [...new Set(motivos.map((m) => m.propuesta))].join(' ') };
}

async function listObjeciones(sb) { return M.readJson(sb, OBJ, []); }
async function addObjecion(sb, o) {
  const list = await M.readJson(sb, OBJ, []);
  const id = 'obj-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  list.push(Object.assign({ id, at: new Date().toISOString(), estado: 'pendiente' }, o));
  await M.writeJson(sb, OBJ, list.slice(-300));
  return id;
}
async function setObjecion(sb, id, patch) {
  const list = await M.readJson(sb, OBJ, []);
  const i = list.findIndex((x) => x.id === id); if (i < 0) return null;
  list[i] = Object.assign({}, list[i], patch, { resuelta_at: new Date().toISOString() });
  await M.writeJson(sb, OBJ, list);
  return list[i];
}

// ───────────────────────── F4 · LO QUE SE LE DICE AL GUIONISTA / DETALLADOR / REPARADOR ─────────────────────────
const pct = (x) => Math.round(x * 100) + ' %';
async function cerebroBlock(sb) {
  const doc = await loadRules(sb);
  if (!doc || !doc.patterns) return '';
  const act = doc.patterns.filter((p) => p.state === 'activa').slice(0, 12);
  const good = doc.patterns.filter((p) => p.state === 'funciona').slice(0, 6);
  if (!act.length && !good.length) return '';
  let t = `CEREBRO DE VYRALES — LO COMPROBADO CON EVIDENCIA (${doc.casos} tomas revisadas en primer intento; falla promedio ${pct(doc.base)}).\n`;
  if (act.length) t += 'REGLAS (patrones que fallan mucho más que el promedio en varios episodios; cúmplelas desde la primera toma):\n';
  act.forEach((p, i) => { t += `${i + 1}. ${p.regla || p.label} (falla ${pct(p.rate)} en ${p.n} tomas, ${p.lift.toFixed(1)}× el promedio). Cómo: ${p.arreglo}\n`; });
  if (good.length) t += 'LO QUE SÍ FUNCIONA (falla mucho menos que el promedio; úsalo): ' + good.map((p) => `${p.label} (${pct(p.rate)} en ${p.n})`).join('; ') + '.\n';
  t += 'Una falla suelta NO es una regla: no cambies algo que funciona por un caso aislado.\n\n';
  return t;
}

module.exports = { judgeChange, listObjeciones, addObjecion, setObjecion, OBJ, franklinLive, MIN_EPS, featuresOf, keysOf, verdictFlags, recordVerdict, recordMany, syncFromDb, computeStats, fixStats, think, loadRules, risksFor, addDiary, cerebroBlock, labelOf, INFO, MIN_N, EVID, RULES, DIARY };
