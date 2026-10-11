// REVISOR "IMAGEN = NARRACIÓN" (Franklin, oct-10: "las imágenes no van acorde con la narración").
// Antes de generar los cuadros, Gemini compara la línea del narrador de cada toma con su start_en y
// reescribe SOLO las que no muestran lo que se dice (una cuchilla de piedra para "la humanidad cabía en
// un estadio", una caverna repetida…). ~$0.005 por episodio. Se corre una vez por episodio
// (continuity.visual_checked); si después editas un prompt a mano, se respeta.
const { TEXT_MODEL } = require('./_publish');
const PRICE = { input: 0.75, output: 3.75 };

const lineOf = (sh) => String(sh.voice_part || (Array.isArray(sh.dialogue) ? sh.dialogue : (sh.dialogue ? [sh.dialogue] : [])).map((d) => d && d.line).filter(Boolean).join(' ')).trim();

async function checkVisuals({ series, shots, log = console.log }) {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('Falta GOOGLE_AI_API_KEY.');
  const rows = (shots || []).map((sh) => ({ n: sh.n, narracion: lineOf(sh), imagen: sh.start_en || '', final: sh.end_en || '' })).filter((r) => r.narracion || r.imagen);
  if (!rows.length) return { changes: [], costUsd: 0 };
  const prompt = [
    'Eres director de arte de documentales cortos verticales (YouTube Shorts) hechos con IA. Cada toma tiene una línea del narrador (español) y el prompt de su imagen (inglés) que se genera con un modelo de imágenes fotorrealista.',
    'REGLA DE ORO: el espectador debe VER exactamente lo que el narrador está diciendo en ese momento. Revisa cada toma y reescribe SOLO las que no cumplan.',
    'Una toma NO cumple si: (a) la imagen muestra algo distinto del sujeto/acción/lugar que nombra la línea (p. ej. dice "la humanidad entera cabía en un estadio" y la imagen es una herramienta de piedra); (b) la línea habla de personas (clanes, población, supervivientes, cooperar, mariscos que comen) y la imagen no tiene personas; (c) la línea nombra un clima o época (hielo, invierno, sol oculto) y la imagen no lo muestra; (d) es casi igual a la imagen de otra toma (cada toma debe verse distinta); (e) la geografía, la época, los animales o las plantas no corresponden al lugar del que se habla (en África no hay mamuts; Toba está en Sumatra, selva tropical).',
    'Al reescribir: inglés, en AFIRMATIVO (nunca "no", "without"), 20–45 palabras, una escena concreta y filmable: sujeto principal + acción + lugar + luz. Personas anónimas permitidas cuando la línea habla de gente (pequeños grupos, de espaldas, de perfil o a media distancia, con la ropa y época correctas). Ideas abstractas o cifras → una metáfora visual que se entienda al instante (cifra de población pequeña → un estadio moderno enorme casi vacío con un puñado de gente). Sin texto escrito en la imagen. Mantén el estilo documental realista del resto.',
    'Si reescribes start_en y la toma tenía final (end_en), escribe un end_en nuevo que sea la MISMA vista con un cambio grande ("The same view: …") solo si es un plano abierto; si es un primer plano, end_en = "".',
    '',
    `Serie: ${(series && (series.title || series.slug)) || ''}`,
    'Tomas (JSON):',
    JSON.stringify(rows),
    '',
    'Devuelve SOLO este JSON (todas las tomas, en orden): {"shots":[{"n":1,"ok":true},{"n":2,"ok":false,"problema":"1 frase en español","start_en":"…","end_en":"…"}]}'
  ].join('\n');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } })
  });
  const j = await res.json();
  if (!res.ok) throw new Error('Gemini (revisor de imágenes) HTTP ' + res.status + ': ' + JSON.stringify(j.error || j).slice(0, 200));
  const text = j.candidates && j.candidates[0] && j.candidates[0].content.parts.map((p) => p.text || '').join('');
  let out; try { out = JSON.parse(text); } catch (_) { throw new Error('El revisor no devolvió JSON válido.'); }
  const u = j.usageMetadata || {};
  const costUsd = ((u.promptTokenCount || 3000) * PRICE.input + ((u.candidatesTokenCount || 1500) + (u.thoughtsTokenCount || 0)) * PRICE.output) / 1e6;
  const changes = (out.shots || []).filter((x) => x && x.ok === false && String(x.start_en || '').trim().length > 20)
    .map((x) => ({ n: Number(x.n), problema: String(x.problema || ''), start_en: String(x.start_en).trim(), end_en: String(x.end_en || '').trim() }));
  changes.forEach((c) => log(`  toma ${c.n}: ${c.problema}\n     → ${c.start_en}`));
  return { changes, costUsd };
}

// Aplica la revisión a un episodio y la guarda (shots + continuity.visual_checked). Devuelve los cambios.
async function reviewEpisode(supabase, { episodeId, force = false, log = console.log }) {
  const { data: ep, error } = await supabase.from('episodes').select('id, series_id, shots, continuity').eq('id', episodeId).single();
  if (error) throw new Error(error.message);
  const cont = ep.continuity || {};
  if (cont.visual_checked && !force) { log('Revisor de imágenes: ya revisado antes (se respetan tus prompts).'); return { changes: [], skipped: true }; }
  const { data: series } = await supabase.from('series').select('id, slug, title').eq('id', ep.series_id).single();
  log('Revisor de imágenes: comparando cada imagen con su narración...');
  const { changes, costUsd } = await checkVisuals({ series, shots: ep.shots, log });
  const byN = Object.fromEntries(changes.map((c) => [c.n, c]));
  const shots = (ep.shots || []).map((sh) => {
    const c = byN[sh.n];
    if (!c) return sh;
    return Object.assign({}, sh, { start_en: c.start_en, end_en: sh.end_en ? c.end_en : '', end_frame_url: null, end_frame_skip: false, frame_stale: true, visual_fix: { at: new Date().toISOString(), problema: c.problema, antes: sh.start_en } });
  });
  await supabase.from('episodes').update({ shots, continuity: Object.assign({}, cont, { visual_checked: new Date().toISOString() }) }).eq('id', episodeId);
  try { const { logSpend } = require('./_spend'); await logSpend(supabase, { seriesId: ep.series_id, episodeId, kind: 'text', model: TEXT_MODEL, costUsd, note: 'revisor imagen=narración' }); } catch (_) {}
  log(`Revisor de imágenes: ${changes.length} toma(s) corregida(s) de ${(ep.shots || []).length} · $${costUsd.toFixed(4)}`);
  return { changes, costUsd };
}

module.exports = { checkVisuals, reviewEpisode };
