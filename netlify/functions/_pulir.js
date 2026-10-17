// PULIDO DE LA NARRACIÓN (Franklin, oct-11: "nada que suene a IA; sin 'Y' sueltas al empezar; la historia debe
// seguir completa sin saltos bruscos ni palabras locas"). Claude en la PC revisa TODAS las líneas juntas y las
// corrige lo mínimo: misma cantidad de líneas (cada una sigue en su toma), mismos datos, mismo largo aprox.
// Firma de VYRALES (Franklin, oct-16): la última frase es siempre esta; la frase de antes la adapta el guionista al tema.
const CIERRE_LARGO = 'Suscríbete a VYRALES, porque la próxima historia podría cambiar todo lo que creías saber.';
const CTA_SHORT = 'Si quieres ver la historia completa, entra al enlace que te dejo aquí abajo.';

// Cierre / llamada a la acción POR CANAL (Franklin oct-16): MindFuel es un canal de motivación en inglés; ahí no se puede
// decir "más historias como esta" ni repetir el cierre en español. Cada serie puede definir en su story_bible:
//   language: "en"  ·  ctas: { largo: "…", short: "…" }
// Sin eso queda el cierre de VYRALES (español).
function ctasOf(storyBible) {
  const b = storyBible || {}; const c = b.ctas || {};
  const lang = b.language || (/american english|in english|english narrator/i.test(JSON.stringify(b.narration || {})) ? 'en' : 'es');
  return { lang, cierre: c.largo || (lang === 'en' ? '' : CIERRE_LARGO), cta: c.short || (lang === 'en' ? '' : CTA_SHORT) };
}
// Del canal actual (VYRALES_WS en la PC): la primera serie activa del canal que defina ctas/idioma.
async function channelCtas(supabase) {
  try {
    const ws = process.env.VYRALES_WS; if (!ws) return ctasOf(null);
    const { data } = await supabase.from('series').select('story_bible, is_active').eq('workspace_id', ws);
    const b = (data || []).filter((x) => x.is_active !== false).map((x) => x.story_bible || {}).find((x) => x.ctas || x.language) || ((data || [])[0] || {}).story_bible;
    return ctasOf(b);
  } catch (_) { return ctasOf(null); }
}

function polishPrompt(lines, { kind = 'largo', title = '', lang = 'es', cierre = CIERRE_LARGO, cta = CTA_SHORT } = {}) {
  return [
    lang === 'en'
      ? 'Eres el editor final de un narrador en INGLÉS americano (el texto es y SIGUE en inglés: no traduzcas nada, ni agregues frases en español). Recibes la narración dividida en líneas (cada línea va sobre una imagen distinta). Tu trabajo: que suene como un narrador HUMANO de corrido, sin que se note ninguna IA. Las reglas de abajo aplican igual en inglés (p. ej. nada de "And" suelto como muletilla).'
      : 'Eres el editor final de un narrador de documentales en español latino. Recibes la narración de un video dividida en líneas (cada línea va sobre una imagen distinta). Tu trabajo: que suene como un narrador HUMANO contando una historia de corrido, sin que se note ninguna IA.',
    'CORRIGE lo mínimo necesario, línea por línea:',
    '- Nada de "Y" suelta como muletilla al empezar una frase o una línea ("Y la ceniza…", "Y aquí…"). Reescribe el arranque con una transición natural o empieza directo. Máximo una o dos "Y" iniciales en todo el texto, solo si de verdad suenan bien dichas en voz alta.',
    '- Continuidad: cada línea sigue a la anterior sin saltos bruscos; si un cambio de tema o de lugar llega de golpe, añade la transición mínima ("Mientras tanto, a nueve mil kilómetros…", "Años después…").',
    '- Nada de palabras raras, forzadas o rebuscadas; nada de frases hechas de IA ("fascinante", "crucial", "sumérgete", "en definitiva", "cabe destacar", "un viaje", tríos de adjetivos, moralejas). Lenguaje claro, como se habla.',
    '- Conserva TODOS los datos, nombres, cifras y fechas, el orden de la historia y el tono. Cada línea queda de un largo parecido (±20 %). No juntes ni partas líneas.',
    kind === 'largo' && cierre ? `- La ÚLTIMA línea termina EXACTAMENTE con: "${cierre}" (puede ir precedida de la pregunta al espectador si ya estaba en esa línea).` : '',
    kind === 'short_cta' && cta ? `- La ÚLTIMA línea es EXACTAMENTE: "${cta}"` : '',
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
  const cierre = opts.cierre !== undefined ? opts.cierre : CIERRE_LARGO, cta = opts.cta !== undefined ? opts.cta : CTA_SHORT;
  if (opts.kind === 'short_cta' && cta) nl[nl.length - 1] = cta;
  // Se quita cualquier cierre viejo (español o inglés) antes de poner el del canal: nunca dos cierres seguidos.
  if (opts.kind === 'largo' && cierre && !nl[nl.length - 1].includes(cierre)) nl[nl.length - 1] = nl[nl.length - 1].replace(/\s*Y?\s*si quieres más historias[^.]*\.?\s*$/i, '').replace(/\s*If you want more (stories )?like this[^.]*\.?\s*$/i, '').trim() + (nl[nl.length - 1].trim() ? ' ' : '') + cierre;
  return nl;
}

module.exports = { polishLines, polishPrompt, ctasOf, channelCtas, CIERRE_LARGO, CTA_SHORT };
