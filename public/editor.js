// VYRALES — Editor de episodio (recortar, ordenar, subtítulos, audio, tarjetas).
// Todo lo que se ve aquí es una VISTA PREVIA en el navegador; el video final lo arma
// render-episode-background con ffmpeg aplicando el mismo plan (episodes.edit_plan).
(function () {
  const PREVIEW_W = 288; // ancho del "teléfono" de la vista previa (video real: 720x1280)
  const K = PREVIEW_W / 720;
  const SUB_WINDOW = [0.25, 6.1]; // el diálogo se dice entre 0 y 6 s de cada toma
  const MIN_SECONDS = 90;

  const st = { ep: null, plan: null, seq: [], idx: 0, playing: false, timer: null, dirty: false };
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
  <div class="max-w-6xl mx-auto bg-cyber-darker border border-cyber-cyan/40 rounded-xl shadow-2xl">
    <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-cyber-border">
      <div class="min-w-0">
        <h3 id="edTitle" class="font-display font-bold text-white text-lg truncate">Editor</h3>
        <p class="text-[11px] font-mono text-slate-400">Vista previa en el navegador · el video final se arma con ffmpeg al darle <b>Renderizar</b> ($0)</p>
      </div>
      <button onclick="vyEditor.close()" class="text-slate-400 hover:text-white text-xl px-2" title="Cerrar"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 p-4">
      <div class="flex flex-col items-center gap-2">
        <div id="edPhone" class="relative bg-black rounded-xl overflow-hidden border border-cyber-border" style="width:${PREVIEW_W}px;height:${PREVIEW_W * 16 / 9}px">
          <video id="edVideo" class="absolute inset-0 w-full h-full object-cover" playsinline preload="auto"></video>
          <div id="edCard" class="hidden absolute inset-0 bg-black flex flex-col items-center justify-center text-center px-6"></div>
          <div id="edTop" class="hidden absolute left-0 right-0 text-center px-4" style="font-family:Montserrat,sans-serif;font-weight:800;color:#FFE100;text-shadow:0 0 3px #000,0 0 3px #000,0 0 3px #000"></div>
          <div id="edSub" class="hidden absolute left-0 right-0 text-center px-5 leading-tight" style="font-family:Montserrat,sans-serif;font-weight:800;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000,0 0 3px #000,0 0 3px #000"></div>
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
      <div class="min-w-0 flex flex-col gap-3">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono text-slate-300">
          <div class="bg-black/30 border border-cyber-border rounded-lg p-3 space-y-2">
            <p class="text-cyber-cyan font-bold">SUBTÍTULOS</p>
            <label class="flex items-center gap-2"><input type="checkbox" id="edSubOn"> Quemar subtítulos con el diálogo</label>
            <label class="flex items-center gap-2">Tamaño <input type="range" id="edSubSize" min="32" max="64" step="2" class="flex-1"><span id="edSubSizeV"></span></label>
            <label class="flex items-center gap-2">Posición <select id="edSubPos" class="bg-black border border-cyber-border rounded px-1"><option value="bottom">Abajo (arriba de la interfaz de TikTok)</option><option value="middle">Centro</option></select></label>
          </div>
          <div class="bg-black/30 border border-cyber-border rounded-lg p-3 space-y-2">
            <p class="text-cyber-cyan font-bold">AUDIO</p>
            <label class="flex items-center gap-2"><input type="checkbox" id="edNorm"> Volumen parejo en todo el episodio (-14 LUFS)</label>
            <div class="flex items-center gap-2"><button onclick="document.getElementById('edMusicFile').click()" class="px-2 py-1 rounded border border-cyber-border hover:text-white"><i class="fa-solid fa-music mr-1"></i>Subir música</button><input type="file" id="edMusicFile" accept="audio/*" class="hidden"><span id="edMusicName" class="truncate text-slate-400"></span><button id="edMusicDel" onclick="vyEditor.removeMusic()" class="hidden text-cyber-pink" title="Quitar música"><i class="fa-solid fa-trash"></i></button></div>
            <label class="flex items-center gap-2">Volumen música <input type="range" id="edMusicVol" min="0" max="0.5" step="0.01" class="flex-1"><span id="edMusicVolV"></span></label>
          </div>
          <div class="bg-black/30 border border-cyber-border rounded-lg p-3 space-y-2">
            <label class="flex items-center gap-2 text-cyber-cyan font-bold"><input type="checkbox" id="edTitleOn"> TARJETA DE TÍTULO (inicio)</label>
            <input id="edTitleText" maxlength="80" placeholder="Título grande" class="w-full bg-black border border-cyber-border rounded px-2 py-1">
            <input id="edTitleSub" maxlength="120" placeholder="Texto pequeño (ej. Episodio 1 · Treinta días)" class="w-full bg-black border border-cyber-border rounded px-2 py-1">
            <label class="flex items-center gap-2">Segundos <input type="number" id="edTitleSecs" min="1" max="6" step="0.5" class="w-16 bg-black border border-cyber-border rounded px-1"></label>
          </div>
          <div class="bg-black/30 border border-cyber-border rounded-lg p-3 space-y-2">
            <label class="flex items-center gap-2 text-cyber-cyan font-bold"><input type="checkbox" id="edEndOn"> TARJETA FINAL</label>
            <input id="edEndText" maxlength="80" placeholder="Continúa en el episodio 2" class="w-full bg-black border border-cyber-border rounded px-2 py-1">
            <input id="edEndSub" maxlength="120" placeholder="Sígueme para no perdértelo" class="w-full bg-black border border-cyber-border rounded px-2 py-1">
            <label class="flex items-center gap-2">Segundos <input type="number" id="edEndSecs" min="1" max="6" step="0.5" class="w-16 bg-black border border-cyber-border rounded px-1"></label>
          </div>
        </div>
        <div>
          <p class="text-xs font-mono text-cyber-cyan font-bold mb-1">TOMAS (en el orden del video final)</p>
          <div id="edClips" class="flex flex-col gap-2"></div>
        </div>
        <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-cyber-border">
          <button onclick="vyEditor.save()" class="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-mono hover:bg-slate-700"><i class="fa-solid fa-floppy-disk mr-1"></i>Guardar</button>
          <button onclick="vyEditor.reset()" class="px-3 py-2 rounded-lg text-slate-400 text-xs font-mono hover:text-white">Restablecer todo</button>
          <button id="edRenderBtn" onclick="vyEditor.render()" class="ml-auto px-4 py-2 rounded-lg bg-cyber-emerald/20 border border-cyber-emerald/60 text-cyber-emerald text-xs font-mono hover:bg-cyber-emerald/30"><i class="fa-solid fa-film mr-1"></i>Guardar y renderizar video final ($0)</button>
        </div>
        <p id="edStatus" class="text-xs font-mono text-slate-400"></p>
      </div>
    </div>
  </div>
</div>`);
    const v = $('edVideo');
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', () => next());
    $('edMusicFile').addEventListener('change', (e) => uploadMusic(e.target.files[0]));
    const bind = (id, fn, ev) => $(id).addEventListener(ev || 'input', () => { fn($(id)); markDirty(); });
    bind('edSubOn', (el) => { st.plan.subtitles.enabled = el.checked; }, 'change');
    bind('edSubSize', (el) => { st.plan.subtitles.size = Number(el.value); $('edSubSizeV').textContent = el.value; });
    bind('edSubPos', (el) => { st.plan.subtitles.position = el.value; }, 'change');
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
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('edModal').classList.contains('hidden')) close(); });
  }

  function markDirty() { st.dirty = true; renderTotals(); $('edStatus').textContent = 'Cambios sin guardar.'; }

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
    $('edClips').innerHTML = p.clips.map((c, i) => {
      const a = clipAsset(c.shot);
      const def = dialogueOf(c.shot);
      return `<div class="flex gap-3 bg-black/30 border ${c.include === false ? 'border-slate-800 opacity-50' : 'border-cyber-border'} rounded-lg p-2" data-i="${i}">
        <div class="flex flex-col items-center gap-1 flex-shrink-0">
          ${a ? `<video src="${esc(a.storage_path)}#t=1" preload="metadata" muted class="w-16 h-28 object-cover rounded bg-black cursor-pointer" onclick="vyEditor.playFrom(${c.shot})" title="Ver esta toma"></video>` : '<div class="w-16 h-28 rounded bg-slate-900 flex items-center justify-center text-[9px] text-slate-500 text-center">sin video</div>'}
          <div class="flex gap-1"><button onclick="vyEditor.move(${i},-1)" class="text-slate-400 hover:text-white px-1" title="Subir"><i class="fa-solid fa-arrow-up"></i></button><button onclick="vyEditor.move(${i},1)" class="text-slate-400 hover:text-white px-1" title="Bajar"><i class="fa-solid fa-arrow-down"></i></button></div>
        </div>
        <div class="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono text-slate-300">
          <div class="sm:col-span-2 flex items-center justify-between gap-2">
            <span class="text-white font-bold">TOMA ${String(c.shot).padStart(2, '0')} <span class="text-slate-500 font-normal">· ${esc((shotOf(c.shot).characters || []).map((n) => n.split(' ')[0]).join(' + '))} · ${clipDur(c).toFixed(1)}s</span></span>
            <label class="flex items-center gap-1"><input type="checkbox" ${c.include === false ? '' : 'checked'} onchange="vyEditor.set(${i},'include',this.checked)"> Incluir</label>
          </div>
          <label class="flex items-center gap-2">Cortar inicio <input type="range" min="0" max="3" step="0.1" value="${c.trim_start || 0}" oninput="vyEditor.set(${i},'trim_start',this.value);this.nextElementSibling.textContent=Number(this.value).toFixed(1)+'s'" class="flex-1"><span class="w-9 text-right">${(Number(c.trim_start) || 0).toFixed(1)}s</span></label>
          <label class="flex items-center gap-2">Cortar final <input type="range" min="0" max="3" step="0.1" value="${c.trim_end || 0}" oninput="vyEditor.set(${i},'trim_end',this.value);this.nextElementSibling.textContent=Number(this.value).toFixed(1)+'s'" class="flex-1"><span class="w-9 text-right">${(Number(c.trim_end) || 0).toFixed(1)}s</span></label>
          <label class="flex items-center gap-2">Volumen <input type="range" min="0" max="2" step="0.05" value="${c.volume == null ? 1 : c.volume}" oninput="vyEditor.set(${i},'volume',this.value);this.nextElementSibling.textContent=Math.round(this.value*100)+'%'" class="flex-1"><span class="w-9 text-right">${Math.round((c.volume == null ? 1 : c.volume) * 100)}%</span></label>
          <label class="flex items-center gap-2">Texto arriba <input maxlength="60" value="${esc(c.overlay || '')}" placeholder="(opcional) ej. 3 DÍAS DESPUÉS" oninput="vyEditor.set(${i},'overlay',this.value)" class="flex-1 bg-black border border-cyber-border rounded px-1"></label>
          <label class="sm:col-span-2 flex items-center gap-2">Subtítulo <input maxlength="200" value="${esc(c.subtitle || '')}" placeholder="${esc(def || '(sin diálogo)')}" oninput="vyEditor.set(${i},'subtitle',this.value)" class="flex-1 bg-black border border-cyber-border rounded px-1"></label>
        </div>
      </div>`;
    }).join('');
    renderTotals();
  }

  function fillGlobals() {
    const p = st.plan;
    $('edSubOn').checked = p.subtitles.enabled !== false;
    $('edSubSize').value = p.subtitles.size || 46; $('edSubSizeV').textContent = $('edSubSize').value;
    $('edSubPos').value = p.subtitles.position || 'bottom';
    $('edNorm').checked = p.audio.normalize !== false;
    $('edMusicVol').value = p.audio.music_volume == null ? 0.12 : p.audio.music_volume; $('edMusicVolV').textContent = Math.round($('edMusicVol').value * 100) + '%';
    $('edMusicName').textContent = p.audio.music_url ? (p.audio.music_name || 'música cargada') : 'sin música';
    $('edMusicDel').classList.toggle('hidden', !p.audio.music_url);
    $('edMusic').src = p.audio.music_url || '';
    $('edTitleOn').checked = !!p.title_card.enabled; $('edTitleText').value = p.title_card.text || ''; $('edTitleSub').value = p.title_card.subtext || ''; $('edTitleSecs').value = p.title_card.seconds || 2;
    $('edEndOn').checked = !!p.end_card.enabled; $('edEndText').value = p.end_card.text || ''; $('edEndSub').value = p.end_card.subtext || ''; $('edEndSecs').value = p.end_card.seconds || 2;
  }

  // ---- Vista previa ----
  function showOverlay(item, tInClip) {
    const sub = $('edSub'); const top = $('edTop');
    const size = Number(st.plan.subtitles.size) || 46;
    sub.style.fontSize = (size * K) + 'px';
    sub.style.bottom = ((st.plan.subtitles.position === 'middle' ? 560 : 300) * K) + 'px';
    const showSub = item.subtitle && tInClip >= SUB_WINDOW[0] && tInClip <= SUB_WINDOW[1];
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
    st.dirty = false;
    $('edTitle').textContent = 'Editor · EP ' + st.ep.episode_number + (st.ep.title ? ' — ' + st.ep.title : '');
    const clips = (st.ep.assets || []).filter((a) => a.kind === 'video_clip').length;
    $('edStatus').textContent = clips + ' de ' + (st.ep.shots || []).length + ' tomas con video.' + (out.saved ? ' Plan guardado cargado.' : ' Plan nuevo (aún sin guardar).');
    fillGlobals(); renderClips();
    $('edModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    st.idx = 0; st.seq = buildSeq(); stop();
    if (st.seq[0]) { st.playing = false; playItem(0); }
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
    st.plan = out.plan; st.dirty = false;
    if (!silent) $('edStatus').textContent = 'Guardado ✓';
    return true;
  }
  async function reset() {
    if (!(await window.askConfirm('¿Restablecer el editor? Se borran recortes, orden, textos y música de este episodio (los videos no se tocan).'))) return;
    const res = await fetch('/.netlify/functions/edit-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episode_id: st.ep.id, reset: true }) });
    const out = await res.json();
    st.plan = out.plan; st.dirty = false; fillGlobals(); renderClips(); $('edStatus').textContent = 'Restablecido.';
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
      if (key === 'trim_start' || key === 'trim_end') c[key] = Math.min(3, Math.max(0, Number(val) || 0));
      else if (key === 'volume') c[key] = Math.min(2, Math.max(0, Number(val) || 0));
      else c[key] = val;
      markDirty();
      if (key === 'include') renderClips();
    },
    move: (i, d) => { const a = st.plan.clips; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; markDirty(); renderClips(); },
    removeMusic: () => { st.plan.audio.music_url = null; st.plan.audio.music_name = ''; fillGlobals(); markDirty(); }
  };
})();
