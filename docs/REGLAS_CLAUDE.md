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
