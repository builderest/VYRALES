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
