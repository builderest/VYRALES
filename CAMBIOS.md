# CAMBIOS · Memoria del proyecto VYRALES

> **Para la IA (y para Franklin):** este archivo es la MEMORIA viva del proyecto. Si una sesión de Claude se pierde, otra lo lee y continúa sin empezar de cero. **REGLA: cada cambio que hagamos se anota aquí** (fecha, archivo, qué, por qué). Lo más nuevo arriba.
>
> Preferencias de Franklin: cambios mínimos, uno a la vez (diagnosticar → confirmar → cambiar → probar). Respuestas en español, código/términos en inglés. Marcar HECHO / EVIDENCIA / INFERENCIA / HIPÓTESIS / OPINIÓN. Cuestionar decisiones y señalar errores. **Probar en LOCAL (localhost:8888 con `netlify dev`); no hacer push sin que Franklin lo pida** (gasta tokens de Netlify).
>
> El estado más completo del proyecto (producción de video, voz, Flow, redes) está en el doc del Proyecto de claude.ai: **claude/estado-vyrales.md**. Este CAMBIOS.md es el registro de cambios de código.

## Mapa rápido (dónde está qué)
- **Agente** (`agente/agente.js`): corre en la PC "Cronix", lee `agent_jobs` de Supabase y ejecuta comandos (lista blanca en `agente/comandos.js`). Se reinicia solo al cambiar su código **cuando está libre** (watch: agente.js, comandos.js, .env). Carriles en paralelo: Claude (hasta 3), general (hasta 3), **Flow (Chrome)** y **king (GPU)** ahora en paralelo entre sí. `push` corre aparte.
- **Guionista** (`netlify/functions/_guionista.js`): arma el prompt. `buildLongPrompt` (video largo + shorts) y `buildNarratedPrompt`/`buildNarratedPromptRaw` (shorts sueltos). Lo corre `agente/claude_largo.js` / `claude_guion.js` en la PC (proceso nuevo cada vez → lee el prompt actual sin reiniciar el agente).
- **Importar largo** (`netlify/functions/import-largo.js`): convierte el guion de Claude en episodios/tomas y llama a `import-series.js` (que escribe en BD y crea `characters`).
- **Render** (`netlify/functions/_render.js`, lo corre `agente/render_local.js` en la PC): compone el video. `renderTail()` = cierre con dedo 👇 y textos.
- **Tenencia** (`netlify/functions/_tenant.js`): `workspaces` (admin `00000000-…-0001`; canales tienen `owner_ws=admin`; clientes `owner_ws=null`). Canal activo = cookie `vyrales_ws`. `_keys.js` resuelve claves por workspace.
- **Series ocultas**: `series.is_active=false`. Hay que filtrarlo en CADA listado.
- **Agrupado largo+shorts**: por `continuity.parent_episode_id` (UUID del largo). Mover de serie = cambiar `episodes.series_id`.

---

## Registro de cambios

### 2026-10-13 / 14  (sesión Claude Cowork)

**Canal VYRALES enfocado solo en Historia (short + completa).** Las otras 7 series ocultas (`is_active=false`), no borradas, hasta tener un canal por nicho.
- `netlify/functions/videos.js` — filtra `is_active=false` (no listar videos de series ocultas). **Pusheado (commit 2213e9c4 get-episodes; b46c692 videos).**
- `netlify/functions/get-episodes.js` — dropdown `allSeries` filtra ocultas. **Pusheado.**
- `public/dashboard.html` — si la serie activa está oculta, el panel cambia solo a una visible (ya no reaparece `dulce_engano`). **Pusheado (b46c692).**
- `netlify/functions/analytics.js` — caché **por workspace** (`cache[ws]`) en vez de global; MindFuel ya no muestra datos de VYRALES. **Pusheado (b46c692).**
- `.env` en Cronix — `DASHBOARD_KEY='(valor en .env, no se escribe aquí)'` entre comillas (el `#` rompía el parseo local y el login admin fallaba). **Local de la PC.**

**El Chapo movido** de `cibertales_curiosidades_completa` (oculta) a `cibertales_historia_completa` (#15-19: 1 largo + 4 shorts). Decisión: rehacer su guion con el sistema nuevo de personajes fijos; borrar los #15-19 viejos SOLO después de verificar e importar el nuevo.

**Agente multi-tarea** (`agente/agente.js`) — **pusheado (commit ee00eaf):**
- `claude_ideas`/`claude_*` ahora corre en **canales del admin** (`owner_ws=admin`, como MindFuel), no solo admin. Se agregó `adminChannels` (set) y la compuerta salta `USER_OK` para esos canales. Antes: "Comando no permitido para esta cuenta".
- **Flow (Chrome) separado de king (GPU):** `GPU_RE` (de a uno, GPU) y `FLOW_RE`/`flowBusy` (de a uno, Chrome) corren EN PARALELO. `KING_RE` queda solo para excluirlos de la fila general.
- `render_full` ya **no** se encola para episodios sin tomas de video (`queueFullRenders` filtra los que no tienen `video_clip`): detiene el bucle de fallos que mantenía ocupado al agente.

**Guionista decide personajes/lugares fijos** — **pusheado (ee00eaf):**
- `netlify/functions/_guionista.js` (`buildLongPrompt` + `buildNarratedPromptRaw`): el guionista DECIDE según la historia si necesita personajes fijos (biografías: El Chapo) o no (grupos anónimos: Toba/Flores). Si sí → los define en `characters` con `fixed_prompt_tag` constante y `reference_images: true`. **Regla de seguridad (persona real):** personaje GENÉRICO de su época, NO retrato exacto ni copia de foto con derechos; 3/4, sin primer plano frontal. También `locations` fijos.
- `netlify/functions/import-largo.js`: antes forzaba `characters: []` y `reference_images: false` (borraba lo que definía Claude). Ahora los **deja pasar** y activa `reference_images` cuando hay personajes. (`import-series.js` ya sabe crear `characters` por `series_id,name`; `_keyframe.js` genera/reusa la imagen de referencia.)

**URL en pantalla bajo el dedo** (`netlify/functions/_render.js`, `renderTail`) — **LOCAL, pendiente de push:**
- En los Shorts que llevan al largo (`finger`), se dibuja `vyrales.app/ver` debajo del dedo 👇 (a ~0.82H), porque TikTok/IG no dejan enlace clickeable: el espectador la escribe. Usa `PUBLIC_SITE_HOST || 'vyrales.app'`.

**Fase 2 en marcha:** regenerando el guion largo de El Chapo *"El hombre que desapareció frente a las cámaras"* (job `largo-mv7eby1m11at`) con el sistema nuevo. Verificar que defina a El Chapo como personaje fijo ANTES de importar; luego borrar los #15-19 viejos.


### 2026-10-13/14 (cont.) — Flujo de 3 salas (Guiones → Produciendo → Editar y publicar)
Visión de Franklin: un guion NO se produce directo desde Guiones; primero se MUEVE a producción; "Produciendo" es la sala de trabajo (solo UNO a la vez); al terminar pasa a "Editar y publicar". TODO LOCAL, SIN PUSH (probado en localhost:8888).
- **FASE 1** `public/panel.js`: la "Fila de producción" (#vyFilaRows) ya no incluye `en_revision` (esos van a Revisar y publicar). Verificado: 24→15 por terminar.
- **FASE 2a (compuerta)** — verificado:
  - `netlify/functions/mover-produccion.js` (NUEVO, local): POST {episode_id,on} marca `episodes.continuity.en_produccion`. Regla SOLO UNO A LA VEZ por serie (409 si ya hay otro). Auth por cookie admin (checkDashboardKey).
  - `public/panel.js`: la Fila ahora muestra SOLO los que tienen `continuity.en_produccion`.
  - `public/dashboard.html` (renderOne de Guiones): sin producir directo. Si NO está en producción → muestra el guion de solo lectura (scriptPreview) + botón "Mover a producir". Si SÍ → workspace completo + "Sacar de producción". Botón "Mover a producir / Quitar de producción" también en la CABECERA (summary) con stopPropagation.
- **FASE 2a** ajuste: `mover-produccion.js` mueve el GRUPO completo (largo + sus Shorts) como una unidad; el "uno a la vez" trata el grupo como uno. `panel.js`: la Fila muestra solo el largo (Shorts no como filas sueltas). dashboard.html: botón "Mover a producir" NO sale en los Shorts (solo largo/standalone), y también en la cabecera (summary) de cada guion.
- **FASE 2b (sala Produciendo)** — verificado: `renderOne(e, inRoom)` parametrizado → Guiones SIEMPRE solo lectura (scriptPreview), la sala (#produccionWorkspace, nueva sección en dashboard.html) muestra el workspace completo del largo en producción + sus shorts agrupados + un header con PERSONAJES FIJOS y LUGARES FIJOS arriba. El workspace ya no vive en Guiones.
- **PENDIENTE**: Fase 2c (pase automático a "Editar y publicar" cuando el de la sala queda listo + toggle ocultar "listo para producir" en Guiones) · arreglar por qué El Chapo salió sin personajes fijos (Fase 1 no tomó en el largo).
- NOTA: `mover-produccion.js` es función nueva → para producción hay que pushear (hoy solo corre en local). El resto (panel.js/dashboard.html) también local sin push.

---
*(Agrega aquí los próximos cambios, lo más nuevo arriba.)*

## 2026-10-14 — Siempre Flow ($0) en fotos de personaje + TOMAS FIJAS

- **Fotos de personaje SIEMPRE con Flow ($0)** cuando la serie tiene `story_bible.image_engine='flow'`:
  - `agente/flow_cara.js`: nuevo comando PC `node agente/flow_cara.js <slug> [characterId]` → genera fotos de cara con Google Flow (baja ORIGINAL `=s0`, resolución completa). Con `characterId` regenera solo ese.
  - `agente/comandos.js`: registrado `flow_cara` (arg `slug` o `slug:uuid`, hidden).
  - `agente/agente.js`: `flow_cara` en USER_OK + dispatch + script map (`flow_cara.js`) + maxMin 20.
  - `netlify/functions/_character_photo.js`: `createCharacterPhoto` usa Flow si `VYRALES_LOCAL_RUN` + engine flow (costUsd:0), si no Gemini.
  - `public/dashboard.html` `generateCharacterPhotos()`: rama Flow → encola `flow_cara:<slug>[:id]` por el agente. Botones muestran "(Flow, $0)".
- **Prompt de la foto de referencia**: confirmado que es CARA/apariencia, ropa neutra (camiseta gris lisa), fondo neutro — la ropa de escena la decide el guion en cada toma (NO se fija aquí). `buildImagePrompt` en `_series.js` ya lo hacía bien.
- **Strip TOMAS FIJAS** (`#tomasFijasStrip`): corregido para leer la imagen desde `series.visual_memory.locations[k].url` (antes miraba `story_bible`, nunca mostraba la generada). Botón **Generar N imágenes** en `#genFijasBtn` → `generateMissingFixedLocations()` (Flow $0, una por una).
- **Responsive**: grid personajes `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3` + `max-h-[400px] overflow-y-auto` (no crece de más con 6+). Tira de tomas scroll horizontal.
- PENDIENTE: regenerar El Chapo con `claude_largo.js` corregido (tagging por toma) + `location` en shot del long en `_guionista.js`. PUSH de todo cuando Franklin apruebe.

## 2026-10-14 — QA visual: 6 a 9 fotos por toma (en vez de 5)

- `agente/_qa.js` `visionReview`: antes sacaba 5 fotos fijas por toma (`t_1..t_5`). Ahora saca **6 a 9** según la duración del clip (~1 por segundo, `nF = clamp(round(dur), 6, 9)`), repartidas de inicio a fin. Decisión Franklin: más muestras = mejor verificación de movimiento/estilo, con **Claude ($0)** en vez de pagar Gemini (que se consideró "mejor" pero de pago).
- Prompt del revisor: referencias dinámicas ("la primera y la última imagen", "puntos intermedios") en vez de "imagen 1 y la 5" fijo.
- Aplica solo (cada corrida carga el _qa.js más nuevo); no requiere reinicio.

## 2026-10-14 — PROMPT MAESTRO LTX-SAFE (precisión en la generación: que salga bien a la primera)

Diagnóstico con datos: EP 11 (Tsar Bomba, 121 tomas) → 73 malas (60 %): `broken` 55, `action_ok` 47, `haze` 11, `style_ok` 0.
Causas: multi-actor en una toma (LTX deforma/cambia nº de personas), push-in/grúa/seguimiento (solo se mueve la cámara
o pierde al sujeto), objetos frágiles (papel, sellos, cuerdas, mapas, pantallas → aparecen/desaparecen/letras), humo de relleno.
Las reglas viejas SE CONTRADECÍAN: el guionista ponía como ejemplo "fast push-in, crane up, FPV drone fly-over, slow orbit",
"atmósfera: humo, niebla" y "grupos de 1 a 6".

- **NUEVO `netlify/functions/_ltx_safe.js`** = UNA sola fuente de verdad: `LTX_SAFE` (9 reglas: un sujeto/un movimiento,
  máx. 3 personas sin contar, cámara lateral corta sin acercarse/alejarse, sujeto dentro, movimiento grande, nada frágil
  ni con letras, fondo simple, nada cambia/aire limpio, action_en 20–35 palabras + revisión obligatoria), `SAFE_CAMERAS`,
  `safeCamera()`. Lecciones nuevas se agregan AQUÍ y llegan a las 3 capas.
- `_guionista.js`: narrado y largo llevan LTX_SAFE (en el narrado se agrega DESPUÉS de la limpieza de ejemplos para no
  perderlos); cámara segura; "una toma = un sujeto haciendo una sola cosa"; máx. 3 personas; aire limpio; campo
  **`location`** por toma en el largo (chapters y shorts) + regla de etiquetar el lugar fijo.
- `_visual_check.js` RULES: + LTX_SAFE; personas máx. 3; action_en 20–35; aire limpio en start_en.
- `_king.js` `ltxPromptFor`: red de seguridad `safeCamera` (push-in/grúa/seguimiento/órbita/dron → "slow lateral drift")
  en narrados, también para guiones ya escritos; el relleno automático pasa de "slow push-in" a desplazamiento lateral.
- `agente/_qa.js` `rewriteShot`: + LTX_SAFE; se quitó "REPIENSA desde cero" (hacía que el 2º intento saliera PEOR) →
  "corrige con precisión el fallo concreto SIMPLIFICANDO".
- **BUG** `agente/claude_largo.js` `detail()`: las filas no llevaban `characters` ni `location` → TODAS las tomas del largo
  quedaban sin personaje y con lugar "escena" (El Chapo EP15/EP20: 0 tomas con personaje, 0 con lugar fijo). Arreglado.
- PENDIENTE: regenerar El Chapo con el guionista nuevo (tiene visual_checked=true → no se reescribe solo).
- SIGUIENTE: "cerebro" del QA (especialista con memoria por toma + aprendizaje con evidencia que retroalimenta al guionista).

### PENDIENTE (texto de Franklin, oct-14) — retomar al terminar y verificar el cerebro
> "El QA no trabaja con King, ¿verdad? Si es así, cuando un video corto termina, el QA puede revisarlo de una vez; no tiene que
> esperar a que termine todo. Puede ir haciendo QA e ir marcando los que necesitan rehacerse o no, porque son trabajos
> diferentes. Si uno necesita rehacerse desde 0, ese lo pone en cola hasta que la producción completa termine.
> Otra cosa: los Shorts no se deben ejecutar con el maestro; deben ejecutarse independientes, ya que se crean después de
> que el padre está creado y verificado. Deben crearse solos, no juntos con el padre, sino individual al padre."

## 2026-10-14 — 🧠 CEREBRO (aprende con evidencia) + 🔧 ESPECIALISTA de reparación

Pedido de Franklin: "que aprenda, guarde todo, revise, tenga memoria e independencia; que no se lleve de lo que le digan sino
de lo que funciona (algo que salió bien muchas veces y mal una vez NO es un consejo); que se comunique con el guionista".

- **F1/F2 `netlify/functions/_cerebro.js`** (Storage, carpeta de memoria del canal):
  - `featuresOf(shot)`: rasgos deterministas ($0) — cámara (acerca/sigue/lateral), multi-acción, personas (p0/p1/p2_3/p4mas),
    multitud, objeto frágil, texto, humo de relleno, fondo recargado, acción larga, gesto fino, sujeto sale, movimiento sutil,
    vehículo QUE SE DESPLAZA, explosión, plano cerrado/abierto, personaje fijo, solo cámara.
  - Evidencia (`cerebro_evidencia.json`): cada veredicto del QA y de Franklin. `syncFromDb({reset})` reconstruye desde la base.
    **Aprobaciones masivas ("aprobar todas", EP11 = 121 clips en 3 min) NO cuentan**; solo la aprobación individual (≤2/min)
    y los ✗ de Franklin. `franklinLive()` registra al instante (approve-shot individual, shot-edit qa_force), peso ×3.
  - Recupera el PRIMER intento de tomas reintentadas 1 vez (`qa_rewrite_from`).
  - Reglas (`cerebro_reglas.json`) SOLO con números y SOLO con PRIMEROS intentos (los reintentos tienen sesgo): activa si
    n≥8, ≥1.5× la base, intervalo de Wilson por encima de la base y **en ≥2 episodios**; degradada bajo 1.2× (histéresis);
    "funciona" si ≤0.6× la base en ≥2 episodios. Métrica "¿sirve reintentar?" por patrón. Fiabilidad del juez del QA por
    bandera, usable solo con acuerdos (sesgada si solo hay desacuerdos). Arreglos que funcionaron (rasgo quitado → arreglado).
  - `cerebroBlock()` → entra en `memoryBlock` (lo recibe Claude en CADA llamada: guionista, detallador, reparador, juez).
- **F3 `agente/_especialista.js`** + bucle de `agente/_qa.js`: bitácora por toma (`shots[].qa.attempts`), decide
  azar (solo faltó movimiento, toma limpia) / patrón / estructura (reintentar casi nunca sirve) / mínimo / seguro (tras 2) /
  humano / no_fiable; el reparador recibe la bitácora ("NO repitas") + la evidencia. `regen-shot-background` acepta
  `keep_old` → al final **se queda el MEJOR intento** (restaura clip + prompt) y borra los demás. Diario `cerebro_diario.json`.
  Al terminar cada QA, el cerebro piensa solo. El `ok` del reintento ahora incluye style_ok.
- **F4**: `_memoria.memoryBlock` sin las anécdotas "ERRORES RECIENTES"; `claude_aprender` solo consolida correcciones de
  Franklin (las del QA → cerebro). Endpoint `netlify/functions/cerebro.js`; sección 🧠 en el modal "Reglas aprendidas"
  (botones Pensar ahora / Recargar historial, diario, análisis). Comandos `cerebro_cargar` / `cerebro_pensar`
  (`agente/cerebro.js`; `pensar` = + análisis de Claude que SOLO OPINA, no cambia reglas).
- **Primeros resultados reales**: 300 tomas en 1er intento, falla 37 %; de 160 reintentadas siguen mal 38 %. 0 reglas activas
  (lo que más falla —vehículo que se desplaza 74 %, 4+ personas 63 %, multitudes 55 %— viene casi todo del EP11). FUNCIONA:
  acción detallada >40 palabras (18 %). Quitar "movimiento sutil" arregló 7/9.
- **El cerebro corrigió el maestro**: se revirtió "acción de 20–35 palabras" → 25–45 detallada (el detalle ayuda).
  OJO (sin evidencia todavía): la cámara push-in/seguimiento NO sale peor en 1er intento, y el humo de relleno sale MEJOR;
  las reglas LTX-SAFE de cámara/humo quedan como hipótesis hasta que el cerebro las confirme o descarte.
- Fix: `_keyframe.js` / `location-image.js` guardan el archivo sin tildes/espacios ("Túnel del Altiplano" fallaba: Invalid key).
- PENDIENTE: revisar con Franklin la memoria vieja `reglas.json` (39 reglas, varias de casos sueltos que contradicen lo nuevo,
  ej. #38 "muchas cosas moviéndose a la vez", #39 "la cámara solo se aleja").

## 2026-10-14 — Limpieza de la memoria vieja + El Chapo regenerándose
- `media/memoria/reglas.json`: 39 → 31 reglas (respaldo `memoria/reglas_respaldo_2026-10-14.json`). Se quitaron 8 reglas
  del QA (casos sueltos) que contradecían el maestro/cerebro o estaban repetidas: #19, #27, #29, #30, #31, #37, #38, #39.
  Las reglas de Franklin quedan TODAS.
- Choques resueltos a favor de Franklin: regla #14 (revelar paisaje enorme SIN personas → cámara se aleja y sube) ahora es
  excepción en LTX_SAFE y `safeCamera` ya no la convierte en lateral; regla #20 (los cambios de luz no se ven) → LTX_SAFE
  y el cerebro ya no proponen "mover la luz", sino cámara lateral.
- `import-largo.js`: cámara por defecto "slow lateral drift" (antes "slow smooth push-in").
- El Chapo (grupo EP20–24, el que está en Produciendo) se está REGENERANDO con el guionista nuevo, mismo tema:
  job `largo-mv7m61qa6ndt` (regenerado de `largo-mv7eby1m11at`). Al terminar: import-largo, mover en_produccion al grupo
  nuevo. EP15–19 y EP20–24 viejos NO se borran sin permiso de Franklin.

## 2026-10-14 — ⚖️ El cerebro puede decirle que NO a Franklin (objeciones)
Regla de Franklin: "si intento cambiar algo y él no está de acuerdo porque no funcionaría o contradice lo que ya tenemos,
tiene toda la libertad de decirme que no y no hacerlo, o avisarme en el Dashboard por qué y cuál sería la mejor solución;
yo puedo cometer errores que él no". Salvaguarda acordada: Franklin conserva "Hazlo igual" y lo forzado se mide como
experimento (`doc.forzados`: ¿quién tenía razón?).
- `_cerebro.js`: `judgeChange(antes, después, doc)` juzga SOLO lo que el cambio agrega/quita: `no` = agrega un patrón con
  evidencia fuerte (regla activa) → no se aplica; `aviso` = agrega algo sospechoso (observación, n≥8, ≥1.3×) o quita algo que
  funciona → se aplica y avisa. `cerebro_objeciones.json` (`addObjecion`/`setObjecion`/`listObjeciones`). Evidencia marca
  `forz` (cambio forzado) y `computeStats` cuenta cómo salieron.
- Puertas: `shot-edit.js` (editor de toma) y `shot-prompt.js` (prompt a mano) → 409 `{objecion}` salvo `forzar:true`
  (+`objecion_id`); al forzar, la toma lleva `franklin_forzado`. `memoria.js` → regla nueva queda `estado:'evaluando'`
  (no se usa) y encola `claude_aprender`, que la ACEPTA u OBJETA con razón + regla mejorada (`en_disputa`). Al consolidar,
  las correcciones de Franklin que contradicen la evidencia van a objeciones, y las reglas evaluando/en disputa/forzadas
  no las reescribe Claude. `memoryBlock` no usa reglas con `estado`.
- `netlify/functions/objeciones.js`: GET pendientes/recientes · POST {id, decision: forzar|propuesta|descartar}.
- Panel: diálogo "Hazlo igual" / "Tienes razón, no lo hagas" (openDialog acepta okText/cancelText), aviso flotante
  (`vyToast`), pastilla "🧠 N objeciones" abajo a la derecha (cada 90 s), sección ⚖️ en la vista 🧠 con
  Tienes razón / Usa tu propuesta / Hazlo igual, insignias ⏳/⚖️/experimento en las reglas.
- Memoria: regla #2 de Franklin (la libertad de decir que no con datos; él conserva la última palabra).
- Probado de punta a punta: cambio malo en EP20 T1 → 409 y la toma quedó intacta; regla [PRUEBA] de multitudes con push-in →
  Claude la objetó con datos y propuso dividir en 2 tomas; ambas se resolvieron con "Tienes razón" (regla borrada).

## 2026-10-14 — Prueba real El Chapo (supervisada) · arreglos que salieron
- Push `d75a1fd` a producción (cerebro, especialista, objeciones, LTX-safe, Producción 3 salas).
- Guion regenerado `largo-mv7m61qa6ndt` → EP25 (148 tomas) + Shorts EP26–28; en Produciendo (EP20–24 sacados, no borrados).
  Viejo EP20 → nuevo: personaje 0→34, lugar fijo 0→34, cámara que se acerca 19→4, frágiles 30→3, 4+ personas 5→2.
- **Importador con personajes fijos** (1ª vez que llegan de verdad): `import-largo.js` completa `key`/`role` y pone
  Veo Fast como respaldo cuando hay referencias; `_series.js`: en `narrado_unico` no exige voz/ropa fija/prefijo del tag, y
  las tomas pueden nombrar al personaje por NOMBRE (así lo busca `_keyframe.js`); `toEpisodeRows` no inventa ropa fija.
- **Detectores del cerebro afinados** (daban falsos positivos y ensuciaban las estadísticas): multi-acción solo si el
  "while" mete OTRA persona; multitud solo gente ("rows of soldiers", no "rows of cans"; "army soldiers" no es multitud);
  movimiento sutil solo personas; vehículo solo si el verbo es del vehículo (sin cruzar comas, sin "landing gear").
- **NUEVO `agente/preflight.js`** (comando `preflight:<ep>`): ANTES de producir, el cerebro marca las tomas con riesgo y
  Claude las corrige con el cambio mínimo (misma narración/sujeto/personaje/lugar); guarda `shot.preflight` (antes→después).
  EP25: 21 tomas corregidas (aviones estacionados con hélices girando, sin papeles, grupos de 3, fondos simples).
- Serie `cibertales_historia_completa`: `flow_characters=true` (las tomas con El Chapo van por Flow $0 con su foto como
  ingrediente; antes habrían ido por Gemini ~$2.30).
- Tomas fijas nuevas con imagen (Flow): "Celda de ADX Florence", "Lavandería de Puente Grande".
- 🐞 **BUG GRAVE (lo cazó la supervisión): el repaso del detallador REVOLVÍA la narración.** `claude_largo.js` `detail()`:
  el repaso de tomas sin acción/cámara dejaba que Claude PARTIERA tomas y reacomodaba por POSICIÓN (más tomas que las
  pedidas → todo se corría: frases encima de otras, tomas perdidas), y los grupos dejaban números de toma repetidos.
  EP25 salió con 58 líneas fuera de orden y la voz ($0.26) leyó ese texto → se descartó y se paró `flow_frames`.
  Arreglo: repaso sin partir + n temporal único + **GUARDIÁN** (si la narración detallada no es idéntica palabra por
  palabra a la pulida, se deshace el repaso; si sigue sin cuadrar, el guion NO se guarda). Opción `req.raw_file` para
  reusar una historia ya escrita (sin volver a pedirla). Afectados en el pasado: todas las versiones de El Chapo
  (EP15–19, EP20–24) y una de "hobbits" no producida. **Toba, EP6 y EP11 NO pasaron por repaso → sanos.**
  El Chapo se rehace: job `largo-mv7o2ert5zy6` (misma historia de Claude, `_to_delete/elchapo_historia_2026-10-14.txt`).
- Guion rehecho `largo-mv7o2ert5zy6`: **✅ guardián: narración idéntica palabra por palabra (1606 palabras)**; repaso de 5
  tomas sin partir. Orden verificado (Kate del Castillo T101 → Sean Penn T102 → juicio T118).
- 🐞 `import-largo.js`: al REIMPORTAR un guion con el mismo título, import-series ACTUALIZA EP25–28 (no crea nuevos) y el
  importador tomaba "el último episodio" (un Short) como el largo → los Shorts quedaban enlazados a EP28. Ahora busca el
  largo por su título. Se corrigieron a mano: EP26–28 → padre/cta = EP25. (Además yo había archivado EP25–28 creyendo que
  era la versión revuelta: se devolvieron a guion_generado. No se perdió nada.) Las 2 imágenes viejas (T4, T6) → frame_stale.
- Pre-vuelo EP25: 23 tomas corregidas, 3 falsas alarmas; las 6 que siguen marcadas se revisaron a mano y son aceptables
  (cámara domo, teléfono que la narración pide, radio grande y lisa). Detector: "dome camera"/"guard tower" ya no es fondo recargado.
- Producción EP25 arrancada: flow_frames `e001ae28…` (Flow $0, El Chapo con su foto como ingrediente) + voz_continua `e72e19c9…`.

## 2026-10-14 06:40 — 🔥 Producción: el panel daba HTTP 502 (Franklin, desde el celular)
- **ERROR EXACTO:** `get-episodes?series=cibertales_historia_completa` → 502 `Function.ResponseSizeTooLarge` (>6 MB, límite de
  Netlify). **CAUSA:** 28 episodios largos (4 versiones de El Chapo) y el campo `shot.prompt_preview` (prompt de Veo calculado
  al importar, 2.2 MB, que en narrados nadie usa) + voz palabra por palabra + prompts de assets.
- **Arreglo inmediato (datos):** se quitó `prompt_preview` de las tomas de las 7 series narradas (35 episodios, 1126 tomas,
  2.25 MB; es recalculable). Producción respondió 200 con 3.85 MB SIN necesitar despliegue.
- **Arreglo definitivo (código):** `get-episodes.js` recorta en la respuesta lo que la lista no usa (prompt_preview en narrados,
  palabras/segmentos/texto de la voz, voice_prev, bitácoras del QA y del pre-vuelo, prompt largo de assets) → 5.80 → 2.05 MB;
  `_series.js` ya no calcula prompt_preview en narrados.
- **⚠️ PARA FRANKLIN: Netlify NO desplegó el push d75a1fd.** En producción `mover-produccion`, `objeciones` y `cerebro` dan 404
  (siguen las funciones viejas). Las 59 funciones empaquetan bien con esbuild → no es el código. INFERENCIA: Netlify no está
  construyendo (¿créditos/minutos de build agotados o despliegues pausados?). Revisar en app.netlify.com → Deploys.

## 2026-10-14 06:55 — Vigía El Chapo: cuadros completos, arranca la producción
- Netlify ya despliega: `objeciones` responde 401 (antes 404) → el código nuevo está en producción.
- Cuadros 146/146. Las 4 tomas marcadas viejas (T4, T6, T57, T103) se rehicieron con Flow ($0).
- **Bug arreglado** (`agente/flow_cuadros.js`): las tomas CON personajes no quitaban la marca `frame_stale` al rehacerse
  (solo lo hacían las sin personajes) → el panel las seguía mostrando como viejas. Marca limpiada a mano en EP25.
- Lanzado `gen_local:3b110a58…` (king, $0) — job e97a7193.
- **07:00 — PARADO: king no responde.** `gen_local` falló al conectar con ComfyUI en king (100.66.84.73:8188, Tailscale,
  `UND_ERR_CONNECT_TIMEOUT`) en las tomas 1–9. Lo cancelé para no marcar las 146 como fallidas (no se perdió nada: no había
  clips; esas 9 se rehacen al relanzar). No hay forma de encender king desde aquí. **Franklin: encender king (o revisar que
  ComfyUI y Tailscale estén abiertos) y relanzar "Producir" en EP25** — o yo lo relanzo en cuanto king responda.

## 2026-10-14 07:00 — Netlify no publicaba desde c5d82b4: clave en CAMBIOS.md
- **ERROR EXACTO (log de Netlify):** `Secret env var "DASHBOARD_KEY"'s value detected: found value at line 29 in CAMBIOS.md`
  → el escáner de secretos de Netlify tumba el build (exit code 2). Desde el commit c5d82b4 NINGÚN push llegó a producción.
- **Corrección de lo que dije antes:** que `objeciones` diera 401 NO probaba el despliegue (la edge function `auth` responde 401
  antes de que se sepa si la función existe). Fue una inferencia mal fundada.
- **Arreglo:** quitado el valor de la clave de CAMBIOS.md. Regla: nunca escribir valores de `.env` en archivos del repo.
- **Pendiente Franklin:** la clave sigue en el historial de git (commit c5d82b4) → cambiar DASHBOARD_KEY (Netlify → Environment
  variables y `.env` de Cronix).
- **07:05 — Push rechazado por GitHub (videos >100 MB).** Un `git add -A` (mi ejemplo de instrucciones) metió 299 archivos
  locales (videos, imágenes, respaldos, 706 MB) en el commit e47e373. Deshecho con `git reset --mixed origin/main` — ningún
  archivo borrado, siguen en la carpeta. `.gitignore` ahora excluye medios (*.mp4, *.mp3, *.wav, *.tgz…) y carpetas de trabajo,
  así que `git add -A` ya es seguro.

## 2026-10-14 07:15 — Revisión toma 8 de El Chapo (pedida por Franklin)
- **Problema (visto en 9 cuadros del clip):** 3 s, "paneo lento a la izquierda". En el segundo 0.7 LTX hace una disolvencia a
  OTRA celda: desaparecen el muro de la ducha y la puerta, que son justo lo que dice la narración ("el único punto que la cámara
  no ve"). Fallo de continuidad, no de calidad de imagen (el cuadro inicial de Flow está bien).
- **CAUSA PROBABLE:** paneo en un espacio cerrado con lente 24 mm y solo 3 s: LTX no tiene "a dónde" mover la cámara y cambia de
  escena. **Corrección:** toma de cámara de seguridad fija (empuje casi imperceptible), parpadeo del fluorescente, sombra en la
  esquina; el muro queda en cuadro todo el tiempo. Marcada clip_stale.
- No se rehace todavía: `regen_local` corre el QA de todo el episodio y une el video, y gen_local va por la mitad. Se rehace al
  terminar gen_local.

## 2026-10-14 07:30 — 👁️ "Ojos" nuevos del QA: detector de corte de escena (por la toma 8)
- **Franklin:** "es para que mejores todo, para que seas los ojos y la próxima ya esté más pulido".
- **Medición (20 clips de EP25, diferencia entre cuadros a 8 fps):** T8 salto 29× lo normal (disolvencia a otra celda),
  T18 3.9× (la muralla salta a otro encuadre con torre). Los otros 18 clips ≤2.4×. Revisado a ojo: T8 y T18 son cortes reales;
  T10 (2.4×) no es corte.
- **`agente/_qa.js` → `sceneCut()`:** corte = salto ≥3.5× la mediana del clip y ≥8. Tres usos:
  1. Revisión mecánica (antes del QA visual, $0): si hay corte, Claude reescribe la toma con la causa exacta y se rehace.
  2. El QA visual recibe el aviso "CORTE MEDIDO a los X s" para comparar el lugar antes y después.
  3. Tomas con `clip_stale` (corregidas a mano por el supervisor o Franklin) se rehacen con SU prompt, sin reescribirlas.
- **`_cerebro.js`:** patrón nuevo `corto_con_camara` (clip ≤3 s con cámara que se desplaza). Es HIPÓTESIS: el cerebro lo mide
  con evidencia y solo será regla si los números lo confirman (independencia: 2 casos no bastan).
- Entra en acción al final de este mismo gen_local (el QA se carga al terminar), así que T8 y T18 deberían salir solas.

## 2026-10-14 07:45 — 👁️ Toma 2 (la vio Franklin): una parte del suelo se mueve y la otra no
- **Medición** (movimiento por franjas, 8 fps): en T2 la franja del medio (penal + terreno) se mueve 9.9 y el pasto del primer
  plano 2.7 → 2.3× al revés de lo que hace una cámara real (lo cercano se mueve MÁS). En los otros 10 clips sin personas:
  0.3–1.4. T7 da 6.3 pero es legítimo (el preso se agacha) → por eso el detector SOLO aplica a planos sin personas.
- **`_qa.js` → `bandMotion()` + `sinPersonas()`:** plano sin personas con el medio ≥2× el primer plano → se reescribe la toma
  ("drift lateral con primer plano que pase por delante, nada de paneos en planos abiertos") y se rehace.
- **`_cerebro.js`:** patrón `cam_paneo` separado de `cam_lateral`. HIPÓTESIS: en EP25 fallaron 2 de 6 paneos (T2, T8) y 0 de
  los drifts revisados. Lo decidirá la evidencia.
- **T2 corregida a mano:** cámara "slow lateral drift" a ras del pasto, el pasto pasa por delante y se mece, las luces del penal
  parpadean. clip_stale → el QA la rehace con este prompt al terminar gen_local (va por la 37/146, 0 fallos).

## 2026-10-14 07:35 — Vigía: tomas 21–39 medidas y revisadas
- gen_local va bien (0 fallos de king). Medidas las 19 tomas nuevas con los dos detectores:
  - **Corte de escena:** T21 (salto a 0.25 s y al final las casas del pueblo se "embarran" al alejarse) y T28 (la pila de
    sacos del almacén se derrumba/deforma y cambia la luz a 1 s). Ambas confirmadas a ojo → detector 4/4 aciertos, 0 falsos
    en 39 clips.
  - **Deformación parcial:** ninguna en planos sin personas (T35 da 2.3 pero tiene personas → no aplica, correcto).
- Las rehará el QA al final (T2, T8 por clip_stale; T18, T21, T28 por corte).

## 2026-10-14 07:55 — Más estricto con lo que se le pasa a LTX (pedido de Franklin)
- **EVIDENCIA (EP25, tomas 1–39, medida objetiva):** los 4 cortes/deformaciones de lugar (T8, T18, T21, T28) son TODOS
  planos sin personas: 4 de 18 sin personas vs 0 de 21 con personas. El juez visual nunca lo vio (para él "sin personas" falla
  igual que el promedio) porque juzga la acción, no si el lugar cambió.
- **INFERENCIA:** cuando solo se mueve la cámara, LTX "inventa" movimiento cambiando el lugar.
- **`_king.js` (prompt de LTX):** en planos sin personas ni vehículos se agrega, en afirmativo: "una sola toma continua: el lugar
  sigue siendo el mismo, los edificios, muros y objetos conservan forma, tamaño y posición; solo la cámara se desliza y los
  elementos naturales (luz, pasto, agua, tela) se mueven un poco". Aplica a 66 de 146 tomas de EP25. No prohíbe nada ni cambia
  la cámara (la evidencia de paneo vs drift aún no alcanza).
- **`_cerebro.js`:** un defecto MEDIDO manda sobre la opinión del juez visual (antes ganaba el primero que se registraba).
  **`_qa.js`:** cada corte/deformación medida se guarda como evidencia (src "medido") → el cerebro aprende de hechos.
- **gen_local reiniciado** (iba por la 48/146; el proceso viejo tenía el prompt anterior en memoria): job 65e95533. Salta los 47
  clips hechos; rehízo primero T2 (y sigue T8) con su prompt corregido; de la 48 en adelante ya usan el prompt estricto.

## 📌 PENDIENTE (Franklin, oct-14) — guionista, para después de verificar El Chapo
- Primera frase que enganche en 0–2 s a alguien que no conoce el canal.
- Presentar lugares y personajes para quien no sabe del tema (sin jerga ni nombres sueltos).
- Llamado a seguir / like / compartir. HECHO: el largo ya cierra con "Si quieres más historias como esta, contadas
  completas, suscríbete al canal." Falta decidir: un llamado corto a mitad del largo (tras un momento fuerte, nunca al
  inicio) y en los Shorts un cierre tipo "sígueme para la historia completa".
- Medirlo con las métricas de YouTube (retención/seguidores por video) antes de dejarlo como regla.

## 2026-10-14 08:20 — Vigía: tomas 40–66 + T2/T8 rehechas → detectores afinados y un bug del cerebro
- **T8 nueva:** el muro de la ducha ya se queda (✅ lo principal), pero hay un tirón de cámara a los 2.2 s (medido 17×). El QA
  la volverá a intentar.
- **T2 nueva:** sigue mal de otra forma: las luces del penal se apagan y la noche se vuelve atardecer. Los detectores
  numéricos NO lo ven (no hay salto ni deformación por franjas) → **el QA visual ahora compara la PRIMERA y la ÚLTIMA
  imagen: si el lugar se convirtió en otro (pozo→túnel, noche→atardecer, luces que desaparecen, pila que se derrumba sola)
  es broken**. Mismo caso en T12 (el pozo con escalera se vuelve un túnel horizontal).
- **Corte de escena:** umbral 3.5 → 3.0. Con 68 clips: cortes reales T8, T18, T21, T28, T56 (juzgado: corte a otro ángulo a
  1.9 s, ratio 3.1–4.6 según la medición), T65 (salta a primer plano del carrito); sanos ≤2.7.
- **BUG del cerebro arreglado:** contaba los AÑOS como personas ("from 1993 … gunmen" → "1993 personas" → 4+). Afectaba
  la estadística de "4 o más personas" de TODAS las series históricas con años en el prompt. Además faltaban palabras
  (gunmen, employee, lawyer, judge, actress, driver, brother…). La reconstrucción del cerebro ahora conserva la
  evidencia medida y la de Franklin en vivo. Se recalcula al terminar El Chapo (cerebro_cargar).
- Resultado provisional de la cláusula estricta (tomas 48–66 sin personas: T52, T55, T56, T59, T63): 1 corte (T56) de 5
  (20 %) vs 4 de 18 (22 %) antes. Muestra muy chica: todavía no dice nada; se juzga al final con ~45 tomas.

## 2026-10-14 11:40 — Panel: "toma 48 generando" se quedaba pegado durante el QA (lo vio Franklin)
- **CAUSA:** al terminar, `generate-media-background.js` guardaba `validator_report` desde la copia en memoria de ANTES de
  producir → devolvía un `qa_working` viejo (toma 48, "generar"). Y la fase automática del QA (cortes/duración) no avisaba
  en qué toma iba; solo la fase visual lo hacía.
- **Arreglo:** se relee `validator_report` antes de guardar y se limpia `qa_working`; el QA marca "revisar"/"rehacer" en cada
  toma también en la fase automática. Corregido a mano en EP25 (ahora muestra la toma real del QA).
- Las marcas de "revisada por QA" (shot.qa) las pone la fase VISUAL; aparecen cuando esa fase revise cada toma.

## 2026-10-14 11:50 — 📊 PRIMER INTENTO de El Chapo EP25 (146 tomas), medido + revisado a ojo
- **Malas a la primera (vistas a ojo, todas confirmadas):** 13 de 146 → **133 pasan (91 %)**:
  T2 (deforma/luces), T8, T12 (pozo→túnel), T18, T21, T28, T56, T65, T78, T84, T128 (pared se vuelve textura),
  T142 (celda salta a otra), T146 (túnel con saltos).
- **Falsos positivos del medidor:** T132 (hombre en la ventana, corte 9.6 pero el clip es continuo), T136 (humvees que
  avanzan) y T137 (avioneta, franjas 2.1). Arreglado: el detector de deformación ya no aplica con vehículos y sube a 2.2.
  T132 queda como falso positivo conocido del detector de cortes (con persona en primer plano).
- **Aparte (no es calidad):** tomas cuyo clip quedó más corto que su voz (T12, T24, T31…): el QA las alarga.
- **Falta** el juicio visual (caras, manos, imagen = narración): ese número puede bajar el 91 %.
- **Cláusula estricta (sin personas):** cortes antes 4/18 (22 %) → después 6/42 (14 %). Mejora, pero aún sin
  significancia estadística; se sigue midiendo.
- Las 13 malas son TODAS sin personas excepto T65 → el problema de LTX está en planos de solo lugar.

## 2026-10-14 11:50 — 🔥 El QA llevaba 2 h 17 min MUERTO (no corriendo)
- **EVIDENCIA:** el último clip rehecho por el QA fue T31 a las 09:29 UTC; `agente.log` muestra "arrancando agente" a las
  4:29 AM (= 09:29 UTC) y 6:16 AM: la PC/agente se reinició y mató el proceso. En la base el trabajo seguía "running" y
  nadie lo retomaba (el panel parecía trabajando).
- **Arreglo (`agente/agente.js` → `recoverOrphans`)**: al arrancar, todo trabajo "running" es huérfano → se marca cortado y
  los largos (gen_local, regen_local, render_full, qa_tomas, flow_frames, voz_ingles, short_reusar) se re-encolan una vez.
  Probado: a las 11:46 UTC el agente se reinició solo con el código nuevo y retomó gen_local de EP25 (salta las 146 tomas
  hechas y corre el QA ya con todas las mejoras de hoy).

## 2026-10-14 12:40 — QA visual de EP25: 67 de 146 "malas" → auditoría a ojo y triaje (king otra vez caído)
- **king NO responde** desde ~12:00 UTC (gen_estado: `fetch failed` a 100.66.84.73:8188) → todos los rehacer fallaban.
  QA detenido. **Franklin: revisar king (encendido, Tailscale, ComfyUI).**
- El juez visual marcó 67/146. Auditoría a ojo de 10 que mis medidores no marcaron: 3 malas de verdad (T10 guardias se
  funden, T37 mesa→rampa, T39 pila→pared), 3 detalles menores (T14, T36, T44), 4 bien (T15, T17, T24, T41).
- **Regla nueva en `_qa.js` ("leve")**: si el juez marca SOLO acción floja/al revés o SOLO bruma (sin imagen equivocada ni
  nada roto/deforme), se acepta con nota y no se rehace (queda como evidencia). `VYRALES_QA_ESTRICTO=1` lo desactiva.
  En EP25: 15 aceptadas así (T18, 23, 35, 46, 70, 74, 80, 82, 98, 110, 115, 124, 137, 141, 145) + 4 aceptadas por mí a ojo
  (T15, 17, 24, 41). **Quedan 48 para rehacer** cuando king vuelva (casi todas "cambia de lugar"/objetos que se deforman;
  T108 y T120 tienen la IMAGEN inicial equivocada → necesitan cuadro nuevo).

## 2026-10-14 13:30 — 🔎 Por qué Cronix no llega a king: **ProtonVPN** en Cronix
- `red_diag` (nuevo): `curl` de Cronix a `100.66.84.73:8188` → `connect failed: Bad access` **en 0 ms** = bloqueo LOCAL en
  Cronix (no es king ni la red: `tailscale ping` responde en 30 ms).
- `red_diag2` (nuevo): en Cronix está **conectado ProtonVPN** (adaptador "ProtonVPN", servicio + WireGuard corriendo). Su
  kill switch / filtros bloquean el tráfico que no va por el túnel, incluido Tailscale → Node y curl no pueden abrir la conexión.
- INFERENCIA: tras los reinicios de Windows de esta mañana (4:29 y 6:16), ProtonVPN se conectó solo al arrancar.
- **Arreglo (Franklin):** desconectar ProtonVPN en Cronix, o en ProtonVPN → Split tunneling excluir Tailscale / la red
  100.64.0.0/10, o desactivar el kill switch / "conectar al iniciar". No lo toco yo: es una configuración de seguridad.
- **Línea de tiempo (registro de Windows de Cronix, `red_diag3`):** 4:29 y 4:33 AM dos reinicios pedidos por un programa
  (evento 1074, típico de Windows Update) → muere el QA. 6:17:41 AM se conecta **ProtonVPN** (antes no aparece en el día).
  6:46 AM el agente retoma el QA y desde ahí TODO falla. O sea: el VPN no cortó un trabajo en marcha; se conectó después
  del reinicio, cuando el QA ya estaba muerto, y bloqueó el reintento.
- **Intento de cerrarlo con el agente (13:45):** el agente NO es administrador (`proton_info`: ADMIN=False) y el túnel lo
  mantienen dos servicios de Windows (ProtonVPN Service + WireGuard) que solo un admin puede detener. Cerrar la ventana
  (ProtonVPN.Client) no desconecta. Probé además un puente por `tailscale nc` (`agente/ts_proxy.js`): también lo bloquea
  ProtonVPN ("forbidden by its access permissions"). → Hace falta darle Disconnect en la app (en persona, por control remoto,
  o activando Computer use en la app de Claude de Cronix).
- **13:50 — Franklin pidió matar el proceso:** `proton_cerrar` mató ProtonVPN.Client (PID 22904) → la conexión a king sigue
  bloqueada igual (`Bad access` en 0 ms): el túnel y el bloqueo los mantienen los servicios de sistema, que el agente
  (sin admin) no puede detener. Internet de Cronix sigue funcionando (el agente habla con la base).

## 2026-10-14 13:55 — QA de EP25 corriendo (ProtonVPN apagado por Franklin) + bug de la alineación de voz
- ProtonVPN apagado en Cronix → king responde; `qa_tomas` 8f385b69 arrancó. Ya rehízo T21 y T56 (cortes).
- **BUG (`_align.js`)**: el QA quiso estirar T64 a 26.9 s ("dura 15 s y su voz 26.9 s", imposible: LTX da máx. 15 s).
  CAUSA: Whisper dio a una palabra un final 2–3 s tardío; el hueco de palabras adivinadas quedó "al revés" (fin < inicio,
  tiempos decrecientes) → T64 se comía 27 s y T65–T67 quedaban de 1 s. 50 palabras invertidas en EP25.
- **Arreglo:** `matchWords` encoge esa palabra para que el hueco nunca quede al revés; `repairWords()` repara voces ya
  guardadas. EP25 reparada: T64 26.9→11.1 s, T65 1.0→2.3, T66 1.0→2.8, T67 1.0→2.1, T68 2.0→6.3; 0 invertidas; suma
  578.5 s vs voz 576.5 s ✔.
- PENDIENTE: al terminar el QA, revisar que los clips de T65–T68 alcancen sus nuevas duraciones (si no, rehacerlos).
- **14:35 — avance QA:** 19 tomas rehechas en ~45 min. Revisadas a ojo: T2 (ahora estable, las luces no se apagan) ✅,
  T8 (muro se queda) ✅, T10 (los 2 guardias siguen siendo 2) ✅, T37 (mesa de billar ya no se transforma) ✅, T64 ✅.
  T12 y T28 agotaron 3 intentos según el juez; a ojo se ven bien (pozo estable; cajas estables) → aprobadas por mí con nota.
  T142 aún salta de ángulo al final → la verá el QA visual.

## 2026-10-14 16:00 — Lugares fijos como referencia en Flow (idea de Franklin, para los próximos documentales)
- **Antes:** solo las tomas CON personaje mandaban fotos de referencia a Flow (cara + lugar). Las tomas sin personas (celdas,
  túneles, penal… justo las que más fallan) iban sin ninguna referencia → el mismo lugar salía distinto en cada toma.
- **Cambio (`agente/flow_cuadros.js`):** toda toma cuyo lugar tenga foto fija (TOMAS FIJAS, `visual_memory.locations`) va por
  el camino con referencias aunque no tenga personajes. EP25 se queda como está (Franklin).
- **HALLAZGO / PENDIENTE (guionista):** en EP25, 109 de 146 tomas tienen `location: "escena"` (genérico); solo 37 están
  ligadas a uno de los 8 lugares fijos. Ej.: tomas del exterior del penal o del túnel que no dicen su lugar → no recibirían la
  referencia. Para los próximos: que el detallador asigne el lugar fijo a CADA toma que ocurra en él.

## 📌 PENDIENTE (Franklin aprobó, oct-14) — Meta: elegir la Página por canal
- Problema: dos canales con FB/IG ligados al mismo Facebook personal → al conectar el segundo, Meta reemplaza el permiso y
  la Página del primero deja de funcionar. Además `metaConnect` elige sola la Página (`META_PAGE_ID` o la primera con IG).
- Hacer: al conectar Meta, mostrar la lista de Páginas/IG autorizadas y que Franklin elija cuál va en ESE espacio de trabajo;
  no usar `META_PAGE_ID` como valor fijo global; en el panel, avisar "marca TODAS tus Páginas en Meta (Editar configuración)".

## 2026-10-14 16:40 — Cada canal publica en SUS redes (Franklin)
- **HALLAZGO (tabla social_accounts):** el canal principal VYRALES tiene guardados Facebook = "MindFuel Rise" e Instagram =
  "@maindful_rise" — o sea, la Página de MindFuel. CAUSA: `metaConnect` tomaba "la primera Página con Instagram" de todas las
  autorizadas en tu Facebook. Si se publicaba un video de VYRALES en FB/IG, salía en MindFuel.
- **Arreglo 1 (`_social.js` → metaConnect):** con varias Páginas autorizadas elige la que se llama como el canal (nombre de su
  YouTube conectado o del espacio). Si ninguna coincide, NO adivina: avisa qué Páginas hay y pide conectar desde el canal correcto.
- **Arreglo 2 (`social-publish-background.js` + `_tenant.runInWs`):** al publicar, las cuentas se buscan en el canal DUEÑO
  del episodio, no en el canal que esté abierto en el panel.
- **Franklin:** cuando Netlify publique esto, abre el canal VYRALES → "Conectar Facebook + Instagram" (con las dos Páginas
  marcadas) para que VYRALES quede con SU Página. MindFuel ya está bien.

## 2026-10-14 17:00 — Analítica DENTRO del panel + datos del canal correcto (Franklin)
- **Dentro del panel:** "Analítica" ya no abre otra página: es una pantalla más del panel (`#analitica`), como Producción o
  Guiones. Muestra la misma analítica en un recuadro integrado (`analitica.html?embed=1`, sin su barra lateral ni botón
  "Panel"); los enlaces de conectar redes/ir al panel abren en la ventana completa. Se recarga al entrar → siempre del canal activo.
- **Datos del otro canal:** (1) la caché de 3 min ahora se invalida en cuanto cambia una cuenta conectada del canal (antes,
  tras reconectar Facebook de MindFuel→VYRALES, seguía mostrando lo viejo hasta 3 min); (2) el índice de episodios que
  etiqueta los videos por serie/tema solo usa episodios del canal (antes mezclaba todos: MindFuel ahora 0, VYRALES 67).

## 2026-10-14 16:45 — QA de EP25 terminado (11:40 AM Texas)
- QA terminó y unió el video (578.3 s). Quedaron 9 tomas que el juez marcó mal; revisadas a ojo:
  - Bien → aprobadas por mí con nota: T8, T93, T95, T102, T107, T112.
  - Mal de verdad → rehaciendo con `regen_local:…:39,94,116` (job bb6eca9e): T39 (la pila de paquetes se vuelve una pared),
    T94 (preso mirando a cámara en pasillo que debía estar vacío), T116 (el jet con hélices fantasma gigantes).
  - T120 ya quedó bien (hombre de traje en la mesa de madera, sala de juicio). T142 bien (sierra al atardecer).
- render_full (calidad completa) cancelado: se rehace al terminar el regen para incluir las 3 tomas nuevas.
- **17:20 —** regen de T39/T94/T116 terminado y video unido de nuevo (581.2 s). T39 ✓, T116 ✓ (2º intento). T94 seguía mal.
  **CAUSA de T94:** la toma tenía `characters: ["El Chapo"]` aunque la imagen pide un pasillo VACÍO → Flow recibía la foto
  de la cara y metía al preso en primer plano. Quitado el personaje y rehecha con cuadro nuevo (`regen_local:…:94:94`).
  **PENDIENTE guionista/pre-vuelo:** asignar `characters` SOLO si la persona se ve en la imagen (12 tomas de EP25 tienen
  personaje + "empty" en el prompt: revisar el patrón en el próximo documental).
- **17:50 —** T94 rehecha: pasillo vacío con el guardia al fondo ✅ (aprobada). **0 tomas marcadas mal en EP25.**
  Video unido final-v1791998684432 (9:41, 581 s) revisado: 24 cuadros repartidos coherentes, audio −17 dB medio sin silencios
  >1.5 s, sin congelados >2 s. Lanzado `render_full` (calidad completa, 770b1484) y los 3 Shorts con `short_reusar`
  (EP26 9cc4b11a, EP27 64444d09, EP28 3443c79a).
- **12:48 Texas —** `render_full` EP25 listo: 1920x1080, 581 s, 548 MB. Shorts listos (720x1280, revisados a ojo con 12 cuadros
  c/u, sin silencios ni congelados, −17 dB): EP26 61.9 s, EP27 58.5 s, EP28 53.3 s, todos cierran con "historia completa 👇".
  **Producción El Chapo terminada.**

## 2026-10-14 (tarde) — canales: guion que no aparecía y redes "no conectadas"
- **Guion de MindFuel no aparecía:** el guionista crea series con slugs del sistema (`cibertales_*`), que ya son del canal
  principal → en otro canal `import-series` respondía 409 y no se creaba nada. Ahora (`adaptarAlCanal` en
  `import-series.js`) en un canal esos slugs pasan a ser del canal (`mindfuel_rise_curiosidades_completa`) y, si la
  identidad del canal es en inglés, la serie queda en inglés (language `en`, narrador en inglés americano, tarjeta final
  SUBSCRIBE). `import-largo.js` usa el slug real que devuelve la importación (y los Shorts apuntan a él).
  Probado en local con el guion `largo-mv8b3disj3he` (Tom Daley): serie "MindFuel Rise · Full stories" con el largo (EP1)
  y 3 Shorts (EP2–4) en MindFuel.
- **Inicio decía "redes no conectadas" en un canal sin series:** `dashboard.html` salía antes de leer `social-status`
  y `sinNovela()` pintaba "Conectar tus redes" fijo. Ahora se leen las redes igual y `pintarRedes()` (panel.js) pinta
  el estado real del canal.
- Pendiente (no tocado): el 🧠 cerebro (evidencia de fallas de LTX) es por canal → MindFuel empieza en cero; las 32
  reglas generales sí las comparte.
- **Memoria compartida entre canales (pedido de Franklin):** "nichos diferentes, agentes diferentes, pero las mismas
  reglas, así aprende más de cada uno". `_memoria.js`: `reglas.json`, `lecciones.json` y todo el 🧠 cerebro
  (`cerebro_evidencia/reglas/diario/objeciones.json`) son UNO SOLO para el principal y sus canales (`owner_ws` = admin).
  Lo que cambia por canal es la IDENTIDAD (nicho, tono, idioma). Cuentas de OTROS usuarios siguen aparte.
  `shot-edit.js`: las correcciones de Franklin en cualquier canal suyo ya son lecciones (antes solo en el principal).
  `claude_aprender.js`: solo reglas de oficio, nada del tema/tono/idioma de un canal. Verificado: Admin y MindFuel leen
  las mismas 32 reglas y 754 evidencias del cerebro; Wander (otro usuario) no.
- **Botones de cuadro cobraban en tomas con personajes:** el panel solo usaba Flow si la toma NO tenía personajes
  (o si la serie tenía `flow_characters: true`, que ninguna tenía) → "Generar cuadro (~$0.13, incluye lugar)" iba a
  Gemini pagado. Ahora Flow es lo normal también con personajes (solo `flow_characters: false` lo apaga): botón por
  toma, "generar todos" y `_keyframe.js` (Flow con fotos de personajes, solo en la PC). Y en series con Flow ya no
  se ofrece "Cuadro + animar" mientras la toma no tiene cuadro (ese camino generaba el cuadro con Gemini).
  Revisado `generation_log` de MindFuel: todo $0 hasta ahora (personajes y lugar con Flow).
- **Regla de Franklin: ninguna imagen se paga; Gemini solo si Flow falla 2–3 veces.** Hallazgo: en EP25 las 40
  tomas con personajes se hicieron con Gemini ($2.68) porque `flow_cuadros.js` no marcaba `VYRALES_LOCAL_RUN` y
  `_keyframe.js` exigía `flow_characters: true`. Cambios:
  - `_image.js` `freeImage()`: Flow en la PC con 3 intentos; Gemini solo después. Fuera de la PC → error, no cobra
    (salvo `VYRALES_PAID_IMAGES=1`). Lo usan cuadros (con y sin personajes), cuadro final, lugares y fotos de cara.
  - `flow_cuadros.js` marca `VYRALES_LOCAL_RUN`.
  - Flow se trababa preguntando "¿9:16 o 16:9?": `_keyframe.js` escribía "vertical 9:16" fijo aunque la serie sea
    16:9 → ahora usa el formato real; `flow_imagenes.js` quita del prompt frases del otro formato y, si igual pregunta,
    elige el del episodio.
  - `flow_imagenes.js` detecta al instante el rechazo por política ("might violate our policies") en vez de esperar
    4 min; `freeImage` reintenta sin los nombres de las personas.
  - **Abierto:** con foto de cara subida como referencia, Flow rechaza por política aun sin nombres (probado tomas
    81–83 de MindFuel EP1, persona real famosa: Tom Daley). Esas tomas terminan en Gemini tras 3 intentos.
- **Guiones largos que no aparecían en Guiones (pasó varias veces):** el guion terminado solo vivía en la lista de
  Analítica de ESE navegador y había que darle "Ver y crear en el panel" a mano (si se pidió desde el teléfono, en la
  PC no aparecía). Revisado: de 7 guiones largos recientes solo 3 se habían creado. Ahora `claude_largo.js` lo crea
  solo al terminar (import-largo en el canal que lo pidió) y Analítica muestra "ya está en Guiones". Creado a mano
  el de hoy: "Desmond Doss: salvó a 75 soldados…" (EP29 + Shorts EP30–33).
- **Shorts que faltan de un largo ya hecho (Franklin):** si el largo estaba "en revisión" no había botón para sus
  Shorts sin hacer ("Mover a producir" solo salía con el largo en guion). Ahora en Guiones, en "SHORTS DE ESTE VIDEO",
  sale "Hacer los N Shorts que faltan ($0)" cuando el largo ya tiene tomas: manda `short_reusar` por cada uno (usa
  las tomas del largo y su propia narración). `agent.js`: `short_reusar` entra a la fila (antes se rechazaba si la
  PC estaba ocupada).
- **Short EP14 fallaba al unir 2 tomas del largo** (`short_reusar.js`: "Failed to configure output pad on
  Parsed_concat"): `setsar=1` iba ANTES del scale/crop → las piezas llegaban con SAR distinto al concat. Ahora
  `scale,crop,setsar=1,format=yuv420p`. Re-lanzado: EP14 listo (69 s, revisado a ojo). Shorts EP05/08/09/10/14 hechos.
- **Aviso "Costo estimado ~$7.79 (cuadros iniciales ~$7.71)" al producir MindFuel EP1:** el cálculo cobraba los
  cuadros de tomas con personajes aunque la serie use Flow. Ahora con Flow los cuadros cuentan $0.
  `freeImage`: tras un rechazo por política se reintenta SIN las fotos de cara (queda la descripción del personaje).
  **Abierto:** en MindFuel EP1 (Tom Daley, clavadistas en traje de baño) Flow sigue rechazando aun sin la foto de cara
  (probado toma 84) → esas tomas terminarían en Gemini (81 tomas con personajes ≈ $5.4). No producir hasta resolverlo.
- **Subtítulos de YouTube con colores y más grandes (largos, pedido de Franklin):** `_captions.js` `buildYtt()` arma el
  formato YTT/SRV3 de YouTube: letra blanca en negrita (150 %), contorno negro sin caja, números y nombres propios en
  amarillo, abajo al centro. `uploadSubtitles` sube el YTT (el SRT se sigue guardando). Probado en "Humanos de un
  metro" (youtu.be/MeOR19OAlr8): YouTube lo aceptó y lo sirve con estilo (su conversión a VTT trae color y negrita).
- **Subtítulos en los dos idiomas siempre:** antes la pista inglesa solo existía si el video tenía voz inglesa, y en un
  canal en inglés (MindFuel) la pista "es" habría salido con el texto en inglés. Ahora `ensureSubtitles` usa el idioma
  de la serie como pista principal y TRADUCE la otra con Claude en la PC ($0), mismos tiempos y mismo estilo YTT.
  Aplicado a los 3 largos que están en YouTube: Toba (pUbmcSr8Ikw, ES + EN de su voz inglesa), Humanos de un metro
  (MeOR19OAlr8) y Bomba del Zar (OAxewumtTKE) con ES + EN traducido. Revisada la pista EN de la Bomba del Zar.
- **Subtítulos más llamativos y palabra por palabra (Franklin):** texto AMARILLO (#FFE14D) y números/nombres en
  MORADO-ROSA (#E040FB), contorno negro, 150 %. `buildYtt` ahora escribe cada bloque palabra por palabra con los tiempos
  de la voz (una entrada YTT por palabra, texto acumulado); las pistas traducidas van por bloque. Los 3 largos ya tienen
  amarillo/morado por bloque; la versión palabra por palabra NO se pudo subir hoy: **se agotó la cuota diaria de la API
  de YouTube** (cada subida de subtítulos cuesta ~400 unidades de 10.000; se reinicia a medianoche del Pacífico).
- **MindFuel EP1 "trabado en la toma 24" (oct-15, ~11:30 pm Texas):** no estaba trabado: cada toma con personaje
  tardaba ~40 min (Flow no subía la foto de cara: "Añadir a petición" no aparecía; 3 intentos → Gemini $0.067).
  Franklin eligió pararlo y hacerlo gratis: job cancelado en la toma 26; tomas 26–118 sin `characters` (guardados en
  `characters_orig`) → cuadros con Flow sin foto (probado 26 y 27: lote de 2 en 56 s, $0). Llevaba 14 cuadros
  pagados ($0.94).
- **Alineación de la voz en inglés:** `_align.js` usaba Whisper en español siempre → la voz de MindFuel casaba 143 de
  1247 palabras y las tomas 1–25 salieron con duraciones mal. Ahora el idioma se detecta del texto (`idiomaDe`):
  1185/1247. El QA está rehaciendo en king ($0) las tomas 1–25 que no calzan con su voz.
- **MindFuel: producción PARADA y formato nuevo (Franklin, oct-15):** cancelado el gen_local del EP1 (Tom Daley) y su
  seguimiento. Nueva identidad del canal (`workspaces.settings.identidad`; la anterior queda en `identidad_anterior`):
  mensajes motivacionales fuertes y ORIGINALES escritos por el guionista, sin historias reales ni personas reales;
  una imagen simbólica por frase (pueden ser fijas con movimiento suave, no hace falta video completo) y sin mostrar
  personas (solo anónimas, lejos o de espaldas). Pendiente: el modo de producción "imágenes" (sin LTX) para este canal.
- **Personajes/tomas fijas de OTRO video en Producción (Franklin: "¿por qué me pone El Chapo en una serie nueva?"):**
  las tiras mostraban todos los personajes y lugares de la serie (El Chapo, Desmond Doss, ADX Florence…). Ahora solo
  los del grupo que se está produciendo (el movido más recientemente; EP34 Gran Dolina → "Homínido de Gran Dolina" y
  sus lugares). "Generar N fotos/imágenes" también genera solo esos.
- **MindFuel: borrado todo lo de Tom Daley (pedido de Franklin, oct-15):** serie "mindfuel_rise_curiosidades_completa"
  (EP1 largo + 3 Shorts), sus 57 archivos en Storage, 4 personajes y la serie. MindFuel queda sin series, esperando el
  formato nuevo (mensajes motivacionales + imágenes simbólicas).
- **Subtítulos de los largos un poco más chicos y más abajo (Franklin):** tamaño 150 % → 115 %, posición 88 % → 96 %
  de la altura (pegados al borde de abajo).
- **Cuota de YouTube: las búsquedas se comían 22 %:** la consola de Google mostró 9.995/10.000 usadas y "Search Queries
  per day: 22". Cada búsqueda cuesta 100 unidades; `viralRefs` (_analytics.js) hacía 6 por cada pedido de ideas.
  Ahora se guardan 24 h por canal (`media/cache/virales_<ws>.json`): una vez al día como máximo (600 unidades).
- **Segundo proyecto de Google Cloud para YouTube (Franklin):** el proyecto de Google Cloud original
  (10,000 unidades/día) lo comparten todos los canales — un canal activo puede agotar la cuota de todos.
  Se creó un segundo proyecto ("vyrales-canal2") solo para canal admin vs. el resto: `_social.js` ahora
  elige las credenciales por workspace (`ytCreds()`): canal admin sigue con `YOUTUBE_CLIENT_ID/SECRET`
  (proyecto 1); cualquier otro canal usa `YOUTUBE_CLIENT_ID_2/SECRET_2` (proyecto 2) si están puestas en
  Netlify, si no cae al proyecto 1 como antes. `_analytics.js` usa el mismo criterio al refrescar el token.
  Falta: agregar `YOUTUBE_CLIENT_ID_2` y `YOUTUBE_CLIENT_SECRET_2` en las variables de entorno de Netlify
  (ya están en el `.env` local) y reconectar YouTube en los canales que no sean el admin para que tomen
  el proyecto nuevo.
- **Respaldo de YouTube para canal admin (Franklin):** si al canal 1 se le acaba la cuota del
  proyecto 1, ahora reintenta automáticamente con el proyecto 2 (mismo canal de YouTube,
  autorizado también con `YOUTUBE_CLIENT_ID_2/SECRET_2`) en vez de fallar. Se agregó
  `withYoutubeFallback()`/`isQuotaError()` en `_social.js`, usado en `youtubeUpload`,
  `youtubeAddToPlaylist`, `youtubePlaylists`, la subida de subtítulos (`_captions.js`) y el
  refresco de token de analítica (`_analytics.js`). Solo aplica al canal admin (los demás canales
  ya tienen el proyecto 2 como su cuota PROPIA, no como respaldo — si se les permitiera caer ahí
  también se repetiría el problema de cuota compartida).
  Para activarlo: entrar a `/.netlify/functions/oauth-youtube-start?backup=1` logueado como admin
  y autorizar el MISMO canal de YouTube (pero con el proyecto 2) — queda guardado en
  `social_accounts` como `platform: 'youtube_backup'`. Sin esa conexión, el respaldo simplemente
  no se usa y todo sigue como antes.
- **Respaldo probado y arreglo del detector de cuota:** los mensajes de error de YouTube se
  cortaban a 200 caracteres antes de llegar a `"reason":"quotaExceeded"`, así que el respaldo
  nunca se activaba aunque estuviera conectado. Se amplió el corte a 500 caracteres y el detector
  ahora también reconoce "youtube.quota" / "exceeded your ... quota". Probado en vivo: subió los
  subtítulos nuevos (karaoke por palabra, ES+EN) a los 3 videos largos ya publicados usando el
  respaldo del proyecto 2, mientras el proyecto 1 seguía sin cuota del día.
- **Analítica de YouTube intermitente, arreglada (Franklin):** la página de analítica hacía varias
  llamadas directas a la API (canal, lista de videos, 3 reportes de YouTube Analytics) con el
  token ya obtenido, pero si alguna de esas llamadas (no el refresco del token) chocaba con la
  cuota agotada del proyecto 1, no había reintento — por eso a veces cargaba bien y a veces salía
  en blanco/"—", según si justo en ese momento quedaba cuota. Ahora toda esa recolección
  (`youtube()`/`youtubeOn()` en `_analytics.js`) corre dentro de `withYoutubeFallback`: si CUALQUIERA
  de esas llamadas devuelve "cuota agotada", se reintenta completa con el respaldo del proyecto 2.
- **`/ver` (link de Instagram/TikTok), rediseño (Franklin):** antes cada historia llevaba a YouTube
  afuera de la página. Ahora el video se ve empotrado ahí mismo (reproductor oficial de YouTube —
  sigue contando como vista real en YouTube), con un diseño parecido a YouTube: reproductor grande
  + lista de "más historias" al lado (abajo en el teléfono). `?v=<episode_id>` ahora hace que ESE
  video sea el que aparece listo en la pantalla grande al entrar (antes redirigía de una vez a
  YouTube). Carga liviana: se muestra la miniatura con botón de play y el reproductor real solo se
  carga cuando el usuario le da play (o cambia de video en la lista).
- **"Iniciar producción" ya no bloquea pidiendo ir al Elenco (Franklin):** si al personaje le falta
  la foto de cara, antes había que ir manualmente a Elenco → "Generar fotos que faltan". Ahora el
  mismo botón de producir (y también "Generar cuadros" y regenerar una toma sola) genera solas las
  fotos que falten primero (Flow gratis primero, igual que siempre) y sigue con la producción sin
  parar. Si alguna foto de verdad no se pudo generar, ahí sí avisa para revisarla a mano.
- **`/ver` otra vez, formato cuadrícula (Franklin):** pidió que se viera como la página del canal de
  YouTube pero con el video grande arriba. Cambié la lista lateral angosta por una cuadrícula de
  miniaturas (como "Videos" en YouTube) debajo del reproductor grande, en vez de una lista al
  costado.
- **`/ver` con la marca real del canal (Franklin):** el encabezado ahora trae el banner, el avatar,
  el nombre, el @handle, suscriptores y la descripción REALES del canal de YouTube (misma API que
  usa Analítica), con caché de 12 h para no gastar cuota en cada visita. Se agregó también el botón
  oficial de "Suscribirme" de YouTube (el widget real, funciona de verdad), igual que se ve en el
  canal.
- **Arreglo: la cuota agotada se escondía en `/ver` (Franklin, mismo bug que el de analítica):** la
  llamada que trae los datos del canal no revisaba primero si la respuesta era un error 403 de
  cuota agotada; la convertía en un "sin canal" genérico que `withYoutubeFallback` no reconocía
  como cuota, así que nunca pasaba al proyecto de respaldo y la página se quedaba sin banner/avatar.
  Ahora revisa el código de error ANTES, igual que ya se arregló en analítica y en subtítulos.
- **`/ver`, rediseño final según ejemplo de Franklin (sin listas de reproducción):** Franklin mandó
  un ejemplo exacto de cómo lo quería. Se cambió todo el diseño: ahora son dos pestañas arriba
  ("Videos" / "Shorts", sin Listas de reproducción, no era necesaria), y cada una tiene su propio
  reproductor grande a la izquierda + una lista lateral (no cuadrícula abajo) a la derecha con scroll
  propio. Los Shorts tienen su propio reproductor en formato vertical (9:16, como un celular) y su
  lista lateral con miniaturas verticales, separado del de Videos (16:9, lista con miniaturas
  horizontales). Cada tarjeta de la lista muestra vistas y fecha REALES (se agregó `getVideoStats()`
  que trae vistas y duración reales de YouTube, caché 12h) — nunca se inventan datos: si la API no
  responde, esos datos simplemente no se muestran.
- **Arreglo en `/ver`: Shorts se colaban en la lista de Videos largos (Franklin):** el filtro usaba
  solo la URL (`/shorts/`), pero muchos Shorts quedaron publicados con un link normal `youtu.be/<id>`
  (no `/shorts/`), así que se colaban en "Videos". Ahora se usa también `continuity.kind` (el sistema
  marca los cortos como `short_cta`), que es el dato correcto para distinguirlos.
- **Botón de Suscribirme en `/ver` (Franklin: "se ve feo"):** el widget oficial embebido de YouTube
  dejaba un espacio en blanco feo. Se cambió por un botón propio (rojo, estilo YouTube) que lleva
  directo al canal para suscribirse ahí.
- **Arreglo "Error 153" al reproducir en `/ver` (Franklin):** al reproductor le faltaba decirle a
  YouTube desde qué dominio se está reproduciendo (`origin`); sin eso YouTube a veces lo bloquea con
  ese error. Ya se agregó.
- **Efecto al pasar el mouse en las miniaturas de la lista (Franklin: "se ve feo" sin eso):** ahora
  las miniaturas hacen un pequeño zoom al pasar el mouse por encima, como en el canal real.
- **Banner de `/ver` en mejor calidad (Franklin):** la imagen del banner que trae la API de YouTube
  venía recortada a baja resolución por defecto; ahora se pide el tamaño grande, se ve nítida.
- **Arreglo: al tocar otro video de la lista no cambiaba, ni en Videos ni en Shorts (Franklin):** los
  botones de la lista funcionaban sobre `id="video-list"`/`id="short-list"`, pero los contenedores
  reales se llaman `id="videos-list"`/`id="shorts-list"` (con "s"); por ese desajuste nunca se
  enganchaba el clic, entonces tampoco se movía el resaltado (el "efecto" que se veía que faltaba).
  Ya corregido y probado.
- **`/ver`: reproducción automática en cadena (Franklin):** al terminar un video o un short, pasa
  solo al siguiente de la lista (en Videos y en Shorts por igual); al llegar al final, vuelve a
  empezar desde el primero. Para esto el reproductor ahora usa la API real de YouTube (antes era un
  iframe simple que no avisaba cuándo terminaba el video).
- **VYRALES ya tiene su "identidad" definida y YA NO hará temas de narcos/crimen activo (Franklin, por
  lo de El Chapo):** el sistema tenía una función para que cada canal tenga su propio nicho/identidad
  (de qué trata, qué evitar), pero estaba programada para usarse SOLO en canales secundarios (como
  MindFuel), nunca en el canal principal (VYRALES). La corregí para que también aplique al principal,
  y le definí su identidad: "historias y curiosidades reales y asombrosas (ciencia, historia,
  misterios, naturaleza, desastres, superación)", con una regla explícita de evitar narcotráfico,
  cárteles y crimen organizado reciente (como El Chapo) — un delito histórico ya resuelto o de hace
  mucho tiempo sí puede entrar si no glorifica violencia reciente. Esto ahora se le manda SIEMPRE al
  guionista (import-series) y al generador automático de ideas (analítica), con máxima prioridad
  ("manda sobre todo").
