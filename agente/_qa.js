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

// Un cuadro del clip en el segundo t (JPG 640 px) → Buffer.
function grab(url, t) {
  const ffmpeg = require(path.join(ROOT, 'node_modules', 'ffmpeg-static'));
  return new Promise((res) => execFile(ffmpeg, ['-v', 'error', '-ss', String(Math.max(0, t)), '-i', url, '-frames:v', '1', '-vf', 'scale=640:-2', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '4', '-'], { encoding: 'buffer', timeout: 60000, maxBuffer: 1 << 24 }, (e, so) => res(e || !so || !so.length ? null : so)));
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
async function visionReview(items, log) {
  const { runClaude, parseJson, claudePath } = require('./_claude');
  if (!claudePath()) { log('QA visual: Claude no está instalado en esta PC → me la salto'); return {}; }
  const out = {};
  for (let i = 0; i < items.length; i += 3) {
    const group = items.slice(i, i + 3);
    const files = []; const desc = [];
    for (const it of group) {
      const d = it.dur || 6;
      const fr = await Promise.all([0.15, d * 0.25, d * 0.5, d * 0.75, Math.max(0.2, d - 0.3)].map((t) => grab(it.url, t)));
      if (fr.some((b) => !b)) continue;
      fr.forEach((b, k) => files.push({ name: `t${it.sh.n}_${k + 1}.jpg`, buffer: b }));
      const mv = await motionStep(it.url);
      const mvc = await motionStep(it.url, true);
      desc.push(`TOMA ${it.sh.n}: imágenes t${it.sh.n}_1.jpg … t${it.sh.n}_5.jpg (de inicio a final, en orden).\n  Narración: "${lineOf(it.sh)}"\n  Debe mostrar: ${it.sh.start_en || it.sh.visual_es || ''}\n  Acción pedida: ${it.sh.action_en || ''}\n  Movimiento medido en píxeles: todo el cuadro ${mv == null ? '?' : mv}, solo el centro ${mvc == null ? '?' : mvc} (≈1 congelado, 3–6 poco o solo cámara, 8+ claro)`);
    }
    if (!desc.length) continue;
    const prompt = `Eres el control de calidad de un documental. Usa la herramienta Read para mirar TODAS las imágenes que se nombran abajo (están en la carpeta actual). Para cada toma compara inicio, mitad y final con la narración.

${desc.join('\n\n')}

Para cada toma decide (sé justo: marca false solo si el problema se ve claro):
- image_ok: la imagen muestra el sujeto principal que dice la narración (no otra cosa distinta).
- action_ok: SE VE la acción pedida en el sujeto principal. Sé ESTRICTO: compara la posición de 2 objetos concretos del sujeto (ej. "roca grande arriba a la izquierda") entre la imagen 1 y la 5 RESPECTO a lo que los rodea. Si solo cambia el encuadre (zoom, giro o inclinación de cámara) y los objetos siguen igual entre sí, es false. Si la imagen muestra algo que debería estar en movimiento (derrumbe, caída, explosión, corriente) y entre 1 y 5 no avanza, es false. Si el movimiento medido es menor que 6, desconfía y mira con más cuidado. Solo para acciones sutiles por naturaleza (una luz que brilla, alguien leyendo) basta con que se note algo.
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
async function rewriteShot(sh, reason, log, { allowImage = false, allowSplit = true } = {}) {
  const { runClaude, parseJson } = require('./_claude');
  const prompt = `Eres el director de fotografía de un documental hecho con LTX (modelo de video que parte de una imagen fija y HACE todo lo que lee).
Una toma salió mal. Arréglala para que no vuelva a pasar (si ya se reescribió antes, cambia de enfoque: otro movimiento de cámara, una acción más simple).

Narración (FIJA: NO la cambies, no la reescribas, no la resumas): "${lineOf(sh)}"
La imagen inicial muestra: ${sh.start_en || ''}
Cámara actual: ${sh.camera || ''}
Acción actual: ${sh.action_en || ''}
Final actual: ${sh.reaction_en || ''}
Lo que salió mal (control de calidad): ${reason}

Reglas:
- La imagen tiene que mostrar EXACTAMENTE lo que dice la narración.
- La cámara hace UN movimiento corto y suave que mantiene TODO lo importante dentro del cuadro hasta el final. En "camera" escribe SOLO el movimiento (ej. "slow lateral drift to the left"); nunca "no zoom", "held", "unchanged", "same framing" (LTX hace lo que lee). Si el problema fue que solo se movía la cámara, que se metió o hizo zoom de más, usa un movimiento mínimo y pon el movimiento en el SUJETO.
- La acción (25–45 palabras, inglés) describe SOLO lo que se mueve en el sujeto principal, con verbos visibles y una dirección. Nunca uses still, steady, stay, remain, fixed, motionless, frozen, static, suspended.
- Si el sujeto es humo, una columna de erupción, nubes o polvo: usa verbos de turbulencia visibles (billows, churns, rolls, swells and expands outward, grows taller) para que su forma CAMBIE durante la toma.
- No nombres objetos que no estén en la imagen. No humo ni neblina de relleno (solo si la narración trata de eso).
- El final (12–25 palabras, inglés) es el estado final de ESE mismo movimiento, con el sujeto todavía en cuadro.
${allowImage ? '- Puedes cambiar la imagen: "start_en" (45–80 palabras, inglés) describe el cuadro inicial en el momento JUSTO ANTES o DURANTE el movimiento (nunca "frozen mid-fall"), plano y lente, sujeto con detalles, lugar, luz.' : '- No cambies la imagen (no devuelvas start_en).'}
${allowSplit ? '- Si la narración nombra 2 a 4 cosas visualmente distintas que no caben en una sola imagen, PARTE la toma: "split" = lista de pedazos; cada "line" es un trozo EXACTO y seguido de la narración (todas juntas forman la narración palabra por palabra, mínimo 3 palabras cada una) con su propia imagen y movimiento. Si no hace falta, no la partas.' : ''}
Responde SOLO uno de estos JSON:
{"camera":"...","action_en":"...","reaction_en":"..."${allowImage ? ',"start_en":"..."' : ''}}
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
  if (allowImage && j.start_en && String(j.start_en).split(/\s+/).length >= 25) out.start_en = String(j.start_en).slice(0, 900);
  return out;
}

async function qaShots({ supabase, epId, handler, log = console.log }) {
  // La producción larga puede llevar horas con el código de LTX ya cargado en memoria: se recarga para que las
  // tomas rehechas usen las reglas nuevas (sin quietud, sin humo de relleno, movimiento reforzado).
  for (const k of Object.keys(require.cache)) if (/[\\/]netlify[\\/]functions[\\/](_king|regen-shot-background|_keyframe|_visual_check)\.js$/.test(k)) delete require.cache[k];
  handler = require(path.join(ROOT, 'netlify', 'functions', 'regen-shot-background')).handler;
  const VF = require(path.join(ROOT, 'netlify', 'functions', '_voice_full'));
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
    const clip = (ep.assets || []).filter((a) => a.kind === 'video_clip' && a.shot_number === sh.n).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (!clip) continue;
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
          await supabase.from('episodes').update({ shots: (fr.shots || []).map((x) => x.n === sh.n ? Object.assign({}, x, fix, { prompt_override: null, ltx_en: null, keyframe_prompt_override: fix.start_en ? null : x.keyframe_prompt_override, qa_rewrite_from: { camera: x.camera, action_en: x.action_en, reaction_en: x.reaction_en, start_en: x.start_en } }) : x) }).eq('id', epId);
          log(`QA toma ${sh.n}: prompt nuevo → cámara "${fix.camera}" · ${fix.action_en}`);
        }
      } catch (e) { log(`QA toma ${sh.n}: no pude reescribir (${String(e.message).slice(0, 120)})`); }
    }
    const r = await handler({ httpMethod: 'POST', body: JSON.stringify({ assetId: clip.id, provider: 'king', new_frame: false }) });
    if (r.statusCode >= 400) log(`QA toma ${sh.n}: FALLÓ ${String(r.body).slice(0, 200)}`); else { log(`QA toma ${sh.n}: lista ✅`); redone.push(sh.n); }
  }
  // 3) Revisión visual con Claude ($0). Una sola vuelta por toma (shot.qa.redone) para no entrar en bucles.
  if (process.env.VYRALES_QA_VISUAL !== '0') {
    const { data: ep2 } = await supabase.from('episodes').select('shots, assets(*)').eq('id', epId).single();
    const items = [];
    for (const sh of ep2.shots || []) {
      const clip = (ep2.assets || []).filter((a) => a.kind === 'video_clip' && a.shot_number === sh.n).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      // Se salta solo si ESTE clip ya pasó. Si falló y no se alcanzó a rehacer (proceso cortado), se vuelve a revisar.
      if (clip && !(sh.qa && sh.qa.clip_id === clip.id && sh.qa.ok && !sh.qa.force)) items.push({ sh, clip, url: clip.storage_path, dur: await durationOf(clip.storage_path) });
    }
    log(`QA visual: revisando ${items.length} toma(s) con Claude ($0)...`);
    const res = await visionReview(items, log);
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
        const newFrame = freeFrame && (r.image_ok === false || tries >= 1);
        const rewrite = true;
        todo.push({ n: it.sh.n, clip: it.clip, newFrame, boost: r.action_ok === false, rewrite, reason: r.reason || '', sh: it.sh });
        log(`QA visual toma ${it.sh.n}: ${r.reason || 'no pasó'} → intento ${tries + 1}/3: Claude reescribe el prompt${newFrame ? ' + imagen nueva' : ''}`);
      } else if (bad) log(`QA visual toma ${it.sh.n}: sigue con problema (${r.reason || ''}) → queda marcada para que la veas`);
    }
    const saveQa = async (extra = {}) => {
      const { data: fr } = await supabase.from('episodes').select('shots').eq('id', epId).single();
      await supabase.from('episodes').update({ shots: (fr.shots || []).map((x) => qaOf[x.n] ? Object.assign({}, x, { qa: Object.assign({}, qaOf[x.n], extra[x.n] || {}) }, extra[x.n] && extra[x.n].boost ? { qa_boost: true } : {}) : x) }).eq('id', epId);
    };
    const mark = {}; todo.forEach((t) => { const pv = (items.find((it) => it.sh.n === t.n) || {}).sh; const tr = pv && pv.qa ? (Number(pv.qa.tries) || (pv.qa.redone ? 1 : 0)) : 0; mark[t.n] = { redone: true, tries: tr + 1, boost: t.boost }; });
    await saveQa(mark);
    for (const t of todo) {
      if (t.rewrite) {
        try {
          const fix = await rewriteShot(t.sh, t.reason, log, { allowImage: t.newFrame, allowSplit: true });
          if (fix && fix.split) { splits.push({ n: t.n, parts: fix.split }); log(`QA toma ${t.n}: Claude la parte en ${fix.split.length} tomas (misma narración)`); continue; }
          if (fix) {
            const { data: fr } = await supabase.from('episodes').select('shots').eq('id', epId).single();
            await supabase.from('episodes').update({ shots: (fr.shots || []).map((x) => x.n === t.n ? Object.assign({}, x, fix, { prompt_override: null, ltx_en: null, keyframe_prompt_override: fix.start_en ? null : x.keyframe_prompt_override, qa_rewrite_from: { camera: x.camera, action_en: x.action_en, reaction_en: x.reaction_en, start_en: x.start_en } }) : x) }).eq('id', epId);
            log(`QA toma ${t.n}: prompt nuevo → cámara "${fix.camera}" · ${fix.action_en}`);
          }
        } catch (e) { log(`QA toma ${t.n}: no pude reescribir (${String(e.message).slice(0, 120)}) → reintento igual`); }
      }
      const r = await handler({ httpMethod: 'POST', body: JSON.stringify({ assetId: t.clip.id, provider: 'king', new_frame: t.newFrame }) });
      if (r.statusCode >= 400) log(`QA visual toma ${t.n}: FALLÓ ${String(r.body).slice(0, 200)}`); else { log(`QA visual toma ${t.n}: rehecha ✅`); if (!redone.includes(t.n)) redone.push(t.n); }
    }
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
  log(redone.length ? `QA: rehice ${redone.length} toma(s): ${redone.join(', ')}` : 'QA: no rehice ninguna toma en esta pasada (las marcadas con ⚠ necesitan revisión humana)');
  return redone;
}

module.exports = { qaShots, durationOf, frozenSeconds, visionReview, grab };
