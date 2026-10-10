// GUIONISTAS DE VIDEOS ÚNICOS NARRADOS — formato "narrado_unico". UN PROMPT MAESTRO POR TIPO DE VIDEO
// (idea de Franklin, oct-2026): cada género engancha distinto (gancho, tono, voz, imagen, cierre).
//   GET /.netlify/functions/import-series?master=<tipo>[&topic=…]    tipos: ver TIPOS abajo
// El JSON que devuelve Claude se importa igual que una novela (mismo esquema que series/cibertales_curiosidades.json).
// Las novelas con personajes siguen usando _master_prompt.js (?master=1).
//
// Datos reales del canal (oct-2026): en series la Parte 1 tuvo 3,200 vistas en YouTube y la Parte 2 solo 38
// → la gente ve UN video completo pero no busca el siguiente. En Facebook 2 de cada 3 se iban antes de 3 s.

const TIPOS = {
  curiosidades: {
    nombre: 'curiosidades de ciencia, espacio, naturaleza y cuerpo humano',
    slug: 'cibertales_curiosidades', title: 'Curiosidades CIBERTALES',
    temaDefault: 'una curiosidad REAL de ciencia, espacio, naturaleza o cuerpo humano que contradiga lo que la gente cree o suene imposible, y que toque algo de su vida diaria',
    tono: 'Épico de documental (estilo History Channel / Discovery): asombro y tensión, frases con peso, ritmo de tráiler.',
    // Elegido por Franklin (oct-2026): abrir con un salto en el tiempo "te lleva hacia atrás automáticamente".
    gancho: 'Un salto en el tiempo con un dato imposible y concreto, que te transporta de golpe ("Hace cuatro mil millones de años, un día entero duraba apenas seis horas."). Después, conecta con el presente del espectador.',
    estructura: 'Gancho → bucle abierto → la causa (historia de causa y efecto) → giro inesperado al 70–80 % → prueba concreta → final que vuelve al gancho.',
    visual: 'Photorealistic cinematic science documentary, epic natural light, rich deep colors, atmospheric depth, premium nature-documentary cinematography',
    voz: 'Alnilam',
    vozEstilo: 'Narrador de documental estilo History Channel en español latino: voz grave, profunda y resonante, con autoridad y misterio; dramático pero natural, con pausas solemnes antes de cada revelación. Nada de tono de comercial. Mantén la MISMA energía e intensidad de principio a fin de cada frase: nunca te apagues ni bajes la voz al final.',
    cierre: { text: '¿SABÍAS ESTO?', subtext: 'Cada día una curiosidad nueva', voice: 'Síguenos: cada día, una curiosidad nueva.' },
    fuentes: true
  },
  historia: {
    nombre: 'historias reales de la historia (batallas, imperios, inventos, personajes, desastres)',
    slug: 'cibertales_historia', title: 'Historia CIBERTALES',
    temaDefault: 'un episodio REAL y poco conocido de la historia, con un momento de máxima tensión y un desenlace sorprendente',
    tono: 'History Channel puro: solemne, dramático, con fechas y lugares concretos; la historia contada como un thriller.',
    gancho: 'El momento más tenso de la historia, contado en presente ("Faltaban cuatro minutos para que el mundo cambiara para siempre.").',
    estructura: 'Gancho en el momento crítico → retroceso breve para el contexto → escalada → decisión o giro → consecuencia que llega hasta hoy.',
    visual: 'Photorealistic cinematic historical documentary, period-accurate settings and costumes, dramatic chiaroscuro light, smoke and dust in the air, epic wide shots',
    voz: 'Algenib',
    vozEstilo: 'Narrador de documental histórico en español latino: voz grave y rasposa, solemne, con peso; cuenta la historia como un thriller, con pausas dramáticas antes de los momentos clave. Mantén la MISMA energía e intensidad de principio a fin de cada frase: nunca te apagues ni bajes la voz al final.',
    cierre: { text: 'LA HISTORIA REAL', subtext: 'Cada día una historia que no te contaron', voice: 'Síguenos: cada día, una historia que no te contaron.' },
    fuentes: true
  },
  misterios: {
    nombre: 'misterios reales y casos sin resolver (o resueltos de forma sorprendente)',
    slug: 'cibertales_misterios', title: 'Misterios CIBERTALES',
    temaDefault: 'un misterio REAL y documentado (lugar, objeto, desaparición, fenómeno) con datos verificables y una explicación sorprendente o una pregunta abierta honesta',
    tono: 'Suspenso oscuro e inquietante, susurrado en los momentos clave; nunca inventa lo paranormal como hecho.',
    gancho: 'Un detalle perturbador y concreto ("En 1872 encontraron un barco navegando solo. La mesa estaba servida.").',
    estructura: 'Detalle perturbador → lo que se sabe → pistas que no encajan → la teoría más fuerte → lo que sigue sin explicación (pregunta al espectador).',
    visual: 'Photorealistic cinematic mystery documentary, moody low-key lighting, fog and deep shadows, desaturated cold colors with a single warm accent, slow suspenseful atmosphere',
    voz: 'Charon',
    vozEstilo: 'Narrador de misterio en español latino: voz profunda y baja, casi en confidencia, inquietante; pausas largas antes de cada detalle perturbador; nunca grita. Mantén la MISMA energía e intensidad de principio a fin de cada frase: nunca te apagues ni bajes la voz al final.',
    cierre: { text: '¿TÚ QUÉ CREES?', subtext: 'Cada día un misterio nuevo', voice: 'Síguenos: cada día, un misterio nuevo.' },
    fuentes: true
  },
  motivacion: {
    nombre: 'historias reales de superación (personas que lo perdieron todo y volvieron)',
    slug: 'cibertales_motivacion', title: 'Historias que inspiran',
    temaDefault: 'la historia REAL y verificable de una persona que tocó fondo y logró algo extraordinario, con un momento de quiebre claro',
    tono: 'Intenso y emotivo, como un tráiler de película basada en hechos reales; motivación a través de la historia, nunca frases sueltas de autoayuda.',
    gancho: 'El punto más bajo de la persona, concreto y visual ("A los 65 años, con un cheque de 105 dólares, lo había perdido todo.").',
    estructura: 'Punto más bajo → por qué parecía imposible → los rechazos → el momento de quiebre → la victoria → una sola frase final que el espectador se lleva.',
    visual: 'Photorealistic cinematic biographical drama, emotional golden-hour and low-key light, intimate close details of hands and places, film grain, warm-cold color contrast',
    voz: 'Orus',
    vozEstilo: 'Narrador de historia de superación en español latino: voz firme, cálida y profunda, intensa sin gritar; baja la voz en el momento más duro y crece en la victoria. Mantén la MISMA energía e intensidad de principio a fin de cada frase: nunca te apagues ni bajes la voz al final.',
    cierre: { text: 'NUNCA ES TARDE', subtext: 'Cada día una historia que inspira', voice: 'Síguenos: cada día, una historia que te va a mover.' },
    fuentes: true
  },
  // Frases motivacionales de fe y guerrero (pedido de Franklin, oct-2026: estilo póster "Aprendí a luchar en silencio…").
  frases: {
    nombre: 'frases motivacionales de fe, disciplina y batalla interior (el guerrero que lucha en silencio y confía en Dios)',
    slug: 'vyrales_frases', title: 'Frases que te levantan',
    temaDefault: 'UNA frase poderosa de fe y fortaleza (original o la que pida el usuario), contada como una mini historia de batalla interior',
    tono: 'Épico, solemne y emotivo, como el tráiler de una película de caballeros: dolor real, silencio, fe y victoria. Nada cursi ni de autoayuda barata; frases cortas con peso, que se sientan en el pecho.',
    gancho: 'La primera parte de la frase, sobre la imagen más fuerte (el caballero solo en la tormenta). No se agrega ninguna frase propia.',
    estructura: 'VIDEO CONTINUO + UNA SOLA VOZ (Franklin, oct-2026): story_bible.narration.mode = "continuous" y continuity.voice_text = la frase del usuario EXACTA, de corrido, sin "…" ni cortes (solo su puntuación). Las tomas NO llevan dialogue (vacío): la voz se genera una vez para todo el video y el texto sale en pantalla al ritmo de la voz. 3–5 tomas ENCADENADAS: la toma 1 tiene start_en; las demás solo end_en, porque su cuadro inicial es el final de la anterior (un solo movimiento de cámara continuo que cuenta la frase de principio a fin). Cada toma lleva voice_part = el pedazo EXACTO de la frase que se oye sobre ella (en orden, cubriendo toda la frase): su duración se calcula sola con la voz, así la frase sigue al video. La PRIMERA imagen muestra literalmente la primera palabra fuerte ("luchar" → el caballero peleando). Movimiento tipo anime: cada end_en es un pasito del anterior, MISMO ángulo y casi el mismo encuadre ("The same view slightly closer: …"), nada cambia de golpe. 4–6 tomas. Video corto: lo que dura la voz + 2 s.',
    visual: 'Dark epic cinematic fantasy, photorealistic, a lone battle-worn medieval knight, black and gold palette, volumetric god rays, rain, embers and golden particles in the air, dramatic low-key light, film grain',
    voz: 'Orus',
    vozEstilo: 'Narrador épico en español latino: voz grave, profunda y firme, solemne, con peso en las palabras clave (luchar, silencio, Dios, victoria) y pausas solemnes solo entre frases; crece con fuerza en la frase final. Nunca grita, nunca suena a comercial. Mantén la MISMA energía e intensidad de principio a fin de cada frase: nunca te apagues ni bajes la voz al final.',
    cierre: { text: 'SOLO DIOS DA LA VICTORIA', subtext: 'Síguenos para más frases que te levantan', voice: 'Síguenos para más frases que te levantan.' },
    reglas: 'El mismo personaje en TODAS las tomas, descrito igual en cada start_en/end_en (p. ej. "a lone knight in dark battle-worn steel armor, a tattered dark hooded cape and an engraved lion crest on the chest, face hidden in shadow"); nunca se le ve la cara de frente. La frase pedida se dice EXACTA, palabra por palabra. Texto en pantalla estilo PÓSTER (story_bible.subtitle_style = "poster"): en cada toma, text_big = 1–3 palabras clave de su línea que salen GRANDES, y text_gold = las palabras sagradas o de victoria que salen en ORO (p. ej. ["SOLO","DIOS"]). Sin hook_text (el póster ya muestra la frase). Sin sangre ni violencia gráfica: las batallas son siluetas, humo y chispas.',
    fuentes: false
  }
};

function buildNarratedPromptRaw(tipo, p, episodeNumber = 1) {
  return `Eres un guionista profesional de videos verticales cortos (TikTok, YouTube Shorts, Reels) especializado en ${p.nombre}. Tu trabajo se mide en dos números: cuántos pasan de los primeros 3 segundos y qué porcentaje del video ven. Escribes obras maestras que nadie puede dejar de mirar.

=== IDENTIDAD DE ESTE TIPO DE VIDEO ===
- TONO: ${p.tono}
- GANCHO MODELO: ${p.gancho}
- ESTRUCTURA: ${p.estructura}

=== CÓMO SE ESCRIBE UNA OBRA MAESTRA ===
1. GANCHO (toma 1, 0–3 s): máximo 12 palabras; empieza YA, sin saludo ni contexto. Prohibido: "¿Sabías que…?", "Hoy te voy a contar", "Increíble", "No vas a creer", "Imagina que…", "Mira…". La imagen de la toma 1 ya está en movimiento y muestra lo que dice la frase.
2. HOOK_TEXT: 3 a 5 palabras en MAYÚSCULAS que aparecen en pantalla los primeros 3 segundos (para quien ve sin sonido).
3. BUCLE ABIERTO (tomas 2–3): una pregunta que solo se responde al final. El cerebro no suelta una pregunta abierta.
4. UNA SOLA HISTORIA de causa → efecto → consecuencia. Nunca una lista de datos sueltos. Cada frase empuja a la siguiente ("y entonces…", "pero…").
5. RE-ENGANCHE cada 15–20 s: un giro o una escalada ("Entonces ocurrió algo que nadie esperaba"). Lo más fuerte va al 70–80 % del video.
6. PALABRAS CON PESO, ritmo de tráiler: alterna frases cortísimas (2–4 palabras) con frases largas; "…" donde la voz debe respirar antes de lo fuerte. Traduce cifras a algo concreto. PROHIBIDO lo infantil o cursi ("un poquito", "como un trompo", diminutivos, chistes) y el relleno.
7. IMAGEN = FRASE: cada toma muestra EXACTAMENTE lo que dice su frase (si dice "volcanes", se ven volcanes; si dice "gigante", se ve gigante), con una acción visual fuerte y una cámara con energía. Nunca una imagen quieta ni decorativa.
8. FINAL: responde el bucle abierto; si puedes, vuelve a la imagen o la idea del gancho para que al repetirse el video se sienta continuo. Nada de "dale like".
${p.reglas ? '8b. REGLAS DE ESTE TIPO: ' + p.reglas + '\n' : ''}${p.fuentes ? '9. CERO DATOS FALSOS: cada dato lleva su fuente en continuity.sources (estudio, institución, libro, año). Si hay un rango, palabras prudentes ("unas", "cerca de", "casi"). Si no se puede verificar, no entra. Nunca inventes cifras para que suene más dramático.\n' : ''}
=== REGLAS TÉCNICAS (obligatorias; el sistema valida el JSON) ===
- DURACIÓN: objetivo 1:01–1:20 (lo que funciona en el canal, oct-2026). El sistema genera UNA SOLA VOZ continua para todo el video (no una por toma) y corta cada toma justo donde la voz pasa a su línea; las letras salen grandes palabra por palabra. Ritmo del narrador ≈ 2.3 palabras por segundo → apunta a ~170 palabras en total. NUNCA sacrifiques una buena frase para que quepa: si la historia necesita más, AGREGA ESCENAS (más tomas con imágenes nuevas) o alarga una toma; la PC hace tomas de hasta 15 s. 10 a 18 tomas. Cada toma: UNA línea del narrador (6 a 25 palabras); si una idea pasa de ~15 s de voz, pártela en dos escenas con dos imágenes distintas.
- Solo narrador en off: dialogue = [{ "speaker": "Narrador", "line": "…" }] en todas las tomas. Nadie habla ni mueve la boca en cuadro.
- characters: [] (sin personajes fijos). Si sale una persona, que sea genérica, de espaldas, en silueta o de lejos, descrita en start_en.
- Textos para la IA de video en INGLÉS y en AFIRMATIVO (lo que SÍ se ve; nunca "no", "without", "never"): camera, start_en (cuadro inicial exacto), action_en (acción de 0 a 6 s), reaction_en (cómo queda de 6 a 8 s), background_en (3–4 elementos del lugar), locations.visual.
- VIDEOS DE VARIAS COSAS (tres datos, cinco misterios…): el gancho dice cuántas son y la primera línea de cada bloque ANUNCIA su número en voz: "Número uno: …", "Número dos: …", "Y número tres: …" (la última, con "Y"). Así el espectador sabe en cuál va y espera la siguiente.
- IMAGEN = NARRACIÓN, AL PIE DE LA LETRA: el start_en de cada toma muestra EXACTAMENTE el objeto o la acción que nombra su línea (si dice "levanta la línea directa" → la mano levantando el teléfono; "la computadora marca un misil" → la pantalla de radar con el punto; "el sistema satelital" → el satélite en órbita). Nunca un tablero genérico en lugar de lo que se nombra. TODAS las tomas llevan su propio start_en (cada toma es un corte con su imagen).
- CUADRO FINAL (end_en) SOLO en tomas abiertas donde algo cambia mucho en la MISMA vista (un misil que sube, una ola que rompe, un animal que salta): "The same view: …". En primeros planos, pantallas, objetos y rostros: end_en = "" (la cámara se acerca sola). Nunca un end_en que cambie de lugar o de encuadre (plano general → primer plano): sale una transformación fea.
- UN SOLO SUJETO principal por imagen. Personas: de espaldas o en silueta, escrito así: "seen from directly behind, back of his head toward the camera, facing the screen". Nunca de frente a cámara, nunca con objetos que no estén en la narración (tazas, papeles).
- Máquinas, salas, búnkers: movimiento ambiental (luces que parpadean, humo leve, pantallas que cambian); la acción fuerte solo cuando la narración la tiene (misiles, explosión, animal cazando).
- camera SIEMPRE en movimiento (nunca "static"): tomas abiertas con energía ("fast push-in toward …", "crane up to reveal …", "FPV drone fly-over", "camera travels alongside …"); primeros planos lentos ("very slow push-in toward …", "slow orbit around …").
- CIERRE: la última toma termina con una pregunta directa al espectador para que comente ("¿Qué habrías hecho tú? Te leo en los comentarios."), con una imagen de cierre propia.
- Prohibido pedir: texto, letreros, papeles legibles, pantallas con letras, multitudes, peleas, carreras, manos en primer plano, espejos. Sin comillas dobles dentro de los textos.

=== JSON A ENTREGAR (solo el JSON, sin explicaciones) ===
{
  "format_version": 3,
  "slug": "${p.slug}",
  "title": "${p.title}",
  "genre": "${tipo}",
  "language": "es",
  "synopsis": "Videos únicos narrados: ${p.nombre}.",
  "story_bible": {
    "format": "narrado_unico",
    "tone": "${p.tono.replace(/"/g, '')}",
    "visual_style": "${p.visual}",
    "narration": { "engine": "gemini_tts", "voice": "${p.voz}", "model": "gemini-3.8-flash-tts", "video_audio": "none", "style": "${p.vozEstilo.replace(/"/g, '')}" },
    "end_card": { "enabled": true, "mode": "tail", "text": "${p.cierre.text}", "subtext": "${p.cierre.subtext}", "voice": "${p.cierre.voice}", "seconds": 2.5 },
    "extras": { "Narrador": { "who": "an off-screen narrator who is never visible on camera", "voice": "a deep, resonant adult male documentary narrator voice in neutral Latin American Spanish", "voiceover": true } },
    "rules": { "keyframes": true, "shot_seconds": 8, "shots_per_episode": <número de tomas>, "max_dialogue_words_per_shot": 28, "max_characters_per_shot": 2, "max_words_per_episode": 600, "shot_model": "veo_lite", "cliffhanger_model": "veo_lite", "reference_images": false },
    "locations": { "<lugar>": { "visual": "…", "ambient": "…" } }
  },
  "characters": [],
  "episodes": [{
    "episode_number": ${episodeNumber},
    "title": "<título con curiosidad, máx. 60 caracteres>",
    "continuity": { "summary": "…", "last_cliffhanger": "<la última frase>", "hook_text": "<3–5 PALABRAS>", "sources": ["…"] },
    "shots": [{ "n": 1, "location": "<lugar>", "characters": [], "scene_es": "…", "camera": "…", "start_en": "…", "end_en": "…", "action_en": "…", "reaction_en": "…", "background_en": "…", "dialogue": [{ "speaker": "Narrador", "line": "…" }], "sfx": "" }]
  }]
}

Antes de entregar, revisa toma por toma: gancho sin frases prohibidas, bucle abierto plantado y resuelto, giro al 70–80 %, tono del tipo de video, ninguna frase infantil, la imagen muestra lo que dice la frase, cámara con energía, inglés en afirmativo${p.fuentes ? ', fuente de cada dato' : ''}. Entrega solo el JSON.`;
}

const buildCuriosityPrompt = (opts = {}) => buildNarratedPrompt('curiosidades', opts);

// Frases (voz continua): quita las reglas de video narrado por tomas que no aplican y ajusta el JSON.
function continuousVariant(raw) {
  const drop = /^(2\. HOOK_TEXT|3\. BUCLE ABIERTO|4\. UNA SOLA HISTORIA|5\. RE-ENGANCHE|8\. FINAL|- DURACIÓN MÁXIMA|- Solo narrador en off|- VIDEOS DE VARIAS COSAS|- IMAGEN = NARRACIÓN|- CUADRO FINAL|- CIERRE)/;
  let t = raw.split('\n').filter((l) => !drop.test(l)).join('\n');
  t = t.replace('=== REGLAS TÉCNICAS (obligatorias; el sistema valida el JSON) ===', '=== REGLAS TÉCNICAS (obligatorias; el sistema valida el JSON) ===\n- UNA SOLA VOZ para todo el video: continuity.voice_text = la frase EXACTA; todas las tomas con "dialogue": [] y con "voice_part" (su pedazo exacto de la frase, en orden). story_bible.narration.mode = "continuous" y story_bible.subtitle_style = "poster". Toma 1 con start_en; las demás solo end_en (encadenadas). Cada toma: text_big (1–3 palabras clave grandes) y text_gold (palabras en oro).');
  t = t.replace('"video_audio": "none",', '"video_audio": "none", "mode": "continuous",');
  t = t.replace('"format": "narrado_unico",', '"format": "narrado_unico", "subtitle_style": "poster",');
  t = t.replace(/"continuity": \{[^\n]*\},/, '"continuity": { "summary": "…", "voice_text": "<la frase exacta>" },');
  t = t.replace(/"shots": \[\{[^\n]*\}\]/, '"shots": [{ "n": 1, "location": "<lugar>", "characters": [], "scene_es": "…", "voice_part": "<pedazo exacto de la frase>", "camera": "…", "start_en": "…", "end_en": "…", "action_en": "…", "background_en": "…", "dialogue": [], "text_big": ["…"], "text_gold": ["…"] }, { "n": 2, "voice_part": "…", "camera": "…", "end_en": "The same view slightly closer: …", "action_en": "…", "dialogue": [] }]');
  t = t.replace(/Antes de entregar, revisa[^\n]*/, 'Antes de entregar, revisa: la frase va EXACTA en voice_text, los voice_part la cubren completa y en orden, la primera imagen muestra la primera palabra fuerte, cada end_en es un pasito del anterior, inglés en afirmativo. Entrega solo el JSON.');
  return t;
}

// Prompt maestro LIMPIO (oct-2026: "solo el prompt maestro y ya"): sin temas ni frases de ejemplo
// metidas (Claude las copiaba). Las reglas se quedan; los ejemplos entre paréntesis con comillas se quitan
// de la parte de instrucciones (el JSON de ejemplo no se toca). La idea la escribe el usuario al final.
function buildNarratedPrompt(tipo = 'curiosidades', { topic = '' } = {}) {
  const p = TIPOS[tipo] || TIPOS.curiosidades;
  const raw = buildNarratedPromptRaw(tipo, p);
  const cut = raw.indexOf('=== JSON A ENTREGAR');
  let body = raw;
  if (tipo === 'frases') body = continuousVariant(raw);
  const cut2 = body.indexOf('=== JSON A ENTREGAR');
  const head = (cut2 > 0 ? body.slice(0, cut2) : body)
    .replace(/\s*\((?:p\. ?ej\.\s*)?[^()]*["“][^()]*\)/g, '')
    .replace(/\s*\((?:Franklin|idea de Franklin|pedido de Franklin)[^()]*\)/g, '')
    .replace(/[ \t]+\n/g, '\n');
  const idea = tipo === 'frases'
    ? `=== MI IDEA ===\nFrase exacta (va en continuity.voice_text palabra por palabra, sin cambiar nada):\n${topic || '<escribe aquí tu frase>'}\n`
    : `=== MI IDEA ===\nTema del video:\n${topic || '<escribe aquí tu tema>'}\n(Si no escribes tema, elige tú ${p.temaDefault}.)\n`;
  return head + (cut2 > 0 ? body.slice(cut2) : '') + '\n\n' + idea;
}

module.exports = { TIPOS, buildNarratedPrompt, buildCuriosityPrompt };
