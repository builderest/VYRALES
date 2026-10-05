// VYRALES — Editor de episodio, estilo CapCut.
//   · Derecha: todas las tomas.  · Izquierda: la toma seleccionada + herramientas.
//   · Abajo: línea de tiempo (recortar arrastrando bordes, reordenar arrastrando, transiciones).
// Todo lo que se ve aquí es una VISTA PREVIA; el video final lo arma render-episode-background
// con ffmpeg aplicando el mismo plan (episodes.edit_plan). Atajos: Espacio, ←/→, I, O, Supr,
// Ctrl+Z / Ctrl+Y.
(function () {
  const PREVIEW_W = 288; // ancho del "teléfono" (video real: 720x1280)
  const K = PREVIEW_W / 720;
  const SUB_WINDOW = [0.25, 6.1]; // el diálogo se dice entre 0 y 6 s de cada toma (tiempo original)
  const MIN_SECONDS = 90;
  const FRAME = 1 / 24;
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const TRANSITIONS = { cut: 'Corte directo', crossfade: 'Fundido cruzado', fade_black: 'Fundido a negro', dissolve: 'Disolver', slide: 'Deslizar ←', slide_up: 'Deslizar ↑', wipe: 'Barrido', zoom: 'Zoom', circle: 'Círculo', blur: 'Desenfoque', flash: 'Destello blanco' };
  const TR_ICON = { cut: '|', crossfade: '◐', fade_black: '■', dissolve: '░', slide: '←', slide_up: '↑', wipe: '▶', zoom: '⊕', circle: '◯', blur: '≈', flash: '✦' };
  const OVERLAP = (t) => t && t !== 'cut' && t !== 'fade_black'; // transiciones que enciman las tomas
  const SUB_STYLES = { classic: 'Clásico', yellow: 'Amarillo', box: 'Caja negra' };
  const SPEAKER_CSS = ['#ffffff', '#8cf0ff', '#ff8cb9', '#b4ff80', '#c49eff', '#ffc880'];

  const st = { ep: null, plan: null, seq: [], idx: 0, sel: 0, playing: false, timer: null, raf: null, dirty: false, undo: [], redo: [], lastSnap: 0, base: null, pxs: 16, scrubShot: null, speakers: [] };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const fmt1 = (s) => (Math.max(0, s)).toFixed(1) + 's';
  const ctx = () => (window.vyCtx ? window.vyCtx() : { series: new URLSearchParams(location.search).get('series'), data: null, reload: () => location.reload() });
  const btn = 'px-2 py-1 rounded border text-[11px] font-mono';

  // ================= UI =================
  function injectUi() {
    if ($('edModal')) return;
    const font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@800&display=swap';
    document.head.appendChild(font);
    const css = document.createElement('style');
    css.textContent = `
      #edTimeline .tl-block{position:absolute;top:22px;height:64px;border-radius:6px;overflow:hidden;background:#0f172a;border:2px solid #1e293b;cursor:grab;user-select:none}
      #edTimeline .tl-block.sel{border-color:#06b6d4;box-shadow:0 0 0 1px #06b6d4}
      #edTimeline .tl-block.off{opacity:.35}
      #edTimeline .tl-block video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;opacity:.55}
      #edTimeline .tl-block .tl-name{position:absolute;left:6px;top:3px;font:700 10px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none}
      #edTimeline .tl-block .tl-dur{position:absolute;right:6px;bottom:3px;font:10px monospace;color:#cbd5e1;text-shadow:0 0 3px #000;pointer-events:none}
      #edTimeline .tl-h{position:absolute;top:0;bottom:0;width:9px;background:rgba(251,191,36,.85);cursor:ew-resize;z-index:2}
      #edTimeline .tl-h.l{left:0;border-radius:4px 0 0 4px}#edTimeline .tl-h.r{right:0;border-radius:0 4px 4px 0}
      #edTimeline .tl-card{position:absolute;top:22px;height:64px;border-radius:6px;background:#111827;border:2px dashed #334155;font:10px monospace;color:#94a3b8;display:flex;align-items:center;justify-content:center}
      #edTimeline .tl-tr{position:absolute;top:44px;width:20px;height:20px;margin-left:-10px;border-radius:50%;background:#020617;border:1px solid #475569;color:#e2e8f0;font-size:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:3}
      #edTimeline .tl-tr.on{border-color:#a78bfa;color:#a78bfa}
      #edPlayhead{position:absolute;top:0;bottom:0;width:2px;background:#f43f5e;z-index:4;pointer-events:none}
      #edPlayhead:before{content:'';position:absolute;top:0;left:-5px;border:6px solid transparent;border-top-color:#f43f5e}
      #edSub .w-on{color:var(--hl)}#edSub .w-off{color:var(--base)}
      .ed-kbd{font:10px monospace;border:1px solid #334155;border-radius:3px;padding:0 4px;color:#cbd5e1}
    `;
    document.head.appendChild(css);
    document.body.insertAdjacentHTML('beforeend', `
<div id="edModal" class="hidden fixed inset-0 z-[105] bg-black/85 backdrop-blur-sm overflow-y-auto p-3">
  <div class="max-w-7xl mx-auto bg-cyber-darker border border-cyber-cyan/40 rounded-xl shadow-2xl">
    <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-cyber-border">
      <div class="min-w-0">
        <h3 id="edTitle" class="font-display font-bold text-white text-lg truncate">Editor</h3>
        <p class="text-[11px] font-mono text-slate-400">
          <span class="ed-kbd">Espacio</span> play · <span class="ed-kbd">←</span><span class="ed-kbd">→</span> cuadro a cuadro (<span class="ed-kbd">Shift</span> = 1 s) ·
          <span class="ed-kbd">I</span> empieza aquí · <span class="ed-kbd">O</span> termina aquí · <span class="ed-kbd">Supr</span> quitar/poner toma · <span class="ed-kbd">Ctrl+Z</span> deshacer
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button id="edUndo" onclick="vyEditor.undo()" class="px-2 py-1 rounded bg-slate-800 text-white text-xs hover:bg-slate-700" title="Deshacer (Ctrl+Z)"><i class="fa-solid fa-rotate-left"></i></button>
        <button id="edRedo" onclick="vyEditor.redo()" class="px-2 py-1 rounded bg-slate-800 text-white text-xs hover:bg-slate-700" title="Rehacer (Ctrl+Y)"><i class="fa-solid fa-rotate-right"></i></button>
        <button onclick="vyEditor.close()" class="text-slate-400 hover:text-white text-xl px-2" title="Cerrar"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 p-4 pb-2">
      <div class="min-w-0 grid grid-cols-1 md:grid-cols-[${PREVIEW_W + 16}px_1fr] gap-4">
        <!-- Vista previa -->
        <div class="flex flex-col items-center gap-2">
          <div id="edPhone" class="relative bg-black rounded-xl overflow-hidden border border-cyber-border" style="width:${PREVIEW_W}px;height:${PREVIEW_W * 16 / 9}px">
            <video id="edVideo" class="absolute inset-0 w-full h-full object-cover" style="transform-origin:50% 50%" playsinline preload="auto"></video>
            <div id="edCard" class="hidden absolute inset-0 bg-black flex flex-col items-center justify-center text-center px-6"></div>
            <div id="edFade" class="absolute inset-0 bg-black pointer-events-none" style="opacity:0"></div>
            <div id="edTop" class="hidden absolute left-0 right-0 text-center px-4" style="font-family:Montserrat,sans-serif;font-weight:800;color:#FFE100;text-shadow:0 0 3px #000,0 0 3px #000,0 0 3px #000"></div>
            <div id="edSub" class="hidden absolute left-0 right-0 text-center px-5 leading-tight z-10 select-none" style="font-family:Montserrat,sans-serif;font-weight:800"></div>
            <div id="edLabel" class="absolute top-1 left-1 text-[10px] font-mono bg-black/60 text-white rounded px-1.5"></div>
          </div>
          <audio id="edMusic" loop preload="auto"></audio><audio id="edNarr" preload="auto"></audio><video id="edPre" muted preload="auto" playsinline class="hidden"></video>
          <div class="w-full flex items-center gap-2">
            <button id="edPlayBtn" onclick="vyEditor.togglePlay()" class="px-3 py-1.5 rounded-lg bg-cyber-cyan/20 border border-cyber-cyan/50 text-cyber-cyan text-xs font-mono"><i class="fa-solid fa-play mr-1"></i>Ver todo</button>
            <span id="edTime" class="text-[11px] font-mono text-slate-300">0:00 / 0:00</span>
          </div>
          <p id="edTotal" class="text-xs font-mono"></p>
        </div>

        <!-- Herramientas -->
        <div class="min-w-0 flex flex-col gap-3 text-xs font-mono text-slate-300">
          <div id="edClipPanel" class="bg-black/30 border border-cyber-cyan/40 rounded-lg p-3 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <p id="edClipTitle" class="text-cyber-cyan font-bold">TOMA</p>
              <div class="flex items-center gap-3">
                <button onclick="vyEditor.playSel()" class="text-cyber-cyan hover:underline"><i class="fa-solid fa-play mr-1"></i>Ver toma</button>
                <label class="flex items-center gap-1"><input type="checkbox" id="edClipInc"> Incluir</label>
              </div>
            </div>
            <p id="edClipInfo" class="text-[11px] text-slate-400"></p>
            <div class="bg-black/40 border border-cyber-border rounded-lg p-2">
              <div class="flex items-center justify-between mb-1"><span id="edScrubLabel" class="text-white">Busca el cuadro exacto</span><span id="edScrubTime">0.0s / 8.0s</span></div>
              <input type="range" id="edScrub" min="0" max="8" step="0.0417" value="0" class="w-full">
              <div class="flex gap-2 mt-2">
                <button onclick="vyEditor.stepFrame(-1)" class="${btn} border-cyber-border" title="Cuadro anterior (←)"><i class="fa-solid fa-backward-step"></i></button>
                <button onclick="vyEditor.cutHere('start')" class="flex-1 ${btn} border-cyber-gold/50 text-cyber-gold hover:bg-cyber-gold/10" title="I"><i class="fa-solid fa-scissors mr-1"></i>Empieza aquí</button>
                <button onclick="vyEditor.cutHere('end')" class="flex-1 ${btn} border-cyber-gold/50 text-cyber-gold hover:bg-cyber-gold/10" title="O">Termina aquí <i class="fa-solid fa-scissors ml-1"></i></button>
                <button onclick="vyEditor.stepFrame(1)" class="${btn} border-cyber-border" title="Cuadro siguiente (→)"><i class="fa-solid fa-forward-step"></i></button>
                <button id="edClearTrim" onclick="vyEditor.clearTrim()" class="${btn} border-cyber-border text-slate-400" title="Toma completa otra vez"><i class="fa-solid fa-rotate-left"></i></button>
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
              <label class="flex items-center gap-2">Volumen <input type="range" id="edVol" min="0" max="2" step="0.05" class="flex-1"><span id="edVolV" class="w-10 text-right"></span></label>
              <label class="flex items-center gap-2">Velocidad <select id="edSpeed" class="flex-1 bg-black border border-cyber-border rounded px-1 py-0.5">${SPEEDS.map((s) => `<option value="${s}">${s}×${s < 1 ? ' (lento)' : s > 1 ? ' (rápido)' : ''}</option>`).join('')}</select></label>
              <label class="flex items-center gap-2"><input type="checkbox" id="edZoom"> Zoom suave (acercamiento lento)</label>
              <label class="flex items-center gap-2">Al pasar a la siguiente <select id="edTrans" class="flex-1 bg-black border border-cyber-border rounded px-1 py-0.5">${Object.entries(TRANSITIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
              <label class="flex items-center gap-2 sm:col-span-2">Duración transición <input type="range" id="edTransS" min="0.2" max="1.5" step="0.1" class="flex-1"><span id="edTransSV" class="w-10 text-right"></span></label>
            </div>
            <label class="flex items-center gap-2">Subtítulo <input id="edSubText" maxlength="200" class="flex-1 bg-black border border-cyber-border rounded px-2 py-1"></label>
            <label class="flex items-center gap-2">Texto arriba <input id="edOverlay" maxlength="60" placeholder="(opcional) ej. 3 DÍAS DESPUÉS" class="flex-1 bg-black border border-cyber-border rounded px-2 py-1"></label>
          </div>
          <div>
            <div class="flex gap-1 mb-2">
              <button data-tab="subs" onclick="vyEditor.tab('subs')" class="ed-tab">Subtítulos</button>
              <button data-tab="audio" onclick="vyEditor.tab('audio')" class="ed-tab">Audio</button>
              <button data-tab="cards" onclick="vyEditor.tab('cards')" class="ed-tab">Tarjetas</button>
            </div>
            <div data-pane="subs" class="ed-pane bg-black/30 border border-cyber-border rounded-lg p-3 space-y-2">
              <label class="flex items-center gap-2"><input type="checkbox" id="edSubOn"> Quemar subtítulos con el diálogo (todas las tomas)</label>
              <div class="flex items-center gap-2 flex-wrap">Estilo ${Object.entries(SUB_STYLES).map(([k, v]) => `<button data-substyle="${k}" onclick="vyEditor.subStyle('${k}')" class="${btn} border-cyber-border">${v}</button>`).join('')}</div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label class="flex items-center gap-2"><input type="checkbox" id="edKaraoke"> Palabra por palabra</label>
                <label class="flex items-center gap-2"><input type="checkbox" id="edSpkColor"> Color por personaje</label>
                <label class="flex items-center gap-2"><input type="checkbox" id="edPop"> Animación al aparecer</label>
              </div>
              <label class="flex items-center gap-2">Tamaño <input type="range" id="edSubSize" min="22" max="64" step="1" class="flex-1"><span id="edSubSizeV" class="w-8 text-right"></span></label>
              <label class="flex items-center gap-2">Altura <input type="range" id="edSubPos" min="20" max="1150" step="5" class="flex-1"><span id="edSubPosV" class="w-12 text-right"></span></label>
              <p class="text-[10px] text-slate-500">Arrastra el subtítulo en la vista previa. Franja roja = zona que tapan los botones de TikTok/Reels. "Palabra por palabra" reparte el tiempo según el largo de cada palabra (aproximado).</p>
            </div>
            <div data-pane="audio" class="ed-pane hidden bg-black/30 border border-cyber-border rounded-lg p-3 space-y-2">
              <label class="flex items-center gap-2"><input type="checkbox" id="edNorm"> Volumen parejo en todo el episodio (-14 LUFS)</label>
              <label class="flex items-center gap-2"><input type="checkbox" id="edDuck"> Bajar la música cuando habla el narrador (estilo documental)</label>
              <div class="flex items-center gap-2"><button onclick="document.getElementById('edMusicFile').click()" class="${btn} border-cyber-border hover:text-white"><i class="fa-solid fa-music mr-1"></i>Subir música</button><input type="file" id="edMusicFile" accept="audio/*" class="hidden"><span id="edMusicName" class="truncate text-slate-400"></span><button id="edMusicDel" onclick="vyEditor.removeMusic()" class="hidden text-cyber-pink" title="Quitar música"><i class="fa-solid fa-trash"></i></button></div>
              <div class="border border-cyber-border rounded-lg p-2 space-y-1.5">
                <p class="text-[10px] text-slate-500">MÚSICA CON IA (Lyria 3.5 · ~$0.08 por pista de 2–3 min · instrumental, sin voces)</p>
                <textarea id="edMusicPrompt" rows="3" class="w-full bg-black/40 border border-cyber-border rounded p-1.5 text-[11px] text-slate-200" placeholder="Describe la música (en inglés funciona mejor)"></textarea>
                <button id="edMusicGenBtn" onclick="vyEditor.genMusic()" class="${btn} border-cyber-violet/50 text-cyber-violet hover:bg-cyber-violet/10"><i class="fa-solid fa-wand-magic-sparkles mr-1"></i>Generar música (~$0.08)</button>
                <span id="edMusicGenSt" class="text-[10px] text-slate-400"></span>
                <p class="text-[10px] text-slate-500 pt-1">BIBLIOTECA DE LA SERIE (se reusa en cualquier episodio)</p>
                <div id="edMusicLib" class="space-y-1"></div>
              </div>
              <label class="flex items-center gap-2">Volumen música <input type="range" id="edMusicVol" min="0" max="0.5" step="0.01" class="flex-1"><span id="edMusicVolV"></span></label>
            </div>
            <div data-pane="cards" class="ed-pane hidden grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="bg-black/30 border border-cyber-border rounded-lg p-3 space-y-2">
                <label class="flex items-center gap-2 text-cyber-cyan font-bold"><input type="checkbox" id="edTitleOn"> TÍTULO (inicio)</label>
                <input id="edTitleText" maxlength="80" placeholder="Título grande" class="w-full bg-black border border-cyber-border rounded px-2 py-1">
                <input id="edTitleSub" maxlength="120" placeholder="Texto pequeño" class="w-full bg-black border border-cyber-border rounded px-2 py-1">
                <label class="flex items-center gap-2">Segundos <input type="number" id="edTitleSecs" min="1" max="6" step="0.5" class="w-16 bg-black border border-cyber-border rounded px-1"></label>
              </div>
              <div class="bg-black/30 border border-cyber-border rounded-lg p-3 space-y-2">
                <label class="flex items-center gap-2 text-cyber-cyan font-bold"><input type="checkbox" id="edEndOn"> FINAL</label>
                <input id="edEndText" maxlength="80" placeholder="Continúa en el episodio 2" class="w-full bg-black border border-cyber-border rounded px-2 py-1">
                <input id="edEndSub" maxlength="120" placeholder="Sígueme para no perdértelo" class="w-full bg-black border border-cyber-border rounded px-2 py-1">
                <label class="flex items-center gap-2">Segundos <input type="number" id="edEndSecs" min="1" max="6" step="0.5" class="w-16 bg-black border border-cyber-border rounded px-1"></label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Lista de tomas -->
      <div class="min-w-0 flex flex-col">
        <p class="text-xs font-mono text-cyber-cyan font-bold mb-2">TOMAS · orden del video final</p>
        <div id="edClips" class="flex flex-col gap-1.5 overflow-y-auto pr-1" style="max-height:${PREVIEW_W * 16 / 9 + 40}px"></div>
      </div>
    </div>

    <!-- Línea de tiempo -->
    <div class="px-4 pb-2">
      <div class="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1">
        <span>LÍNEA DE TIEMPO · arrastra los bordes amarillos para recortar · arrastra una toma para moverla · ○ = transición</span>
        <span class="flex items-center gap-1 flex-wrap justify-end">
          <span class="text-cyber-violet">Transiciones automáticas:</span>
          <select id="edAutoType" class="bg-black border border-cyber-border rounded px-1 py-0.5 text-slate-200">${Object.entries(TRANSITIONS).filter(([k]) => k !== 'cut').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <button onclick="vyEditor.autoTransitions('scene')" class="${btn} border-cyber-violet/60 text-cyber-violet hover:bg-cyber-violet/10" title="Pone la transición solo donde cambia el lugar; dentro de la misma escena deja corte directo">Al cambiar de escena</button>
          <button onclick="vyEditor.autoTransitions('all')" class="${btn} border-cyber-border" title="Entre todas las tomas">En todas</button>
          <button onclick="vyEditor.autoTransitions('none')" class="${btn} border-cyber-border" title="Todo con corte directo">Quitar</button>
          <span class="ml-2">Zoom</span><button onclick="vyEditor.zoomTl(-1)" class="${btn} border-cyber-border">−</button><button onclick="vyEditor.zoomTl(1)" class="${btn} border-cyber-border">+</button>
        </span>
      </div>
      <div id="edTlWrap" class="overflow-x-auto bg-black/40 border border-cyber-border rounded-lg">
        <div id="edTimeline" class="relative" style="height:96px"></div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-cyber-border">
      <button onclick="vyEditor.save()" class="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-mono hover:bg-slate-700"><i class="fa-solid fa-floppy-disk mr-1"></i>Guardar</button>
      <button onclick="vyEditor.reset()" class="px-3 py-2 rounded-lg text-slate-400 text-xs font-mono hover:text-white">Restablecer todo</button>
      <p id="edStatus" class="text-xs font-mono text-slate-400 flex-1 min-w-0"></p>
      <button id="edRenderBtn" onclick="vyEditor.render()" class="px-4 py-2 rounded-lg bg-cyber-emerald/20 border border-cyber-emerald/60 text-cyber-emerald text-xs font-mono hover:bg-cyber-emerald/30"><i class="fa-solid fa-film mr-1"></i>Guardar y renderizar video final ($0)</button>
    </div>
  </div>
</div>`);

    const v = $('edVideo');
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', () => next());
    // La voz va en un archivo aparte: si el video se queda cargando (buffering), la voz y la
    // música esperan; cuando el video sigue, la voz se vuelve a alinear con el video.
    v.addEventListener('waiting', () => { $('edNarr').pause(); $('edMusic').pause(); st.buffering = true; });
    v.addEventListener('playing', () => {
      if (!st.buffering) return;
      st.buffering = false;
      if (!st.playing) return;
      if (st.plan.audio.music_url) $('edMusic').play().catch(() => {});
      const it = st.seq[st.idx];
      if (it && it._narrOn) { it._narrOn = false; onTime(); }
    });
    $('edMusicFile').addEventListener('change', (e) => uploadMusic(e.target.files[0]));
    $('edScrub').addEventListener('input', (e) => { if (st.scrubShot != null) showFrame(st.scrubShot, Number(e.target.value)); });

    const bind = (id, fn, ev) => $(id).addEventListener(ev || 'input', () => { fn($(id)); markDirty(); });
    bind('edSubOn', (el) => { st.plan.subtitles.enabled = el.checked; previewSub(); }, 'change');
    bind('edKaraoke', (el) => { st.plan.subtitles.karaoke = el.checked; previewSub(); }, 'change');
    bind('edSpkColor', (el) => { st.plan.subtitles.speaker_colors = el.checked; previewSub(); }, 'change');
    bind('edPop', (el) => { st.plan.subtitles.animation = el.checked ? 'pop' : 'none'; }, 'change');
    bind('edSubSize', (el) => { st.plan.subtitles.size = Number(el.value); $('edSubSizeV').textContent = el.value; previewSub(); });
    bind('edSubPos', (el) => { st.plan.subtitles.margin_v = Number(el.value); $('edSubPosV').textContent = posLabel(); previewSub(); });
    bind('edNorm', (el) => { st.plan.audio.normalize = el.checked; }, 'change');
    bind('edDuck', (el) => { st.plan.audio.duck = el.checked; }, 'change');
    $('edNarr').addEventListener('ended', () => duck(false));
    bind('edMusicVol', (el) => { st.plan.audio.music_volume = Number(el.value); $('edMusicVolV').textContent = Math.round(el.value * 100) + '%'; $('edMusic').volume = Number(el.value); });
    bind('edTitleOn', (el) => { st.plan.title_card.enabled = el.checked; renderTimeline(); }, 'change');
    bind('edTitleText', (el) => { st.plan.title_card.text = el.value; });
    bind('edTitleSub', (el) => { st.plan.title_card.subtext = el.value; });
    bind('edTitleSecs', (el) => { st.plan.title_card.seconds = Number(el.value) || 2; renderTimeline(); });
    bind('edEndOn', (el) => { st.plan.end_card.enabled = el.checked; renderTimeline(); }, 'change');
    bind('edEndText', (el) => { st.plan.end_card.text = el.value; });
    bind('edEndSub', (el) => { st.plan.end_card.subtext = el.value; });
    bind('edEndSecs', (el) => { st.plan.end_card.seconds = Number(el.value) || 2; renderTimeline(); });

    // Herramientas de la toma seleccionada
    const cur = () => st.plan.clips[st.sel];
    $('edClipInc').addEventListener('change', (e) => setClip('include', e.target.checked));
    $('edVol').addEventListener('input', (e) => { setClip('volume', e.target.value); });
    $('edSpeed').addEventListener('change', (e) => { setClip('speed', e.target.value); });
    $('edZoom').addEventListener('change', (e) => { setClip('zoom', e.target.checked); });
    $('edTrans').addEventListener('change', (e) => { setClip('transition', e.target.value); });
    $('edTransS').addEventListener('input', (e) => {
      // Mover la duración en una toma con "Corte directo" la pasa a fundido cruzado (antes el
      // control quedaba bloqueado sin explicar por qué).
      const c = st.plan.clips[st.sel];
      if (c && (c.transition || 'cut') === 'cut') { c.transition = 'crossfade'; renderTimeline(); }
      setClip('transition_s', e.target.value);
    });
    $('edSubText').addEventListener('input', (e) => { setClip('subtitle', e.target.value); previewSub(); });
    $('edOverlay').addEventListener('input', (e) => { setClip('overlay', e.target.value); const it = st.seq[st.idx]; if (it && it.shot === (cur() || {}).shot) { it.overlay = e.target.value; showOverlay(it, $('edVideo').currentTime || 0); } });

    initSubDrag();
    initKeys();
  }

  // ================= Datos / helpers =================
  const clipAsset = (n) => (st.ep.assets || []).find((a) => a.kind === 'video_clip' && a.shot_number === n);
  const shotOf = (n) => (st.ep.shots || []).find((s) => s.n === n) || {};
  // Narrador con voz fija (TTS): igual que en _render.js — empieza a 0.3 s de la toma, se acelera
  // hasta 1.2x si no cabe, y silencia el audio de clips que traen la voz vieja de Veo.
  const NARR_START = 0.3;
  const ttsOn = () => { const d = window.vyCtx && window.vyCtx().data; const n = d && d.series && d.series.story_bible && d.series.story_bible.narration; return !!(n && n.engine === 'gemini_tts'); };
  function narrOf(c, a, overlap) {
    const n = shotOf(c.shot).narration;
    if (!ttsOn() || !n || !n.url) return null;
    const secs = Number(n.seconds) || 6;
    const avail = Math.max(1, clipDur(c) - NARR_START - Math.max(0.15, overlap));
    const tempo = Math.min(1.2, Math.max(1, secs / avail));
    return { url: n.url, seconds: secs, tempo, mute: /Voice-over narration/i.test(a.prompt || '') };
  }
  function duck(on) {
    const m = $('edMusic');
    if (!st.plan || !st.plan.audio.music_url) return;
    const base = Number(st.plan.audio.music_volume) || 0.12;
    m.volume = on && st.plan.audio.duck !== false ? base * 0.33 : base;
  }
  const dialogueList = (n) => { const d = shotOf(n).dialogue; return Array.isArray(d) ? d : d ? [d] : []; };
  const dialogueOf = (n) => dialogueList(n).map((x) => x && x.line).filter(Boolean).join(' ');
  const speakerOf = (n) => (dialogueList(n)[0] || {}).speaker || '';
  const speedOf = (c) => Math.min(2, Math.max(0.5, Number(c.speed) || 1));
  const srcLen = () => 8; // las tomas de Veo duran 8 s
  const clipDur = (c) => Math.max(1, srcLen() - (Number(c.trim_start) || 0) - (Number(c.trim_end) || 0)) / speedOf(c);
  const transS = (c) => Math.min(1.5, Math.max(0.2, Number(c.transition_s) || 0.4));

  function normalizePlan(p) {
    p.subtitles = Object.assign({ enabled: true, size: 38, margin_v: 180, style: 'classic', karaoke: false, speaker_colors: false, animation: 'none' }, p.subtitles || {});
    if (p.subtitles.margin_v == null) p.subtitles.margin_v = p.subtitles.position === 'middle' ? 560 : 300;
    p.clips.forEach((c) => {
      if (c.speed == null) c.speed = 1;
      if (c.zoom == null) c.zoom = false;
      if (!c.transition) c.transition = 'cut';
      if (c.transition_s == null) c.transition_s = 0.4;
    });
    return p;
  }

  function buildSeq() {
    const p = st.plan;
    const seq = [];
    let t = 0;
    const push = (item) => { item.t0 = t; t += item.dur; seq.push(item); };
    if (p.title_card.enabled && (p.title_card.text || p.title_card.subtext)) push({ type: 'card', key: 'title', lines: [p.title_card.text, p.title_card.subtext], dur: Number(p.title_card.seconds) || 2, label: 'Título' });
    const inc = p.clips.filter((c) => c.include !== false && clipAsset(c.shot));
    st.speakers = [];
    inc.forEach((c) => { const s = speakerOf(c.shot); if (s && !st.speakers.includes(s)) st.speakers.push(s); });
    inc.forEach((c, k) => {
      const a = clipAsset(c.shot);
      const tr = k < inc.length - 1 ? c.transition : 'cut';
      const narr = narrOf(c, a, OVERLAP(tr) ? transS(c) : 0);
      const start0 = Number(c.trim_start) || 0;
      push({ type: 'clip', shot: c.shot, url: a.storage_path, start: start0, end: srcLen() - (Number(c.trim_end) || 0), speed: speedOf(c), zoom: !!c.zoom, narr,
        subWin: narr ? [start0 + NARR_START * speedOf(c), start0 + (NARR_START + narr.seconds / narr.tempo) * speedOf(c)] : null,
        volume: narr && narr.mute ? 0 : (c.volume == null ? 1 : Number(c.volume)), subtitle: p.subtitles.enabled ? (c.subtitle || dialogueOf(c.shot)) : '', speaker: speakerOf(c.shot),
        overlay: c.overlay || '', dur: clipDur(c), transition: k < inc.length - 1 ? c.transition : 'cut', transition_s: transS(c), label: 'TOMA ' + String(c.shot).padStart(2, '0') });
    });
    if (p.end_card.enabled && (p.end_card.text || p.end_card.subtext)) push({ type: 'card', key: 'end', lines: [p.end_card.text, p.end_card.subtext], dur: Number(p.end_card.seconds) || 2, label: 'Final' });
    return seq;
  }
  // Duración real del video final: los fundidos cruzados se enciman.
  function totalDur(seq) {
    return seq.reduce((s, x) => s + x.dur, 0) - seq.reduce((s, x) => s + (x.type === 'clip' && OVERLAP(x.transition) ? Math.min(x.transition_s, x.dur / 2) : 0), 0);
  }

  // ================= Deshacer / rehacer =================
  function snapshot() {
    const now = Date.now();
    if (st.base != null && now - st.lastSnap > 700) {
      st.undo.push(st.base); if (st.undo.length > 100) st.undo.shift();
      st.redo = [];
    }
    st.lastSnap = now;
  }
  function markDirty() {
    snapshot();
    st.base = JSON.stringify(st.plan);
    st.dirty = true;
    renderTotals(); renderTimeline(); updateUndoBtns();
    $('edStatus').textContent = 'Cambios sin guardar.';
  }
  function updateUndoBtns() {
    $('edUndo').disabled = !st.undo.length; $('edRedo').disabled = !st.redo.length;
    $('edUndo').style.opacity = st.undo.length ? 1 : 0.4; $('edRedo').style.opacity = st.redo.length ? 1 : 0.4;
  }
  function restore(json) {
    const selShot = st.plan && st.plan.clips[st.sel] ? st.plan.clips[st.sel].shot : null;
    st.plan = normalizePlan(JSON.parse(json)); st.base = json; st.lastSnap = 0; st.dirty = true;
    const si = st.plan.clips.findIndex((x) => x.shot === selShot); if (si >= 0) st.sel = si;
    fillGlobals(); renderClips(); paintScrub(); previewSub(); updateUndoBtns();
    $('edStatus').textContent = 'Cambios sin guardar.';
  }
  function undo() { if (!st.undo.length) return; st.redo.push(JSON.stringify(st.plan)); restore(st.undo.pop()); }
  function redo() { if (!st.redo.length) return; st.undo.push(JSON.stringify(st.plan)); restore(st.redo.pop()); }

  // ================= Cambios en tomas =================
  function setClip(key, val, i) {
    const idx = i == null ? st.sel : i;
    const c = st.plan.clips[idx];
    if (!c) return;
    if (key === 'trim_start' || key === 'trim_end') {
      const other = key === 'trim_start' ? Number(c.trim_end) || 0 : Number(c.trim_start) || 0;
      c[key] = Math.round(Math.min(7 - other, Math.max(0, Number(val) || 0)) * 100) / 100;
    } else if (key === 'volume') c[key] = Math.min(2, Math.max(0, Number(val) || 0));
    else if (key === 'speed') c[key] = Math.min(2, Math.max(0.5, Number(val) || 1));
    else if (key === 'transition_s') c[key] = Math.min(1.5, Math.max(0.2, Number(val) || 0.4));
    else c[key] = val;
    markDirty();
    if (idx === st.sel && key !== 'subtitle' && key !== 'overlay') fillClipPanel();
    if (key === 'include') renderClips();
    else updateListItem(idx);
    if (st.scrubShot === c.shot) paintScrub();
  }

  // ================= Render de la interfaz =================
  function renderTotals() {
    st.seq = buildSeq();
    const total = totalDur(st.seq);
    $('edTotal').innerHTML = 'Duración del episodio: <b>' + fmt(total) + '</b>' + (total < MIN_SECONDS ? ' <span class="text-cyber-gold">(meta: mínimo 1:30)</span>' : ' <span class="text-cyber-emerald">✓</span>');
  }

  function listItemHtml(c, i) {
    const a = clipAsset(c.shot);
    const on = i === st.sel;
    const cut = (Number(c.trim_start) || Number(c.trim_end));
    const tags = [cut ? '<span class="text-cyber-gold" title="recortada">✂</span>' : '', speedOf(c) !== 1 ? `<span class="text-cyber-cyan">${speedOf(c)}×</span>` : '', c.zoom ? '<span class="text-cyber-violet" title="zoom">🔍</span>' : '',
      c.transition && c.transition !== 'cut' ? `<span class="text-cyber-violet" title="transición: ${TRANSITIONS[c.transition]}">${TR_ICON[c.transition] || '◐'}</span>` : '', c.overlay ? '<span class="text-yellow-300" title="texto arriba">T</span>' : '', c.include === false ? '<span class="text-cyber-pink">quitada</span>' : ''].filter(Boolean).join(' ');
    return `<div id="edItem${i}" onclick="vyEditor.select(${i})" class="flex items-center gap-2 rounded-lg p-1.5 cursor-pointer border ${on ? 'border-cyber-cyan bg-cyber-cyan/10' : 'border-cyber-border hover:border-slate-500'} ${c.include === false ? 'opacity-40' : ''}">
      ${a ? `<video src="${esc(a.storage_path)}#t=1" preload="metadata" muted class="w-9 h-16 object-cover rounded bg-black flex-shrink-0 pointer-events-none"></video>` : '<div class="w-9 h-16 rounded bg-slate-900 flex-shrink-0"></div>'}
      <div class="flex-1 min-w-0 text-[11px] font-mono">
        <p class="${on ? 'text-cyber-cyan' : 'text-white'} font-bold">${String(i + 1).padStart(2, '0')} · TOMA ${String(c.shot).padStart(2, '0')}</p>
        <p class="text-slate-500 truncate">${esc((shotOf(c.shot).characters || []).map((n) => n.split(' ')[0]).join(' + '))}</p>
        <p class="text-slate-400">${clipDur(c).toFixed(1)}s ${tags}</p>
      </div>
      <div class="flex flex-col flex-shrink-0">
        <button onclick="event.stopPropagation();vyEditor.move(${i},-1)" class="text-slate-400 hover:text-white px-1" title="Subir"><i class="fa-solid fa-chevron-up"></i></button>
        <button onclick="event.stopPropagation();vyEditor.move(${i},1)" class="text-slate-400 hover:text-white px-1" title="Bajar"><i class="fa-solid fa-chevron-down"></i></button>
      </div>
    </div>`;
  }
  function updateListItem(i) {
    const el = $('edItem' + i);
    if (el) el.outerHTML = listItemHtml(st.plan.clips[i], i);
  }
  function renderClips() {
    if (st.sel == null || st.sel >= st.plan.clips.length) st.sel = 0;
    $('edClips').innerHTML = st.plan.clips.map(listItemHtml).join('');
    renderTotals(); renderTimeline(); fillClipPanel();
  }

  function fillClipPanel() {
    const c = st.plan.clips[st.sel];
    if (!c) return;
    const sh = shotOf(c.shot);
    $('edClipTitle').textContent = 'EDITANDO · TOMA ' + String(c.shot).padStart(2, '0') + ' (posición ' + (st.sel + 1) + ')';
    $('edClipInfo').textContent = (sh.characters || []).join(' + ') + (sh.location ? ' · ' + sh.location : '') + ' · queda ' + clipDur(c).toFixed(1) + 's';
    $('edClipInc').checked = c.include !== false;
    const vol = c.volume == null ? 1 : Number(c.volume);
    $('edVol').value = vol; $('edVolV').textContent = Math.round(vol * 100) + '%';
    $('edSpeed').value = String(speedOf(c));
    $('edZoom').checked = !!c.zoom;
    $('edTrans').value = c.transition || 'cut';
    $('edTransS').value = transS(c); $('edTransSV').textContent = transS(c).toFixed(1) + 's';
    $('edTransS').disabled = false;
    $('edTransSV').title = (c.transition || 'cut') === 'cut' ? 'Esta toma tiene corte directo: al mover la duración se pone fundido cruzado' : '';
    if ((c.transition || 'cut') === 'cut') $('edTransSV').textContent = 'corte';
    if (document.activeElement !== $('edSubText')) $('edSubText').value = c.subtitle || '';
    $('edSubText').placeholder = dialogueOf(c.shot) || '(sin diálogo)';
    if (document.activeElement !== $('edOverlay')) $('edOverlay').value = c.overlay || '';
    $('edClearTrim').style.opacity = (Number(c.trim_start) || Number(c.trim_end)) ? 1 : 0.35;
  }

  function fillGlobals() {
    const p = st.plan;
    $('edSubOn').checked = p.subtitles.enabled !== false;
    $('edKaraoke').checked = !!p.subtitles.karaoke;
    $('edSpkColor').checked = !!p.subtitles.speaker_colors;
    $('edPop').checked = p.subtitles.animation === 'pop';
    document.querySelectorAll('#edModal [data-substyle]').forEach((b) => {
      const on = b.dataset.substyle === (p.subtitles.style || 'classic');
      b.className = btn + ' ' + (on ? 'border-cyber-cyan text-cyber-cyan bg-cyber-cyan/10' : 'border-cyber-border text-slate-400 hover:text-white');
    });
    $('edSubSize').value = p.subtitles.size || 38; $('edSubSizeV').textContent = $('edSubSize').value;
    $('edSubPos').value = p.subtitles.margin_v; $('edSubPosV').textContent = posLabel();
    $('edNorm').checked = p.audio.normalize !== false;
    $('edDuck').checked = p.audio.duck !== false;
    $('edMusicVol').value = p.audio.music_volume == null ? 0.12 : p.audio.music_volume; $('edMusicVolV').textContent = Math.round($('edMusicVol').value * 100) + '%';
    $('edMusicName').textContent = p.audio.music_url ? (p.audio.music_name || 'música cargada') : 'sin música';
    $('edMusicDel').classList.toggle('hidden', !p.audio.music_url);
    renderMusicLib();
    if (!$('edMusicPrompt').value) $('edMusicPrompt').value = MUSIC_PROMPT_DEFAULT;
    if (($('edMusic').getAttribute('src') || '') !== (p.audio.music_url || '')) $('edMusic').setAttribute('src', p.audio.music_url || '');
    $('edTitleOn').checked = !!p.title_card.enabled; $('edTitleText').value = p.title_card.text || ''; $('edTitleSub').value = p.title_card.subtext || ''; $('edTitleSecs').value = p.title_card.seconds || 2;
    $('edEndOn').checked = !!p.end_card.enabled; $('edEndText').value = p.end_card.text || ''; $('edEndSub').value = p.end_card.subtext || ''; $('edEndSecs').value = p.end_card.seconds || 2;
  }

  // ================= Línea de tiempo =================
  function renderTimeline() {
    const tl = $('edTimeline');
    if (!tl || !st.plan) return;
    const seq = buildSeq();
    const px = st.pxs;
    const total = seq.reduce((s, x) => s + x.dur, 0);
    tl.style.width = Math.max(600, total * px + 40) + 'px';
    let html = '';
    // regla
    for (let s = 0; s <= Math.ceil(total); s += (px < 10 ? 10 : 5)) {
      html += `<div style="position:absolute;left:${10 + s * px}px;top:2px;font:9px monospace;color:#64748b">${fmt(s)}</div><div style="position:absolute;left:${10 + s * px}px;top:14px;height:6px;width:1px;background:#334155"></div>`;
    }
    seq.forEach((it) => {
      const left = 10 + it.t0 * px;
      const w = Math.max(8, it.dur * px - 3);
      if (it.type === 'card') {
        html += `<div class="tl-card" style="left:${left}px;width:${w}px" title="Tarjeta">${esc(it.label)}</div>`;
        return;
      }
      const i = st.plan.clips.findIndex((c) => c.shot === it.shot);
      const c = st.plan.clips[i];
      html += `<div class="tl-block ${i === st.sel ? 'sel' : ''}" data-i="${i}" style="left:${left}px;width:${w}px">
        <video src="${esc(it.url)}#t=${(it.start + 1).toFixed(1)}" preload="metadata" muted></video>
        <div class="tl-h l" data-h="l" title="Arrastra para cortar el inicio"></div><div class="tl-h r" data-h="r" title="Arrastra para cortar el final"></div>
        <span class="tl-name">${String(c.shot).padStart(2, '0')}${speedOf(c) !== 1 ? ' · ' + speedOf(c) + '×' : ''}${c.zoom ? ' 🔍' : ''}</span><span class="tl-dur">${it.dur.toFixed(1)}s</span>
      </div>`;
      const nextIt = seq[seq.indexOf(it) + 1];
      if (nextIt && nextIt.type === 'clip') {
        const icon = TR_ICON[c.transition || 'cut'] || '◐';
        html += `<div class="tl-tr ${c.transition && c.transition !== 'cut' ? 'on' : ''}" data-tr="${i}" style="left:${10 + (it.t0 + it.dur) * px - 1}px" title="Transición: ${TRANSITIONS[c.transition || 'cut']} (clic para cambiar)">${icon}</div>`;
      }
    });
    // las tomas quitadas, al final y atenuadas, para poder volver a ponerlas
    st.plan.clips.forEach((c, i) => {
      if (c.include !== false) return;
      html += `<div class="tl-block off ${i === st.sel ? 'sel' : ''}" data-i="${i}" data-off="1" style="left:${10 + total * px + 20 + (html.match(/data-off/g) || []).length * 44}px;width:40px" title="Toma quitada (clic para elegirla)"><span class="tl-name">${String(c.shot).padStart(2, '0')}</span></div>`;
    });
    html += '<div id="edPlayhead" style="left:10px"></div>';
    tl.innerHTML = html;
    movePlayhead();
  }
  function globalTime() {
    const it = st.seq[st.idx];
    if (!it) return 0;
    if (it.type === 'card') return it.t0 + (st.cardT || 0);
    const v = $('edVideo');
    return it.t0 + Math.max(0, ((v.currentTime || it.start) - it.start) / it.speed);
  }
  function movePlayhead() {
    const ph = $('edPlayhead');
    if (!ph) return;
    const t = globalTime();
    ph.style.left = (10 + t * st.pxs) + 'px';
    const total = st.seq.reduce((s, x) => s + x.dur, 0);
    $('edTime').textContent = fmt(t) + ' / ' + fmt(totalDur(st.seq));
    if (st.playing) {
      const wrap = $('edTlWrap');
      const x = 10 + t * st.pxs;
      if (x < wrap.scrollLeft + 40 || x > wrap.scrollLeft + wrap.clientWidth - 40) wrap.scrollLeft = x - 80;
    }
    return total;
  }
  function seekGlobal(t) {
    st.seq = buildSeq();
    const it = st.seq.find((x) => t >= x.t0 && t < x.t0 + x.dur) || st.seq[st.seq.length - 1];
    if (!it) return;
    if (it.type === 'clip') {
      const i = st.plan.clips.findIndex((c) => c.shot === it.shot);
      if (i !== st.sel) { st.sel = i; renderClips(); }
      showFrame(it.shot, it.start + (t - it.t0) * it.speed);
    } else {
      stop(); st.idx = st.seq.indexOf(it); st.cardT = t - it.t0; showCard(it); movePlayhead();
    }
  }
  // Arrastrar en la línea de tiempo: bordes = recortar · cuerpo = mover · vacío = buscar
  function initTimeline() {
    const tl = $('edTimeline');
    tl.addEventListener('pointerdown', (e) => {
      const tr = e.target.closest('.tl-tr');
      if (tr) {
        const i = Number(tr.dataset.tr);
        const order = Object.keys(TRANSITIONS);
        const c = st.plan.clips[i];
        setClip('transition', order[(order.indexOf(c.transition || 'cut') + 1) % order.length], i);
        window.vyEditor.select(i);
        return;
      }
      const block = e.target.closest('.tl-block');
      const rect = tl.getBoundingClientRect();
      if (!block) { seekGlobal(Math.max(0, (e.clientX - rect.left - 10) / st.pxs)); return; }
      const i = Number(block.dataset.i);
      const c = st.plan.clips[i];
      if (block.dataset.off) { window.vyEditor.select(i); return; }
      const h = e.target.dataset.h;
      const x0 = e.clientX;
      const startTrim = { s: Number(c.trim_start) || 0, e: Number(c.trim_end) || 0 };
      let moved = false;
      block.setPointerCapture(e.pointerId);
      stop();
      if (st.sel !== i) { st.sel = i; fillClipPanel(); document.querySelectorAll('#edClips > div').forEach((el, k) => { el.classList.toggle('border-cyber-cyan', k === i); }); }
      const onMove = (ev) => {
        const dx = ev.clientX - x0;
        if (Math.abs(dx) > 3) moved = true;
        const dSrc = (dx / st.pxs) * speedOf(c);
        if (h === 'l') { setClip('trim_start', startTrim.s + dSrc, i); showFrame(c.shot, Number(c.trim_start)); }
        else if (h === 'r') { setClip('trim_end', startTrim.e - dSrc, i); showFrame(c.shot, srcLen() - Number(c.trim_end) - FRAME); }
        else if (moved) { block.style.transform = `translateX(${dx}px)`; block.style.zIndex = 5; block.style.cursor = 'grabbing'; }
      };
      const onUp = (ev) => {
        block.removeEventListener('pointermove', onMove);
        block.removeEventListener('pointerup', onUp);
        if (!h && moved) {
          // Mover la toma: se suelta delante de la toma cuyo centro queda a la derecha.
          const x = ev.clientX - rect.left - 10;
          const seq = buildSeq().filter((it) => it.type === 'clip' && it.shot !== c.shot);
          let target = seq.findIndex((it) => x < (it.t0 + it.dur / 2) * st.pxs);
          const shots = seq.map((it) => it.shot);
          const order = st.plan.clips.filter((k) => k.shot !== c.shot);
          const insertBefore = target >= 0 ? shots[target] : null;
          const pos = insertBefore == null ? order.length : order.findIndex((k) => k.shot === insertBefore);
          order.splice(pos, 0, c);
          st.plan.clips = order;
          st.sel = order.indexOf(c);
          markDirty(); renderClips();
        } else if (!h && !moved) {
          window.vyEditor.select(i);
        } else {
          renderClips();
        }
      };
      block.addEventListener('pointermove', onMove);
      block.addEventListener('pointerup', onUp);
    });
  }

  // ================= Subtítulos: estilo, arrastre, karaoke =================
  function posLabel() { return Math.round((Number(st.plan.subtitles.margin_v) || 0) / 1280 * 100) + '%'; }
  function styleSub(speaker) {
    const sub = $('edSub');
    const p = st.plan.subtitles;
    sub.style.fontSize = ((Number(p.size) || 38) * K) + 'px';
    sub.style.bottom = ((Number(p.margin_v) || 180) * K) + 'px';
    const style = p.style || 'classic';
    const spk = p.speaker_colors && speaker ? SPEAKER_CSS[Math.max(0, st.speakers.indexOf(speaker)) % SPEAKER_CSS.length] : null;
    const base = style === 'yellow' ? '#FFE100' : '#ffffff';
    const hl = style === 'yellow' ? '#ffffff' : '#FFE100';
    sub.style.setProperty('--base', spk || base);
    sub.style.setProperty('--hl', hl);
    sub.style.color = p.karaoke ? (spk || base) : (spk || base);
    if (style === 'box') {
      sub.style.textShadow = 'none';
      sub.innerHTML = sub.innerHTML; // conserva el contenido
      sub.style.background = 'transparent';
    } else {
      sub.style.textShadow = '0 0 3px #000,0 0 3px #000,0 0 3px #000,0 0 3px #000';
    }
  }
  function subHtml(text, progress) {
    const p = st.plan.subtitles;
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const box = (p.style || 'classic') === 'box';
    const wrap = (inner) => box ? `<span style="background:rgba(0,0,0,.6);padding:${2 * K * 4}px ${6 * K * 4}px;border-radius:${4 * K * 4}px;box-decoration-break:clone;-webkit-box-decoration-break:clone;line-height:1.5">${inner}</span>` : inner;
    if (!p.karaoke || progress == null) return wrap(esc(text));
    const weights = words.map((w) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length) + 1);
    const tot = weights.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    return wrap(words.map((w, i) => { acc += weights[i] / tot; return `<span class="${progress >= acc - weights[i] / tot ? 'w-on' : 'w-off'}">${esc(w)}</span>`; }).join(' '));
  }
  function previewSub() {
    const item = st.seq[st.idx];
    const c = st.plan.clips[st.sel];
    const text = item && item.type === 'clip' ? item.subtitle : (c ? (c.subtitle || dialogueOf(c.shot)) : '');
    styleSub(item && item.speaker);
    const sub = $('edSub');
    if (!st.playing) { sub.innerHTML = subHtml(text || 'Así se verá el subtítulo', st.plan.subtitles.karaoke ? 0.45 : null); sub.classList.toggle('hidden', !st.plan.subtitles.enabled); }
  }
  function initSubDrag() {
    const sub = $('edSub'); const phone = $('edPhone');
    sub.style.cursor = 'ns-resize'; sub.title = 'Arrastra para subir o bajar el subtítulo';
    phone.insertAdjacentHTML('beforeend', '<div id="edSafe" class="hidden absolute left-0 right-0 bottom-0 pointer-events-none" style="height:' + (190 * K) + 'px;background:repeating-linear-gradient(45deg,rgba(255,0,80,.18) 0 6px,transparent 6px 12px);border-top:1px dashed rgba(255,0,80,.6)"></div>');
    sub.addEventListener('pointerdown', (e) => {
      e.preventDefault(); sub.setPointerCapture(e.pointerId); st.dragging = true; $('edSafe').classList.remove('hidden');
      const rect = phone.getBoundingClientRect();
      const move = (ev) => {
        const fromBottom = rect.bottom - ev.clientY - sub.offsetHeight / 2;
        st.plan.subtitles.margin_v = Math.round(Math.min(1150, Math.max(20, fromBottom / K)) / 5) * 5;
        $('edSubPos').value = st.plan.subtitles.margin_v; $('edSubPosV').textContent = posLabel(); styleSub(st.seq[st.idx] && st.seq[st.idx].speaker);
      };
      const up = () => { st.dragging = false; $('edSafe').classList.add('hidden'); sub.removeEventListener('pointermove', move); sub.removeEventListener('pointerup', up); markDirty(); };
      sub.addEventListener('pointermove', move); sub.addEventListener('pointerup', up);
    });
  }

  // ================= Reproducción =================
  function showOverlay(item, tSrc) {
    const sub = $('edSub'); const top = $('edTop');
    styleSub(item.speaker);
    const SW = item.subWin || SUB_WINDOW;
    const inWin = tSrc >= SW[0] && tSrc <= SW[1];
    const showSub = item.subtitle && (inWin || st.dragging || !st.playing);
    sub.classList.toggle('hidden', !showSub);
    if (showSub) {
      const prog = st.plan.subtitles.karaoke ? Math.min(1, Math.max(0, (tSrc - SW[0]) / (SW[1] - SW[0]))) : null;
      sub.innerHTML = subHtml(item.subtitle, prog);
      if (st.plan.subtitles.animation === 'pop' && st.playing) {
        const age = (tSrc - Math.max(SW[0], item.start)) / item.speed;
        sub.style.transform = age >= 0 && age < 0.14 ? `scale(${0.7 + 0.3 * age / 0.14})` : 'scale(1)';
      } else sub.style.transform = 'scale(1)';
    }
    top.style.fontSize = (44 * K) + 'px'; top.style.top = (170 * K) + 'px';
    top.classList.toggle('hidden', !item.overlay);
    top.textContent = item.overlay || '';
    // zoom suave y fundidos (aprox. de lo que hará ffmpeg)
    const v = $('edVideo');
    const prog = Math.min(1, Math.max(0, (tSrc - item.start) / Math.max(0.1, item.end - item.start)));
    v.style.transform = item.zoom ? `scale(${1 + 0.08 * prog})` : 'none';
    const tIn = (tSrc - item.start) / item.speed;
    const tLeft = (item.end - tSrc) / item.speed;
    const prev = st.seq[st.idx - 1];
    let fade = 0;
    const fIn = prev && prev.type === 'clip' && prev.transition !== 'cut' ? prev.transition_s / 2 : 0;
    const fOut = item.transition !== 'cut' ? item.transition_s / 2 : 0;
    if (fIn && tIn < fIn) fade = Math.max(fade, (prev.transition === 'fade_black' ? 1 : 0.5) * (1 - tIn / fIn));
    if (fOut && tLeft < fOut) fade = Math.max(fade, (item.transition === 'fade_black' ? 1 : 0.5) * (1 - tLeft / fOut));
    $('edFade').style.opacity = st.playing ? fade : 0;
  }
  function onTime() {
    const item = st.seq[st.idx];
    if (!item || item.type !== 'clip') return;
    const v = $('edVideo');
    showOverlay(item, v.currentTime);
    if (item.narr && st.playing && !item._narrOn) {
      const tOut = (v.currentTime - item.start) / item.speed;
      if (tOut >= NARR_START && tOut < NARR_START + item.narr.seconds / item.narr.tempo) {
        item._narrOn = true;
        const na = $('edNarr');
        if (na.getAttribute('src') !== item.narr.url) na.setAttribute('src', item.narr.url);
        try { na.currentTime = Math.max(0, (tOut - NARR_START) * item.narr.tempo); } catch (_) {}
        na.playbackRate = item.narr.tempo; na.play().catch(() => {}); duck(true);
      }
    } else if (item.narr && st.playing && item._narrOn) {
      // Corrección de desfase: si la voz se adelantó/atrasó más de 0.25 s, se realinea.
      const na = $('edNarr');
      const want = ((v.currentTime - item.start) / item.speed - NARR_START) * item.narr.tempo;
      if (!na.paused && want >= 0 && want < na.duration && Math.abs(na.currentTime - want) > 0.25) { try { na.currentTime = want; } catch (_) {} }
    }
    if (st.scrubShot !== item.shot) {
      st.scrubShot = item.shot; paintScrub();
      const si = st.plan.clips.findIndex((x) => x.shot === item.shot);
      if (si >= 0 && si !== st.sel) { st.sel = si; renderClips(); }
    }
    $('edScrub').value = v.currentTime; $('edScrubTime').textContent = v.currentTime.toFixed(2) + 's / 8.00s';
    movePlayhead();
    if (st.playing && v.currentTime >= item.end - 0.03) next();
  }
  function showCard(item) {
    const v = $('edVideo'); const card = $('edCard');
    v.pause(); v.classList.add('invisible');
    $('edSub').classList.add('hidden'); $('edTop').classList.add('hidden'); $('edFade').style.opacity = 0;
    card.classList.remove('hidden');
    card.innerHTML = `<p style="font-family:Montserrat,sans-serif;font-weight:800;color:#fff;font-size:${66 * K}px;line-height:1.15">${esc(item.lines[0] || '')}</p><p style="font-family:Montserrat,sans-serif;font-weight:800;color:#b4b4b4;font-size:${40 * K}px;margin-top:${30 * K}px">${esc(item.lines[1] || '')}</p>`;
    $('edLabel').textContent = item.label;
  }
  function playItem(i) {
    clearTimeout(st.timer);
    st.idx = i;
    const item = st.seq[i];
    $('edNarr').pause(); duck(false);
    if (item) item._narrOn = false;
    const v = $('edVideo'); const card = $('edCard');
    if (!item) { stop(); return; }
    $('edLabel').textContent = item.label;
    if (item.type === 'card') {
      showCard(item);
      const t0 = Date.now() - (st.cardT || 0) * 1000; st.cardT = 0;
      const tick = () => { st.cardT = (Date.now() - t0) / 1000; movePlayhead(); if (!st.playing) return; if (st.cardT >= item.dur) { st.cardT = 0; next(); } else st.timer = setTimeout(tick, 80); };
      tick();
      return;
    }
    card.classList.add('hidden'); v.classList.remove('invisible');
    // Precarga la SIGUIENTE toma para que no se congele al cambiar (cada clip pesa ~6 MB).
    const nextClip = st.seq.slice(i + 1).find((x) => x.type === 'clip');
    if (nextClip && $('edPre').getAttribute('src') !== nextClip.url) { $('edPre').setAttribute('src', nextClip.url); $('edPre').load(); }
    if (item.narr) { const na = $('edNarr'); if (na.getAttribute('src') !== item.narr.url) { na.setAttribute('src', item.narr.url); na.load(); } }
    const go = () => { v.currentTime = item.start; v.volume = Math.min(1, item.volume); v.playbackRate = item.speed; if (st.playing) v.play().catch(() => {}); };
    if (v.getAttribute('src') !== item.url) { v.setAttribute('src', item.url); v.addEventListener('loadedmetadata', go, { once: true }); v.load(); } else go();
  }
  function next() {
    if (st.idx + 1 >= st.seq.length) { stop(); return; }
    playItem(st.idx + 1);
  }
  function stop() {
    st.playing = false; clearTimeout(st.timer);
    $('edVideo').pause(); $('edMusic').pause(); $('edNarr').pause(); duck(false); $('edFade').style.opacity = 0;
    $('edPlayBtn').innerHTML = '<i class="fa-solid fa-play mr-1"></i>Ver todo';
  }
  function start(fromIdx) {
    st.seq = buildSeq();
    if (!st.seq.length) return alert('No hay tomas incluidas.');
    st.playing = true;
    $('edPlayBtn').innerHTML = '<i class="fa-solid fa-pause mr-1"></i>Pausa';
    const m = $('edMusic');
    if (st.plan.audio.music_url) { m.volume = Number(st.plan.audio.music_volume) || 0.12; if (!fromIdx) m.currentTime = 0; m.play().catch(() => {}); }
    playItem(fromIdx || 0);
  }

  // ================= Buscar dentro de una toma =================
  function paintScrub() {
    const shot = st.scrubShot;
    if (shot == null) return;
    const c = st.plan.clips.find((x) => x.shot === shot) || {};
    const len = srcLen();
    const a = ((Number(c.trim_start) || 0) / len) * 100;
    const b = (1 - (Number(c.trim_end) || 0) / len) * 100;
    const r = $('edScrub');
    r.style.background = `linear-gradient(90deg,#334155 0%,#334155 ${a}%,#06b6d4 ${a}%,#06b6d4 ${b}%,#334155 ${b}%,#334155 100%)`;
    r.style.height = '6px'; r.style.borderRadius = '4px';
    $('edScrubLabel').textContent = 'TOMA ' + String(shot).padStart(2, '0') + ' · queda ' + clipDur(c).toFixed(1) + 's';
  }
  function showFrame(shot, t) {
    stop();
    st.seq = buildSeq();
    const a = clipAsset(shot);
    if (!a) return;
    st.scrubShot = shot;
    paintScrub();
    const i = st.seq.findIndex((x) => x.shot === shot);
    if (i >= 0) st.idx = i;
    const v = $('edVideo');
    $('edCard').classList.add('hidden'); v.classList.remove('invisible');
    $('edLabel').textContent = 'TOMA ' + String(shot).padStart(2, '0');
    const seek = () => {
      v.currentTime = Math.max(0, Math.min(srcLen() - FRAME, t));
      $('edScrub').value = v.currentTime; $('edScrubTime').textContent = v.currentTime.toFixed(2) + 's / 8.00s';
      const item = st.seq[st.idx];
      if (item && item.shot === shot) showOverlay(item, v.currentTime);
      movePlayhead();
    };
    if (v.getAttribute('src') !== a.storage_path) { v.setAttribute('src', a.storage_path); v.addEventListener('loadedmetadata', seek, { once: true }); v.load(); } else seek();
  }

  // ================= Atajos =================
  function initKeys() {
    document.addEventListener('keydown', (e) => {
      if ($('edModal').classList.contains('hidden')) return;
      if (!$('confirmModal').classList.contains('hidden')) return;
      const tag = (e.target && e.target.tagName) || '';
      const typing = (tag === 'INPUT' && !['range', 'checkbox'].includes(e.target.type)) || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape') { close(); return; }
      if (typing) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') { e.preventDefault(); window.vyEditor.togglePlay(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); window.vyEditor.stepFrame((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 24 : 1)); }
      else if (k === 'i') { e.preventDefault(); window.vyEditor.cutHere('start'); }
      else if (k === 'o') { e.preventDefault(); window.vyEditor.cutHere('end'); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const c = st.plan.clips[st.sel]; if (c) setClip('include', c.include === false); }
    });
  }

  // ================= Abrir / guardar / render =================
  async function open(episodeId) {
    injectUi();
    if (!$('edTimeline').dataset.init) { initTimeline(); $('edTimeline').dataset.init = '1'; }
    const c = ctx();
    const r = await fetch('/.netlify/functions/get-episodes?series=' + encodeURIComponent(c.series), { cache: 'no-store' });
    const d = await r.json();
    st.ep = (d.episodes || []).find((e) => e.id === episodeId);
    if (!st.ep) return alert('No encontré el episodio.');
    if (st.ep.status === 'generando_media') return alert('El episodio se está generando. Ábrelo en el editor cuando termine.');
    const res = await fetch('/.netlify/functions/edit-plan?episode_id=' + encodeURIComponent(episodeId));
    const out = await res.json();
    if (!res.ok) return alert(out.error || 'No se pudo cargar el plan de edición.');
    st.plan = normalizePlan(out.plan);
    if (!out.saved) {
      st.plan.end_card.text = 'Continúa en el episodio ' + (st.ep.episode_number + 1);
      st.plan.end_card.subtext = 'Sígueme para no perdértelo';
      st.plan.title_card.text = (d.series && d.series.title) || '';
      st.plan.title_card.subtext = 'Episodio ' + st.ep.episode_number + (st.ep.title ? ' · ' + st.ep.title : '');
    }
    st.dirty = false; st.undo = []; st.redo = []; st.base = JSON.stringify(st.plan); st.lastSnap = 0;
    $('edTitle').textContent = 'Editor · EP ' + st.ep.episode_number + (st.ep.title ? ' — ' + st.ep.title : '');
    const n = (st.ep.assets || []).filter((a) => a.kind === 'video_clip').length;
    $('edStatus').textContent = n + ' de ' + (st.ep.shots || []).length + ' tomas con video.' + (out.saved ? ' Plan guardado cargado.' : ' Plan nuevo (aún sin guardar).');
    fillGlobals(); renderClips(); updateUndoBtns();
    $('edModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    window.vyEditor.tab('subs');
    window.vyEditor.select(0);
  }
  async function close() {
    if (st.dirty && !(await window.askConfirm('Tienes cambios sin guardar en el editor. ¿Cerrar de todas formas?'))) return;
    stop();
    $('edModal').classList.add('hidden');
    document.body.style.overflow = '';
  }
  async function save(silent) {
    const res = await fetch('/.netlify/functions/edit-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episode_id: st.ep.id, plan: st.plan }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { alert('No se pudo guardar: ' + (out.error || res.status)); return false; }
    st.plan = normalizePlan(out.plan); st.base = JSON.stringify(st.plan); st.dirty = false;
    if (!silent) $('edStatus').textContent = 'Guardado ✓';
    return true;
  }
  async function reset() {
    if (!(await window.askConfirm('¿Restablecer el editor? Se borran recortes, orden, textos, efectos y música de este episodio (los videos no se tocan).'))) return;
    const res = await fetch('/.netlify/functions/edit-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episode_id: st.ep.id, reset: true }) });
    const out = await res.json();
    st.undo.push(JSON.stringify(st.plan)); st.redo = [];
    st.plan = normalizePlan(out.plan); st.base = JSON.stringify(st.plan); st.dirty = false;
    fillGlobals(); renderClips(); updateUndoBtns();
    $('edStatus').textContent = 'Restablecido (ya guardado). Puedes deshacerlo y volver a Guardar.';
  }
  async function render() {
    if (!(await save(true))) return;
    const total = totalDur(buildSeq());
    const heavy = st.plan.clips.some((c) => c.include !== false && (c.zoom || (c.transition && c.transition !== 'cut')));
    if (!(await window.askConfirm('Renderizar el video final del EP ' + st.ep.episode_number + ' (' + fmt(total) + ').\n\nNo cuesta nada (solo ffmpeg). Reemplaza el video final anterior. Tarda ' + (heavy ? '2–5' : '1–3') + ' minutos' + (heavy ? ' (zoom y transiciones toman más)' : '') + '.'))) return;
    const b = $('edRenderBtn'); b.disabled = true;
    const startedAt = Date.now();
    b.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Renderizando...';
    try {
      const res = await fetch('/.netlify/functions/render-episode-background', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ series: ctx().series, episode_id: st.ep.id }) });
      if (!res.ok && res.status !== 202) throw new Error('HTTP ' + res.status);
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        $('edStatus').textContent = 'Renderizando con ffmpeg... ' + Math.round((Date.now() - startedAt) / 1000) + ' s';
        const d = await fetch('/.netlify/functions/get-episodes?series=' + encodeURIComponent(ctx().series), { cache: 'no-store' }).then((r) => r.json());
        const ep = (d.episodes || []).find((e) => e.id === st.ep.id);
        const lr = ep && ep.validator_report && ep.validator_report.last_render;
        if (lr && new Date(lr.at).getTime() >= startedAt - 2000 && lr.status !== 'rendering') {
          if (lr.status === 'error') throw new Error(lr.error || 'error desconocido');
          $('edStatus').innerHTML = '✅ Video final listo (' + fmt(lr.seconds) + ', ' + lr.took_s + ' s de render). <button class="text-cyber-cyan underline" data-src="' + esc(lr.url) + '" data-kind="video" data-title="EP ' + st.ep.episode_number + ' · Video final" onclick="openMedia(this)">Ver / descargar</button>';
          ctx().reload && ctx().reload();
          return;
        }
      }
      throw new Error('tardó más de 10 minutos; revisa la terminal de netlify dev ([render-episode]).');
    } catch (err) {
      $('edStatus').textContent = '❌ No se pudo renderizar: ' + err.message;
    } finally {
      b.disabled = false; b.innerHTML = '<i class="fa-solid fa-film mr-1"></i>Guardar y renderizar video final ($0)';
    }
  }
  // ---------- Música con IA (Lyria) + biblioteca por serie ----------
  const MUSIC_PROMPT_DEFAULT = 'A 3-minute cinematic natural-history documentary underscore: deep warm cello and low strings, soft taiko-style drums pulsing slowly, airy ethnic flute, gentle piano motifs, a sense of ancient mystery, wonder and discovery, tension that rises gradually and resolves softly at the end. 70 BPM.';
  const musicTracks = () => { const d = ctx().data; return (d && d.series && d.series.story_bible && d.series.story_bible.music_tracks) || []; };
  function renderMusicLib() {
    const box = $('edMusicLib'); if (!box) return;
    const list = musicTracks();
    box.innerHTML = list.length ? list.map((t, i) =>
      `<div class="flex items-center gap-2 text-[11px]">
        <button onclick="vyEditor.previewTrack(${i})" class="text-slate-400 hover:text-white" title="Escuchar"><i class="fa-solid fa-play"></i></button>
        <span class="flex-1 truncate ${st.plan && st.plan.audio.music_url === t.url ? 'text-cyber-emerald' : 'text-slate-300'}">${esc(t.name || 'Música')}</span>
        ${st.plan && st.plan.audio.music_url === t.url ? '<span class="text-cyber-emerald">en uso</span>' : `<button onclick="vyEditor.useTrack(${i})" class="text-cyber-cyan hover:underline">Usar</button>`}
      </div>`).join('') : '<p class="text-[11px] text-slate-500">Todavía no hay música generada.</p>';
  }
  async function genMusic() {
    const prompt = $('edMusicPrompt').value.trim();
    if (prompt.length < 15) return alert('Describe la música un poco más.');
    if (!(await (window.askConfirm ? window.askConfirm('Generar una pista de música con Lyria 3.5 (instrumental, 2–3 min).\n\nCosto: ~$0.08. Tarda ~30–60 s. ¿Continuar?') : Promise.resolve(confirm('Generar música (~$0.08)?'))))) return;
    const b = $('edMusicGenBtn'); b.disabled = true; $('edMusicGenSt').textContent = 'Generando música... (~30–60 s)';
    const before = (musicTracks()[0] || {}).url;
    try {
      const res = await fetch('/.netlify/functions/music-generate-background', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ series: ctx().series, prompt }) });
      if (!res.ok && res.status !== 202) throw new Error('HTTP ' + res.status);
      const t0 = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 6000));
        await ctx().reload();
        const run = ((ctx().data || {}).series || {}).story_bible && ctx().data.series.story_bible.music_last_run;
        const first = musicTracks()[0];
        if (first && first.url !== before) { useTrackObj(first); $('edMusicGenSt').textContent = '✅ Lista y puesta en el episodio. Dale Guardar.'; break; }
        if (run && run.status === 'error' && new Date(run.at).getTime() > t0 - 5000) throw new Error(run.error || 'error');
        if (Date.now() - t0 > 4 * 60000) throw new Error('tardó demasiado; revisa la terminal');
      }
    } catch (err) {
      $('edMusicGenSt').textContent = '';
      alert('No se pudo generar la música: ' + err.message);
    } finally { b.disabled = false; renderMusicLib(); }
  }
  function useTrackObj(t) { st.plan.audio.music_url = t.url; st.plan.audio.music_name = t.name || 'Música IA'; if (st.plan.audio.music_volume == null || st.plan.audio.music_volume < 0.15) st.plan.audio.music_volume = 0.2; fillGlobals(); markDirty(); }

  async function uploadMusic(file) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return alert('La música pesa más de 15 MB. Usa un MP3 más ligero.');
    $('edMusicName').textContent = 'Subiendo ' + file.name + '...';
    try {
      const res = await fetch('/.netlify/functions/music-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ series: ctx().series, filename: file.name, content_type: file.type || 'audio/mpeg' }) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || res.status);
      const up = await fetch(out.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type || 'audio/mpeg' }, body: file });
      if (!up.ok) throw new Error('subida HTTP ' + up.status);
      st.plan.audio.music_url = out.public_url; st.plan.audio.music_name = file.name;
      fillGlobals(); markDirty();
    } catch (err) {
      $('edMusicName').textContent = 'sin música';
      alert('No se pudo subir la música: ' + err.message);
    }
  }

  window.vyEditor = {
    open, close, save, reset, render, undo, redo,
    togglePlay: () => {
      if (st.playing) { stop(); return; }
      st.seq = buildSeq();
      const it = st.seq[st.idx];
      const v = $('edVideo');
      if (it && it.type === 'clip' && v.currentTime > it.start + 0.05 && v.currentTime < it.end - 0.1) {
        st.playing = true; it._narrOn = false; $('edPlayBtn').innerHTML = '<i class="fa-solid fa-pause mr-1"></i>Pausa';
        v.playbackRate = it.speed; v.volume = Math.min(1, it.volume); v.play().catch(() => {});
        if (st.plan.audio.music_url) $('edMusic').play().catch(() => {});
      } else start(st.idx < st.seq.length - 1 ? st.idx : 0);
    },
    playFrom: (shot) => { st.seq = buildSeq(); const i = st.seq.findIndex((x) => x.shot === shot); if (i >= 0) start(i); },
    playSel: () => { const c = st.plan.clips[st.sel]; if (c) window.vyEditor.playFrom(c.shot); },
    select: (i) => {
      st.sel = i; renderClips();
      const c = st.plan.clips[i];
      if (c) showFrame(c.shot, Number(c.trim_start) || 0);
      previewSub();
      const el = $('edItem' + i); if (el) el.scrollIntoView({ block: 'nearest' });
    },
    move: (i, d) => { const a = st.plan.clips; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; if (st.sel === i) st.sel = j; else if (st.sel === j) st.sel = i; markDirty(); renderClips(); },
    stepFrame: (n) => {
      const c = st.plan.clips[st.sel];
      if (!c) return;
      const v = $('edVideo');
      const base = st.scrubShot === c.shot ? (v.currentTime || 0) : Number(c.trim_start) || 0;
      showFrame(c.shot, base + n * FRAME);
    },
    cutHere: (which) => {
      const c = st.plan.clips[st.sel];
      if (!c) return;
      const t = st.scrubShot === c.shot ? ($('edVideo').currentTime || 0) : 0;
      if (which === 'start') setClip('trim_start', Math.round(t * 100) / 100);
      else setClip('trim_end', Math.round((srcLen() - t) * 100) / 100);
      renderClips(); paintScrub();
      $('edStatus').textContent = (which === 'start' ? 'Inicio' : 'Final') + ' de la TOMA ' + String(c.shot).padStart(2, '0') + ' en ' + t.toFixed(2) + 's (Ctrl+Z para deshacer).';
    },
    clearTrim: (i) => { const idx = i == null ? st.sel : i; const c = st.plan.clips[idx]; c.trim_start = 0; c.trim_end = 0; markDirty(); renderClips(); paintScrub(); },
    autoTransitions: (mode) => {
      const type = $('edAutoType').value || 'crossfade';
      const inc = st.plan.clips.filter((c) => c.include !== false && clipAsset(c.shot));
      let changed = 0;
      inc.forEach((c, k) => {
        const nxt = inc[k + 1];
        let t = 'cut';
        if (nxt && mode === 'all') t = type;
        if (nxt && mode === 'scene' && (shotOf(c.shot).location || '') !== (shotOf(nxt.shot).location || '')) t = type;
        if (c.transition !== t) { c.transition = t; changed++; }
        if (t !== 'cut' && !c.transition_s) c.transition_s = 0.5;
      });
      markDirty(); renderClips();
      $('edStatus').textContent = mode === 'none' ? 'Todas las transiciones quitadas.' : changed + ' transición(es) puestas (' + TRANSITIONS[type] + (mode === 'scene' ? ', solo al cambiar de lugar' : '') + '). Ctrl+Z para deshacer.';
    },
    subStyle: (k) => { st.plan.subtitles.style = k; fillGlobals(); markDirty(); previewSub(); },
    zoomTl: (d) => { st.pxs = Math.min(60, Math.max(6, st.pxs * (d > 0 ? 1.4 : 1 / 1.4))); renderTimeline(); },
    tab: (name) => {
      document.querySelectorAll('#edModal .ed-pane').forEach((el) => el.classList.toggle('hidden', el.dataset.pane !== name));
      document.querySelectorAll('#edModal .ed-tab').forEach((el) => { const on = el.dataset.tab === name; el.className = 'ed-tab px-3 py-1 rounded-t border-b-2 text-xs font-mono ' + (on ? 'border-cyber-cyan text-cyber-cyan' : 'border-transparent text-slate-400 hover:text-white'); });
    },
    genMusic,
    useTrack: (i) => { const t = musicTracks()[i]; if (t) useTrackObj(t); },
    previewTrack: (i) => { const t = musicTracks()[i]; if (!t) return; const a = window.__trackPrev || (window.__trackPrev = new Audio()); if (a.src === t.url && !a.paused) { a.pause(); return; } a.src = t.url; a.play().catch(() => {}); },
    removeMusic: () => { st.plan.audio.music_url = null; st.plan.audio.music_name = ''; fillGlobals(); markDirty(); }
  };
})();
