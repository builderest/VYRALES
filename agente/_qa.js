// CONTROL DE CALIDAD AUTOMÁTICO antes de unir el video (lo usan gen_local y regen_local).
// 1) Voz continua: cada clip debe alcanzar lo que dura su parte de la voz; si no, se rehace más largo (≤15 s).
// 2) Clips congelados: ffmpeg freezedetect; si más del 40 % del clip está quieto, se rehace UNA vez.
// 3) Revisión con los OJOS de Claude (tu plan Max, $0): 3 cuadros por toma (inicio/mitad/final) contra la narración:
//    imagen que no cuadra → cuadro nuevo (Flow/FLUX, $0, solo tomas sin personajes) + video; acción que no se ve,
//    humo de relleno o algo roto → video otra vez con movimiento reforzado. UNA sola vuelta por toma (sin bucles).
// Devuelve la lista de tomas rehechas (si hay alguna, hay que volver a unir).
const path = require('path');
const { execFile } = require('child_process');
const ROOT = path.resolve(__dirname, '..');

function ff(args, timeout = 120000) {
  const ffmpeg = require(path.join(ROOT, 'node_modules', 'ffmpeg-static'));
  return new Promise((res) => execFile(ffmpeg, args, { timeout, maxBuffer: 1 << 24 }, (e, so, se) => res(String(se || ''))));
}
async function durationOf(url) {
  const se = await ff(['-i', url], 60000);
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(se);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
}
async function frozenSeconds(url) {
  const se = await ff(['-i', url, '-vf', 'freezedetect=n=0.002:d=1', '-an', '-f', 'null', '-']);
  let tot = 0;
  for (const m of se.matchAll(/freeze_duration: ([\d.]+)/g)) tot += parseFloat(m[1]);
  const open = /freeze_start: ([\d.]+)(?![\s\S]*freeze_end)/.exec(se); // congelado hasta el final
  if (open) tot += Math.max(0, (await durationOf(url)) - parseFloat(open[1]));
  return tot;
}

// Un cuadro del clip en el segundo t (JPG 1280 px: a 640 no se veían las personas pequeñas de planos abiertos, T66 Toba) → Buffer.
function grab(url, t) {
  const ffmpeg = require(path.join(ROOT, 'node_modules', 'ffmpeg-static'));
  return new Promise((res) => execFile(ffmpeg, ['-v', 'error', '-ss', String(Math.max(0, t)), '-i', url, '-frames:v', '1', '-vf', 'scale=1280:-2', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '4', '-'], { encoding: 'buffer', timeout: 60000, maxBuffer: 1 << 24 }, (e, so) => res(e || !so || !so.length ? null : so)));
}
// Movimiento medido: diferencia media entre cuadros (gris 64x36, 4 fps). Calibrado en Toba: ~1 congelado, 3–6 poco
// (a veces solo la cámara), 8–15 movimiento claro.
// center = solo el centro del cuadro (donde suele estar el sujeto): si el borde se mueve y el centro no, el sujeto está quieto.
function motionStep(url, center = false) {
  const ffmpeg = require(path.join(ROOT, 'node_modules', 'ffmpeg-static'));
  return new Promise((res) => execFile(ffmpeg, ['-v', 'error', '-i', url, '-vf', (center ? 'crop=iw/2:ih/2,' : '') + 'fps=4,scale=64:36,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer', timeout: 90000, maxBuffer: 1 << 26 }, (e, raw) => {
    if (e || !raw) return res(null);
    const N = 64 * 36, n = Math.floor(raw.length / N); if (n < 2) return res(null);
    let tot = 0; for (let k = 1; k < n; k++) { let d = 0; for (let i = 0; i < N; i++) d += Math.abs(raw[k * N + i] - raw[(k - 1) * N + i]); tot += d / N; }
    res(Math.round(tot / (n - 1) * 10) / 10);
  }));
}
const lineOf = (sh) => String(sh.voice_part || (Array.isArray(sh.dialogue) ? sh.dialogue : sh.dialogue ? [sh.dialogue] : []).map((d) => d && d.line).filter(Boolean).join(' ')).trim();

// Revisa tomas de a 4 con Claude (lee las imágenes). Devuelve { n: { image_ok, action_ok, haze, broken, reason } }.
async function visionReview(items, log, onBatch) {
  const { runClaude, parseJson, claudePath } = require('./_claude');
  if (!claudePath()) { log('QA visual: Claude no está instalado en esta PC → me la salto'); return {}; }
  const out = {};
  for (let i = 0; i < items.length; i += 3) {
    const group = items.slice(i, i + 3);
    if (onBatch) { try { await onBatch(group); } catch (_) {} }
    const files = []; const desc = [];
    for (const it of group) {
      const d = it.dur || 6;
      const fr = await Promise.all([0.15, d * 0.25, d * 0.5, d * 0.75, Math.max(0.2, d - 0.3)].map((t) => grab(it.url, t)));
      if (fr.some((b) => !b)) continue;
      fr.forEach((b, k) => files.push({ name: `t${it.sh.n}_${k + 1}.jpg`, buffer: b }));
      const mv = await motionStep(it.url);
      const mvc = await motionStep(it.url, true);
      const camOnly = it.sh.camera_only ? '\n  TOMA DE SOLO CÁMARA (pedido de Franklin): el objeto/maqueta NO debe moverse ni cambiar de forma; action_ok = true si la cámara hace su paneo; si el objeto cambia de forma, de estructura o se convierte en otra cosa → broken = true.' : '';
      desc.push(`TOMA ${it.sh.n}${camOnly}: imágenes t${it.sh.n}_1.jpg … t${it.sh.n}_5.jpg (de inicio a final, en orden).\n  Narración: "${lineOf(it.sh)}"\n  Debe mostrar: ${it.sh.start_en || it.sh.visual_es || ''}\n  Acción pedida: ${it.sh.action_en || ''}\n  Movimiento medido en píxeles: todo el cuadro ${mv == null ? '?' : mv}, solo el centro ${mvc == null ? '?' : mvc} (≈1 congelado, 3–6 poco o solo cámara, 8+ claro)`);
    }
    if (!desc.length) continue;
    const prompt = `Eres el control de calidad de un documental. Usa la herramienta Read para mirar TODAS las imágenes que se nombran abajo (están en la carpeta actual). Para cada toma compara inicio, mitad y final con la narración.

${desc.join('\n\n')}

Para cada toma decide (sé justo: marca false solo si el problema se ve claro):
- image_ok: la imagen muestra el sujeto principal que dice la narración (no otra cosa distinta).
- action_ok: SE VE la acción pedida en el sujeto principal. Sé ESTRICTO: compara la posición de 2 objetos concretos del sujeto (ej. "roca grande arriba a la izquierda") entre la imagen 1 y la 5 RESPECTO a lo que los rodea. Si solo cambia el encuadre (zoom, giro o inclinación de cámara) y los objetos siguen igual entre sí, es false. Si la imagen muestra algo que debería estar en movimiento (derrumbe, caída, explosión, corriente) y entre 1 y 5 no avanza, es false. Si el movimiento medido es menor que 6, desconfía y mira con más cuidado. Solo para acciones sutiles por naturaleza (una luz que brilla, alguien leyendo) basta con que se note algo.
  Personas PEQUEÑAS en planos abiertos (arqueólogos al fondo, un grupo lejano): mira de cerca, las imágenes son grandes. Si hacen la acción aunque se vea pequeña (raspan, caminan, levantan algo), action_ok es true. Marca false solo cuando estés SEGURO de que la acción no ocurre; si dudas en personas pequeñas, true.
  El SUJETO PRINCIPAL es lo que nombra la narración (la columna de humo, las rocas, el grupo, la ola). Si lo que se mueve es el fondo, las nubes de alrededor o los bordes, pero el sujeto principal queda igual (misma forma, mismo tamaño, mismos bultos en el mismo sitio), action_ok es false.
  Ejemplos reales que pasaron mal y NO deben aprobarse: una columna de erupción vista desde el espacio cuya forma no cambia mientras las nubes alrededor se mueven; rocas de un derrumbe que no caen mientras la cámara se inclina; una cámara de magma donde solo avanza la cámara.
- evidence: en una frase, qué parte del SUJETO PRINCIPAL comparaste y cómo estaba en la imagen 1 y en la 5.
- haze: aparece humo, neblina o bruma blanca que NO tiene que ver con la narración (true = problema).
- broken: algo deforme, caras o manos rotas, letras/texto inventado, cosas que aparecen o desaparecen (true = problema).
- reason: una frase corta en español con lo que viste (vacío si todo bien).
Responde SOLO este JSON: {"tomas":[{"n":1,"image_ok":true,"action_ok":true,"haze":false,"broken":false,"evidence":"","reason":""}]}`;
    try {
      const j = parseJson(await runClaude(prompt, { files, timeoutMin: 8, log }));
      for (const t of (j.tomas || [])) if (t && t.n != null) out[Number(t.n)] = t;
      log(`QA visual: revisadas tomas ${group.map((g) => g.sh.n).join(', ')}`);
    } catch (e) { log('QA visual: falló un grupo (' + String(e.message).slice(0, 160) + ')'); }
  }
  return out;
}

// Claude ($0) reescribe la toma usando lo que vio el control de calidad. NUNCA toca la narración (la voz es fija):
// solo cámara/acción/final, la imagen (start_en) si no cuadra con la narración, o propone PARTIR la toma cuando la
// frase nombra 2+ cosas distintas (los pedazos son la MISMA frase cortada, palabra por palabra).
async function rewriteShot(sh, reason, log, { allowImage = false, allowSplit = true, context = '' } = {}) {
  const { runClaude, parseJson } = require('./_claude');
  const prompt = `Eres el director de fotografía de un documental hecho con LTX (modelo de video que parte de una imagen fija y HACE todo lo que lee).
Una toma salió mal${sh.camera_only ? ' (es una toma de SOLO CÁMARA: el objeto no se mueve ni cambia de forma; solo cambia el movimiento de cámara, y la acción describe ese paneo y la luz que lo recorre)' : ''}. Arréglala de verdad.
SÉ INDEPENDIENTE Y CREATIVO: si esta toma YA falló antes, NO hagas un ajuste tímido ni repitas casi lo mismo — REPIENSA la imagen desde cero (otro ángulo, otra composición, otra forma concreta de mostrar lo que dice la narración). El objetivo es que salga BIEN, no que se parezca al intento anterior. Piensa a dónde va la escena (ver contexto) para que la imagen tenga sentido con lo que viene.

Narración (FIJA: NO la cambies, no la reescribas, no la resumas): "${lineOf(sh)}"
${context ? 'Contexto (lo que se dice ANTES y DESPUÉS, para que la imagen conecte con el relato): ' + context + '\n' : ''}
La imagen inicial muestra: ${sh.start_en || ''}
Cámara actual: ${sh.camera || ''}
Acción actual: ${sh.action_en || ''}
Final actual: ${sh.reaction_en || ''}
Lo que salió mal (control de calidad): ${reason}

Reglas:
- La imagen tiene que mostrar EXACTAMENTE lo que dice la narración y ser de la ÉPOCA de la historia: si la historia es de la prehistoria (o de otra época), nada moderno (estadios, ciudades, ropa actual, carros, pantallas) salvo que la NARRACIÓN lo mencione o compare con eso ("cabrían en un estadio"): entonces SÍ se muestra lo moderno (sin inventar acción ajena, nada de gente jugando). Si la narración no lo menciona (solo da la cifra), se muestra con gente de esa época.
- La cámara hace UN movimiento corto y suave que mantiene TODO lo importante dentro del cuadro hasta el final. En "camera" escribe SOLO el movimiento (ej. "slow lateral drift to the left"); nunca "no zoom", "held", "unchanged", "same framing" (LTX hace lo que lee). Si el problema fue que solo se movía la cámara, que se metió o hizo zoom de más, usa un movimiento mínimo y pon el movimiento en el SUJETO.
- La acción (25–45 palabras, inglés) describe SOLO lo que se mueve en el sujeto principal, con verbos visibles y una dirección. Tiene que VERSE claramente en 6 segundos: nada de "respira", "parpadea" o gestos mínimos; si el sujeto es una persona pequeña o lejana, que camine, se agache, levante algo o señale. Si una persona se salía del cuadro, que se mueva DENTRO del cuadro (hacia la cámara o de lado corto), nunca hacia fuera. Nunca uses still, steady, stay, remain, fixed, motionless, frozen, static, suspended.
- Si el sujeto es humo, una columna de erupción, nubes o polvo: usa verbos de turbulencia visibles (billows, churns, rolls, swells and expands outward, grows taller) para que su forma CAMBIE durante la toma.
- No nombres objetos que no estén en la imagen. No humo ni neblina de relleno (solo si la narración trata de eso).
- NADA se inunda, aparece, desaparece ni se transforma: el sujeto y el suelo mantienen su forma. Si hay agua y la escena NO es de agua, NO la hagas fluir ni encharcar (LTX la vuelve una inundación que tapa todo); logra el movimiento con la cámara y un brillo de luz leve.
- El final (12–25 palabras, inglés) es el estado final de ESE mismo movimiento, con el sujeto todavía en cuadro.
${allowImage ? '- CAMBIA la imagen (es parte del problema): "start_en" (45–80 palabras, inglés) SÚPER específica para Flow. Di el MATERIAL y la TEXTURA REAL del sujeto (grietas, poros, rugosidad, desgaste, suciedad, barro, óxido, pelo, piel) y colores apagados y realistas, para que NUNCA salga liso, brillante ni apetitoso tipo comida (bola de helado, chocolate, caramelo). Di plano y lente, 2–3 detalles concretos del sujeto, el lugar, la luz. Si el intento anterior salió liso o irreconocible, descríbelo de otra forma más clara y reconocible de lo que ES.' : '- No cambies la imagen (no devuelvas start_en).'}
${allowSplit ? '- Si la narración nombra 2 a 4 cosas visualmente distintas que no caben en una sola imagen, PARTE la toma: "split" = lista de pedazos; cada "line" es un trozo EXACTO y seguido de la narración (todas juntas forman la narración palabra por palabra, mínimo 3 palabras cada una) con su propia imagen y movimiento. Si no hace falta, no la partas.' : ''}
Responde SOLO uno de estos JSON:
{"camera":"...","action_en":"...","reaction_en":"..."${allowImage ? ',"start_en":"...","background_en":"3–4 cosas del lugar de la NUEVA imagen, solo nombradas"' : ''}}
${allowSplit ? 'o {"split":[{"line":"...","start_en":"...","camera":"...","action_en":"...","reaction_en":"..."}]}' : ''}`;
  const j = parseJson(await runClaude(prompt, { timeoutMin: 6, log }));
  if (allowSplit && j && Array.isArray(j.split) && j.split.length >= 2) {
    const { validParts } = require(path.join(ROOT, 'netlify', 'functions', '_split'));
    const parts = j.split.map((p) => ({ line: String(p.line || ''), start_en: String(p.start_en || ''), camera: String(p.camera || ''), action_en: String(p.action_en || ''), reaction_en: String(p.reaction_en || ''), background_en: sh.background_en || '', end_en: '' }));
    const bad = validParts(lineOf(sh), parts);
    if (!bad) return { split: parts };
    log(`  Claude propuso partir la toma ${sh.n} pero los pedazos no forman la narración exacta (${bad}) → solo reescribo`);
  }
  if (!j || !j.action_en || !j.camera) return null;
  const out = { camera: String(j.camera).slice(0, 160), action_en: String(j.action_en).slice(0, 500), reaction_en: String(j.reaction_en || '').slice(0, 300) };
  if (allowImage && j.start_en && String(j.start_en).split(/\s+/).length >= 25) { out.start_en = String(j.start_en).slice(0, 900); out.background_en = String(j.background_en || '').slice(0, 300); }
  return out;
}

async function qaShots({ supabase, epId, handler, log = console.log }) {
  // La producción larga puede llevar horas con el código de LTX ya cargado en memoria: se recarga para que las
  // tomas rehechas usen las reglas nuevas (sin quietud, sin humo de relleno, movimiento reforzado).
  for (const k of Object.keys(require.cache)) if (/[\\/]netlify[\\/]functions[\\/](_king|regen-shot-background|_keyframe|_visual_check)\.js$/.test(k)) delete require.cache[k];
  handler = require(path.join(ROOT, 'netlify', 'functions', 'regen-shot-background')).handler;
  // "Editando ahora" (Franklin oct-13): el QA escribe en qué toma está trabajando para que el panel lo muestre.
  const setWorking = async (n, what) => { try { const { data: fr } = await supabase.from('episodes').select('validator_report').eq('id', epId).single(); await supabase.from('episodes').update({ validator_report: Object.assign({}, fr.validator_report || {}, { qa_working: n == null ? null : { n, at: new Date().toISOString(), what: what || 'rehacer' } }) }).eq('id', epId); } catch (_) {} };
  const VF = require(path.join(ROOT, 'netlify', 'functions', '_voice_full'));
  // Short armado con las tomas del LARGO (short_reusar.js): no se rehacen tomas con LTX; su QA es elegir otra
  // toma del largo (lo hace short_reusar con Claude). Franklin, oct-11.
  { const { data: e0 } = await supabase.from('episodes').select('continuity').eq('id', epId).single();
    if (e0 && e0.continuity && e0.continuity.reused_from_long) { log('QA: Short hecho con tomas del largo → su revisión la hace short_reusar (no se rehace con LTX)'); return []; } }
  const redone = [];
  const splits = []; // tomas que Claude decide partir (se aplican al final)
  const { data: ep } = await supabase.from('episodes').select('*, assets(*)').eq('id', epId).single();
  const { data: series } = await supabase.from('series').select('id, slug, title, genre, story_bible').eq('id', ep.series_id).single();
  let exact = {};
  if (VF.continuousMode(series.story_bible)) {
    const voice = await VF.ensureFullVoice(supabase, { episode: ep, series, log });
    exact = VF.shotCutsExact(voice, ep.shots || []) || {};
    const secs = VF.shotSecondsFor(voice, ep.shots || []);
    const { data: fr } = await supabase.from('episodes').select('shots').eq('id', epId).single();
    await supabase.from('episodes').update({ shots: (fr.shots || []).map((x, i) => Object.assign({}, x, { seconds: Math.min(15, Math.max(secs[i] || 2, Math.ceil((exact[x.n] || 0) + 0.3))) })) }).eq('id', epId);
  }
  for (const sh of ep.shots || []) {
    const clip = (ep.assets || []).filter((a) => a.kind === 'video_clip' && a.shot_number === sh.n).sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))[0];
    if (!clip || clip.approved) continue; // aprobada por Franklin: no se toca
    const d = await durationOf(clip.storage_path);
    let why = '';
    if (exact[sh.n] && d && d < exact[sh.n] * 0.8) why = `dura ${d.toFixed(1)} s y su voz ${exact[sh.n].toFixed(1)} s`;
    else {
      const fz = await frozenSeconds(clip.storage_path);
      if (d && fz > d * 0.4) why = `está quieto ${fz.toFixed(1)} de ${d.toFixed(1)} s`;
    }
    if (!why) continue;
    log(`QA toma ${sh.n}: ${why} → la rehago con prompt nuevo`);
    if (/quieto/.test(why)) {
      try {
        const fix = await rewriteShot(sh, 'El video salió casi congelado: ' + why + '. Necesita un movimiento claro y visible del sujeto principal.', log);
        if (fix) {
          const { data: fr } = await supabase.from('episodes').select('shots').eq('id', epId).single();
          await supabase.from('episodes').update({ shots: (fr.shots || []).map((x) => x.n === sh.n ? Object.assign({}, x, fix, fix.start_en ? { end_en: '', end_frame_url: null, end_frame_skip: false } : {}, { prompt_override: null, ltx_en: null, keyframe_prompt_override: fix.start_en ? null : x.keyframe_prompt_override, qa_rewrite_from: { camera: x.camera, action_en: x.action_en, reaction_en: x.reaction_en, start_en: x.start_en } }) : x) }).eq('id', epId);
          log(`QA toma ${sh.n}: prompt nuevo → cámara "${fix.camera}" · ${fix.action_en}`);
        }
      } catch (e) { log(`QA toma ${sh.n}: no pude reescribir (${String(e.message).slice(0, 120)})`); }
    }
    const r = await handler({ httpMethod: 'POST', headers: { 'x-vyrales-key': process.env.DASHBOARD_KEY || '' }, /* llamada interna = "sistema" (multiusuario) */ body: JSON.stringify({ assetId: clip.id, provider: 'king', new_frame: false }) });
    if (r.statusCode >= 400) log(`QA toma ${sh.n}: FALLÓ ${String(r.body).slice(0, 200)}`); else { log(`QA toma ${sh.n}: lista ✅`); redone.push(sh.n); }
  }
  // 3) Revisión visual con Claude ($0). Una sola vuelta por toma (shot.qa.redone) para no entrar en bucles.
  if (process.env.VYRALES_QA_VISUAL !== '0') {
    const { data: ep2 } = await supabase.from('episodes').select('shots, assets(*)').eq('id', epId).single();
    const items = [];
    for (const sh of ep2.shots || []) {
      const clip = (ep2.assets || []).filter((a) => a.kind === 'video_clip' && a.shot_number === sh.n).sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))[0];
      // Se salta solo si ESTE clip ya pasó. Si falló y no se alcanzó a rehacer (proceso cortado), se vuelve a revisar.
      // Si Franklin APROBÓ esta toma, manda su decisión: no se revisa ni se rehace (salvo que la marque con ✗).
      if (clip && clip.approved && !(sh.qa && sh.qa.force)) continue;
      if (clip && !(sh.qa && sh.qa.clip_id === clip.id && sh.qa.ok && !sh.qa.force)) items.push({ sh, clip, url: clip.storage_path, dur: await durationOf(clip.storage_path) });
    }
    log(`QA visual: revisando ${items.length} toma(s) con Claude ($0)...`);
    const res = await visionReview(items, log, async (group) => { if (group && group[0]) await setWorking(group[0].n, 'revisar'); });
    const todo = [];
    const qaOf = {};
    for (const it of items) {
      const r = res[it.sh.n]; if (!r) continue;
      // Franklin la marcó a mano ("no se mueve", etc.): se rehace aunque Claude la apruebe.
      const forced = !!(it.sh.qa && it.sh.qa.force && (it.sh.qa.clip_id === it.clip.id || it.sh.qa.force_any));
      if (forced) { r.action_ok = false; r.reason = 'Marcada a mano: ' + (it.sh.qa.force_reason || 'no está bien') + (r.reason ? ' · QA: ' + r.reason : ''); }
      const bad = forced || r.image_ok === false || r.action_ok === false || r.haze === true || r.broken === true;
      // Hasta 3 intentos por toma; en TODOS Claude reescribe cámara/acción/final con lo que vio el QA (repetir el mismo
      // prompt daba el mismo error, ej. T6 Toba). Imagen nueva si no cuadra o desde el 2º intento (solo sin personajes).
      // Después de 3 queda para revisión humana.
      const tries = it.sh.qa ? (Number(it.sh.qa.tries) || (it.sh.qa.redone ? 1 : 0)) : 0;
      const already = tries >= 3;
      qaOf[it.sh.n] = { clip_id: it.clip.id, ok: !bad, image_ok: r.image_ok !== false, action_ok: r.action_ok !== false, haze: !!r.haze, broken: !!r.broken, reason: String(r.reason || '').slice(0, 300), at: new Date().toISOString(), redone: tries > 0, tries };
      if (bad && !already) {
        const freeFrame = !(it.sh.characters || []).length; // cuadro nuevo solo por el camino gratis (Flow/FLUX)
        // Franklin (oct-11): si se rehace con el MISMO prompt, sale el mismo error → SIEMPRE se reescribe el prompt
        // (Claude guionista, con lo que vio el QA) y la imagen se cambia si no cuadra o desde el 2º intento.
        // keep_image: Franklin quiere ESA imagen (ej. el estadio de T35 como comparación); solo se arregla el movimiento.
        const newFrame = freeFrame && !(it.sh.qa && it.sh.qa.keep_image) && (r.image_ok === false || tries >= 1);
        const rewrite = true;
        todo.push({ n: it.sh.n, clip: it.clip, newFrame, boost: r.action_ok === false, rewrite, reason: r.reason || '', sh: it.sh });
        log(`QA visual toma ${it.sh.n}: ${r.reason || 'no pasó'} → intento ${tries + 1}/3: Claude reescribe el prompt${newFrame ? ' + imagen nueva' : ''}`);
      } else if (bad) {
        log(`QA visual toma ${it.sh.n}: sigue con problema (${r.reason || ''}) → queda marcada para que la veas`);
        try { await require(path.join(ROOT, 'netlify', 'functions', '_memoria')).addLesson(supabase, { source: 'qa_falla', ep: epId, toma: it.sh.n, narracion: lineOf(it.sh), problema: r.reason || '', imagen: it.sh.start_en, accion: it.sh.action_en, camara: it.sh.camera }); } catch (_) {}
      }
    }
    const saveQa = async (extra = {}) => {
      const { data: fr } = await supabase.from('episodes').select('shots').eq('id', epId).single();
      await supabase.from('episodes').update({ shots: (fr.shots || []).map((x) => qaOf[x.n] ? Object.assign({}, x, { qa: Object.assign({}, qaOf[x.n], extra[x.n] || {}) }, extra[x.n] && extra[x.n].boost ? { qa_boost: true } : {}) : x) }).eq('id', epId);
    };
    // El intento se cuenta SOLO cuando la toma de verdad se rehízo (antes se contaba antes de rehacer y, si la PC
    // cortaba el trabajo, la toma quedaba con intentos gastados sin haberse rehecho).
    const prevTries = {}; todo.forEach((t) => { const pv = t.sh; prevTries[t.n] = pv && pv.qa ? (Number(pv.qa.tries) || (pv.qa.redone ? 1 : 0)) : 0; });
    await saveQa({});
    const bumpTry = async (n, boost) => {
      const { data: fr } = await supabase.from('episodes').select('shots').eq('id', epId).single();
      await supabase.from('episodes').update({ shots: (fr.shots || []).map((x) => x.n === n ? Object.assign({}, x, { qa: Object.assign({}, x.qa || {}, { redone: true, tries: prevTries[n] + 1 }) }, boost ? { qa_boost: true } : {}) : x) }).eq('id', epId);
    };
    // Franklin (oct-13): TERMINAR cada toma antes de pasar a la otra. Se reintenta la MISMA toma hasta que quede
    // bien (hasta 3 intentos en total), reescribiendo el prompt con lo que vio el QA y verificando solo esa toma.
    // Así NO se re-escanean las demás en cada intento (antes: una pasada completa por intento = mucho tiempo perdido).
    const bumpTryTo = async (n, tries, boost) => {
      const { data: fr } = await supabase.from('episodes').select('shots').eq('id', epId).single();
      await supabase.from('episodes').update({ shots: (fr.shots || []).map((x) => x.n === n ? Object.assign({}, x, { qa: Object.assign({}, x.qa || {}, { redone: true, tries }) }, boost ? { qa_boost: true } : {}) : x) }).eq('id', epId);
    };
    const yaAprobada = async (n, sh) => { try { const { data } = await supabase.from('assets').select('approved').eq('episode_id', epId).eq('kind', 'video_clip').eq('shot_number', n).order('updated_at', { ascending: false }).limit(1); return !!(data && data[0] && data[0].approved && !(sh && sh.qa && sh.qa.force)); } catch (_) { return false; } };
    // Franklin (oct-13): si mandas un video MANUAL (gen_local/regen_local/toma_local) mientras el QA corre,
    // el QA NO se traba: termina la toma actual, le CEDE el turno al manual (prioridad) y se re-encola para
    // seguir después justo donde quedó (las tomas ya buenas no se re-escanean).
    const hayTrabajoManual = async () => { try { const { data } = await supabase.from('agent_jobs').select('command').eq('status', 'pending'); return (data || []).some((j) => /^(gen_local|regen_local|toma_local):/.test(j.command)); } catch (_) { return false; } };
    const reencolarQA = async () => { try { const { data: ex } = await supabase.from('agent_jobs').select('id').eq('status', 'pending').eq('command', 'qa_tomas:' + epId).limit(1); if (ex && ex.length) return; const row = { command: 'qa_tomas:' + epId }; if (process.env.VYRALES_WS) row.workspace_id = process.env.VYRALES_WS; await supabase.from('agent_jobs').insert(row); } catch (_) {} };
    for (const t of todo) {
      if (await hayTrabajoManual()) {
        log('QA: hay un video manual en cola → le doy prioridad. Termino aquí; el QA se re-encola y sigue después donde quedó (sin re-escanear las buenas).');
        await reencolarQA();
        await setWorking(null);
        return redone;
      }
      if (await yaAprobada(t.n, t.sh)) { log(`QA toma ${t.n}: la aprobaste a mano → no se rehace`); continue; }
      let tries = prevTries[t.n];
      let reason = t.reason;
      let newFrame = t.newFrame;
      let clipId = t.clip.id;
      let shNow = t.sh;
      let done = false;
      while (tries < 3 && !done) {
        if (await yaAprobada(t.n, shNow)) { log(`QA toma ${t.n}: la aprobaste a mano → la dejo`); done = true; break; }
        await setWorking(t.n, 'rehacer');
        // Contexto: lo que se dice ANTES y DESPUÉS, para que la imagen conecte con el relato (ej. T6 "algo redondo" → T7 "es un cráneo").
        const ctxA = (ep2.shots || []).find((x) => x.n === t.n - 1);
        const ctxB = (ep2.shots || []).find((x) => x.n === t.n + 1);
        const context = [ctxA ? 'antes: "' + lineOf(ctxA) + '"' : '', ctxB ? 'después: "' + lineOf(ctxB) + '"' : ''].filter(Boolean).join(' · ');
        // 1) Reescribir el prompt con lo que vio el QA (repetir el mismo da el mismo error).
        try {
          const fix = await rewriteShot(shNow, reason, log, { allowImage: newFrame, allowSplit: true, context });
          if (fix && fix.split) { splits.push({ n: t.n, parts: fix.split }); log(`QA toma ${t.n}: Claude la parte en ${fix.split.length} tomas (misma narración)`); done = true; break; }
          if (fix) {
            const { data: fr } = await supabase.from('episodes').select('shots').eq('id', epId).single();
            await supabase.from('episodes').update({ shots: (fr.shots || []).map((x) => x.n === t.n ? Object.assign({}, x, fix, { prompt_override: null, ltx_en: null, keyframe_prompt_override: fix.start_en ? null : x.keyframe_prompt_override, qa_rewrite_from: { camera: x.camera, action_en: x.action_en, reaction_en: x.reaction_en, start_en: x.start_en } }) : x) }).eq('id', epId);
            log(`QA toma ${t.n}: prompt nuevo → cámara "${fix.camera}" · ${fix.action_en}`);
          }
        } catch (e) { log(`QA toma ${t.n}: no pude reescribir (${String(e.message).slice(0, 120)}) → reintento igual`); }
        // 2) Rehacer en king (ESPERA a que termine el render).
        const rr = await handler({ httpMethod: 'POST', headers: { 'x-vyrales-key': process.env.DASHBOARD_KEY || '' }, body: JSON.stringify({ assetId: clipId, provider: 'king', new_frame: newFrame }) });
        tries++;
        if (rr.statusCode >= 400) { log(`QA toma ${t.n}: FALLÓ al rehacer ${String(rr.body).slice(0, 160)}`); await bumpTryTo(t.n, tries, t.boost); break; }
        log(`QA toma ${t.n}: rehecha (intento ${tries}/3) ✅ — verificando solo esta toma...`);
        // 3) Verificar SOLO esta toma (no las demás).
        const { data: ep3 } = await supabase.from('episodes').select('shots, assets(*)').eq('id', epId).single();
        shNow = (ep3.shots || []).find((x) => x.n === t.n) || shNow;
        const clip = (ep3.assets || []).filter((a) => a.kind === 'video_clip' && a.shot_number === t.n).sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))[0];
        clipId = clip ? clip.id : clipId;
        const res3 = await visionReview([{ sh: shNow, clip, url: clip && clip.storage_path, dur: clip ? await durationOf(clip.storage_path) : 0 }], log);
        const vr = res3[t.n] || {};
        const ok = !(vr.image_ok === false || vr.action_ok === false || vr.haze === true || vr.broken === true);
        const prevReason = (shNow.qa && (shNow.qa.reason || shNow.qa.force_reason)) || reason;
        const qaFinal = { clip_id: clipId, ok, image_ok: vr.image_ok !== false, action_ok: vr.action_ok !== false, haze: !!vr.haze, broken: !!vr.broken, reason: ok ? '' : String(vr.reason || reason).slice(0, 300), fixed_from: ok ? prevReason : (shNow.qa && shNow.qa.fixed_from), redone: true, tries, force: false, force_any: false, at: new Date().toISOString() };
        const { data: fr2 } = await supabase.from('episodes').select('shots').eq('id', epId).single();
        await supabase.from('episodes').update({ shots: (fr2.shots || []).map((x) => x.n === t.n ? Object.assign({}, x, { qa: qaFinal }) : x) }).eq('id', epId);
        if (!redone.includes(t.n)) redone.push(t.n);
        log(`QA toma ${t.n}: ${ok ? 'quedó bien ✓' : 'todavía no (' + (vr.reason || '') + ')'}`);
        if (ok) {
          done = true;
          if (prevReason) { try { await require(path.join(ROOT, 'netlify', 'functions', '_memoria')).addLesson(supabase, { source: 'qa_arreglo', ep: epId, toma: t.n, narracion: lineOf(shNow), problema: prevReason, solucion: { camara: shNow.camera, accion: shNow.action_en, imagen: shNow.start_en, solo_camara: !!shNow.camera_only } }); } catch (_) {} }
        } else {
          reason = vr.reason || reason;
          const freeFrame = !(shNow.characters || []).length;
          newFrame = freeFrame && !(shNow.qa && shNow.qa.keep_image) && (vr.image_ok === false || tries >= 1);
        }
      }
      if (!done && tries >= 3) {
        log(`QA toma ${t.n}: 3 intentos y sigue con problema → queda para que la revises`);
        try { await require(path.join(ROOT, 'netlify', 'functions', '_memoria')).addLesson(supabase, { source: 'qa_falla', ep: epId, toma: t.n, narracion: lineOf(shNow), problema: reason, imagen: shNow.start_en, accion: shNow.action_en, camara: shNow.camera }); } catch (_) {}
      }
    }
    await setWorking(null);
  }
  // Tomas que Claude decidió PARTIR: se parten de la última a la primera (así la renumeración no mueve las pendientes),
  // con la MISMA narración, y se piden sus cuadros (Flow, $0) + videos (king) → flow_frames en modo solo.
  if (splits.length) {
    const { splitShotDb } = require(path.join(ROOT, 'netlify', 'functions', '_split'));
    for (const sp of splits.sort((a, b) => b.n - a.n)) {
      try { await splitShotDb(supabase, epId, sp.n, sp.parts, log); } catch (e) { log(`QA toma ${sp.n}: no pude partirla (${String(e.message).slice(0, 140)})`); }
    }
    await supabase.from('agent_jobs').insert({ command: 'flow_frames:' + epId });
    log(`QA: partí ${splits.length} toma(s); en cola sus imágenes nuevas (Flow) y videos (king)`);
  }
  try {
    const lessons = await require(path.join(ROOT, 'netlify', 'functions', '_memoria')).readJson(supabase, 'lecciones.json', []);
    if (lessons.some((l) => !l.consolidated)) { const { data: oa } = await supabase.from('agent_jobs').select('id').eq('status', 'pending').eq('command', 'claude_aprender').limit(1); if (!(oa && oa.length)) await supabase.from('agent_jobs').insert({ command: 'claude_aprender' }); }
  } catch (_) {}
  log(redone.length ? `QA: rehice ${redone.length} toma(s): ${redone.join(', ')}` : 'QA: no rehice ninguna toma en esta pasada (las marcadas con ⚠ necesitan revisión humana)');
  await setWorking(null);
  return redone;
}

module.exports = { qaShots, durationOf, frozenSeconds, visionReview, grab };
