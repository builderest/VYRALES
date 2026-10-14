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
- `.env` en Cronix — `DASHBOARD_KEY='@#$%Rm4766102'` entre comillas (el `#` rompía el parseo local y el login admin fallaba). **Local de la PC.**

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

---
*(Agrega aquí los próximos cambios, lo más nuevo arriba.)*
