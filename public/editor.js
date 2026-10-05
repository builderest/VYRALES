// VYRALES — Editor de episodio (recortar, ordenar, subtítulos, audio, tarjetas).
// Todo lo que se ve aquí es una VISTA PREVIA en el navegador; el video final lo arma
// render-episode-background con ffmpeg aplicando el mismo plan (episodes.edit_plan).
(function () {
  const PREVIEW_W = 288; // ancho del "teléfono" de la vista previa (video real: 720x1280)
  const K = PREVIEW_W / 720;
  const SUB_WINDOW = [0.25, 6.1]; // el diálogo se dice entre 0 y 6 s de cada toma
  const MIN_SECONDS = 90;

  const st = { ep: null, plan: null, seq: [], idx: 0, playing: false, timer: null, dirty: false, undo: [], redo: [], lastSnap: 0, base: null };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const ctx = () => (window.vyCtx ? window.vyCtx() : { series: new URLSearchParams(location.search).get('series'), data: null, reload: () => location.reload() });

  function injectUi() {
    if ($('edModal')) return;
    const font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@800&display=swap';
    document.head.appendChild(font);
    document.body.insertAdjacentHTML('beforeend', `
<div id="edModal" class="hidden fixed inset-0 z-[105] bg-black/85 backdrop-blur-sm overflow-y-auto p-3">
  <div class="max-w-7xl mx-auto bg-cyber-darker border border-cyber-cyan/40 rounded-xl shadow-2xl">
    <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-cyber-border">
      <div class="min-w-0">
        <h3 id="edTitle" class="font-display font-bold text-white text-lg truncate">Editor</h3>
        <p class="text-[11px] font-mono text-slate-400">Elige una toma a la derecha y edítala a la izquierda · el video final se arma con ffmpeg al darle <b>Renderizar</b> ($0)</p>
      </div>
      <div class="flex items-center gap-2">
        <button id="edUndo" onclick="vyEditor.undo()" class="px-2 py-1 rounded bg-slate-800 text-white text-xs font-mono hover:bg-slate-700" title="Deshacer (Ctrl+Z)"><i class="fa-solid fa-rotate-left"></i></button>
        <button id="edRedo" onclick="vyEditor.redo()" class="px-2 py-1 rounded bg-slate-800 text-white text-xs font-mono hover:bg-slate-700" title="Rehacer (Ctrl+Y)"><i class="fa-solid fa-rotate-right"></i></button>
        <button onclick="vyEditor.close()" class="text-slate-400 hover:text-white text-xl px-2" title="Cerrar"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 p-4">
      <!-- IZQUIERDA: la toma que se edita + todas las herramientas -->
      <div class="min-w-0 grid grid-cols-1 md:grid-cols-[${PREVIEW_W + 16}px_1fr] gap-4">
        <div class="flex flex-col items-center gap-2">
          <div id="edPhone" class="relative bg-black rounded-xl overflow-hidden border border-cyber-border" style="width:${PREVIEW_W}px;height:${PREVIEW_W * 16 / 9}px">
            <video id="edVideo" class="absolute inset-0 w-full h-full object-cover" playsinline preload="auto"></video>
            <div id="edCard" class="hidden absolute inset-0 bg-black flex flex-col items-center justify-center text-center px-6"></div>
            <div id="edTop" class="hidden absolute left-0 right-0 text-center px-4" style="font-family:Montserrat,sans-serif;font-weight:800;color:#FFE100;text-shadow:0 0 3px #000,0 0 3px #000,0 0 3px #000"></div>
            <div id="edSub" class="hidden absolute left-0 right-0 text-center px-5 leading-tight z-10 select-none" style="font-family:Montserrat,sans-serif;font-weight:800;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000,0 0 3px #000,0 0 3px #000"></div>
            <div id="edLabel" class="absolute top-1 left-1 text-[10px] font-mono bg-black/60 text-white rounded px-1.5"></div>
          </div>
          <audio id="edMusic" loop preload="auto"></audio>
          <div class="w-full flex items-center gap-2">
            <button id="edPlayBtn" onclick="vyEditor.togglePlay()" class="px-3 py-1.5 rounded-lg bg-cyber-cyan/20 border border-cyber-cyan/50 text-cyber-cyan text-xs font-mono"><i class="fa-solid fa-play mr-1"></i>Ver todo</button>
            <div class="flex-1 h-1.5 bg-slate-800 rounded"><div id="edProg" class="h-1.5 bg-cyber-cyan rounded" style="width:0%"></div></div>
            <span id="edTime" class="text-[10px] font-mono text-slate-400">0:00</span>
          </div>
          <p id="edTotal" class="text-xs font-mono"></p>
        </div>
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
            <div id="edScrubBox" class="bg-black/40 border border-cyber-border rounded-lg p-2">
              <div class="flex items-center justify-between mb-1"><span id="edScrubLabel" class="text-white">Busca el cuadro exacto</span><span id="edScrubTime">0.0s / 8.0s</span></div>
              <input type="range" id="edScrub" min="0" max="8" step="0.04" value="0" class="w-full">
              <div class="flex gap-2 mt-2">
                <button onclick="vyEditor.cutHere('start')" class="flex-1 px-2 py-1 rounded border border-cyber-gold/50 text-cyber-gold hover:bg-cyber-gold/10" title="Lo de antes de este punto se quita"><i class="fa-solid fa-scissors mr-1"></i>Empieza aquí</button>
                <button onclick="vyEditor.cutHere('end')" class="flex-1 px-2 py-1 rounded border border-cyber-gold/50 text-cyber-gold hover:bg-cyber-gold/10" title="Lo de después de este punto se quita">Termina aquí <i class="fa-solid fa-scissors ml-1"></i></button>
                <button id="edClearTrim" onclick="vyEditor.clearTrim()" class="px-2 py-1 rounded border border-cyber-border text-slate-400 hover:text-white" title="Toma completa otra vez"><i class="fa-solid fa-rotate-left"></i></button>
              </div>
              <p class="text-[10px] text-slate-500 mt-1">Las zonas grises de la barra se quitan del video final.</p>
            </div>
            <label class="flex items-center gap-2">Cortar inicio <input type="range" id="edCutStart" min="0" max="6" step="0.1" class="flex-1"><span id="edCutStartV" class="w-10 text-right"></span></label>
            <label class="flex items-center gap-2">Cortar final <input type="range" id="edCutEnd" min="0" max="6" step="0.1" class="flex-1"><span id="edCutEndV" class="w-10 text-right"></span></label>
            <label class="flex items-center gap-2">Volumen <input type="range" id="edVol" min="0" max="2" step="0.05" class="flex-1"><span id="edVolV" class="w-10 text-right"></span></label>
            <label class="flex items-center gap-2">Subtítulo <input id="edSubText" maxlength="200" class="flex-1 bg-black border border-cyber-border rounded px-2 py-1"></label>
            <label class="flex items-center gap-2">Texto arriba <input id="edOverlay" maxlength="60" placeholder="(opcional) ej. 3 DÍAS DESPUÉS" class="flex-1 bg-black border border-cyber-border rounded px-2 py-1"></label>
          </div>
          <div>
            <div class="flex gap-1 mb-2">
              <button data-tab="subs" onclick="vyEditor.tab('subs')" class="ed-tab px-3 py-1 rounded-t border-b-2">Subtítulos</button>
              <button data-tab="audio" onclick="vyEditor.tab('audio')" class="ed-tab px-3 py-1 rounded-t border-b-2">Audio</button>
              <button data-tab="cards" onclick="vyEditor.tab('cards')" class="ed-tab px-3 py-1 rounded-t border-b-2">Tarjetas</button>
            </div>
            <div data-pane="subs" class="ed-pane bg-black/30 border border-cyber-border rounded-lg p-3 space-y-2">
              <label class="flex items-center gap-2"><input type="checkbox" id="edSubOn"> Quemar subtítulos con el diálogo (todas las tomas)</label>
              <label class="flex items-center gap-2">Tamaño <input type="range" id="edSubSize" min="22" max="64" step="1" class="flex-1"><span id="edSubSizeV" class="w-8 text-right"></span></label>
              <label class="flex items-center gap-2">Altura <input type="range" id="edSubPos" min="20" max="1150" step="5" class="flex-1"><span id="edSubPosV" class="w-12 text-right"></span></label>
              <p class="text-[10px] text-slate-500">También puedes <b>arrastrar el subtítulo</b> en la vista previa. La franja roja es donde TikTok/Reels tapan con sus botones.</p>
            </div>
            <div data-pane="audio" class="ed-pane hidden bg-black/30 border border-cyber-border rounded-lg p-3 space-y-2">
              <label class="flex items-center gap-2"><input type="checkbox" id="edNorm"> Volumen parejo en todo el episodio (-14 LUFS)</label>
              <div class="flex items-center gap-2"><button onclick="document.getElementById('edMusicFile').click()" class="px-2 py-1 rounded border border-cyber-border hover:text-white"><i class="fa-solid fa-music mr-1"></i>Subir música</button><input type="file" id="edMusicFile" accept="audio/*" class="hidden"><span id="edMusicName" class="truncate text-slate-400"></span><button id="edMusicDel" onclick="vyEditor.removeMusic()" class="hidden text-cyber-pink" title="Quitar música"><i class="fa-solid fa-trash"></i></button></div>
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
      <!-- DERECHA: todas las tomas -->
      <div class="min-w-0 flex flex-col">
        <p class="text-xs font-mono text-cyber-cyan font-bold mb-2">TOMAS · orden del video final</p>
        <div id="edClips" class="flex flex-col gap-1.5 overflow-y-auto pr-1" style="max-height:${PREVIEW_W * 16 / 9 + 40}px"></div>
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
    $('edMusicFile').addEventListener('change', (e) => uploadMusic(e.target.files[0]));
    const bind = (id, fn, ev) => $(id).addEventListener(ev || 'input', () => { fn($(id)); markDirty(); });
    bind('edSubOn', (el) => { st.plan.subtitles.enabled = el.checked; }, 'change');
    bind('edSubSize', (el) => { st.plan.subtitles.size = Number(el.value); $('edSubSizeV').textContent = el.value; previewSub(); });
    bind('edSubPos', (el) => { st.plan.subtitles.margin_v = Number(el.value); $('edSubPosV').textContent = posLabel(); previewSub(); });
    initDrag();
    bind('edNorm', (el) => { st.plan.audio.normalize = el.checked; }, 'change');
    bind('edMusicVol', (el) => { st.plan.audio.music_volume = Number(el.value); $('edMusicVolV').textContent = Math.round(el.value * 100) + '%'; $('edMusic').volume = Number(el.value); });
    bind('edTitleOn', (el) => { st.plan.title_card.enabled = el.checked; }, 'change');
    bind('edTitleText', (el) => { st.plan.title_card.text = el.value; });
    bind('edTitleSub', (el) => { st.plan.title_card.subtext = el.value; });
    bind('edTitleSecs', (el) => { st.plan.title_card.seconds = Number(el.value) || 2; });
    bind('edEndOn', (el) => { st.plan.end_card.enabled = el.checked; }, 'change');
    bind('edEndText', (el) => { st.plan.end_card.text = el.value; });
    bind('edEndSub', (el) => { st.plan.end_card.subtext = el.value; });
    bind('edEndSecs', (el) => { st.plan.end_card.seconds = Number(el.value) || 2; });
    // Herramientas de la toma seleccionada
    const selI = () => st.sel;
    $('edClipInc').addEventListener('change', (e) => window.vyEditor.set(selI(), 'include', e.target.checked));
    $('edCutStart').addEventListener('input', (e) => { window.vyEditor.set(selI(), 'trim_start', e.target.value); fillClipPanel(); showFrame(st.plan.clips[selI()].shot, Number(st.plan.clips[selI()].trim_start)); });
    $('edCutEnd').addEventListener('input', (e) => { window.vyEditor.set(selI(), 'trim_end', e.target.value); fillClipPanel(); showFrame(st.plan.clips[selI()].shot, clipLen() - Number(st.plan.clips[selI()].trim_end) - 0.05); });
    $('edVol').addEventListener('input', (e) => { window.vyEditor.set(selI(), 'volume', e.target.value); $('edVolV').textContent = Math.round(e.target.value * 100) + '%'; });
    $('edSubText').addEventListener('input', (e) => { window.vyEditor.set(selI(), 'subtitle', e.target.value); previewSub(); });
    $('edOverlay').addEventListener('input', (e) => { window.vyEditor.set(selI(), 'overlay', e.target.value); const it = st.seq[st.idx]; if (it) { it.overlay = e.target.value; showOverlay(it, $('edVideo').currentTime || 0); } });
    $('edScrub').addEventListener('input', (e) => { if (st.scrubShot != null) showFrame(st.scrubShot, Number(e.target.value)); });
    document.addEventListener('keydown', (e) => {
      if ($('edModal').classList.contains('hidden')) return;
      if (e.key === 'Escape') close();
      const inText = /INPUT|TEXTAREA/.test((e.target && e.target.tagName) || '') && e.target.type !== 'range' && e.target.type !== 'checkbox';
      if ((e.ctrlKey || e.metaKey) && !inText && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && !inText && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    });
  }

  // Deshacer / rehacer: se guarda una foto del plan ANTES de cada cambio. Los movimientos
  // seguidos de una barra (menos de 0.7 s entre sí) cuentan como un solo cambio.
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
    st.dirty = true; renderTotals(); updateUndoBtns(); $('edStatus').textContent = 'Cambios sin guardar.';
  }
  function updateUndoBtns() {
    if (!$('edUndo')) return;
    $('edUndo').disabled = !st.undo.length; $('edRedo').disabled = !st.redo.length;
    $('edUndo').style.opacity = st.undo.length ? 1 : 0.4; $('edRedo').style.opacity = st.redo.length ? 1 : 0.4;
  }
  function restore(json) {
    const selShot = st.plan && st.plan.clips[st.sel] ? st.plan.clips[st.sel].shot : null;
    st.plan = JSON.parse(json); st.base = json; st.lastSnap = 0; st.dirty = true;
    const si = st.plan.clips.findIndex((x) => x.shot === selShot); if (si >= 0) st.sel = si; // sigue en la misma toma
    fillGlobals(); renderClips(); paintScrub(); previewSub(); updateUndoBtns();
    $('edStatus').textContent = 'Cambios sin guardar.';
  }
  function undo() { if (!st.undo.length) return; st.redo.push(JSON.stringify(st.plan)); restore(st.undo.pop()); }
  function redo() { if (!st.redo.length) return; st.undo.push(JSON.stringify(st.plan)); restore(st.redo.pop()); }

  const clipAsset = (n) => (st.ep.assets || []).find((a) => a.kind === 'video_clip' && a.shot_number === n);
  const shotOf = (n) => (st.ep.shots || []).find((s) => s.n === n) || {};
  const dialogueOf = (n) => { const d = shotOf(n).dialogue; const l = Array.isArray(d) ? d : d ? [d] : []; return l.map((x) => x && x.line).filter(Boolean).join(' '); };
  const clipDur = (c) => Math.max(1, 8 - (Number(c.trim_start) || 0) - (Number(c.trim_end) || 0));

  function buildSeq() {
    const p = st.plan;
    const seq = [];
    if (p.title_card.enabled && (p.title_card.text || p.title_card.subtext)) seq.push({ type: 'card', lines: [p.title_card.text, p.title_card.subtext], dur: Number(p.title_card.seconds) || 2, label: 'Título' });
    p.clips.forEach((c) => {
      const a = clipAsset(c.shot);
      if (c.include === false || !a) return;
      seq.push({ type: 'clip', shot: c.shot, url: a.storage_path, start: Number(c.trim_start) || 0, end: 8 - (Number(c.trim_end) || 0), volume: c.volume == null ? 1 : Number(c.volume),
        subtitle: p.subtitles.enabled ? (c.subtitle || dialogueOf(c.shot)) : '', overlay: c.overlay || '', dur: clipDur(c), label: 'TOMA ' + String(c.shot).padStart(2, '0') });
    });
    if (p.end_card.enabled && (p.end_card.text || p.end_card.subtext)) seq.push({ type: 'card', lines: [p.end_card.text, p.end_card.subtext], dur: Number(p.end_card.seconds) || 2, label: 'Final' });
    return seq;
  }

  function renderTotals() {
    st.seq = buildSeq();
    const total = st.seq.reduce((s, x) => s + x.dur, 0);
    const el = $('edTotal');
    el.innerHTML = 'Duración del episodio: <b>' + fmt(total) + '</b>' + (total < MIN_SECONDS ? ' <span class="text-cyber-gold">(meta: mínimo 1:30)</span>' : ' <span class="text-cyber-emerald">✓</span>');
  }

  function renderClips() {
    const p = st.plan;
    if (st.sel == null || st.sel >= p.clips.length) st.sel = 0;
    $('edClips').innerHTML = p.clips.map((c, i) => {
      const a = clipAsset(c.shot);
      const on = i === st.sel;
      const cut = (Number(c.trim_start) || Number(c.trim_end));
      return `<div onclick="vyEditor.select(${i})" class="flex items-center gap-2 rounded-lg p-1.5 cursor-pointer border ${on ? 'border-cyber-cyan bg-cyber-cyan/10' : 'border-cyber-border hover:border-slate-500'} ${c.include === false ? 'opacity-40' : ''}">
        ${a ? `<video src="${esc(a.storage_path)}#t=1" preload="metadata" muted class="w-10 h-[72px] object-cover rounded bg-black flex-shrink-0 pointer-events-none"></video>` : '<div class="w-10 h-[72px] rounded bg-slate-900 flex-shrink-0"></div>'}
        <div class="flex-1 min-w-0 text-[11px] font-mono">
          <p class="${on ? 'text-cyber-cyan' : 'text-white'} font-bold">${String(i + 1).padStart(2, '0')} · TOMA ${String(c.shot).padStart(2, '0')}</p>
          <p class="text-slate-500 truncate">${esc((shotOf(c.shot).characters || []).map((n) => n.split(' ')[0]).join(' + '))}</p>
          <p class="text-slate-400"><span id="edDur${i}">${clipDur(c).toFixed(1)}s</span>${cut ? ' <span class="text-cyber-gold">✂</span>' : ''}${c.include === false ? ' <span class="text-cyber-pink">quitada</span>' : ''}${c.overlay ? ' <span class="text-yellow-300">T</span>' : ''}</p>
        </div>
        <div class="flex flex-col flex-shrink-0">
          <button onclick="event.stopPropagation();vyEditor.move(${i},-1)" class="text-slate-400 hover:text-white px-1" title="Subir"><i class="fa-solid fa-chevron-up"></i></button>
          <button onclick="event.stopPropagation();vyEditor.move(${i},1)" class="text-slate-400 hover:text-white px-1" title="Bajar"><i class="fa-solid fa-chevron-down"></i></button>
        </div>
      </div>`;
    }).join('');
    renderTotals();
    fillClipPanel();
  }

  function fillClipPanel() {
    const c = st.plan.clips[st.sel];
    if (!c) return;
    const sh = shotOf(c.shot);
    $('edClipTitle').textContent = 'EDITANDO · TOMA ' + String(c.shot).padStart(2, '0') + ' (posición ' + (st.sel + 1) + ')';
    $('edClipInfo').textContent = (sh.characters || []).join(' + ') + (sh.location ? ' · ' + sh.location : '') + ' · queda ' + clipDur(c).toFixed(1) + 's';
    $('edClipInc').checked = c.include !== false;
    $('edCutStart').value = Number(c.trim_start) || 0; $('edCutStartV').textContent = (Number(c.trim_start) || 0).toFixed(1) + 's';
    $('edCutEnd').value = Number(c.trim_end) || 0; $('edCutEndV').textContent = (Number(c.trim_end) || 0).toFixed(1) + 's';
    const vol = c.volume == null ? 1 : Number(c.volume);
    $('edVol').value = vol; $('edVolV').textContent = Math.round(vol * 100) + '%';
    if (document.activeElement !== $('edSubText')) { $('edSubText').value = c.subtitle || ''; }
    $('edSubText').placeholder = dialogueOf(c.shot) || '(sin diálogo)';
    if (document.activeElement !== $('edOverlay')) $('edOverlay').value = c.overlay || '';
    $('edClearTrim').style.opacity = (Number(c.trim_start) || Number(c.trim_end)) ? 1 : 0.35;
    const durEl = $('edDur' + st.sel); if (durEl) durEl.textContent = clipDur(c).toFixed(1) + 's';
  }

  function fillGlobals() {
    const p = st.plan;
    $('edSubOn').checked = p.subtitles.enabled !== false;
    if (p.subtitles.margin_v == null) p.subtitles.margin_v = p.subtitles.position === 'middle' ? 560 : 300;
    $('edSubSize').value = p.subtitles.size || 38; $('edSubSizeV').textContent = $('edSubSize').value;
    $('edSubPos').value = p.subtitles.margin_v; $('edSubPosV').textContent = posLabel();
    $('edNorm').checked = p.audio.normalize !== false;
    $('edMusicVol').value = p.audio.music_volume == null ? 0.12 : p.audio.music_volume; $('edMusicVolV').textContent = Math.round($('edMusicVol').value * 100) + '%';
    $('edMusicName').textContent = p.audio.music_url ? (p.audio.music_name || 'música cargada') : 'sin música';
    $('edMusicDel').classList.toggle('hidden', !p.audio.music_url);
    $('edMusic').src = p.audio.music_url || '';
    $('edTitleOn').checked = !!p.title_card.enabled; $('edTitleText').value = p.title_card.text || ''; $('edTitleSub').value = p.title_card.subtext || ''; $('edTitleSecs').value = p.title_card.seconds || 2;
    $('edEndOn').checked = !!p.end_card.enabled; $('edEndText').value = p.end_card.text || ''; $('edEndSub').value = p.end_card.subtext || ''; $('edEndSecs').value = p.end_card.seconds || 2;
  }

  // ---- Subtítulo: tamaño y altura (con arrastre en la vista previa) ----
  function posLabel() { return Math.round((Number(st.plan.subtitles.margin_v) || 0) / 1280 * 100) + '%'; }
  function styleSub() {
    const sub = $('edSub');
    sub.style.fontSize = ((Number(st.plan.subtitles.size) || 38) * K) + 'px';
    sub.style.bottom = ((Number(st.plan.subtitles.margin_v) || 180) * K) + 'px';
  }
  // Muestra el subtítulo de la toma actual (aunque esté en pausa) para acomodarlo.
  function previewSub() {
    styleSub();
    const item = st.seq[st.idx];
    const text = item && item.type === 'clip' ? item.subtitle : '';
    const sub = $('edSub');
    if (!st.playing) { sub.textContent = text || 'Así se verá el subtítulo'; sub.classList.toggle('hidden', !st.plan.subtitles.enabled); }
  }
  function initDrag() {
    const sub = $('edSub'); const phone = $('edPhone');
    sub.style.cursor = 'ns-resize'; sub.style.pointerEvents = 'auto'; sub.title = 'Arrastra para subir o bajar el subtítulo';
    // Zona que tapa la interfaz de TikTok/Reels (aprox. el 15% de abajo).
    phone.insertAdjacentHTML('beforeend', '<div id="edSafe" class="hidden absolute left-0 right-0 bottom-0 pointer-events-none" style="height:' + (190 * K) + 'px;background:repeating-linear-gradient(45deg,rgba(255,0,80,.18) 0 6px,transparent 6px 12px);border-top:1px dashed rgba(255,0,80,.6)"></div>');
    sub.addEventListener('pointerdown', (e) => {
      e.preventDefault(); sub.setPointerCapture(e.pointerId); st.dragging = true; $('edSafe').classList.remove('hidden');
      const rect = phone.getBoundingClientRect();
      const move = (ev) => {
        const fromBottom = rect.bottom - ev.clientY - sub.offsetHeight / 2;
        st.plan.subtitles.margin_v = Math.round(Math.min(1150, Math.max(20, fromBottom / K)) / 5) * 5;
        $('edSubPos').value = st.plan.subtitles.margin_v; $('edSubPosV').textContent = posLabel(); styleSub();
      };
      const up = () => { st.dragging = false; $('edSafe').classList.add('hidden'); sub.removeEventListener('pointermove', move); sub.removeEventListener('pointerup', up); markDirty(); };
      sub.addEventListener('pointermove', move); sub.addEventListener('pointerup', up);
    });
  }

  // ---- Barra para buscar dentro de una toma y cortar ----
  st.scrubShot = null;
  function clipLen() { const v = $('edVideo'); return v.duration && isFinite(v.duration) ? v.duration : 8; }
  function paintScrub() {
    const shot = st.scrubShot;
    const box = $('edScrubBox');
    if (shot == null) { box.style.opacity = 0.5; return; }
    box.style.opacity = 1;
    const c = st.plan.clips.find((x) => x.shot === shot) || {};
    const len = clipLen();
    const a = ((Number(c.trim_start) || 0) / len) * 100;
    const b = (1 - (Number(c.trim_end) || 0) / len) * 100;
    const r = $('edScrub');
    r.max = len.toFixed(2);
    r.style.background = `linear-gradient(90deg,#334155 0%,#334155 ${a}%,#06b6d4 ${a}%,#06b6d4 ${b}%,#334155 ${b}%,#334155 100%)`;
    r.style.height = '6px'; r.style.borderRadius = '4px'; r.style.appearance = 'auto';
    $('edScrubLabel').textContent = 'TOMA ' + String(shot).padStart(2, '0') + ' · queda ' + Math.max(1, len - (Number(c.trim_start) || 0) - (Number(c.trim_end) || 0)).toFixed(1) + 's';
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
    const seek = () => { v.currentTime = Math.max(0, Math.min(clipLen() - 0.04, t)); $('edScrub').value = v.currentTime; $('edScrubTime').textContent = v.currentTime.toFixed(1) + 's / ' + clipLen().toFixed(1) + 's'; paintScrub(); const item = st.seq[st.idx]; if (item && item.shot === shot) showOverlay(item, v.currentTime); };
    if (v.getAttribute('src') !== a.storage_path) { v.setAttribute('src', a.storage_path); v.addEventListener('loadedmetadata', seek, { once: true }); v.load(); } else seek();
  }

  // ---- Vista previa ----
  function showOverlay(item, tInClip) {
    const sub = $('edSub'); const top = $('edTop');
    styleSub();
    const showSub = (item.subtitle && tInClip >= SUB_WINDOW[0] && tInClip <= SUB_WINDOW[1]) || (st.dragging && item.subtitle);
    sub.classList.toggle('hidden', !showSub);
    if (showSub) sub.textContent = item.subtitle;
    top.style.fontSize = (44 * K) + 'px'; top.style.top = (170 * K) + 'px';
    top.classList.toggle('hidden', !item.overlay);
    top.textContent = item.overlay || '';
  }
  function onTime() {
    const item = st.seq[st.idx];
    if (!item || item.type !== 'clip') return;
    const v = $('edVideo');
    showOverlay(item, v.currentTime);
    if (st.scrubShot !== item.shot) {
      st.scrubShot = item.shot; paintScrub();
      const si = st.plan.clips.findIndex((x) => x.shot === item.shot);
      if (si >= 0 && si !== st.sel) { st.sel = si; renderClips(); }
    }
    $('edScrub').value = v.currentTime; $('edScrubTime').textContent = v.currentTime.toFixed(1) + 's / ' + clipLen().toFixed(1) + 's';
    if (v.currentTime >= item.end - 0.03) next();
    updateProgress(v.currentTime - item.start);
  }
  function updateProgress(inItem) {
    const total = st.seq.reduce((s, x) => s + x.dur, 0) || 1;
    const before = st.seq.slice(0, st.idx).reduce((s, x) => s + x.dur, 0);
    const t = before + Math.max(0, inItem || 0);
    $('edProg').style.width = Math.min(100, (t / total) * 100) + '%';
    $('edTime').textContent = fmt(t) + ' / ' + fmt(total);
  }
  function playItem(i) {
    clearTimeout(st.timer);
    st.idx = i;
    const item = st.seq[i];
    const v = $('edVideo'); const card = $('edCard');
    if (!item) { stop(); return; }
    $('edLabel').textContent = item.label;
    if (item.type === 'card') {
      v.pause(); v.classList.add('invisible');
      $('edSub').classList.add('hidden'); $('edTop').classList.add('hidden');
      card.classList.remove('hidden');
      card.innerHTML = `<p style="font-family:Montserrat,sans-serif;font-weight:800;color:#fff;font-size:${66 * K}px;line-height:1.15">${esc(item.lines[0] || '')}</p><p style="font-family:Montserrat,sans-serif;font-weight:800;color:#b4b4b4;font-size:${40 * K}px;margin-top:${30 * K}px">${esc(item.lines[1] || '')}</p>`;
      const t0 = Date.now();
      const tick = () => { updateProgress((Date.now() - t0) / 1000); if (Date.now() - t0 >= item.dur * 1000) next(); else st.timer = setTimeout(tick, 100); };
      tick();
      return;
    }
    card.classList.add('hidden'); v.classList.remove('invisible');
    const go = () => { v.currentTime = item.start; v.volume = Math.min(1, item.volume); if (st.playing) v.play().catch(() => {}); };
    if (v.getAttribute('src') !== item.url) { v.setAttribute('src', item.url); v.addEventListener('loadedmetadata', go, { once: true }); v.load(); } else go();
  }
  function next() {
    if (st.idx + 1 >= st.seq.length) { stop(); return; }
    playItem(st.idx + 1);
  }
  function stop() {
    st.playing = false; clearTimeout(st.timer);
    $('edVideo').pause(); $('edMusic').pause();
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

  // ---- Datos ----
  async function open(episodeId) {
    injectUi();
    const c = ctx();
    const r = await fetch('/.netlify/functions/get-episodes?series=' + encodeURIComponent(c.series), { cache: 'no-store' });
    const d = await r.json();
    st.ep = (d.episodes || []).find((e) => e.id === episodeId);
    if (!st.ep) return alert('No encontré el episodio.');
    if (st.ep.status === 'generando_media') return alert('El episodio se está generando. Ábrelo en el editor cuando termine.');
    const res = await fetch('/.netlify/functions/edit-plan?episode_id=' + encodeURIComponent(episodeId));
    const out = await res.json();
    if (!res.ok) return alert(out.error || 'No se pudo cargar el plan de edición.');
    st.plan = out.plan;
    if (!out.saved) {
      // Sugerencias para la primera vez: tarjeta final con el siguiente episodio.
      st.plan.end_card.text = 'Continúa en el episodio ' + (st.ep.episode_number + 1);
      st.plan.end_card.subtext = 'Sígueme para no perdértelo';
      st.plan.title_card.text = (d.series && d.series.title) || '';
      st.plan.title_card.subtext = 'Episodio ' + st.ep.episode_number + (st.ep.title ? ' · ' + st.ep.title : '');
    }
    st.dirty = false; st.undo = []; st.redo = []; st.base = JSON.stringify(st.plan); st.lastSnap = 0;
    $('edTitle').textContent = 'Editor · EP ' + st.ep.episode_number + (st.ep.title ? ' — ' + st.ep.title : '');
    const clips = (st.ep.assets || []).filter((a) => a.kind === 'video_clip').length;
    $('edStatus').textContent = clips + ' de ' + (st.ep.shots || []).length + ' tomas con video.' + (out.saved ? ' Plan guardado cargado.' : ' Plan nuevo (aún sin guardar).');
    fillGlobals(); renderClips(); updateUndoBtns();
    $('edModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    st.idx = 0; st.seq = buildSeq(); stop();
    if (st.seq[0]) { st.playing = false; playItem(0); }
    st.sel = 0; window.vyEditor.tab('subs'); window.vyEditor.select(0);
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
    st.plan = out.plan; st.base = JSON.stringify(st.plan); st.dirty = false;
    if (!silent) $('edStatus').textContent = 'Guardado ✓';
    return true;
  }
  async function reset() {
    if (!(await window.askConfirm('¿Restablecer el editor? Se borran recortes, orden, textos y música de este episodio (los videos no se tocan).'))) return;
    const res = await fetch('/.netlify/functions/edit-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episode_id: st.ep.id, reset: true }) });
    const out = await res.json();
    st.undo.push(JSON.stringify(st.plan)); st.redo = [];
    st.plan = out.plan; st.base = JSON.stringify(st.plan); st.dirty = false; fillGlobals(); renderClips(); updateUndoBtns(); $('edStatus').textContent = 'Restablecido. (Puedes deshacerlo, pero ya está guardado así; dale Guardar después de deshacer.)';
  }
  async function render() {
    if (!(await save(true))) return;
    const total = buildSeq().reduce((s, x) => s + x.dur, 0);
    if (!(await window.askConfirm('Renderizar el video final del EP ' + st.ep.episode_number + ' (' + fmt(total) + ').\n\nNo cuesta nada (solo ffmpeg). Reemplaza el video final anterior. Tarda 1–3 minutos.')) ) return;
    const btn = $('edRenderBtn'); btn.disabled = true;
    const startedAt = Date.now();
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Renderizando...';
    try {
      const res = await fetch('/.netlify/functions/render-episode-background', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ series: ctx().series, episode_id: st.ep.id }) });
      if (!res.ok && res.status !== 202) throw new Error('HTTP ' + res.status);
      for (let i = 0; i < 60; i++) {
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
      throw new Error('tardó más de 5 minutos; revisa la terminal de netlify dev ([render-episode]).');
    } catch (err) {
      $('edStatus').textContent = '❌ No se pudo renderizar: ' + err.message;
    } finally {
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-film mr-1"></i>Guardar y renderizar video final ($0)';
    }
  }
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
    open, close, save, reset, render,
    togglePlay: () => (st.playing ? stop() : start(st.idx < st.seq.length ? st.idx : 0)),
    playFrom: (shot) => { st.seq = buildSeq(); const i = st.seq.findIndex((x) => x.shot === shot); if (i >= 0) start(i); },
    set: (i, key, val) => {
      const c = st.plan.clips[i];
      if (key === 'trim_start' || key === 'trim_end') {
        // Cada toma debe quedar con al menos 1 s.
        const other = key === 'trim_start' ? Number(c.trim_end) || 0 : Number(c.trim_start) || 0;
        c[key] = Math.min(7 - other, Math.max(0, Number(val) || 0));
      }
      else if (key === 'volume') c[key] = Math.min(2, Math.max(0, Number(val) || 0));
      else c[key] = val;
      markDirty();
      const durEl = $('edDur' + i); if (durEl) durEl.textContent = clipDur(c).toFixed(1) + 's';
      if (i === st.sel && key !== 'subtitle' && key !== 'overlay') fillClipPanel();
      if (st.scrubShot === c.shot) paintScrub();
      if (key === 'include') renderClips();
    },
    move: (i, d) => { const a = st.plan.clips; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; if (st.sel === i) st.sel = j; else if (st.sel === j) st.sel = i; markDirty(); renderClips(); },
    seekShot: (shot, t) => showFrame(shot, t),
    undo, redo,
    clearTrim: (i) => { const c = st.plan.clips[i == null ? st.sel : i]; c.trim_start = 0; c.trim_end = 0; markDirty(); renderClips(); paintScrub(); },
    select: (i) => { st.sel = i; renderClips(); const c = st.plan.clips[i]; showFrame(c.shot, Number(c.trim_start) || 0); previewSub(); },
    playSel: () => { const c = st.plan.clips[st.sel]; if (c) window.vyEditor.playFrom(c.shot); },
    tab: (name) => {
      document.querySelectorAll('#edModal .ed-pane').forEach((el) => el.classList.toggle('hidden', el.dataset.pane !== name));
      document.querySelectorAll('#edModal .ed-tab').forEach((el) => { const on = el.dataset.tab === name; el.className = 'ed-tab px-3 py-1 rounded-t border-b-2 text-xs font-mono ' + (on ? 'border-cyber-cyan text-cyber-cyan' : 'border-transparent text-slate-400 hover:text-white'); });
    },
    cutHere: (which) => {
      if (st.scrubShot == null && st.plan.clips[st.sel]) st.scrubShot = st.plan.clips[st.sel].shot;
      if (st.scrubShot == null) return alert('Primero elige una toma de la lista de la derecha.');
      const i = st.plan.clips.findIndex((x) => x.shot === st.scrubShot);
      const t = $('edVideo').currentTime || 0;
      const len = clipLen();
      if (which === 'start') window.vyEditor.set(i, 'trim_start', Math.round(t * 10) / 10);
      else window.vyEditor.set(i, 'trim_end', Math.round((len - t) * 10) / 10);
      renderClips(); paintScrub();
    },
    removeMusic: () => { st.plan.audio.music_url = null; st.plan.audio.music_name = ''; fillGlobals(); markDirty(); }
  };
})();
