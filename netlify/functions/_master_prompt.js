// "Prompt maestro": el texto que Franklin copia desde el dashboard (botón PROMPT → Copiar
// prompt maestro) y le pega a Claude para que escriba una novela COMPLETA nueva, ya en el
// formato exacto que importa el dashboard (formato v2). Las reglas de aquí son las MISMAS
// que hace cumplir validateSeries() en _series.js — si cambias una, cambia la otra.
//
// El ejemplo de formato se arma en vivo a partir de series/dulce_engano.json, así nunca se
// desactualiza respecto al formato real.

function buildExample(sample) {
  const ep = sample.episodes[0];
  const example = {
    format_version: 2,
    slug: 'mi_novela_nueva',
    title: 'Título de la novela',
    genre: 'Género',
    language: 'es',
    synopsis: 'Sinopsis de 2 a 4 frases.',
    story_bible: {
      tone: sample.story_bible.tone,
      setting: sample.story_bible.setting,
      visual_style: sample.story_bible.visual_style,
      negative: sample.story_bible.negative,
      themes: sample.story_bible.themes,
      rules: sample.story_bible.rules,
      locations: { bakery: sample.story_bible.locations.bakery },
      extras: { Consejero: sample.story_bible.extras.Consejero }
    },
    characters: [sample.characters[0]],
    episodes: [
      {
        episode_number: 1,
        title: ep.title,
        wardrobe: { Valentina: 'outfit en inglés solo si cambia en este episodio' },
        continuity: ep.continuity,
        shots: [ep.shots[2], ep.shots[6]].map((s, i) => Object.assign({}, s, { n: i + 1 }))
      }
    ]
  };
  return JSON.stringify(example, null, 2);
}

function buildMasterPrompt(sample) {
  return `Eres un guionista profesional de microdramas verticales (TikTok / Reels / Shorts) y director de fotografía experto en Veo 3.1. Vas a escribir una novela COMPLETA, de principio a fin, lista para producirse con IA sin intervención humana.

=== MI IDEA ===
- Nicho / género: [ESCRIBE AQUÍ]
- Idea o premisa (opcional): [ESCRIBE AQUÍ o deja "inventa tú"]
- Número de episodios: [12]
- Tomas por episodio: [12] (cada toma dura 8 segundos)
- Estilo visual: [ej. "High-end 3D animated feature film style…" o "Photorealistic cinematic…"]
- ¿Usar fotos de referencia de los personajes? [sí / no] (sí = caras idénticas pero cuesta ~3.7× más: Veo Fast)
- Idioma de los diálogos: español de México

=== QUÉ ENTREGAS ===
Un ÚNICO objeto JSON válido (nada de texto antes o después), con EXACTAMENTE la estructura del ejemplo de abajo. Si tu interfaz lo permite, entrégalo como archivo .json descargable. No uses comentarios dentro del JSON.

=== REGLAS OBLIGATORIAS (si rompes una, el sistema rechaza la novela) ===
1. slug: solo minúsculas, números y guion bajo (3–60 caracteres). Único para esta novela.
2. Todos los textos para la IA de video van en INGLÉS: visual_style, negative, locations, extras, fixed_prompt_tag, default_outfit, voice, wardrobe, camera, action_en, reaction_en, sfx. Los textos para personas van en ESPAÑOL: title, synopsis, tone, description, personality, wants, fear, arc, scene_es, continuity, dialogue.line.
3. NUNCA uses comillas dobles (") dentro de ningún texto. En español usa comillas tipográficas “ ” o ninguna.
4. Personajes (máx. 6):
   - key: un solo nombre (ej. "Valentina"). name: nombre completo.
   - role: "protagonista", "antagonista" o "secundario".
   - fixed_prompt_tag: EMPIEZA con "<key>," y describe SOLO identidad física fija (edad, piel, pelo, ojos, rasgos únicos, complexión). NUNCA ropa.
   - profile.default_outfit: ropa habitual en inglés.
   - profile.voice: voz en inglés, siempre la misma (ej. "a warm, slightly husky young female voice with a soft Mexican accent").
   - profile: age, archetype, personality, wants, fear, arc.
5. story_bible.locations: cada set con "visual" (descripción visual fija en inglés) y "ambient" (sonido ambiente en inglés). Reutiliza sets: 6 a 18 en total.
6. story_bible.extras: personajes sin nombre que hablan (consejero, guardia, juez…): { "who": "…", "voice": "…" } en inglés. Los extras no van en "characters" de la toma; se describen en action_en.
7. story_bible.rules: shots_per_episode = número de tomas pedido; shot_seconds = 8; max_dialogue_words_per_shot = 15; max_characters_per_shot = 2; max_words_per_episode = 450.
   - Si en MI IDEA pido "usar fotos de referencia" (caras idénticas en todas las tomas): reference_images = true, shot_model = "veo_fast", cliffhanger_model = "veo_fast" (Veo Lite NO acepta fotos).
   - Si no lo pido: reference_images = false, shot_model = "veo_lite", cliffhanger_model = "veo_lite".
   - keyframes = true SIEMPRE (memoria visual: cada toma se anima desde un cuadro inicial generado con las fotos de los personajes y la imagen fija del lugar).
   - Por eso las descripciones de "locations" deben ser muy concretas y estables (colores, muebles, luz), y cada action_en debe empezar describiendo la posición inicial de los personajes.
8. Cada episodio tiene EXACTAMENTE shots_per_episode tomas, numeradas n = 1, 2, 3… y episode_number consecutivo desde 1.
8b. Audio: describe solo los sonidos de quienes están en cuadro. Nunca pidas risas, aplausos ni voces de fondo si no hay gente que las haga.
9. Cada toma:
   - characters: máximo 2 personajes con nombre en cuadro (usa sus key).
   - dialogue: UN solo hablante por toma ({ "speaker": key o extra, "line": "…" }) o null. Máximo 15 palabras. El hablante debe estar en characters (o ser un extra).
   - camera: encuadre + movimiento simple (ej. "Close-up, static camera", "Medium two-shot, slow push-in").
   - action_en: lo que pasa de 0 a 6 s, UNA acción principal.
   - reaction_en: de 6 a 8 s, una reacción QUIETA (mirada, pausa, respiración). Así el corte entre tomas es limpio y no hay que editar.
   - scene_es: resumen de la toma en español (máx. ~30 palabras).
   - sfx (opcional): efecto de sonido puntual en inglés.
   - wardrobe (opcional): solo si la ropa cambia en ESA toma.
10. Diálogo: al menos 80% de las tomas con diálogo. Conversaciones en plano/contraplano (alternar hablantes entre tomas). Frases naturales, con emoción, nada de explicar la trama.
11. Cada episodio termina en GANCHO (cliffhanger) sin resolver. El último episodio cierra el arco principal pero deja un gancho para temporada 2.
12. continuity de cada episodio: summary, last_cliffhanger, pending_state (español). La historia completa debe ser coherente de principio a fin: nadie sabe algo antes de descubrirlo, los objetos y heridas persisten, la ropa coincide con el momento.
13. EVITA en cámara (Veo los genera mal): espejos y reflejos, texto legible (carteles, pantallas con letras, documentos leíbles), multitudes, peleas, carreras o persecuciones, primeros planos de dedos/manos haciendo cosas finas. Para cartas o pantallas, describe la reacción del personaje, no el texto.
14. Contenido apto para plataformas: sin violencia gráfica, sin contenido sexual explícito, sin marcas reales ni personas reales.

=== EJEMPLO DE ESTRUCTURA (respeta nombres de campos y tipos; el contenido es solo ilustrativo) ===
${buildExample(sample)}

Antes de entregar, revisa tú mismo cada regla toma por toma (número de tomas, 1 hablante, ≤15 palabras, ≤2 personajes, sin comillas dobles, campos completos) y corrige lo que falle. Entrega solo el JSON final.`;
}

module.exports = { buildMasterPrompt };
