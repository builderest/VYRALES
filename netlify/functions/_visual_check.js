// REVISOR "IMAGEN = NARRACIÓN" + PROMPTS DETALLADOS (Franklin, oct-10: "las imágenes no van acorde con la
// narración"; "los prompts tienen que ser súper detallados para que LTX no invente").
// Gemini compara la línea del narrador de cada toma con su imagen y:
//   - reescribe start_en (imagen) de las tomas que no muestran lo que se dice (o de TODAS si aún no hay cuadros);
//   - deja action_en / reaction_en / background_en / end_en DETALLADOS y coherentes con la imagen, para que el
//     video (LTX) haga UN movimiento simple y creíble sin inventar cosas.
// ~$0.05–0.10 por episodio. Una vez por episodio (continuity.visual_checked); tus ediciones posteriores se respetan.
const { TEXT_MODEL } = require('./_publish');
const PRICE = { input: 0.75, output: 3.75 };
const { validParts } = require('./_split');

const lineOf = (sh) => String(sh.voice_part || (Array.isArray(sh.dialogue) ? sh.dialogue : (sh.dialogue ? [sh.dialogue] : [])).map((d) => d && d.line).filter(Boolean).join(' ')).trim();

const RULES = `REGLAS PARA LOS PROMPTS (inglés, en AFIRMATIVO: nunca "no", "without", "never"; sin comillas dobles):
- start_en (la imagen inicial, la genera un modelo fotorrealista) 45–80 palabras, en este orden: tipo de plano y lente (wide shot 24mm, medium shot 50mm, close-up 85mm…) + el SUJETO PRINCIPAL con detalles físicos concretos (tamaño, material, color, ropa y época, postura) + lo que está pasando congelado en ese instante + el lugar con 3 elementos concretos + la luz (fuente, hora, color) + atmósfera (polvo, humo, niebla, partículas). Debe mostrar EXACTAMENTE lo que dice la línea del narrador.
- Personas: anónimas, en grupos pequeños (1 a 6), de espaldas, de perfil o a media distancia, con ropa y época correctas; nunca un rostro en primer plano mirando a cámara, nunca manos en primer plano. Si la línea habla de gente (clanes, población, supervivientes, soldados, un oficial), la imagen tiene gente.
- Cifras o ideas abstractas → una metáfora visual que se entienda al instante (población mínima → un estadio moderno enorme casi vacío con un puñado de personas).
- Geografía, época, fauna y flora correctas para el lugar del que se habla (en África no hay mamuts; Toba está en Sumatra, selva tropical). Cada toma se ve distinta de las demás.
- action_en (lo que hace el video de 0 a 6 s) 25–45 palabras: UN solo movimiento físico, simple, continuo y creíble que corresponde a la línea (el humo sube, las olas rompen, el grupo camina despacio hacia la derecha, las brasas brillan), diciendo QUÉ se mueve, en qué dirección y con verbos de movimiento claros y visibles (sube, se expande, cae, rueda, se agrieta, avanza). Describe SOLO lo que se mueve: NUNCA escribas still, steady, stay, stays, remain, fixed, motionless, frozen, static, unchanged ni "lo demás se queda quieto" (LTX usa cfg=1: nombrar quietud CONGELA TODA la toma y el video sale como una foto). Lo que nombra la narración es lo que MÁS se mueve, a velocidad que se note (no "very slowly"). No agregues humo, neblina, niebla, bruma, haze, mist ni polvo flotando como relleno: solo si la narración habla de humo, ceniza, fuego, erupción o tormenta. Nada aparece ni desaparece, nada se transforma, nadie entra a cuadro, sin texto, sin cortes.
- reaction_en (cómo queda de 6 a 8 s) 12–25 palabras: el estado final de ese mismo movimiento, misma escena.
- background_en: 3–4 elementos del fondo que se mantienen iguales todo el clip.
- end_en: SOLO en planos abiertos donde algo cambia mucho en la misma vista ("The same view: …"), con los mismos elementos (nadie nuevo aparece); en primeros planos, objetos y personas: "".`;

async function gemini(prompt, temperature) {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('Falta GOOGLE_AI_API_KEY.');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature } })
  });
  const j = await res.json();
  if (!res.ok) throw new Error('Gemini (revisor de imágenes) HTTP ' + res.status + ': ' + JSON.stringify(j.error || j).slice(0, 200));
  const text = j.candidates && j.candidates[0] && j.candidates[0].content.parts.map((p) => p.text || '').join('');
  let out; try { out = JSON.parse(text); } catch (_) { throw new Error('El revisor no devolvió JSON válido.'); }
  const u = j.usageMetadata || {};
  return { out, costUsd: ((u.promptTokenCount || 4000) * PRICE.input + ((u.candidatesTokenCount || 3000) + (u.thoughtsTokenCount || 0)) * PRICE.output) / 1e6 };
}

// rewriteStart: 'all' (guion nuevo, aún sin cuadros) | 'failing' (ya hay cuadros: solo se rehace la imagen de las que fallan).
// llm(prompt) → { out (JSON ya parseado), costUsd }. Por defecto Gemini por API; en la PC se usa Claude con tu plan ($0).
async function checkVisuals({ series, shots, rewriteStart = 'failing', framed = null, llm = null, aspect = '9:16', context = '', allowSplit = true, log = console.log }) {
  // fija = esa toma ya tiene una imagen buena generada con su start_en (no se toca salvo que falle).
  const isFixed = (sh) => rewriteStart !== 'all' && (!framed || framed.has(sh.n)) && !sh.frame_stale;
  const rows = (shots || []).map((sh) => ({ n: sh.n, imagen_ya_generada: isFixed(sh), narracion: lineOf(sh), camera: sh.camera || '', start_en: sh.start_en || '', action_en: sh.action_en || '', reaction_en: sh.reaction_en || '', background_en: sh.background_en || '', end_en: sh.end_en || '' })).filter((r) => r.narracion || r.start_en);
  if (!rows.length) return { changes: [], costUsd: 0 };
  const prompt = [
    'Eres director de arte y de fotografía de documentales cortos verticales (YouTube Shorts) hechos con IA: primero se genera la imagen inicial de cada toma y después un modelo de video (LTX) la anima a partir de los textos. Si el texto es vago, el video inventa disparates; si la imagen no muestra lo que dice el narrador, el espectador se pierde.',
    'TAREA 1 — Revisa cada toma: ¿la imagen (start_en) muestra EXACTAMENTE lo que dice el narrador en ese momento? Falla si muestra otra cosa, si la línea habla de personas y no hay personas, si falta el clima/época que se nombra, si se repite con otra toma, o si la geografía/fauna no corresponde.',
    rewriteStart === 'all'
      ? 'TAREA 2 — Escribe para TODAS las tomas un start_en nuevo, súper detallado, que cumpla las reglas (si la idea original ya estaba bien, conserva el mismo sujeto pero con todo el detalle).'
      : 'TAREA 2 — Escribe un start_en nuevo, súper detallado, para las tomas que FALLAN y para TODAS las que tienen imagen_ya_generada=false (conserva el mismo sujeto si ya estaba bien). Las que tienen imagen_ya_generada=true y están bien: devuelve su start_en tal cual.',
    'TAREA 3 — Para TODAS las tomas escribe action_en, reaction_en, background_en y end_en súper detallados y coherentes con su start_en final, para que el video haga un movimiento simple y creíble sin inventar nada.',
    allowSplit ? 'TAREA 4 — PARTIR: si la línea del narrador nombra 2, 3 o 4 cosas que se VEN distintas (sujetos, lugares o momentos distintos: "el volcán explota… y la ceniza cae sobre los bosques de la India"), parte la toma en varias tomas cortas, una por cada cosa, para que cada imagen muestre exactamente lo que se dice en ese instante. Pon en "split" la lista de pedazos (2 a 4), cada uno con "line" = su pedazo EXACTO de la línea (en orden; juntos forman la línea completa palabra por palabra; mínimo 3 palabras cada uno) y sus propios start_en, action_en, reaction_en, background_en, end_en y camera. NO partas si es la misma vista con un cambio (eso se resuelve con end_en) ni si la línea es corta (menos de 8 palabras). Si no hay que partir, no pongas "split".' : '',
    RULES,
    aspect === '16:9' ? '- FORMATO HORIZONTAL 16:9 (video largo de YouTube): composición panorámica, el sujeto puede ir a un tercio y el paisaje respira a los lados.' : '- FORMATO VERTICAL 9:16 (Shorts): el sujeto principal ocupa el centro y el cuadro alto.',
    context ? 'Contexto de la historia: ' + context : '',
    '',
    `Serie: ${(series && (series.title || series.slug)) || ''}`,
    'Tomas (JSON):', JSON.stringify(rows), '',
    'Devuelve SOLO este JSON con TODAS las tomas en orden: {"shots":[{"n":1,"ok":true,"problema":"","start_en":"…","action_en":"…","reaction_en":"…","background_en":"…","end_en":""},{"n":2,"ok":false,"problema":"nombra dos cosas distintas","split":[{"line":"…","start_en":"…","action_en":"…","reaction_en":"…","background_en":"…","end_en":"","camera":"…"},{"line":"…","start_en":"…","action_en":"…","reaction_en":"…","background_en":"…","end_en":"","camera":"…"}]}]} (ok=false y problema = 1 frase en español cuando la imagen original no mostraba lo que dice el narrador).'
  ].join('\n');
  const { out, costUsd } = llm ? await llm(prompt) : await gemini(prompt, 0.4);
  const byN = Object.fromEntries(rows.map((r) => [r.n, r]));
  const changes = (out.shots || []).filter((x) => x && byN[Number(x.n)]).map((x) => {
    const o = byN[Number(x.n)];
    const ok = x.ok !== false;
    const start = String(x.start_en || '').trim();
    const newStart = (!ok || !o.imagen_ya_generada) && start.length > 40 ? start : o.start_en;
    return { n: Number(x.n), ok, problema: String(x.problema || ''), start_en: newStart, startChanged: newStart !== o.start_en,
      action_en: String(x.action_en || '').trim() || o.action_en, reaction_en: String(x.reaction_en || '').trim() || o.reaction_en,
      background_en: String(x.background_en || '').trim() || o.background_en, end_en: String(x.end_en == null ? o.end_en : x.end_en).trim(),
      split: allowSplit && Array.isArray(x.split) && !validParts(o.narracion, x.split) ? x.split.map((p) => ({ line: String(p.line || '').trim(), start_en: String(p.start_en || '').trim(), action_en: String(p.action_en || '').trim(), reaction_en: String(p.reaction_en || '').trim(), background_en: String(p.background_en || '').trim(), end_en: String(p.end_en || '').trim(), camera: String(p.camera || o.camera || '').trim() })) : null };
  });
  changes.filter((c) => !c.ok).forEach((c) => log(c.split ? `  toma ${c.n}: se parte en ${c.split.length} (${c.problema})` : `  toma ${c.n}: ${c.problema}\n     → ${c.start_en}`));
  return { changes, costUsd };
}

// Aplica los cambios a una lista de tomas (sin guardar). frames=true → las tomas con imagen nueva quedan frame_stale.
function applyChanges(shots, changes, { frames = false, splits = true } = {}) {
  const byN = Object.fromEntries(changes.map((c) => [c.n, c]));
  let out = (shots || []).map((sh) => {
    const c = byN[sh.n];
    if (!c) return sh;
    const upd = { start_en: c.start_en, action_en: c.action_en, reaction_en: c.reaction_en, background_en: c.background_en, end_en: c.end_en };
    if (c.startChanged) Object.assign(upd, { end_frame_url: null, end_frame_skip: false, visual_fix: { at: new Date().toISOString(), problema: c.problema, antes: sh.start_en } }, frames ? { frame_stale: true } : {});
    return Object.assign({}, sh, upd);
  });
  // Guion nuevo (sin cuadros): las tomas a partir se parten aquí mismo y todo se renumera 1..N.
  if (splits) { const { splitInArray } = require('./_split'); changes.filter((c) => c.split).sort((a, b) => b.n - a.n).forEach((c) => { out = splitInArray(out, c.n, c.split); }); }
  return out;
}

// Revisa y GUARDA un episodio (shots + continuity.visual_checked). Devuelve los cambios.
async function reviewEpisode(supabase, { episodeId, force = false, llm = null, engine = 'gemini', log = console.log }) {
  const { data: ep, error } = await supabase.from('episodes').select('id, series_id, shots, continuity, assets(kind, shot_number)').eq('id', episodeId).single();
  if (error) throw new Error(error.message);
  const cont = ep.continuity || {};
  if (cont.visual_checked && !force) { log('Revisor de imágenes: ya revisado antes (se respetan tus prompts).'); return { changes: [], skipped: true }; }
  const { data: series } = await supabase.from('series').select('id, slug, title').eq('id', ep.series_id).single();
  const framed = new Set((ep.assets || []).filter((a) => a.kind === 'image').map((a) => a.shot_number));
  const hasFrames = framed.size > 0;
  log('Revisor de imágenes: comparando cada imagen con su narración y detallando los prompts...');
  const { changes, costUsd } = await checkVisuals({ series, shots: ep.shots, rewriteStart: hasFrames ? 'failing' : 'all', framed, llm, log });
  const shots = applyChanges(ep.shots, changes, { frames: hasFrames, splits: false });
  await supabase.from('episodes').update({ shots, continuity: Object.assign({}, cont, { visual_checked: new Date().toISOString() }) }).eq('id', episodeId);
  // Partir tomas (de la última a la primera, así los números de las demás no se mueven antes de tiempo).
  const { splitShotDb } = require('./_split');
  for (const c of changes.filter((x) => x.split).sort((a, b) => b.n - a.n)) {
    try { await splitShotDb(supabase, episodeId, c.n, c.split, log); } catch (e) { log(`  (no pude partir la toma ${c.n}: ${String(e.message).slice(0, 120)})`); }
  }
  try { const { logSpend } = require('./_spend'); await logSpend(supabase, { seriesId: ep.series_id, episodeId, kind: 'text', model: engine === 'claude' ? 'claude_plan' : TEXT_MODEL, costUsd, note: 'revisor imagen=narración' }); } catch (_) {}
  const fixed = changes.filter((c) => c.startChanged).length;
  log(`Revisor de imágenes: ${fixed} imagen(es) corregida(s), ${changes.length} toma(s) con prompts detallados · $${costUsd.toFixed(4)}`);
  return { changes, costUsd };
}

module.exports = { checkVisuals, applyChanges, reviewEpisode, RULES, lineOf };
