// PULIDO DE LA NARRACIÓN (Franklin, oct-11: "nada que suene a IA; sin 'Y' sueltas al empezar; la historia debe
// seguir completa sin saltos bruscos ni palabras locas"). Claude en la PC revisa TODAS las líneas juntas y las
// corrige lo mínimo: misma cantidad de líneas (cada una sigue en su toma), mismos datos, mismo largo aprox.
const CIERRE_LARGO = 'Si quieres más historias como esta, contadas completas, suscríbete al canal.';
const CTA_SHORT = 'Si quieres ver la historia completa, entra al enlace que te dejo aquí abajo.';

function polishPrompt(lines, { kind = 'largo', title = '' } = {}) {
  return [
    'Eres el editor final de un narrador de documentales en español latino. Recibes la narración de un video dividida en líneas (cada línea va sobre una imagen distinta). Tu trabajo: que suene como un narrador HUMANO contando una historia de corrido, sin que se note ninguna IA.',
    'CORRIGE lo mínimo necesario, línea por línea:',
    '- Nada de "Y" suelta como muletilla al empezar una frase o una línea ("Y la ceniza…", "Y aquí…"). Reescribe el arranque con una transición natural o empieza directo. Máximo una o dos "Y" iniciales en todo el texto, solo si de verdad suenan bien dichas en voz alta.',
    '- Continuidad: cada línea sigue a la anterior sin saltos bruscos; si un cambio de tema o de lugar llega de golpe, añade la transición mínima ("Mientras tanto, a nueve mil kilómetros…", "Años después…").',
    '- Nada de palabras raras, forzadas o rebuscadas; nada de frases hechas de IA ("fascinante", "crucial", "sumérgete", "en definitiva", "cabe destacar", "un viaje", tríos de adjetivos, moralejas). Lenguaje claro, como se habla.',
    '- Conserva TODOS los datos, nombres, cifras y fechas, el orden de la historia y el tono. Cada línea queda de un largo parecido (±20 %). No juntes ni partas líneas.',
    kind === 'largo' ? `- La ÚLTIMA línea termina EXACTAMENTE con: "${CIERRE_LARGO}" (puede ir precedida de la pregunta al espectador si ya estaba en esa línea).` : '',
    kind === 'short_cta' ? `- La ÚLTIMA línea es EXACTAMENTE: "${CTA_SHORT}"` : '',
    title ? `Título del video: ${title}` : '',
    '',
    'Líneas (JSON):', JSON.stringify(lines),
    '',
    `Devuelve SOLO este JSON con EXACTAMENTE ${lines.length} líneas, en el mismo orden: {"lines":["…"]}`
  ].filter(Boolean).join('\n');
}

// llm(prompt) → { out } (Claude en la PC). Devuelve las líneas nuevas o lanza error si no cuadran.
async function polishLines(lines, llm, opts = {}) {
  const { out } = await llm(polishPrompt(lines, opts));
  const nl = (out && Array.isArray(out.lines) ? out.lines : []).map((x) => String(x || '').trim());
  if (nl.length !== lines.length || nl.some((x) => !x)) throw new Error('El pulido devolvió ' + nl.length + ' líneas (esperaba ' + lines.length + ').');
  if (opts.kind === 'short_cta') nl[nl.length - 1] = CTA_SHORT;
  if (opts.kind === 'largo' && !nl[nl.length - 1].includes(CIERRE_LARGO)) nl[nl.length - 1] = nl[nl.length - 1].replace(/\s*Y?\s*si quieres más historias[^.]*\.?\s*$/i, '').trim() + (nl[nl.length - 1].trim() ? ' ' : '') + CIERRE_LARGO;
  return nl;
}

module.exports = { polishLines, polishPrompt, CIERRE_LARGO, CTA_SHORT };
