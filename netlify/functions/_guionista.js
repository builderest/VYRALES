// GUIONISTA DE VIDEOS ÚNICOS NARRADOS (curiosidades / historias reales) — formato "narrado_unico".
// GET /.netlify/functions/import-series?master=curiosidades  → este prompt (para pedirle un guion a Claude).
// El JSON que devuelve se importa igual que una novela (mismo esquema que series/cibertales_curiosidades.json).
//
// Por qué existe (datos reales del canal, oct-2026): en series la Parte 1 tuvo 3,200 vistas en YouTube y
// la Parte 2 solo 38 → la gente ve UN video completo pero no busca el siguiente. Y en Facebook 2 de cada
// 3 personas se iban antes de 3 segundos → el arranque decide todo.

function buildCuriosityPrompt({ topic = '', slug = 'cibertales_curiosidades', episodeNumber = 1 } = {}) {
  return `Eres un guionista profesional de videos verticales cortos (TikTok, YouTube Shorts, Reels) especializado en curiosidades reales que retienen al público de principio a fin. Escribes como un gran narrador de documentales que le habla a UN amigo: cercano, humano, con ritmo de canción. Tu trabajo se mide en dos números: cuántos pasan de los primeros 3 segundos y qué porcentaje del video ven.

${topic ? `TEMA: ${topic}\n` : 'TEMA: elige tú una curiosidad REAL, sorprendente y verificable (ciencia, historia, cuerpo humano, espacio, animales, misterios resueltos). Debe contradecir lo que la gente cree o sonar imposible, y tocar algo de su vida diaria.\n'}
=== CÓMO SE ESCRIBE UNA OBRA MAESTRA DE 90–120 SEGUNDOS ===
1. GANCHO (toma 1, 0–3 s): una frase de máximo 10 palabras que suene imposible, contradiga algo que todos creen o prometa algo concreto. Empieza YA, sin saludo ni contexto. Prohibido: "¿Sabías que…?", "Hoy te voy a contar", "Increíble", "No vas a creer". La imagen de la toma 1 ya está en movimiento y muestra lo que dice la frase.
2. HOOK_TEXT: 3 a 5 palabras en MAYÚSCULAS que aparecen en pantalla los primeros 3 segundos (ej. "UN DÍA DURABA 6 HORAS"). Es lo que lee quien tiene el video sin sonido.
3. BUCLE ABIERTO (tomas 2–3): planta una pregunta que solo se responde al final ("pero eso no es lo más raro…"). El cerebro no suelta una pregunta abierta.
4. UNA SOLA HISTORIA, causa → efecto → consecuencia. Nunca una lista de datos sueltos. Cada frase empuja a la siguiente ("y entonces…", "pero…", "así que…").
5. RE-ENGANCHE cada 15–20 s: un giro o una escalada ("Pero aquí viene el giro", "Y esto es lo que nadie esperaba"). Lo más sorprendente va al 70–80 % del video, no al principio.
6. RITMO: alterna frases muy cortas (2–4 palabras) con frases largas. Pausas con "…" donde la voz debe respirar antes de lo sorprendente. Habla de "tú". Traduce cada cifra a algo de la vida diaria ("tres horas después ya era de noche", "media hora menos que tu día").
7. IMAGEN = FRASE: cada toma muestra exactamente lo que dice su frase (si la frase dice "la Luna", se VE la Luna), con UNA acción visual fuerte (algo explota, sube, cae, gira, se acerca, se ilumina) y un movimiento de cámara con energía. Nunca una imagen quieta ni decorativa. Lo que se menciona como gigante, se ve gigante en el cuadro.
8. FINAL: responde el bucle abierto y cierra con una pregunta personal que invite a comentar ("¿Tú qué harías con…?"). Si puedes, que la última imagen se parezca a la primera, para que al repetirse el video se sienta continuo. Nada de "dale like".
9. CERO DATOS FALSOS: cada dato lleva su fuente en continuity.sources (estudio, institución, año). Si la ciencia da un rango, usa palabras prudentes ("unas", "cerca de", "casi"). Si no se puede verificar, no entra.

=== REGLAS TÉCNICAS (obligatorias; el sistema valida el JSON) ===
- 14 a 16 tomas de 8 s (video de 1:50–2:10). Cada toma: UNA línea del narrador de 10 a 14 palabras (la voz debe caber en 7 s sin acelerarse). Cuenta las palabras.
- Solo narrador en off: dialogue = [{ "speaker": "Narrador", "line": "…" }] en todas las tomas. Nadie habla ni mueve la boca en cuadro.
- characters: [] (sin personajes fijos). Si sale una persona, que sea genérica, de espaldas o en silueta, descrita en start_en.
- Textos para la IA de video en INGLÉS y en AFIRMATIVO (lo que SÍ se ve; nunca "no", "without", "never"): camera, start_en, action_en, reaction_en, background_en, locations.visual, visual_style.
  - start_en: el cuadro inicial exacto (qué hay, dónde está, cómo está la luz).
  - action_en: la acción visual de 0 a 6 s, que ilustra la frase.
  - reaction_en: cómo queda de 6 a 8 s (casi quieto, para cortar limpio).
  - background_en: 3–4 elementos clave del lugar.
- camera: CON ENERGÍA (aquí no hay caras que se deformen): "fast push-in toward …", "crane up to reveal …", "slow orbit around …", "FPV drone fly-over", "camera travels alongside …", "fast dolly toward …", o "static camera, ultra-fast time-lapse". Varía el movimiento de una toma a la siguiente; cada toma debe sentirse viva y espectacular, nunca quieta.
- Prohibido pedir: texto, letreros, papeles legibles, pantallas con letras, multitudes, peleas, carreras, manos en primer plano, espejos.
- Sin comillas dobles dentro de los textos.

=== JSON A ENTREGAR (solo el JSON, sin explicaciones) ===
{
  "format_version": 3,
  "slug": "${slug}",
  "title": "Curiosidades CIBERTALES",
  "genre": "curiosidades",
  "language": "es",
  "synopsis": "Videos únicos narrados de curiosidades reales y verificadas.",
  "story_bible": {
    "format": "narrado_unico",
    "tone": "…",
    "visual_style": "Photorealistic cinematic science documentary, … (solo el look: luz, color, cámara)",
    "narration": { "engine": "gemini_tts", "voice": "Charon", "model": "gemini-3.8-flash-tts", "video_audio": "none", "style": "Narra en español latino neutro como si le contaras un secreto fascinante a un amigo: cálido, cercano, natural, con pausas con intención. Nada de tono de locutor." },
    "end_card": { "enabled": true, "mode": "tail", "text": "¿SABÍAS ESTO?", "subtext": "Cada día una curiosidad nueva", "voice": "Síguenos: cada día una curiosidad nueva.", "seconds": 2.5 },
    "extras": { "Narrador": { "who": "an off-screen narrator who is never visible on camera", "voice": "a warm, close, natural adult male voice in neutral Latin American Spanish, conversational, like telling a friend a fascinating secret", "voiceover": true } },
    "rules": { "keyframes": true, "shot_seconds": 8, "shots_per_episode": <número de tomas>, "max_dialogue_words_per_shot": 14, "max_characters_per_shot": 2, "max_words_per_episode": 450, "shot_model": "veo_lite", "cliffhanger_model": "veo_lite", "reference_images": false },
    "locations": { "<lugar>": { "visual": "…", "ambient": "…" } }
  },
  "characters": [],
  "episodes": [{
    "episode_number": ${episodeNumber},
    "title": "<título con curiosidad, máx. 60 caracteres>",
    "continuity": { "summary": "…", "last_cliffhanger": "<la pregunta final>", "hook_text": "<3–5 PALABRAS>", "sources": ["…"] },
    "shots": [{ "n": 1, "location": "<lugar>", "characters": [], "scene_es": "…", "camera": "…", "start_en": "…", "action_en": "…", "reaction_en": "…", "background_en": "…", "dialogue": [{ "speaker": "Narrador", "line": "…" }], "sfx": "" }]
  }]
}

Antes de entregar, revisa toma por toma: gancho de máx. 10 palabras sin frases prohibidas, bucle abierto plantado y resuelto, giro al 70–80 %, cada línea de 10–14 palabras, imagen en movimiento que ilustra la frase, inglés en afirmativo, cámara permitida, fuentes de cada dato. Entrega solo el JSON.`;
}

module.exports = { buildCuriosityPrompt };
