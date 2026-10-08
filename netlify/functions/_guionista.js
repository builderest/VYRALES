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
  }
};

function buildNarratedPrompt(tipo = 'curiosidades', { topic = '', episodeNumber = 1 } = {}) {
  const p = TIPOS[tipo] || TIPOS.curiosidades;
  return `Eres un guionista profesional de videos verticales cortos (TikTok, YouTube Shorts, Reels) especializado en ${p.nombre}. Tu trabajo se mide en dos números: cuántos pasan de los primeros 3 segundos y qué porcentaje del video ven. Escribes obras maestras que nadie puede dejar de mirar.

TEMA: ${topic || 'elige tú ' + p.temaDefault + '.'}

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
${p.fuentes ? '9. CERO DATOS FALSOS: cada dato lleva su fuente en continuity.sources (estudio, institución, libro, año). Si hay un rango, palabras prudentes ("unas", "cerca de", "casi"). Si no se puede verificar, no entra. Nunca inventes cifras para que suene más dramático.\n' : ''}
=== REGLAS TÉCNICAS (obligatorias; el sistema valida el JSON) ===
- 12 a 16 tomas (video de 1:40–2:30). Cada toma: UNA línea del narrador. Lo normal: 10 a 14 palabras (toma de 8 s); si la frase queda mejor más larga, hasta 28 palabras (la toma se alarga sola hasta 16 s). Nunca recortes una buena frase; tampoco rellenes. Alterna tomas cortas y largas.
- Solo narrador en off: dialogue = [{ "speaker": "Narrador", "line": "…" }] en todas las tomas. Nadie habla ni mueve la boca en cuadro.
- characters: [] (sin personajes fijos). Si sale una persona, que sea genérica, de espaldas, en silueta o de lejos, descrita en start_en.
- Textos para la IA de video en INGLÉS y en AFIRMATIVO (lo que SÍ se ve; nunca "no", "without", "never"): camera, start_en (cuadro inicial exacto), action_en (acción de 0 a 6 s), reaction_en (cómo queda de 6 a 8 s), background_en (3–4 elementos del lugar), locations.visual.
- CUADRO INICIAL + CUADRO FINAL (cinematografía): cada toma lleva start_en (primer cuadro exacto) y end_en (último cuadro exacto, en INGLÉS y afirmativo). La IA de video viaja del uno al otro, así que la toma TERMINA en una imagen pensada: un revelado, un cambio de escala, una transformación (p. ej. start_en "extreme macro of a dilated human pupil" → end_en "the pupil's black center fills the frame and becomes a dark abyssal seabed lit by a single submarine spotlight"). Los dos cuadros muestran EXACTAMENTE lo que dice la narración de esa toma. Cuando conviene, el end_en de una toma prepara visualmente el start_en de la siguiente (transiciones que encajan).
- camera con energía y variada: "fast push-in toward …", "crane up to reveal …", "slow orbit around …", "FPV drone fly-over", "camera travels alongside …", "fast dolly toward …", "static camera, ultra-fast time-lapse".
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

module.exports = { TIPOS, buildNarratedPrompt, buildCuriosityPrompt };
