# REGLAS PARA CLAUDE — leer ANTES de tocar cualquier video de VYRALES

Este documento es la memoria del proyecto. Cada vez que Franklin corrige algo, la regla se agrega aquí
(y en el código / prompt maestro). Claude lo lee antes de cada trabajo para no repetir errores ni gastar de más.

## 1. Dinero
- No lanzar nada que cueste (Gemini imagen $0.067, Veo, voces repetidas) sin decir cuánto y por qué. Lo gratis primero: imágenes en Google Flow, video en king.
- Antes de regenerar algo, preguntarse: ¿hace falta rehacerlo entero o solo una parte? (una toma, una frase).
- Medir el resultado (duración, movimiento, sincronía) ANTES de mandarlo, no después de que Franklin lo vea.

## 2. Voz (lo que más molesta si cambia)
- **NUNCA cambiar la voz ni el estilo del narrador sin preguntar.** Franklin elige una voz y esa queda.
- Una voz ya aprobada (`continuity.voice`, idealmente con `approved: true`) **no se regenera completa**. Si cambia el texto, el sistema rehace SOLO las frases nuevas y las pega en la voz original (`_voice_patch.js`).
- La voz no se acelera más de 5 %. Si el video queda largo: **NO se quitan palabras**. Se agregan escenas nuevas o se alargan tomas (king hace hasta 15 s por toma). Tampoco se cambia el estilo.
- Si hay que rehacer la voz completa, avisar primero: "la voz va a sonar distinta".

## 3. Formato
- Videos narrados: UNA sola voz, letras grandes palabra por palabra, cortes exactos con la voz.
- Objetivo 1:01–1:20 (TikTok paga > 1:00): ~170 palabras con el narrador del búnker (~2.3 palabras/s). Si la historia lo necesita, más escenas antes que recortar texto.
- Una toma dura entre 2 y 15 s (límite de LTX en king). Línea larga → toma larga o dos escenas.
- La imagen muestra exactamente lo que dice la narración en ese momento.
- Títulos llamativos pero verdaderos ("La noche que CASI empezó la Tercera Guerra Mundial").

## 4. Imagen y movimiento (LTX en king)
- Todo en afirmativo; el negativo no funciona.
- Cámara siempre en movimiento; primeros planos lentos; "movimiento potente" solo con acción real.
- Imagen final solo en tomas abiertas en la misma vista; nunca de lejos a primer plano.
- Personas de espaldas o en silueta, sin objetos inventados.
- Un sujeto por imagen.

## 5. Proceso
- OBJETIVO: pegar el guion → Generar → sale perfecto a la primera. Cada corrección de Franklin se convierte en regla de código/prompt el mismo día (no se arregla solo el video de hoy).
- Cambios pequeños, uno a la vez, medir, documentar.
- Lo que se aprende se mete al código y al prompt maestro (`_guionista.js`), no solo al video de hoy.
- Al renumerar tomas: los clips llevan versión en el nombre; revisar que no se pisen archivos.

## 6. Qué hace el pipeline solo al darle "Producir" (oct-10)
1. Voz continua completa (o parche si ya había voz aprobada) → acelera máx. 5 % → Whisper local da el tiempo de cada palabra (con re-escucha de tramos saltados y ventanas de 24 s).
2. Duración de cada toma = su parte de la voz (2–15 s).
3. Imágenes con Google Flow (personas de espaldas, un sujeto) → video en king (LTX) con cámara en movimiento.
4. Unión: cortes exactos con la voz, letras palabra por palabra, música con ducking, etiqueta IA.
5. QA automático (agente/_qa.js): clip más corto que su voz o congelado > 40 % → se rehace solo y se vuelve a unir.
6. Paquete de publicación: título y portada empiezan con el tema gancho; título fijado (`continuity.title_locked`) se respeta; sin "Parte 1/1" en videos sueltos.
7. Subidas a Supabase con reintentos (5xx sueltos).
- Importar un guion narrado nuevo en un canal que ya existe = VIDEO NUEVO (siguiente número de episodio). Nunca reemplaza la serie ni los videos anteriores, y conserva la voz/estilo elegidos (oct-10: el guion de Teutoburgo no aparecía porque pisaba al de Petrov).

## Imágenes = narración y Flow en lote (oct-10)
- Antes de generar cuadros, `_visual_check.js` (Gemini, ~$0.02–0.04/episodio) compara cada línea del narrador con su start_en y reescribe las que no muestran lo que se dice (personas cuando la línea habla de gente, clima/época correctos, metáfora visual para cifras, ninguna imagen repetida, fauna/geografía del lugar). Una vez por episodio (`continuity.visual_checked`); las tomas corregidas quedan `frame_stale` y se rehacen solas.
- Flow genera en LOTES: un solo mensaje con varias escenas numeradas (6 por lote, `FLOW_LOTE`). Mandar pedidos seguidos NO sirve (se pierden mientras genera). Flow devuelve las imágenes en desorden → se emparejan mirándolas (Gemini visión). Lo que no empareje se hace una por una.
- Botón de cuadro por toma en series Flow → `flow_frames:<ep>:<n>` en la PC ($0). Si la toma ya tenía video, se rehace en king y se vuelve a unir el final.
- PROMPTS SÚPER DETALLADOS (oct-10): start_en 45–80 palabras (plano+lente, sujeto con detalles físicos, instante, lugar con 3 elementos, luz, atmósfera); action_en 25–45 palabras con UN movimiento simple (qué se mueve, dirección, ritmo, qué queda quieto; nada aparece ni se transforma); reaction_en 12–25; background_en 3–4 elementos. Lo exige el guionista maestro y lo completa el revisor (_visual_check) en cada episodio. Personas anónimas sí cuando la línea habla de gente (1–6, de espaldas/perfil/media distancia).
- Analítica → idea → "Crear guion JSON" (idea-script-background.js, Gemini 3.1 Pro + revisor, ~$0.16, 2–3 min): JSON completo validado, con botones Crear en el panel / Copiar / Descargar. Queda con visual_checked (no se revisa dos veces).
- EDITAR TOMA COMPLETA (oct-11): botón "Editar toma" (lista del guion y tarjeta del video) → narración + imagen actual + prompts de imagen/movimiento/final/fondo/cámara; Guardar, Detallar con IA, Guardar + nueva imagen y video, Guardar + solo video, Subir mi imagen (shot-edit.js). Lo escrito ahí manda (borra overrides viejos). Las tarjetas muestran la narración de la toma y avisan "imagen/video por rehacer".
- EDITOR con voz continua: muestra lo mismo que el render — cada toma dura el corte exacto de la voz, suena la voz continua y el texto sale GRANDE palabra por palabra (edit-plan devuelve `cont`).
- GRATIS PRIMERO (Franklin, oct-11: "todo el proyecto está pensado para gratis; si se necesita, se paga"): imágenes = Google Flow ($0); videos = LTX en king ($0); guiones, ideas, revisor de imágenes y "Detallar con IA" = Claude en la PC con el plan ($0). Gemini por API solo como respaldo cuando la PC está apagada, y SIEMPRE preguntando antes (confirm con el costo). Voz (TTS ~$0.06) y música (~$0.08 una vez por serie) siguen siendo las únicas cosas pagadas.
- PARTIR TOMAS (oct-11): si una frase nombra 2–4 cosas que se ven distintas, se parte en varias tomas cortas (una por cosa) — lo hace solo el revisor (Claude, campo "split") y a mano con "✂ Dividir en varias tomas" en Editar toma. Los pedazos salen de la línea ORIGINAL (mismas palabras y puntuación) → la voz no se regenera; el corte cae en la palabra por shotCutsExact. Se renumeran tomas siguientes, assets y plan del editor (_split.js). Imagen inicial + final solo para la MISMA vista (distinto = morphing feo).
- VIDEO LARGO 16:9 (oct-11): serie "<canal> · Historias completas" (story_bible.aspect '16:9', max_seconds 1100); sus Shorts viven en la MISMA serie como episodios con continuity.parent_episode_id + aspect '9:16' y el panel los muestra en un submenú bajo su largo. Formato por episodio > serie (render, Flow). Flow: "Horizontal 16:9" en el prompt y filtro de imágenes apaisadas (probado: 3/3 en 45 s, 1376x768). LTX: orientación según la imagen inicial (1280x704). Render 1280x720. Voz larga: por capítulos/~300 palabras, misma voz y estilo, 1 toma por pedazo.
- Orden para producir un largo: 1) "Generar cuadros" (Flow en lotes), 2) revisar/editar tomas, 3) Producir (LTX en king, ~3–4 h).
- LLAMADA A LA ACCIÓN de los Shorts (regla fija, Franklin oct-11): la última línea SIEMPRE es "Si quieres ver la historia completa, entra al enlace que te dejo aquí abajo." + en pantalla "HISTORIA COMPLETA / en el enlace de aquí abajo" con un dedo 👇 que rebota (assets/finger.png, Twemoji CC-BY 4.0). Prohibido "lo contamos completo en el video largo de nuestro canal" y frases así (suenan a IA). Los textos para publicar llevan la misma frase con 👇.
- TOMAS PARTIDAS en el panel: "TOMA 4 · PARTE 1/3", y las partes 2..N van debajo con sangría (↳), cada una con su imagen.
- GRATIS PRIMERO también en: botón "Generar cuadro" por toma (abre Editar toma → Flow) y Lugares fijos (Flow en la PC, flow_lugar). Las únicas cosas pagadas que quedan: voz (TTS) y música.
- NARRACIÓN PULIDA (oct-11): nada de "Y" suelta como muletilla al empezar frases; la historia fluye sin saltos bruscos (las transiciones se anuncian); nada de palabras raras. Cierre de los largos SIEMPRE: "Si quieres más historias como esta, contadas completas, suscríbete al canal." (sin "Y"). Está en el guionista maestro (VOZ HUMANA + estructura) y además Claude hace un PASO DE PULIDO automático (_pulir.js) en todo guion nuevo (Short, largo y sus Shorts) y a mano con el comando claude_pulir.

## Movimiento en LTX: NUNCA nombrar quietud (oct-2026)
- LTX corre destilado con cfg = 1: hace TODO lo que lee. "the clouds stay still", "the lake stays completely steady", "the column rests steady" congelaban TODA la toma (Toba largo: la columna no subía, el corte de la caldera no se movía).
- action_en / reaction_en: describir SOLO lo que se mueve, con verbos visibles (sube, se expande, cae, se agrieta). Prohibido: still, steady, stay(s), remain, fixed, motionless, frozen, static, unchanged, "lo demás se queda quieto".
- Lo que nombra la narración es lo que MÁS se mueve, a velocidad que se note.
- En código (_king.js onlyMotion): en narrados se borran las frases de quietud de la acción y se omite un final que solo describa quietud. El modo "gentle" (movimiento muy suave) es solo para primeros planos (close-up/macro/ojo), no para "slow push-in".

## Sin humo/neblina de relleno (oct-2026)
- Salía humo blanco innecesario en tomas normales (Toba largo T30 oficina, T31 avenida, T32 chimpancés). Fuentes: el estilo de la serie decía "smoke and dust in the air", el guionista metía "golden haze / mist / dust motes drift" como relleno de movimiento, y el prompt de LTX añadía "dust and haze drift".
- Regla: humo, neblina, niebla, bruma, haze, mist, polvo flotando SOLO si la línea habla de humo, ceniza, fuego, erupción, tormenta, niebla. Si no: "the air is clear".
- En código (_king.js hazeScene/onlyMotion) se quitan esas frases y las palabras del estilo de la serie cuando la escena no trata de eso. Estilo de cibertales_historia(_completa) cambiado a "clear air, atmospheric depth".

## Control de calidad automático de tomas (oct-2026)
- Al final de cada producción (gen_local) y con el comando qa_tomas:<episodio>, agente/_qa.js revisa cada toma ANTES de que Franklin la vea:
  1. Duración contra su parte de la voz continua (corta → se rehace más larga).
  2. Congelada (ffmpeg freezedetect > 40 % del clip) → se rehace.
  3. Revisión visual con Claude (plan Max, $0, lee 3 cuadros: inicio/mitad/final): imagen que no cuadra con la narración → cuadro nuevo (solo tomas sin personajes, camino gratis Flow/FLUX) + video; acción que no se ve, humo de relleno o algo deforme → video otra vez con qa_boost (movimiento reforzado en el prompt de LTX).
- UNA sola vuelta por toma (shot.qa.redone): si sigue mal, queda marcada en el panel ("⚠ QA: se rehízo y sigue con problema") para revisión humana. Nunca bucles ni cobros.
- Calibración (Toba largo, oct-2026): T7 congelada de verdad (cambio casi nulo); el resto tenía movimiento de cámara aunque el sujeto no se moviera → por eso hace falta la revisión visual, no solo la de píxeles.

## Lo que encontró el QA visual en el largo Toba (oct-2026, ~32 de 90 tomas)
- Papeles/libros que aparecen en manos de cazadores y arqueólogos: venía de la frase del prompt de LTX "Objects ... (envelopes, letters) ... Papers and letters are plain" → ahora solo en novelas con personajes, nunca en narrados.
- Gente que se gira a cámara: la frase "small natural expressions with the eyes" → en narrados se usa "keep the same number, direction and clothing".
- Cámara "con energía" que avanza hasta que el sujeto sale de cuadro o desaparece → "exactly this one smooth move ... the main subject is in the picture from the first second to the last".
- Personas que cambian de número (4→5, 3→2) y objetos que desaparecen: mismas causas; vigilar.
- QA: hasta 2 intentos por toma (shot.qa.tries); luego queda marcada para revisión humana.
- (oct-11, tarde) QA con 3 intentos: en TODOS Claude reescribe cámara/acción/final con lo que vio el QA (Franklin: sin cambiar el prompt no se arregla); imagen nueva si no cuadra o desde el 2º intento (sin personajes); también para clips congelados. Repetir el mismo prompt daba el mismo error (T6 Toba). El prompt anterior se guarda en shot.qa_rewrite_from.
- (oct-11) start_en tampoco puede decir "frozen mid-fall"/"suspended in mid-air": LTX deja la toma congelada (T16 Toba). _king.js lo cambia por "in the middle of falling" en narrados.
- QA visual más estricto: 5 cuadros por toma + movimiento medido en píxeles; action_ok exige comparar 2 objetos entre el cuadro 1 y el 5 (si solo cambia el encuadre de cámara → false). Campo evidence.
- Botón ✗ en cada tarjeta del panel: Franklin marca "no está bien" + motivo → shot.qa.force → qa_tomas la rehace con prompt reescrito por Claude aunque la revisión automática la haya aprobado.
