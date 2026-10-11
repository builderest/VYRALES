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
const lineOf = (sh) => String(sh.voice_part || (Array.isArray(sh.dialogue) ? sh.dialogue : sh.dialogue ? [sh.dialogue] : []).map((d) => d && d.line).filter(Boolean).join(' ')).trim();

// Revisa tomas de a 4 con Claude (lee las imágenes). Devuelve { n: { image_ok, action_ok, haze, broken, reason } }.
async function visionReview(items, log) {
  const { runClaude, parseJson, claudePath } = require('./_claude');
  if (!claudePath()) { log('QA visual: Claude no está instalado en esta PC → me la salto'); return {}; }
  const out = {};
  for (let i = 0; i < items.length; i += 4) {
    const group = items.slice(i, i + 4);
    const files = []; const desc = [];
    for (const it of group) {
      const d = it.dur || 6;
      const fr = await Promise.all([0.15, d / 2, Math.max(0.2, d - 0.3)].map((t) => grab(it.url, t)));
      if (fr.some((b) => !b)) continue;
      fr.forEach((b, k) => files.push({ name: `t${it.sh.n}_${k + 1}.jpg`, buffer: b }));
      desc.push(`TOMA ${it.sh.n}: imágenes t${it.sh.n}_1.jpg (inicio), t${it.sh.n}_2.jpg (mitad), t${it.sh.n}_3.jpg (final).\n  Narración: "${lineOf(it.sh)}"\n  Debe mostrar: ${it.sh.start_en || it.sh.visual_es || ''}\n  Acción pedida: ${it.sh.action_en || ''}`);
    }
    if (!desc.length) continue;
    const prompt = `Eres el control de calidad de un documental. Usa la herramienta Read para mirar TODAS las imágenes que se nombran abajo (están en la carpeta actual). Para cada toma compara inicio, mitad y final con la narración.

${desc.join('\n\n')}

Para cada toma decide (sé justo: marca false solo si el problema se ve claro):
- image_ok: la imagen muestra el sujeto principal que dice la narración (no otra cosa distinta).
- action_ok: entre inicio y final SE VE la acción pedida en el sujeto principal (no basta con que solo se mueva la cámara). Si la acción es sutil por naturaleza (una luz que brilla, alguien leyendo), true si se nota algo.
- haze: aparece humo, neblina o bruma blanca que NO tiene que ver con la narración (true = problema).
- broken: algo deforme, caras o manos rotas, letras/texto inventado, cosas que aparecen o desaparecen (true = problema).
- reason: una frase corta en español con lo que viste (vacío si todo bien).
Responde SOLO este JSON: {"tomas":[{"n":1,"image_ok":true,"action_ok":true,"haze":false,"broken":false,"reason":""}]}`;
    try {
      const j = parseJson(await runClaude(prompt, { files, timeoutMin: 8, log }));
      for (const t of (j.tomas || [])) if (t && t.n != null) out[Number(t.n)] = t;
      log(`QA visual: revisadas tomas ${group.map((g) => g.sh.n).join(', ')}`);
    } catch (e) { log('QA visual: falló un grupo (' + String(e.message).slice(0, 160) + ')'); }
  }
  return out;
}

// Claude ($0) reescribe cámara/acción/final de una toma usando lo que vio el control de calidad.
async function rewriteShot(sh, reason, log) {
  const { runClaude, parseJson } = require('./_claude');
  const prompt = `Eres el director de fotografía de un documental hecho con LTX (modelo de video que parte de una imagen fija y HACE todo lo que lee).
Una toma salió mal. Reescribe SOLO la cámara, la acción y el final para que no vuelva a pasar (si ya se reescribió antes, cambia de enfoque: otro movimiento de cámara, una acción más simple).

Narración: "${lineOf(sh)}"
La imagen inicial muestra: ${sh.start_en || ''}
Cámara actual: ${sh.camera || ''}
Acción actual: ${sh.action_en || ''}
Final actual: ${sh.reaction_en || ''}
Lo que salió mal (control de calidad): ${reason}

Reglas:
- La cámara hace UN movimiento corto y suave que mantiene TODO lo importante de la imagen dentro del cuadro hasta el final. Si el problema fue que la cámara se metió, se fue o hizo zoom de más, usa un movimiento mínimo (slow gentle drift, slight push-in) o lateral corto.
- La acción (25–45 palabras, inglés) describe SOLO lo que se mueve en el sujeto principal, con verbos visibles y una sola dirección. Nunca uses still, steady, stay, remain, fixed, motionless, frozen, static.
- No nombres objetos que no estén en la imagen. No humo ni neblina de relleno (solo si la narración trata de eso).
- El final (12–25 palabras, inglés) es el estado final de ESE mismo movimiento, con el sujeto todavía en cuadro.
Responde SOLO este JSON: {"camera":"...","action_en":"...","reaction_en":"..."}`;
  const j = parseJson(await runClaude(prompt, { timeoutMin: 6, log }));
  if (!j || !j.action_en || !j.camera) return null;
  return { camera: String(j.camera).slice(0, 160), action_en: String(j.action_en).slice(0, 500), reaction_en: String(j.reaction_en || '').slice(0, 300) };
}

async function qaShots({ supabase, epId, handler, log = console.log }) {
  // La producción larga puede llevar horas con el código de LTX ya cargado en memoria: se recarga para que las
  // tomas rehechas usen las reglas nuevas (sin quietud, sin humo de relleno, movimiento reforzado).
  for (const k of Object.keys(require.cache)) if (/[\\/]netlify[\\/]functions[\\/](_king|regen-shot-background|_keyframe|_visual_check)\.js$/.test(k)) delete require.cache[k];
  handler = require(path.join(ROOT, 'netlify', 'functions', 'regen-shot-background')).handler;
  const VF = require(path.join(ROOT, 'netlify', 'functions', '_voice_full'));
  const redone = [];
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
          await supabase.from('episodes').update({ shots: (fr.shots || []).map((x) => x.n === sh.n ? Object.assign({}, x, fix, { prompt_override: null, ltx_en: null, qa_rewrite_from: { camera: x.camera, action_en: x.action_en, reaction_en: x.reaction_en } }) : x) }).eq('id', epId);
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
      if (clip && !(sh.qa && sh.qa.clip_id === clip.id && sh.qa.ok)) items.push({ sh, clip, url: clip.storage_path, dur: await durationOf(clip.storage_path) });
    }
    log(`QA visual: revisando ${items.length} toma(s) con Claude ($0)...`);
    const res = await visionReview(items, log);
    const todo = [];
    const qaOf = {};
    for (const it of items) {
      const r = res[it.sh.n]; if (!r) continue;
      const bad = r.image_ok === false || r.action_ok === false || r.haze === true || r.broken === true;
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
          const fix = await rewriteShot(t.sh, t.reason, log);
          if (fix) {
            const { data: fr } = await supabase.from('episodes').select('shots').eq('id', epId).single();
            await supabase.from('episodes').update({ shots: (fr.shots || []).map((x) => x.n === t.n ? Object.assign({}, x, fix, { prompt_override: null, ltx_en: null, qa_rewrite_from: { camera: x.camera, action_en: x.action_en, reaction_en: x.reaction_en } }) : x) }).eq('id', epId);
            log(`QA toma ${t.n}: prompt nuevo → cámara "${fix.camera}" · ${fix.action_en}`);
          }
        } catch (e) { log(`QA toma ${t.n}: no pude reescribir (${String(e.message).slice(0, 120)}) → reintento igual`); }
      }
      const r = await handler({ httpMethod: 'POST', body: JSON.stringify({ assetId: t.clip.id, provider: 'king', new_frame: t.newFrame }) });
      if (r.statusCode >= 400) log(`QA visual toma ${t.n}: FALLÓ ${String(r.body).slice(0, 200)}`); else { log(`QA visual toma ${t.n}: rehecha ✅`); if (!redone.includes(t.n)) redone.push(t.n); }
    }
  }
  log(redone.length ? `QA: rehice ${redone.length} toma(s): ${redone.join(', ')}` : 'QA: no rehice ninguna toma en esta pasada (las marcadas con ⚠ necesitan revisión humana)');
  return redone;
}

module.exports = { qaShots, durationOf, frozenSeconds, visionReview, grab };
