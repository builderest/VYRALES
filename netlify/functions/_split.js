// PARTIR UNA TOMA EN VARIAS (Franklin, oct-11: "si la narración nombra 2, 3 o 4 cosas, se parte en varios videos
// cortos que al final son la misma escena"). Cada pedazo lleva su parte EXACTA de la línea del narrador (juntos
// forman la línea completa, palabra por palabra), su imagen y su movimiento. Con la voz continua el corte cae justo
// en la palabra (shotCutsExact), así que la voz NO cambia.
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const lineOf = (sh) => String(sh.voice_part || (Array.isArray(sh.dialogue) ? sh.dialogue : (sh.dialogue ? [sh.dialogue] : [])).map((d) => d && d.line).filter(Boolean).join(' ')).trim();
const FIELDS = ['start_en', 'action_en', 'reaction_en', 'background_en', 'end_en', 'camera'];

// ¿Los pedazos forman exactamente la línea original? Cada uno con 3+ palabras (el corte por voz necesita 3).
function validParts(line, parts) {
  if (!Array.isArray(parts) || parts.length < 2 || parts.length > 5) return 'Hay que partir en 2 a 5 pedazos.';
  if (parts.some((p) => norm(p.line).split(' ').filter(Boolean).length < 3)) return 'Cada pedazo necesita al menos 3 palabras.';
  if (norm(parts.map((p) => p.line).join(' ')) !== norm(line)) return 'Los pedazos tienen que formar la frase original, palabra por palabra y en orden.';
  return null;
}

// Las líneas de los pedazos se sacan de la línea ORIGINAL (mismas palabras, misma puntuación y mayúsculas), para que
// el texto de la voz quede idéntico y la voz NUNCA se regenere por un cambio de mayúscula o de coma.
function exactLines(line, parts) {
  const words = String(line).trim().split(/\s+/);
  let i = 0;
  return parts.map((p, k) => {
    const cnt = norm(p.line).split(' ').filter(Boolean).length;
    // Palabras de la original que "cuentan" (las que solo son signos se pegan al pedazo actual).
    const out = [];
    let got = 0;
    while (i < words.length && (got < cnt || k === parts.length - 1)) { const w = words[i++]; out.push(w); if (norm(w)) got++; }
    while (i < words.length && !norm(words[i])) out.push(words[i++]);
    return out.join(' ');
  });
}
function pieceShots(sh, parts) {
  const exact = exactLines(lineOf(sh), parts);
  parts = parts.map((p, k) => Object.assign({}, p, { line: exact[k] || p.line }));
  return parts.map((p, k) => {
    const base = Object.assign({}, sh);
    ['frame_stale', 'clip_stale', 'end_frame_url', 'end_frame_skip', 'visual_fix', 'detail_proposal', 'detail_request', 'keyframe_prompt_override', 'prompt_override', 'narration', 'own_image'].forEach((f) => delete base[f]);
    const o = Object.assign(base, { split_from: sh.split_from || sh.n, split_part: k + 1, split_of: parts.length });
    FIELDS.forEach((f) => { if (p[f] != null) o[f] = String(p[f]).trim(); });
    if (sh.voice_part) o.voice_part = String(p.line).trim();
    o.dialogue = [{ speaker: ((Array.isArray(sh.dialogue) ? sh.dialogue[0] : sh.dialogue) || {}).speaker || 'Narrador', line: String(p.line).trim() }];
    if (Array.isArray(sh.dialogue) && !sh.dialogue.length) o.dialogue = []; // modo frases (voice_part)
    if (k === 0) o.frame_stale = true;
    return o;
  });
}

// Puro (guiones nuevos, sin cuadros todavía): devuelve las tomas renumeradas 1..N.
function splitInArray(shots, n, parts) {
  const out = [];
  for (const sh of shots) { if (sh.n === n) out.push(...pieceShots(sh, parts)); else out.push(sh); }
  return out.map((s, i) => Object.assign({}, s, { n: i + 1 }));
}

// En la base de datos (episodio que ya tiene cuadros/videos): renumera las tomas siguientes, sus assets y el plan del editor.
async function splitShotDb(sb, episodeId, n, parts, log = console.log) {
  const { data: ep, error } = await sb.from('episodes').select('id, shots, edit_plan, assets(id, kind, shot_number)').eq('id', episodeId).single();
  if (error) throw new Error(error.message);
  const sh = (ep.shots || []).find((s) => s.n === n);
  if (!sh) throw new Error('No existe la toma ' + n);
  const bad = validParts(lineOf(sh), parts);
  if (bad) throw new Error(bad);
  const extra = parts.length - 1;
  // Assets de las tomas siguientes: se corren hacia adelante (de la última a la primera).
  const later = (ep.assets || []).filter((a) => a.shot_number > n).sort((a, b) => b.shot_number - a.shot_number);
  for (const a of later) { const { error: e } = await sb.from('assets').update({ shot_number: a.shot_number + extra }).eq('id', a.id); if (e) throw new Error('No pude renumerar: ' + e.message); }
  // El video viejo de la toma partida ya no corresponde (dura la frase entera): se rehace el del pedazo 1.
  const hadClip = (ep.assets || []).some((a) => a.kind === 'video_clip' && a.shot_number === n);
  const pieces = pieceShots(sh, parts).map((p, k) => Object.assign(p, { n: n + k }, k === 0 && hadClip ? { clip_stale: true } : {}));
  const shots = [];
  for (const s of ep.shots) { if (s.n < n) shots.push(s); else if (s.n === n) shots.push(...pieces); else shots.push(Object.assign({}, s, { n: s.n + extra })); }
  const plan = ep.edit_plan && Array.isArray(ep.edit_plan.clips) ? Object.assign({}, ep.edit_plan, { clips: ep.edit_plan.clips.map((c) => (c.shot > n ? Object.assign({}, c, { shot: c.shot + extra }) : c)) }) : ep.edit_plan;
  const { error: e2 } = await sb.from('episodes').update({ shots, edit_plan: plan }).eq('id', episodeId);
  if (e2) throw new Error(e2.message);
  log(`  toma ${n} partida en ${parts.length}: ${parts.map((p) => '"' + String(p.line).slice(0, 40) + '"').join(' | ')}`);
  return { first: n, count: parts.length };
}

module.exports = { validParts, splitInArray, splitShotDb, norm, lineOf };
