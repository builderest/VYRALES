/* =====================================================================
   VYRALES · panel.js  (rediseño "Estudio futurista", fase 2)
   Pinta la pantalla de INICIO nueva (título de la novela, aviso de
   "lo que sigue", tabla de episodios, trabajo en curso, redes, fila
   de la PC) con los MISMOS datos que ya carga loadDashboard().
   No llama a ninguna API ni cambia datos: solo muestra y navega.
   dashboard.html llama a vyPanel.render(data) al final de cada carga.
   ===================================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var NETS = [['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['instagram', 'Instagram'], ['facebook', 'Facebook']];

  // Estados del episodio en palabras simples + color (clases ya existentes del tema)
  var ESTADO = {
    guion_pendiente: ['Guion pendiente', 'muted'],
    guion_generado:  ['Listo para producir', 'a'],
    guion_rechazado: ['Guion rechazado', 'pink'],
    generando_media: ['Creando video', 'a', true],
    en_revision:     ['Por revisar', 'gold'],
    publicado:       ['Publicado', 'ok'],
    archivado:       ['Archivado', 'muted']
  };

  // Qué está haciendo la PC, en palabras simples (según el comando del agente)
  function trabajo(cmd) {
    cmd = String(cmd || '');
    var head = cmd.split(':')[0];
    var map = {
      flow_frames: 'Haciendo imágenes (Google Flow)', flow_cuadros: 'Haciendo imágenes (Google Flow)',
      gen_local: 'Creando el video', regen_local: 'Rehaciendo una toma', toma_local: 'Rehaciendo una toma',
      voz_continua: 'Grabando la voz del narrador', render_full: 'Armando el video en calidad completa',
      claude_revisar: 'Claude revisando el guion', claude_detalle: 'Claude mejorando detalles', claude_pulir: 'Claude puliendo el guion',
      qa_tomas: 'Revisión automática de tomas', yt_relacionado: 'Configurando YouTube'
    };
    if (map[head]) return map[head];
    if (/^claude/.test(head)) return 'Claude trabajando';
    if (/publi|social|yt_|tiktok|insta|face/.test(head)) return 'Publicando en redes';
    return head.replace(/_/g, ' ') || 'Trabajo en la PC';
  }

  function epDeComando(cmd, eps) {
    cmd = String(cmd || '');
    for (var i = 0; i < eps.length; i++) if (eps[i].id && cmd.indexOf(eps[i].id) >= 0) return eps[i];
    return null;
  }

  // Tarea que la PC esta haciendo AHORA (dinamica, sea cual sea): nombre + toma + episodio.
  function tareaActual(jobs, eps) {
    var r = null;
    for (var i = 0; i < jobs.length; i++) { if (jobs[i].status === 'running') { r = jobs[i]; break; } }
    if (!r) return null;
    var txt = trabajo(r.command);
    var ep = epDeComando(r.command, eps);
    var toma = '';
    var qw = ep && ep.validator_report && ep.validator_report.qa_working;
    if (qw && qw.n) toma = String(qw.n);
    else { var m = String(r.command).match(/:(\d+)(?::\d+)?$/); if (m) toma = m[1]; }
    if (toma) { txt = /una toma/i.test(txt) ? txt.replace(/una toma/i, 'toma ' + toma) : (txt + ' \u00b7 toma ' + toma); }
    if (ep) txt += ' \u00b7 Ep. ' + ep.episode_number;
    return txt;
  }

  function aspectoDe(e, serie) {
    var c = e.continuity || {};
    var sb = (serie && serie.story_bible) || {};
    return c.aspect || sb.aspect || '9:16';
  }

  // 5 pasos con datos reales: Guion · Imágenes · Video · Video final · Publicado
  // Cada paso: 2 = hecho, 1 = a medias, 0 = falta
  function pasos(e) {
    var shots = (e.shots || []).length;
    var a = e.assets || [];
    var count = function (k) { return a.filter(function (x) { return x.kind === k; }).length; };
    var imgs = count('keyframe') + count('image');
    var clips = count('video_clip');
    var finalR = count('final_render') > 0;
    var pub = e.status === 'publicado' || Object.keys(((e.validator_report || {}).published) || {}).some(function (k) { return ((e.validator_report || {}).published || {})[k]; });
    var guion = shots > 0 || !!e.script;
    var lvl = function (n) { return !shots ? (n ? 2 : 0) : (n >= shots ? 2 : (n > 0 ? 1 : 0)); };
    var vid = finalR ? 2 : lvl(clips);
    var img = (vid === 2 || finalR) ? 2 : lvl(imgs);
    return [guion ? 2 : 0, img, vid, finalR ? 2 : 0, pub ? 2 : 0];
  }

  function pill(estado) {
    var s = ESTADO[estado] || [estado || '—', 'muted'];
    return '<span class="vy-pill vy-pill-' + s[1] + '">' + (s[2] ? '<span class="vy-live" aria-hidden="true"></span>' : '') + esc(s[0]) + '</span>';
  }

  // ---------- Navegación ----------
  function abrirEpisodio(id) {
    // Si hay un filtro puesto en Guiones, se quita para que el episodio se vea
    if (typeof arcFiltro !== 'undefined' && (arcFiltro !== 'todos' || (($('vyArcSearch') || {}).value))) {
      arcFiltro = 'todos'; if ($('vyArcSearch')) $('vyArcSearch').value = ''; pintarChips(); filtrarArco();
    }
    var d = document.querySelector('details[data-ep-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else setView('guiones');
  }
  // Desde "Trabajando ahora" / "Fila de tu PC": abre el episodio de ese trabajo en Revisar y publicar.
  function irATrabajo(id) {
    if (!id) return;
    setView('revisar');
    irARevisar(id);
  }
  function irARevisar(id) {
    // Con id: ese episodio (también uno viejo o ya publicado) pasa a la pantalla de revisar/publicar.
    if (id && window.vyReviewEp) window.vyReviewEp(id);
    var box = $('shotCardsDetails');
    if (box && !box.classList.contains('hidden')) box.open = true;
    var t = $('vyRevisar'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- Páginas (cada opción del menú muestra solo su pantalla) ----------
  var VIEWS = {
    inicio: 'Inicio', produccion: 'Producción', revisar: 'Revisar y publicar', guiones: 'Guiones',
    videos: 'Videos', personajes: 'Personajes', lugares: 'Lugares', reglas: 'Reglas de la novela', gastos: 'Gastos', analitica: 'Analítica', api: 'API', usuarios: 'Usuarios', creditos: 'Créditos'
  };
  var current = 'inicio';

  function setView(v, keepScroll) {
    if (!VIEWS[v]) v = 'inicio';
    current = v;
    var main = document.querySelector('main.vy-content');
    if (!main) return;
    main.setAttribute('data-view', v);
    Array.prototype.forEach.call(main.querySelectorAll('[data-vy-view]'), function (el) {
      var on = (' ' + el.getAttribute('data-vy-view') + ' ').indexOf(' ' + v + ' ') >= 0;
      if (on) el.removeAttribute('data-vy-off'); else el.setAttribute('data-vy-off', '');
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-vy-go]'), function (a) {
      if (a.classList.contains('vy-nav') || a.classList.contains('vy-tab')) a.classList.toggle('act', a.getAttribute('data-vy-go') === v);
    });
    var t = $('vyPageTitle'); if (t) t.textContent = VIEWS[v];
    document.title = VIEWS[v] + ' · VYRALES';
    try { history.replaceState(null, '', location.pathname + location.search + '#' + v); } catch (_) {}
    if (!keepScroll) window.scrollTo({ top: 0, behavior: 'auto' });
    if (v === 'videos' && window.vyVideosCargar) window.vyVideosCargar();
    if (v === 'analitica') {
      var fr = $('vyAnaliticaFrame');
      // Se recarga al entrar: así siempre muestra el canal ACTIVO (cookie vyrales_ws), nunca uno anterior.
      if (fr) fr.src = '/analitica.html?embed=1&t=' + Date.now();
    }
    if (v === 'api') apiCargar();
    if (v === 'usuarios') usersCargar();
    if (v === 'creditos') credCargar();
  }

  // ¿En qué página vive este elemento? (los botones viejos del panel saltan a secciones con scrollIntoView)
  function viewOf(el) {
    if (!el || !el.closest) return null;
    if (el.closest('#vyReglas')) return 'reglas';
    if (el.closest('#vyGuiones')) return 'guiones';
    var box = el.closest('[data-vy-view]');
    return box ? box.getAttribute('data-vy-view').split(' ')[0] : null;
  }
  // Solo cambia de página si el salto viene de algo que TÚ pulsaste hace un momento.
  // Los saltos automáticos (refrescos del panel) no te sacan de la página donde estás.
  var lastUser = 0;
  ['pointerdown', 'keydown'].forEach(function (t) { document.addEventListener(t, function () { lastUser = Date.now(); }, true); });
  var nativeScroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    var v = viewOf(this);
    if (v && v !== current) {
      if (Date.now() - lastUser > 1500) return; // automático y en otra página: no hacer nada
      setView(v, true);
    }
    return nativeScroll.apply(this, arguments);
  };

  // ---------- Celular/tablet: menú tipo cajón (botón ☰) ----------
  function menu(open) {
    var h = document.documentElement, btn = $('vyMenuBtn');
    if (open == null) open = !h.classList.contains('vy-menu-open');
    h.classList.toggle('vy-menu-open', open);
    if (btn) { btn.setAttribute('aria-expanded', open ? 'true' : 'false'); btn.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú'); }
    if (open) { var act = document.querySelector('#vySide .vy-nav.act') || document.querySelector('#vySide .vy-nav'); if (act) act.focus({ preventScroll: true }); }
    else if (btn && document.activeElement && $('vySide') && $('vySide').contains(document.activeElement)) btn.focus({ preventScroll: true });
  }
  function initMenu() {
    var btn = $('vyMenuBtn'), scrim = $('vyScrim'), side = $('vySide');
    if (btn) btn.addEventListener('click', function () { menu(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-vy-menu]'), function (b) { b.addEventListener('click', function () { menu(); }); });
    if (scrim) scrim.addEventListener('click', function () { menu(false); });
    // Al elegir cualquier opción del menú, se cierra (también los botones que abren ventanas)
    if (side) side.addEventListener('click', function (ev) { if (ev.target.closest('.vy-nav, .vy-brand')) menu(false); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && document.documentElement.classList.contains('vy-menu-open')) menu(false); });
    // Celular tipo app: iPhone ignora "user-scalable=no", así que también bloqueamos el pellizco aquí
    ['gesturestart', 'gesturechange'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false }); });
    document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
    // Si giran el teléfono o agrandan la ventana a escritorio, el cajón no se queda abierto
    var mq = window.matchMedia('(min-width: 1024px)');
    var off = function () { if (mq.matches) menu(false); };
    if (mq.addEventListener) mq.addEventListener('change', off); else if (mq.addListener) mq.addListener(off);
  }

  function initViews() {
    initMenu();
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest && ev.target.closest('[data-vy-go]');
      if (!a) return;
      ev.preventDefault();
      setView(a.getAttribute('data-vy-go'));
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var a = ev.target.closest && ev.target.closest('[data-vy-go][role="link"]');
      if (!a) return;
      ev.preventDefault();
      setView(a.getAttribute('data-vy-go'));
    });
    window.addEventListener('hashchange', function () {
      var v = (location.hash || '').replace('#', '');
      if (VIEWS[v] && v !== current) setView(v);
    });
    setView((location.hash || '').replace('#', ''), true);
    meCargar();
  }

  // ---------- Guiones: filtros ----------
  var arcEps = {}, arcFiltro = 'todos';
  var FILTROS = [
    ['todos', 'Todos', function () { return true; }],
    ['producir', 'Por producir', function (e) { return e.status === 'guion_generado' || e.status === 'guion_pendiente'; }],
    ['curso', 'En producción', function (e) { return e.status === 'generando_media'; }],
    ['revisar', 'Por revisar', function (e) { return e.status === 'en_revision'; }],
    ['publicados', 'Publicados', function (e) { return e.status === 'publicado'; }]
  ];
  function pintarChips() {
    var box = $('vyArcChips'); if (!box) return;
    var all = Object.keys(arcEps).map(function (k) { return arcEps[k]; }).filter(function (e) { return e.status !== 'archivado'; });
    box.innerHTML = FILTROS.map(function (f) {
      var n = all.filter(f[2]).length;
      return '<button type="button" class="vy-chip' + (arcFiltro === f[0] ? ' on' : '') + '" aria-pressed="' + (arcFiltro === f[0]) + '" onclick="vyPanel.filtro(\'' + f[0] + '\')">' +
        esc(f[1]) + ' <span class="vy-chip-n">' + n + '</span></button>';
    }).join('');
  }
  function filtrarArco() {
    var list = $('arcList'); if (!list) return;
    var q = (($('vyArcSearch') || {}).value || '').trim().toLowerCase();
    var f = (FILTROS.find(function (x) { return x[0] === arcFiltro; }) || FILTROS[0])[2];
    var shown = 0;
    Array.prototype.forEach.call(list.children, function (item) {
      var ids = [];
      if (item.matches && item.matches('details[data-ep-id]')) ids.push(item.getAttribute('data-ep-id'));
      Array.prototype.forEach.call(item.querySelectorAll('details[data-ep-id]'), function (d) { ids.push(d.getAttribute('data-ep-id')); });
      var eps = ids.map(function (id) { return arcEps[id]; }).filter(Boolean);
      if (!eps.length) { item.style.display = ''; return; }
      var ok = eps.some(function (e) {
        if (!f(e)) return false;
        if (!q) return true;
        var t = ('ep ' + e.episode_number + ' ' + String(e.episode_number).padStart(2, '0') + ' ' + (e.title || '')).toLowerCase();
        return t.indexOf(q) >= 0;
      });
      item.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    // oct-16: antes, con el canal SIN episodios (list.children.length === 0), el mensaje de vacío se
    // escondía en vez de mostrarse (!list.children.length volvía 'hidden' a true) — la pantalla quedaba
    // en blanco sin avisar nada. Ahora se muestra siempre que no haya nada visible, con un texto distinto
    // si de verdad no hay episodios todavía (vs. que el filtro/búsqueda no encontró nada).
    var em = $('vyArcEmpty');
    if (em) {
      em.classList.toggle('hidden', shown > 0);
      if (shown === 0) em.textContent = list.children.length ? 'Ningún episodio coincide con el filtro.' : 'Todavía no hay guiones en este canal. Dale a "Producir siguiente" para generar el primero.';
    }
  }
  function setFiltro(k) { arcFiltro = k; pintarChips(); filtrarArco(); }

  // ---------- Cuenta → API (claves de los servicios) ----------
  var apiData = null, apiMsg = {};
  function apiHeaders() {
    var h = { 'Content-Type': 'application/json' };
    try { var k = localStorage.getItem('vyrales_key'); if (k) h['x-vyrales-key'] = k; } catch (_) {}
    return h;
  }
  function apiCall(method, body) {
    return fetch('/.netlify/functions/api-keys', { method: method, headers: apiHeaders(), credentials: 'same-origin', cache: 'no-store', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok && !j.services) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); });
  }
  var SRC = { panel: ['Desde el panel', 'a'], servidor: ['Desde el servidor (.env)', 'muted'], prestada: ['Prestada por el administrador', 'a'], sin_creditos: ['Prestada · sin créditos', 'gold'], falta: ['Falta', 'gold'] };
  function apiEstado(s) {
    var n = s.fields.length, ok = s.fields.filter(function (f) { return f.source === 'panel' || f.source === 'servidor' || f.source === 'prestada'; }).length;
    if (s.id === 'sitio' || s.id === 'fal') return ok ? ['Configurado', 'ok'] : ['Opcional', 'muted'];
    if (ok === n) return ['Conectada', 'ok'];
    if (s.id === 'meta' && s.fields.slice(0, 2).every(function (f) { return f.source !== 'falta'; })) return ['Conectada', 'ok'];
    if (s.id === 'youtube' && s.fields.slice(0, 2).every(function (f) { return f.source !== 'falta'; })) return ['Conectada', 'ok'];
    return ok ? ['Incompleta', 'gold'] : ['Sin configurar', 'pink'];
  }
  function apiRender() {
    var box = $('vyApiBody'); if (!box || !apiData) return;
    // Lo que estabas escribiendo en otras tarjetas no se pierde al redibujar
    var typed = {};
    Array.prototype.forEach.call(box.querySelectorAll('.vy-api-card input[name]'), function (i) { if (i.value) typed[i.name] = i.value; });
    var d = apiData, h = '';
    if (d.error) h += '<div class="vy-api-alert vy-api-alert-pink"><i class="fa-solid fa-triangle-exclamation"></i><span>' + esc(d.error) + '</span></div>';
    if (d.setup_needed) {
      h += '<div class="glass-panel rounded-2xl p-6 flex flex-col gap-3 vy-api-setup">' +
        '<strong class="text-white text-lg"><i class="fa-solid fa-database mr-2 text-cyber-gold"></i>Falta un paso (una sola vez)</strong>' +
        '<p class="text-sm text-slate-300">Para guardar claves desde aquí hay que crear la tabla segura en Supabase: abre <b>Supabase → SQL Editor</b>, pega esto y dale <b>Run</b>. Mientras tanto ves el estado de las claves del <code>.env</code>.</p>' +
        '<pre class="vy-api-sql">' + esc(d.setup_sql || '') + '</pre>' +
        '<button type="button" class="vy-ghost self-start min-h-[40px] px-4 rounded-lg border border-cyber-border bg-cyber-darker/80 text-sm text-white" onclick="copyTag(this, event)" data-tag="' + esc(d.setup_sql || '') + '"><i class="fa-regular fa-copy mr-1"></i>Copiar SQL</button>' +
      '</div>';
    }
    h += '<div class="grid grid-cols-1 xl:grid-cols-2 gap-5">' + d.services.map(function (s) {
      var st = apiEstado(s), m = apiMsg[s.id];
      return '<form class="glass-panel rounded-2xl p-6 flex flex-col gap-4 vy-api-card" data-svc="' + esc(s.id) + '" onsubmit="event.preventDefault(); vyPanel.apiGuardar(\'' + esc(s.id) + '\')" autocomplete="off">' +
        '<div class="flex items-start gap-4">' +
          '<div class="vy-api-ic"><i class="' + esc(s.icon) + '"></i></div>' +
          '<div class="flex-1 min-w-0"><h3 class="vy-novela text-xl font-bold text-white">' + esc(s.name) + '</h3><p class="text-xs font-mono text-slate-400 uppercase tracking-wider">' + esc(s.sub) + '</p></div>' +
          '<span class="vy-pill vy-pill-' + st[1] + '">' + esc(st[0]) + '</span>' +
        '</div>' +
        '<p class="text-sm text-slate-300">' + esc(s.desc) + (s.url ? ' <a href="' + esc(s.url) + '" target="_blank" rel="noopener" class="font-semibold">Conseguir la clave <i class="fa-solid fa-arrow-up-right-from-square text-[11px]"></i></a>' : '') + '</p>' +
        s.fields.map(function (f) {
          var src = SRC[f.source] || SRC.falta;
          var id = 'vyk_' + f.name;
          return '<div class="flex flex-col gap-1.5">' +
            '<div class="flex flex-wrap items-center justify-between gap-2"><label for="' + id + '" class="text-sm font-semibold text-white">' + esc(f.label) + '</label>' +
              '<span class="vy-src vy-src-' + src[1] + '">' + esc(src[0]) + (f.source === 'panel' && f.server_too ? ' · reemplaza al .env' : '') + '</span></div>' +
            '<div class="flex gap-2">' +
              '<input id="' + id + '" name="' + esc(f.name) + '" class="vy-input" type="' + (f.secret ? 'password' : 'text') + '" spellcheck="false" autocomplete="off" placeholder="' + esc(f.hint ? 'Actual: ' + f.hint + ' — escribe para cambiarla' : 'Pega aquí ' + f.label.toLowerCase()) + '"' + (d.setup_needed ? ' disabled' : '') + '>' +
              (f.source === 'panel' ? '<button type="button" class="vy-api-x" title="Quitar del panel (vuelve a usarse la del .env)" aria-label="Quitar ' + esc(f.label) + ' del panel" onclick="vyPanel.apiQuitar(\'' + esc(f.name) + '\', \'' + esc(s.id) + '\')"><i class="fa-solid fa-xmark"></i></button>' : '') +
            '</div></div>';
        }).join('') +
        (m ? '<div class="vy-api-alert vy-api-alert-' + (m.ok === true ? 'ok' : m.ok === false ? 'pink' : 'muted') + '" role="status"><i class="fa-solid ' + (m.ok === true ? 'fa-circle-check' : m.ok === false ? 'fa-circle-xmark' : (m.busy ? 'fa-spinner fa-spin' : 'fa-circle-info')) + '"></i><span>' + esc(m.msg) + '</span></div>' : '') +
        '<div class="flex flex-wrap gap-2 pt-1">' +
          '<button type="submit" class="vy-cta min-h-[42px] px-5 rounded-lg bg-gradient-to-r from-cyber-cyan to-cyber-violet text-white text-sm font-bold"' + (d.setup_needed ? ' disabled' : '') + '><i class="fa-solid fa-lock mr-1.5"></i>Guardar</button>' +
          (s.test ? '<button type="button" class="vy-ghost min-h-[42px] px-4 rounded-lg border border-cyber-border bg-cyber-darker/80 text-sm text-white" onclick="vyPanel.apiProbar(\'' + esc(s.id) + '\')"><i class="fa-solid fa-plug-circle-check mr-1.5"></i>Probar conexión</button>' : '') +
        '</div>' +
      '</form>';
    }).join('') + '</div>';
    if (d.is_admin === false) {
      h += '<div class="glass-panel rounded-2xl p-6 flex flex-col gap-2"><h3 class="vy-novela text-xl font-bold text-white"><i class="fa-solid fa-circle-info mr-2 text-cyber-cyan"></i>Cómo funciona</h3>' +
        '<p class="text-sm text-slate-300">Si pones <b class="text-white">tu propia clave</b>, lo que hagas con ese servicio lo pagas directo a ese servicio y no gasta créditos. Si un servicio dice <b class="text-white">"Prestada por el administrador"</b>, se usa la suya y se descuenta de tus créditos (página Créditos). Claude de la PC del administrador no se presta.</p></div>';
      box.innerHTML = h;
      Object.keys(typed).forEach(function (n) { var i = box.querySelector('input[name="' + n + '"]'); if (i) i.value = typed[n]; });
      return;
    }
    h += '<div class="grid grid-cols-1 xl:grid-cols-2 gap-5">' +
      '<div class="glass-panel rounded-2xl p-6 flex flex-col gap-3"><h3 class="vy-novela text-xl font-bold text-white"><i class="fa-solid fa-shield-halved mr-2 text-cyber-cyan"></i>Solo en el servidor</h3>' +
        '<p class="text-sm text-slate-400">Por seguridad estas no se cambian desde la web: van en Netlify (Site configuration → Environment variables) y en el <code>.env</code> de tu PC.</p>' +
        d.server.map(function (x) { return '<div class="vy-net"><span>' + esc(x.label) + '</span>' + (x.set ? '<span class="font-mono text-[11px] text-cyber-emerald vy-glow-ok">● CONFIGURADA</span>' : '<span class="font-mono text-[11px] text-cyber-gold">● FALTA</span>') + '</div>'; }).join('') +
      '</div>' +
      '<div class="glass-panel rounded-2xl p-6 flex flex-col gap-3"><h3 class="vy-novela text-xl font-bold text-white"><i class="fa-solid fa-robot mr-2 text-cyber-violet"></i>Claude</h3>' +
        '<p class="text-sm text-slate-300">Claude escribe y revisa los guiones <strong class="text-white">con tu plan</strong>, desde el agente de tu PC. No necesita clave de API: el agente quita <code>ANTHROPIC_API_KEY</code> a propósito para no cobrarte aparte.</p>' +
        '<button type="button" class="vy-link self-start" onclick="vyPanel.setView(\'inicio\')">Ver el estado de tu PC en Inicio →</button>' +
      '</div></div>';
    box.innerHTML = h;
    Object.keys(typed).forEach(function (n) { var i = box.querySelector('input[name="' + n + '"]'); if (i) i.value = typed[n]; });
  }
  function apiCargar() {
    var box = $('vyApiBody');
    apiCall('GET').then(function (j) { apiData = j; apiRender(); })
      .catch(function (e) { if (box) box.innerHTML = '<div class="vy-api-alert vy-api-alert-pink"><i class="fa-solid fa-triangle-exclamation"></i><span>No se pudo cargar (' + esc(e.message) + '). Si dice "llave", vuelve a iniciar sesión.</span></div>'; });
  }
  function apiGuardar(id) {
    var form = document.querySelector('.vy-api-card[data-svc="' + id + '"]'); if (!form) return;
    var values = {}, n = 0;
    Array.prototype.forEach.call(form.querySelectorAll('input[name]'), function (i) { if (i.value.trim()) { values[i.name] = i.value; n++; } });
    if (!n) { apiMsg[id] = { ok: false, msg: 'Escribe al menos una clave para guardar.' }; apiRender(); return; }
    apiMsg[id] = { ok: null, busy: true, msg: 'Guardando cifrado…' }; apiRender();
    apiCall('POST', { action: 'save', values: values }).then(function (j) {
      Array.prototype.forEach.call(form.querySelectorAll('input[name]'), function (i) { i.value = ''; });
      apiData = j; apiMsg[id] = { ok: true, msg: 'Guardado cifrado. Se aplica en menos de 1 minuto.' + (SERVICES_TEST[id] ? ' Pulsa «Probar conexión» para confirmar.' : '') }; apiRender();
    }).catch(function (e) { apiMsg[id] = { ok: false, msg: e.message }; apiRender(); });
  }
  var SERVICES_TEST = { google: 1, tiktok: 1, meta: 1, youtube: 1 };
  function apiQuitar(name, id) {
    var go = function () {
      apiMsg[id] = { ok: null, busy: true, msg: 'Quitando…' }; apiRender();
      apiCall('POST', { action: 'remove', name: name }).then(function (j) { apiData = j; apiMsg[id] = { ok: null, msg: 'Quitada del panel: ahora se usa la del .env (si hay).' }; apiRender(); })
        .catch(function (e) { apiMsg[id] = { ok: false, msg: e.message }; apiRender(); });
    };
    if (window.askConfirm) Promise.resolve(window.askConfirm('¿Quitar esta clave del panel? Se volverá a usar la del .env / Netlify, si existe.')).then(function (ok) { if (ok) go(); });
    else go();
  }
  function apiProbar(id) {
    apiMsg[id] = { ok: null, busy: true, msg: 'Probando conexión…' }; apiRender();
    apiCall('POST', { action: 'test', service: id }).then(function (j) { apiMsg[id] = { ok: j.ok, msg: j.msg || j.error || 'Sin respuesta' }; apiRender(); })
      .catch(function (e) { apiMsg[id] = { ok: false, msg: e.message }; apiRender(); });
  }

  // ---------- MULTIUSUARIO: quién soy, Usuarios (admin) y Créditos (usuarios) ----------
  var me = null;
  function fnCall(name, method, body) {
    return fetch('/.netlify/functions/' + name, { method: method || 'GET', headers: apiHeaders(), credentials: 'same-origin', cache: 'no-store', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; e.data = j; throw e; } return j; }); });
  }
  function meCargar() {
    return fnCall('me').then(function (j) {
      me = j; window.vyMe = j;
      var root = document.documentElement;
      root.classList.toggle('vy-admin', !!j.is_admin);
      root.classList.toggle('vy-user', !j.is_admin);
      var who = $('vyWhoAmI'); if (who) who.textContent = j.tenancy === false ? '' : (j.is_admin ? 'Administrador' : (j.name || ''));
      var b = $('vyCredBadge'); if (b && j.credits != null) b.textContent = Number(j.credits).toLocaleString('es');
      // Usuarios: la cajita de abajo del menú muestra SU cuenta (no el estado de la PC del admin)
      if (!j.is_admin && j.tenancy !== false) {
        var dot = $('vyAgentDot'), lab = $('vyAgentLabel'), sub = $('vyAgentSub');
        if (dot) dot.style.background = 'rgb(var(--vy-a))';
        if (lab) { lab.textContent = 'CRÉDITOS: ' + Number(j.credits || 0).toLocaleString('es'); lab.style.color = 'rgb(var(--vy-a))'; }
        if (sub) sub.textContent = 'PC del administrador: ' + (j.perms && j.perms.pc ? 'sí' : 'no');
      }
      // Si estás en una página que no es para tu cuenta, vuelve al inicio
      if ((current === 'usuarios' && !j.is_admin) || (current === 'creditos' && j.is_admin)) setView('inicio');
      return j;
    }).catch(function () { document.documentElement.classList.add('vy-admin'); });
  }
  var NOMBRE_SERV = { google: 'Google AI', fal: 'fal.ai', tiktok: 'TikTok', meta: 'Meta', youtube: 'YouTube' };
  var usersData = null, usersMsg = {};
  function precioEj(st, usd) { return Math.max(1, Math.ceil(usd * st.markup / st.credit_usd - 1e-9)); }
  function usersRender() {
    var box = $('vyUsersBody'); if (!box) return;
    var d = usersData;
    if (!d) return;
    if (d.setup_needed) {
      box.innerHTML = '<div class="glass-panel rounded-2xl p-6 vy-api-setup flex flex-col gap-3"><strong class="text-white text-lg"><i class="fa-solid fa-database mr-2 text-cyber-gold"></i>Falta un paso (una sola vez)</strong>' +
        '<p class="text-sm text-slate-300">Para tener usuarios hay que correr la migración <code>supabase/migrations/009_multiusuario.sql</code> en <b>Supabase → SQL Editor → Run</b>. Tus datos de hoy quedan en tu cuenta de administrador.</p></div>';
      return;
    }
    var st = d.settings, m = usersMsg;
    var h = '';
    // Precios
    h += '<form class="glass-panel rounded-2xl p-6 flex flex-col gap-4" onsubmit="event.preventDefault(); vyPanel.usersPrecios(this)">' +
      '<h3 class="vy-novela text-xl font-bold text-white"><i class="fa-solid fa-tags mr-2 text-cyber-cyan"></i>Precios de los créditos</h3>' +
      '<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">' +
        '<label class="flex flex-col gap-1.5 text-sm text-white font-semibold">Margen sobre tu costo (×)<input class="vy-input" name="markup" type="number" step="0.1" min="1" max="20" value="' + st.markup + '"></label>' +
        '<label class="flex flex-col gap-1.5 text-sm text-white font-semibold">Valor de 1 crédito ($)<input class="vy-input" name="credit_usd" type="number" step="0.001" min="0.001" max="1" value="' + st.credit_usd + '"></label>' +
        '<label class="flex flex-col gap-1.5 text-sm text-white font-semibold">Tu PC: créditos por trabajo<input class="vy-input" name="pc_job_credits" type="number" min="0" value="' + st.pc_job_credits + '"></label>' +
        '<label class="flex flex-col gap-1.5 text-sm text-white font-semibold">Tu PC: créditos por toma<input class="vy-input" name="pc_shot_credits" type="number" min="0" value="' + st.pc_shot_credits + '"></label>' +
      '</div>' +
      '<p class="text-sm text-slate-300">Ejemplo con estos valores: un video de Veo que a ti te cuesta <b>$0.24</b> le cuesta al usuario <b>0.24 × ' + st.markup + ' ÷ ' + st.credit_usd + ' = ' + precioEj(st, 0.24) + ' créditos</b> ($' + (precioEj(st, 0.24) * st.credit_usd).toFixed(2) + '). Una imagen de $0.067 = <b>' + precioEj(st, 0.067) + ' créditos</b>. Un episodio de 8 tomas en tu PC = <b>' + (8 * st.pc_shot_credits) + ' créditos</b>.</p>' +
      (m.precios ? '<div class="vy-api-alert vy-api-alert-' + (m.precios.ok ? 'ok' : 'pink') + '"><i class="fa-solid ' + (m.precios.ok ? 'fa-circle-check' : 'fa-circle-xmark') + '"></i><span>' + esc(m.precios.msg) + '</span></div>' : '') +
      '<button type="submit" class="vy-cta self-start min-h-[42px] px-5 rounded-lg bg-gradient-to-r from-cyber-cyan to-cyber-violet text-white text-sm font-bold">Guardar precios</button>' +
    '</form>';
    // Crear usuario
    h += '<form class="glass-panel rounded-2xl p-6 flex flex-col gap-4" autocomplete="off" onsubmit="event.preventDefault(); vyPanel.usersCrear(this)">' +
      '<h3 class="vy-novela text-xl font-bold text-white"><i class="fa-solid fa-user-plus mr-2 text-cyber-cyan"></i>Crear un usuario</h3>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">' +
        '<label class="flex flex-col gap-1.5 text-sm text-white font-semibold">Nombre<input class="vy-input" name="name" maxlength="80" placeholder="Ej. Juan Pérez"></label>' +
        '<label class="flex flex-col gap-1.5 text-sm text-white font-semibold">Email<input class="vy-input" name="email" type="email" required placeholder="juan@correo.com"></label>' +
        '<label class="flex flex-col gap-1.5 text-sm text-white font-semibold">Contraseña (mín. 8)<div class="flex gap-2"><input class="vy-input" name="password" type="text" minlength="8" required spellcheck="false"><button type="button" class="vy-ghost min-h-[44px] px-3 rounded-lg border border-cyber-border bg-cyber-darker/80 text-white" title="Generar una" aria-label="Generar contraseña" onclick="this.previousElementSibling.value = vyPanel.genPass()"><i class="fa-solid fa-dice"></i></button></div></label>' +
        '<label class="flex flex-col gap-1.5 text-sm text-white font-semibold">Créditos de regalo<input class="vy-input" name="credits" type="number" min="0" value="0"></label>' +
      '</div>' +
      '<fieldset class="flex flex-col gap-2"><legend class="text-sm text-white font-semibold mb-2">Lo que le prestas (puedes cambiarlo después)</legend><div class="flex flex-wrap gap-2">' +
        Object.keys(NOMBRE_SERV).map(function (k) { return '<label class="vy-toggle"><input type="checkbox" name="k_' + k + '"><span>' + NOMBRE_SERV[k] + '</span></label>'; }).join('') +
        '<label class="vy-toggle"><input type="checkbox" name="pc"><span><i class="fa-solid fa-desktop mr-1"></i>Tu PC</span></label>' +
      '</div></fieldset>' +
      (m.crear ? '<div class="vy-api-alert vy-api-alert-' + (m.crear.ok ? 'ok' : 'pink') + '"><i class="fa-solid ' + (m.crear.ok ? 'fa-circle-check' : 'fa-circle-xmark') + '"></i><span>' + esc(m.crear.msg) + '</span></div>' : '') +
      '<button type="submit" class="vy-cta self-start min-h-[42px] px-5 rounded-lg bg-gradient-to-r from-cyber-cyan to-cyber-violet text-white text-sm font-bold"><i class="fa-solid fa-user-plus mr-1.5"></i>Crear usuario</button>' +
    '</form>';
    // Cuentas
    h += '<div class="flex items-center justify-between"><h3 class="vy-novela text-2xl font-bold text-white">Cuentas (' + d.accounts.length + ')</h3></div>';
    h += d.accounts.length ? '<div class="grid grid-cols-1 xl:grid-cols-2 gap-5">' + d.accounts.map(function (a) {
      var u = a.users[0] || {}, mm = m[a.id];
      return '<div class="glass-panel rounded-2xl p-6 flex flex-col gap-4' + (a.active ? '' : ' vy-paused') + '" data-ws="' + esc(a.id) + '">' +
        '<div class="flex items-start gap-4"><div class="vy-api-ic"><i class="fa-solid fa-user"></i></div>' +
          '<div class="flex-1 min-w-0"><h4 class="vy-novela text-xl font-bold text-white truncate">' + esc(a.name) + '</h4><p class="text-xs font-mono text-slate-400 truncate">' + esc(u.email || '') + (u.last_login_at ? ' · entró ' + new Date(u.last_login_at).toLocaleDateString('es') : ' · nunca ha entrado') + '</p></div>' +
          '<span class="vy-pill vy-pill-' + (a.active ? 'ok' : 'muted') + '">' + (a.active ? 'Activa' : 'Pausada') + '</span></div>' +
        '<div class="grid grid-cols-3 gap-3">' +
          '<div class="vy-cs"><span class="vy-lab">Créditos</span><strong class="vy-num text-2xl text-cyber-cyan">' + a.credits.toLocaleString('es') + '</strong></div>' +
          '<div class="vy-cs"><span class="vy-lab">Novelas</span><strong class="vy-num text-2xl text-white">' + a.series + '</strong></div>' +
          '<div class="vy-cs"><span class="vy-lab">Costo del mes</span><strong class="vy-num text-2xl text-white">$' + a.month_usd.toFixed(2) + '</strong></div></div>' +
        '<div class="flex flex-col gap-2"><span class="text-sm text-white font-semibold">Le prestas:</span><div class="flex flex-wrap gap-2">' +
          Object.keys(NOMBRE_SERV).map(function (k) { return '<label class="vy-toggle"><input type="checkbox" ' + (a.perms.keys[k] ? 'checked' : '') + ' onchange="vyPanel.usersPermiso(\'' + a.id + '\')" data-k="' + k + '"><span>' + NOMBRE_SERV[k] + '</span></label>'; }).join('') +
          '<label class="vy-toggle"><input type="checkbox" ' + (a.perms.pc ? 'checked' : '') + ' onchange="vyPanel.usersPermiso(\'' + a.id + '\')" data-k="pc"><span><i class="fa-solid fa-desktop mr-1"></i>Tu PC</span></label>' +
        '</div></div>' +
        '<form class="flex flex-wrap gap-2" onsubmit="event.preventDefault(); vyPanel.usersCreditos(\'' + a.id + '\', this)">' +
          '<input class="vy-input" style="max-width:130px" name="delta" type="number" placeholder="+100 / −50" aria-label="Créditos a dar o quitar">' +
          '<input class="vy-input" name="note" maxlength="120" placeholder="Nota (ej. pagó $10 por Zelle)" aria-label="Nota">' +
          '<button type="submit" class="vy-ghost min-h-[44px] px-4 rounded-lg border border-cyber-border bg-cyber-darker/80 text-white text-sm font-semibold"><i class="fa-solid fa-coins mr-1.5 text-cyber-gold"></i>Dar / quitar</button>' +
        '</form>' +
        (mm ? '<div class="vy-api-alert vy-api-alert-' + (mm.ok ? 'ok' : 'pink') + '"><i class="fa-solid ' + (mm.ok ? 'fa-circle-check' : 'fa-circle-xmark') + '"></i><span>' + esc(mm.msg) + '</span></div>' : '') +
        '<div class="flex flex-wrap gap-2 pt-1 border-t border-cyber-border/60">' +
          '<button type="button" class="vy-link" onclick="vyPanel.usersActiva(\'' + a.id + '\', ' + (!a.active) + ')">' + (a.active ? '<i class="fa-solid fa-pause mr-1"></i>Pausar cuenta' : '<i class="fa-solid fa-play mr-1"></i>Reactivar') + '</button>' +
          (u.id ? '<button type="button" class="vy-link" onclick="vyPanel.usersClave(\'' + u.id + '\', \'' + a.id + '\')"><i class="fa-solid fa-key mr-1"></i>Nueva contraseña</button>' : '') +
          '<button type="button" class="vy-link text-cyber-pink" onclick="vyPanel.usersBorrar(\'' + a.id + '\')"><i class="fa-solid fa-trash mr-1"></i>Borrar</button>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>' : '<div class="glass-panel rounded-2xl p-8 text-center text-slate-400">Todavía no hay usuarios. Crea el primero arriba.</div>';
    box.innerHTML = h;
  }
  function usersCargar() {
    fnCall('users').then(function (j) { usersData = j; usersRender(); })
      .catch(function (e) { if (e.data && e.data.setup_needed) { usersData = { setup_needed: true }; usersRender(); } else { var b = $('vyUsersBody'); if (b) b.innerHTML = '<div class="vy-api-alert vy-api-alert-pink"><i class="fa-solid fa-triangle-exclamation"></i><span>' + esc(e.message) + '</span></div>'; } });
  }
  function usersPost(body, key, okMsg) {
    return fnCall('users', 'POST', body).then(function (j) { usersData = j; usersMsg = {}; usersMsg[key] = { ok: true, msg: okMsg }; usersRender(); return j; })
      .catch(function (e) { usersMsg = {}; usersMsg[key] = { ok: false, msg: e.message }; usersRender(); });
  }
  function genPass() {
    var c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '', a = new Uint32Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < a.length; i++) out += c[a[i] % c.length];
    return out;
  }
  function usersCrear(f) {
    var perms = { keys: {}, pc: f.elements['pc'].checked };
    Object.keys(NOMBRE_SERV).forEach(function (k) { perms.keys[k] = f.elements['k_' + k].checked; });
    var E = f.elements, email = E['email'].value.trim(), pass = E['password'].value;
    usersPost({ action: 'create', name: E['name'].value, email: email, password: pass, credits: Number(E['credits'].value) || 0, perms: perms }, 'crear',
      'Usuario creado. Pásale estos datos — Email: ' + email + ' · Contraseña: ' + pass + ' (no se vuelve a mostrar).');
  }
  function usersPermiso(ws) {
    var card = document.querySelector('[data-ws="' + ws + '"]'); if (!card) return;
    var perms = { keys: {}, pc: false };
    Array.prototype.forEach.call(card.querySelectorAll('input[data-k]'), function (i) { if (i.getAttribute('data-k') === 'pc') perms.pc = i.checked; else perms.keys[i.getAttribute('data-k')] = i.checked; });
    usersPost({ action: 'perms', workspace_id: ws, perms: perms }, ws, 'Permisos guardados.');
  }
  function usersCreditos(ws, f) {
    var d = Number(f.delta.value);
    if (!d) { usersMsg = {}; usersMsg[ws] = { ok: false, msg: 'Escribe cuántos créditos (ej. 100 o -50).' }; return usersRender(); }
    usersPost({ action: 'credits', workspace_id: ws, delta: d, note: f.note.value }, ws, (d > 0 ? 'Se le dieron ' : 'Se le quitaron ') + Math.abs(d) + ' créditos.');
  }
  function usersActiva(ws, active) { usersPost({ action: 'active', workspace_id: ws, active: active }, ws, active ? 'Cuenta reactivada.' : 'Cuenta pausada: ya no puede entrar ni usar nada.'); }
  function usersClave(uid, ws) {
    var p = genPass();
    var go = function () { usersPost({ action: 'password', user_id: uid, password: p }, ws, 'Nueva contraseña: ' + p + ' (pásasela; no se vuelve a mostrar).'); };
    if (window.askConfirm) Promise.resolve(window.askConfirm('¿Crear una contraseña nueva para este usuario? La anterior deja de servir.')).then(function (ok) { if (ok) go(); }); else go();
  }
  function usersBorrar(ws) {
    var go = function (txt) { if (txt === 'BORRAR') usersPost({ action: 'delete', workspace_id: ws, confirm: 'BORRAR' }, ws, 'Cuenta borrada.'); };
    if (window.askText) Promise.resolve(window.askText('Escribe BORRAR para borrar esta cuenta (solo se puede si no tiene novelas; si no, mejor páusala):', '')).then(go);
  }
  function usersPrecios(f) {
    usersPost({ action: 'settings', settings: { markup: f.markup.value, credit_usd: f.credit_usd.value, pc_job_credits: f.pc_job_credits.value, pc_shot_credits: f.pc_shot_credits.value } }, 'precios', 'Precios guardados. Se aplican a los próximos cobros.');
  }

  var MOV = { regalo_admin: 'Te dio el administrador', compra: 'Compra', uso_api: 'Uso de API prestada', uso_pc: 'Uso de la PC', ajuste: 'Ajuste del administrador' };
  function credRender() {
    var box = $('vyCredBody'); if (!box || !me) return;
    if (me.is_admin) { box.innerHTML = '<div class="glass-panel rounded-2xl p-6 text-slate-300">Eres el administrador: tú no gastas créditos. Los créditos de tus usuarios se manejan en <a href="#usuarios" data-vy-go="usuarios">Usuarios</a>.</div>'; return; }
    var pr = me.prices || { credit_usd: 0.01, markup: 2.5, pc_shot_credits: 10, pc_job_credits: 10 };
    var lent = Object.keys((me.perms && me.perms.keys) || {}).filter(function (k) { return me.perms.keys[k]; }).map(function (k) { return NOMBRE_SERV[k] || k; });
    var h = '<div class="grid grid-cols-1 lg:grid-cols-3 gap-5">' +
      '<div class="glass-panel rounded-2xl p-6 flex flex-col gap-2 lg:col-span-1"><span class="vy-lab">Tu saldo</span><strong class="vy-num text-5xl text-cyber-cyan">' + Number(me.credits || 0).toLocaleString('es') + '</strong>' +
        '<span class="text-sm text-slate-400">créditos · 1 crédito = $' + pr.credit_usd + ' · equivale a $' + (Number(me.credits || 0) * pr.credit_usd).toFixed(2) + '</span>' +
        '<p class="text-sm text-slate-300 mt-2">Para recargar, pídeselo al administrador.</p></div>' +
      '<div class="glass-panel rounded-2xl p-6 flex flex-col gap-3 lg:col-span-2"><h3 class="vy-novela text-xl font-bold text-white">Qué cuesta (aprox.)</h3>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">' +
          '<div class="vy-cs"><span class="vy-lab">Imagen (Gemini)</span><strong class="text-white">' + precioEj(pr, 0.067) + ' créditos</strong></div>' +
          '<div class="vy-cs"><span class="vy-lab">Toma de video (Veo)</span><strong class="text-white">' + precioEj(pr, 0.24) + ' créditos</strong></div>' +
          '<div class="vy-cs"><span class="vy-lab">Toma en la PC del admin</span><strong class="text-white">' + pr.pc_shot_credits + ' créditos</strong></div>' +
          '<div class="vy-cs"><span class="vy-lab">Otro trabajo en la PC</span><strong class="text-white">' + pr.pc_job_credits + ' créditos</strong></div>' +
        '</div>' +
        '<p class="text-xs text-slate-400">Se cobra lo que de verdad cuesta cada llamada; estos son ejemplos. Te prestan: <b class="text-slate-200">' + (lent.length ? esc(lent.join(', ')) : 'ninguna API') + '</b> · PC del administrador: <b class="text-slate-200">' + (me.perms && me.perms.pc ? 'sí' : 'no') + '</b>.</p></div>' +
    '</div>';
    h += '<section class="glass-panel rounded-2xl"><div class="px-6 pt-6 pb-3"><h3 class="vy-novela text-xl font-bold text-white">Historial</h3></div><div class="overflow-x-auto"><table class="w-full border-collapse min-w-[560px]"><thead><tr><th class="vy-th">Fecha</th><th class="vy-th">Movimiento</th><th class="vy-th">Detalle</th><th class="vy-th text-right">Créditos</th><th class="vy-th text-right">Saldo</th></tr></thead><tbody>' +
      ((me.ledger || []).length ? me.ledger.map(function (x) {
        return '<tr><td class="vy-td font-mono text-xs text-slate-400">' + new Date(x.created_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) + '</td><td class="vy-td">' + esc(MOV[x.reason] || x.reason) + '</td><td class="vy-td text-slate-400 text-sm">' + esc(x.detail || '') + '</td>' +
          '<td class="vy-td font-mono text-right ' + (x.delta > 0 ? 'text-cyber-emerald' : 'text-cyber-pink') + '">' + (x.delta > 0 ? '+' : '') + Number(x.delta).toLocaleString('es') + '</td><td class="vy-td font-mono text-right text-slate-300">' + (x.balance_after != null ? Number(x.balance_after).toLocaleString('es') : '') + '</td></tr>';
      }).join('') : '<tr><td class="vy-td text-slate-400" colspan="5">Todavía no hay movimientos.</td></tr>') +
      '</tbody></table></div></section>';
    box.innerHTML = h;
  }
  function credCargar() { meCargar().then(credRender); }

  // Cuenta sin novelas (o novela que no es tuya): Inicio con un primer paso claro, sin esqueletos de carga eternos.
  function sinNovela(nueva) {
    var next = $('vyNext');
    if (next) {
      next.className = 'glass-panel vy-next flow vy-next-a';
      next.innerHTML = '<div class="vy-next-ic"><i class="fa-solid fa-wand-magic-sparkles"></i></div>' +
        '<div class="vy-next-tx"><strong>' + (nueva ? 'Bienvenido: crea tu primera novela' : 'Elige una de tus novelas arriba') + '</strong>' +
        '<span>' + (nueva ? 'Pega el guion completo (JSON) o pídelo con una idea. Después la produces desde Producción.' : 'O crea una nueva.') + '</span></div>' +
        '<button type="button" class="vy-next-btn" onclick="openNovelModal()">Nueva novela <i class="fa-solid fa-arrow-right"></i></button>';
    }
    var rows = $('vyEpRows'); if (rows) rows.innerHTML = '<tr><td class="vy-td text-slate-400" colspan="5">Todavía no hay episodios.</td></tr>';
    var w = $('vyWork'); if (w) w.innerHTML = '<span class="vy-lab">Trabajando ahora</span><strong class="text-[15px] font-semibold text-slate-300">Nada en proceso</strong>';
    var q = $('vyQueue'); if (q) q.innerHTML = '<p class="text-sm text-slate-400">No hay trabajos pendientes.</p>';
    pintarRedes(); // oct-14: el canal puede tener redes conectadas aunque todavía no tenga series
  }

  // Redes conectadas (del canal activo)
  function pintarRedes() {
    var nets = $('vyNets');
    if (nets) {
      var acc = ((window.__social || {}).accounts) || {};
      nets.innerHTML = NETS.map(function (n) {
        var a = acc[n[0]];
        var ok = a && !a.old;
        return '<div class="vy-net"><span>' + n[1] + '</span>' +
          (ok ? '<span class="font-mono text-[11px] text-cyber-emerald vy-glow-ok">● CONECTADO</span>'
              : '<button type="button" class="vy-link text-cyber-pink" onclick="openSocialModal()">' + (a && a.old ? 'Reconectar' : 'Conectar') + '</button>') +
        '</div>';
      }).join('');
    }
  }

  // ---------- Pintar ----------
  function render(data) {
    if (me && !me.is_admin) meCargar();
    if (!data || !data.series) return;
    var serie = data.series;
    var eps = (data.episodes || []).filter(function (e) { return e.status !== 'archivado'; })
      .sort(function (a, b) { return (b.episode_number || 0) - (a.episode_number || 0); });
    var jobs = data.agent_jobs || [];

    // Título y etiqueta de la novela
    if ($('vyNovelTitle')) $('vyNovelTitle').textContent = serie.title || serie.slug || 'Novela';
    if ($('vyNovelTag')) {
      var gen = serie.genre ? String(serie.genre).split(/[,.]/)[0] : '';
      $('vyNovelTag').textContent = eps.length + ' episodio' + (eps.length === 1 ? '' : 's') + (gen ? ' · ' + gen : '');
    }

    // Tomas por revisar (todas las tomas sin aprobar de los episodios en revisión)
    var pendientes = 0, epRev = null;
    eps.slice().reverse().forEach(function (e) {
      if (e.status !== 'en_revision') return;
      var p = (e.assets || []).filter(function (a) { return a.kind === 'video_clip' && !a.approved; }).length;
      if (p && !epRev) epRev = { e: e, p: p };
      pendientes += p;
    });
    var badge = $('vyNavReview');
    if (badge) { badge.textContent = pendientes; badge.classList.toggle('hidden', !pendientes); }
    var tdot = $('vyTabReview');
    if (tdot) { tdot.textContent = pendientes > 99 ? '99+' : pendientes; tdot.classList.toggle('hidden', !pendientes); }

    // Aviso "lo que sigue"
    var next = $('vyNext');
    if (next) {
      var gen2 = eps.slice().reverse().find(function (e) { return e.status === 'generando_media'; });
      var listo = eps.slice().reverse().find(function (e) { return e.status === 'guion_generado'; });
      var html = '', tone = '';
      if (epRev) {
        tone = 'gold';
        html = '<div class="vy-next-ic"><i class="fa-regular fa-eye"></i></div>' +
          '<div class="vy-next-tx"><strong>El episodio ' + epRev.e.episode_number + ' te está esperando</strong>' +
          '<span>' + epRev.p + ' toma' + (epRev.p === 1 ? '' : 's') + ' necesita' + (epRev.p === 1 ? '' : 'n') + ' tu aprobación antes de publicar · ~2 min</span></div>' +
          '<button type="button" class="vy-next-btn" onclick="vyPanel.irARevisar(\'' + esc(epRev.e.id) + '\')">Revisar ahora <i class="fa-solid fa-arrow-right"></i></button>';
      } else if (gen2) {
        var sh = (gen2.shots || []).length, cl = (gen2.assets || []).filter(function (a) { return a.kind === 'video_clip'; }).length;
        tone = 'a';
        html = '<div class="vy-next-ic"><i class="fa-solid fa-spinner fa-spin"></i></div>' +
          '<div class="vy-next-tx"><strong>Creando el episodio ' + gen2.episode_number + '</strong>' +
          '<span>' + cl + ' de ' + (sh || '?') + ' tomas listas. El panel se actualiza solo.</span></div>' +
          '<button type="button" class="vy-next-btn" onclick="vyPanel.irARevisar(\'' + esc(gen2.id) + '\')">Ver progreso <i class="fa-solid fa-arrow-right"></i></button>';
      } else if (listo) {
        tone = 'a';
        html = '<div class="vy-next-ic"><i class="fa-solid fa-clapperboard"></i></div>' +
          '<div class="vy-next-tx"><strong>El episodio ' + listo.episode_number + ' está listo para producir</strong>' +
          '<span>' + esc(listo.title || 'El guion ya está escrito.') + '</span></div>' +
          '<button type="button" class="vy-next-btn" onclick="vyPanel.abrirEpisodio(\'' + esc(listo.id) + '\')">Abrir episodio <i class="fa-solid fa-arrow-right"></i></button>';
      } else if (!eps.length) {
        tone = 'a';
        html = '<div class="vy-next-ic"><i class="fa-solid fa-wand-magic-sparkles"></i></div>' +
          '<div class="vy-next-tx"><strong>Esta novela todavía no tiene episodios</strong><span>Crea o importa la novela completa para empezar.</span></div>' +
          '<button type="button" class="vy-next-btn" onclick="openNovelModal()">Nueva novela <i class="fa-solid fa-arrow-right"></i></button>';
      }
      next.className = html ? 'glass-panel vy-next flow vy-next-' + tone : 'hidden';
      next.innerHTML = html;
    }

    // Anillo del gasto (mismo dato que la tarjeta: gasto del mes / $150)
    var spend = Number((data.spend || {}).month_total) || 0;
    var pct = Math.min(100, spend / 150 * 100);
    var ring = $('vyBudgetRing');
    if (ring) ring.setAttribute('stroke-dasharray', (163.4 * pct / 100).toFixed(1) + ' 163.4');
    if ($('vyBudgetPct')) $('vyBudgetPct').textContent = Math.round(pct) + '%';

    // Tabla de episodios (los 6 más recientes)
    var rows = $('vyEpRows');
    if (rows) {
      var lista = eps.slice(0, 6);
      rows.innerHTML = lista.length ? lista.map(function (e) {
        var p = pasos(e);
        var segs = p.map(function (v) { return '<span class="vy-seg' + (v === 2 ? ' on' : v === 1 ? ' half' : '') + '"></span>'; }).join('');
        var shots = (e.shots || []).length;
        var clips = (e.assets || []).filter(function (a) { return a.kind === 'video_clip'; }).length;
        var accion = e.status === 'en_revision'
          ? '<button type="button" class="vy-link" onclick="vyPanel.irARevisar(\'' + esc(e.id) + '\')">Revisar</button>'
          : '<button type="button" class="vy-link" onclick="vyPanel.abrirEpisodio(\'' + esc(e.id) + '\')">Abrir</button>';
        var go = e.status === 'en_revision' ? 'vyPanel.irARevisar(\'' + esc(e.id) + '\')' : 'vyPanel.abrirEpisodio(\'' + esc(e.id) + '\')';
        return '<tr class="vy-row" onclick="if(!event.target.closest(\'button\'))' + go + '">' +
          '<td class="vy-td"><div class="flex flex-col gap-0.5"><strong class="font-semibold text-white">Ep. ' + esc(e.episode_number) + (e.title ? ' · ' + esc(e.title) : '') + '</strong>' +
            '<span class="font-mono text-[11px] text-slate-400">' + (aspectoDe(e, serie) === '16:9' ? 'LARGO · 16:9' : 'SHORT · 9:16') + '</span></div></td>' +
          '<td class="vy-td"><div class="flex gap-1" title="Guion · Imágenes · Video · Video final · Publicado">' + segs + '</div></td>' +
          '<td class="vy-td">' + pill(e.status) + '</td>' +
          '<td class="vy-td font-mono text-right text-slate-300">' + (shots ? clips + '/' + shots : '—') + '</td>' +
          '<td class="vy-td text-right">' + accion + '</td>' +
        '</tr>';
      }).join('') : '<tr><td class="vy-td text-slate-400" colspan="5">Todavía no hay episodios en esta novela.</td></tr>';
      if ($('vyEpCount')) $('vyEpCount').textContent = eps.length > 6 ? 'Mostrando 6 de ' + eps.length : '';
    }

    // ---------- GUIONES: filtros y búsqueda ----------
    arcEps = {};
    (data.episodes || []).forEach(function (e) { arcEps[e.id] = e; });
    pintarChips();
    filtrarArco();

    // ---------- PERSONAJES: resumen ----------
    var cs = $('vyCastStats');
    if (cs) {
      var chars = data.characters || [];
      var conFoto = chars.filter(function (c) { return c.reference_image_url; }).length;
      var roles = {};
      chars.forEach(function (c) { var r = c.role || 'otro'; roles[r] = (roles[r] || 0) + 1; });
      var rolTxt = { protagonista: 'protagonista', antagonista: 'antagonista', secundario: 'secundario' };
      cs.innerHTML = chars.length ?
        '<div class="vy-cs"><span class="vy-lab">Personajes</span><strong class="vy-num text-2xl text-white">' + chars.length + '</strong></div>' +
        '<div class="vy-cs vy-cs-wide"><span class="vy-lab">Con foto de cara</span><div class="flex items-center gap-3"><strong class="vy-num text-2xl ' + (conFoto === chars.length ? 'text-cyber-emerald' : 'text-cyber-gold') + '">' + conFoto + '/' + chars.length + '</strong>' +
          '<div class="vy-bar flex-1"><div class="vy-fill" style="width:' + Math.round(conFoto / chars.length * 100) + '%"></div></div></div></div>' +
        Object.keys(roles).map(function (r) {
          return '<div class="vy-cs"><span class="vy-lab">' + esc((rolTxt[r] || r) + (roles[r] === 1 ? '' : (/[aeiou]$/.test(rolTxt[r] || r) ? 's' : 'es'))) + '</span><strong class="vy-num text-2xl text-white">' + roles[r] + '</strong></div>';
        }).join('') : '';
    }

    // ---------- LUGARES: resumen y nombres legibles ----------
    var locs = (serie.story_bible || {}).locations || {};
    var vmL = (serie.visual_memory && serie.visual_memory.locations) || {};
    var lk = Object.keys(locs);
    var conImg = lk.filter(function (k) { return vmL[k] && vmL[k].url; }).length;
    if ($('vyLocEmpty')) $('vyLocEmpty').classList.toggle('hidden', lk.length > 0);
    var ls = $('vyLocStats');
    if (ls) ls.innerHTML = lk.length ?
      '<div class="vy-cs"><span class="vy-lab">Lugares</span><strong class="vy-num text-2xl text-white">' + lk.length + '</strong></div>' +
      '<div class="vy-cs vy-cs-wide"><span class="vy-lab">Con imagen fija</span><div class="flex items-center gap-3"><strong class="vy-num text-2xl ' + (conImg === lk.length ? 'text-cyber-emerald' : 'text-cyber-gold') + '">' + conImg + '/' + lk.length + '</strong>' +
        '<div class="vy-bar flex-1"><div class="vy-fill" style="width:' + Math.round(conImg / lk.length * 100) + '%"></div></div></div></div>' : '';
    // "casa_elena" -> "Casa elena" (solo lo que se ve; la clave interna no cambia)
    Array.prototype.forEach.call(document.querySelectorAll('#locationsGrid > div p.font-display'), function (pEl) {
      var t = pEl.firstChild;
      if (t && t.nodeType === 3 && /_/.test(t.nodeValue)) {
        var v = t.nodeValue.replace(/_/g, ' ').trim();
        t.nodeValue = v.charAt(0).toUpperCase() + v.slice(1) + ' ';
      }
    });

    // ---------- GASTOS ----------
    var kp = $('vyCostKpis');
    if (kp) {
      var sp = data.spend || {};
      var mes = Number(sp.month_total) || 0, nov = Number(sp.series_total) || 0, cobros = Number(sp.generations) || 0;
      var pctM = Math.min(100, mes / 150 * 100);
      var estado = pctM >= 90 ? ['Cerca del límite', 'pink'] : pctM >= 70 ? ['Ojo: más del 70 %', 'gold'] : ['Dentro del presupuesto', 'ok'];
      var conVideo = eps.filter(function (e) { return (e.assets || []).some(function (a) { return a.kind === 'video_clip'; }); }).length;
      var prom = conVideo ? nov / conVideo : 0;
      kp.innerHTML =
        '<div class="glass-panel rounded-xl p-5 flex items-center gap-4">' +
          '<svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="' + Math.round(pctM) + '% del límite mensual" class="flex-none vy-ring"><circle cx="32" cy="32" r="26" fill="none" stroke="#1b253e" stroke-width="6"/>' +
          '<circle cx="32" cy="32" r="26" fill="none" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + (163.4 * pctM / 100).toFixed(1) + ' 163.4" transform="rotate(-90 32 32)" style="stroke: rgb(var(--vy-' + (estado[1] === 'ok' ? 'a' : estado[1]) + '))"/>' +
          '<text x="32" y="36" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" fill="#e9eefb">' + Math.round(pctM) + '%</text></svg>' +
          '<div class="flex flex-col gap-1 min-w-0"><span class="vy-lab">Este mes (todas)</span><strong class="vy-num text-2xl text-white">$' + mes.toFixed(2) + '</strong><span class="vy-pill vy-pill-' + estado[1] + '" style="align-self:flex-start">' + estado[0] + '</span></div></div>' +
        '<div class="glass-panel rounded-xl p-5 flex flex-col gap-1.5"><span class="vy-lab">Esta novela (total)</span><strong class="vy-num text-2xl text-cyber-cyan">$' + nov.toFixed(2) + '</strong><span class="text-xs text-slate-400">' + esc(serie.title || '') + '</span></div>' +
        '<div class="glass-panel rounded-xl p-5 flex flex-col gap-1.5"><span class="vy-lab">Cobros (esta novela)</span><strong class="vy-num text-2xl text-white">' + cobros + '</strong><span class="text-xs text-slate-400">Videos, imágenes y voces pagados</span></div>' +
        '<div class="glass-panel rounded-xl p-5 flex flex-col gap-1.5"><span class="vy-lab">Promedio por episodio</span><strong class="vy-num text-2xl text-cyber-violet">' + (conVideo ? '$' + prom.toFixed(2) : '—') + '</strong><span class="text-xs text-slate-400">' + (conVideo ? 'Total de la novela ÷ ' + conVideo + ' episodio' + (conVideo === 1 ? '' : 's') + ' con video' : 'Todavía no hay episodios con video') + '</span></div>';
    }
    var cm = $('vyCostModels');
    if (cm) {
      var grupos = {};
      eps.forEach(function (e) {
        (e.assets || []).forEach(function (a) {
          if (a.kind !== 'video_clip') return;
          var c = Number(a.cost_usd) || 0;
          // Igual que las tarjetas de tomas: modelo veo_* con costo $0 = hecho con LTX en tu PC
          var k = (c === 0 && /^veo_/.test(a.model || '')) ? 'LTX en tu PC' : a.model === 'veo_fast' ? 'Veo Fast' : a.model === 'veo_lite' ? 'Veo Lite' : String(a.model || 'Otro');
          grupos[k] = grupos[k] || { n: 0, usd: 0 }; grupos[k].n++; grupos[k].usd += c;
        });
      });
      var ks = Object.keys(grupos).sort(function (x, y) { return grupos[y].usd - grupos[x].usd || grupos[y].n - grupos[x].n; });
      var maxN = Math.max.apply(null, ks.map(function (k) { return grupos[k].n; }).concat([1]));
      cm.innerHTML = ks.length ? ks.map(function (k) {
        var g = grupos[k];
        return '<div class="flex flex-col gap-1.5"><div class="flex justify-between gap-2 text-sm"><span class="text-white font-semibold">' + esc(k) + '</span>' +
          '<span class="font-mono text-slate-300">$' + g.usd.toFixed(2) + ' · ' + g.n + ' toma' + (g.n === 1 ? '' : 's') + '</span></div>' +
          '<div class="vy-bar"><div class="vy-fill" style="width:' + Math.max(3, Math.round(g.n / maxN * 100)) + '%"></div></div></div>';
      }).join('') + '<p class="text-[11px] text-slate-500">Solo videos de tomas de esta novela (sin imágenes ni voces).</p>'
        : '<p class="text-sm text-slate-400">Todavía no hay tomas con video en esta novela.</p>';
    }

    // ---------- REVISAR Y PUBLICAR ----------
    // Mismo episodio que elige loadDashboard() para el panel de revisión
    var asc = eps.slice().sort(function (a, b) { return (a.episode_number || 0) - (b.episode_number || 0); });
    // El episodio que elegiste en el selector de "Revisar y publicar" manda (si no, el encabezado mostraba otro).
    var pickId = window.__reviewEpId; try { if (!pickId && data.series) pickId = localStorage.getItem('vyrales_review_ep_' + data.series.slug); } catch (_) {}
    var rev = (pickId && asc.find(function (e) { return e.id === pickId; })) ||
              asc.find(function (e) { return e.status === 'en_revision'; }) ||
              asc.find(function (e) { return e.status === 'generando_media'; }) ||
              asc.find(function (e) { return (e.assets || []).some(function (a) { return a.kind === 'video_clip'; }); }) || null;
    var rt = $('vyRevTitle'), rs = $('vyRevSteps'), re = $('vyRevEmpty');
    if (re) re.classList.toggle('hidden', !!rev);
    if (rt) rt.textContent = rev ? 'Episodio ' + rev.episode_number + (rev.title ? ' · ' + rev.title : '') : 'Revisar y publicar';
    if (rs) {
      if (!rev) rs.innerHTML = '';
      else {
        var cl = (rev.assets || []).filter(function (a) { return a.kind === 'video_clip'; });
        var ok = cl.filter(function (a) { return a.approved; }).length;
        var vr = rev.validator_report || {};
        var fin = (rev.assets || []).some(function (a) { return a.kind === 'final_render'; });
        var txt = vr.publish_package && vr.publish_package.status === 'done';
        var pubs = Object.keys(vr.published || {}).filter(function (k) { return (vr.published || {})[k]; });
        var st = [
          ['Tomas aprobadas', cl.length ? ok + '/' + cl.length : '—', cl.length && ok === cl.length ? 2 : (ok ? 1 : 0)],
          ['Video final', fin ? 'Listo' : 'Falta unir', fin ? 2 : 0],
          ['Textos', txt ? 'Listos' : 'Pendientes', txt ? 2 : 0],
          ['Publicado', pubs.length ? pubs.map(function (k) { return (window.NET && NET[k]) || k; }).join(', ') : 'Todavía no', pubs.length ? 2 : 0]
        ];
        rs.innerHTML = st.map(function (x, i) {
          return '<li class="vy-rs vy-rs-' + x[2] + '"><span class="vy-rs-n">' + (x[2] === 2 ? '<i class="fa-solid fa-check"></i>' : (i + 1)) + '</span>' +
            '<span class="flex flex-col min-w-0"><span class="vy-lab" style="font-size:10px">' + esc(x[0]) + '</span><strong class="text-sm text-white truncate">' + esc(x[1]) + '</strong></span></li>';
        }).join('');
      }
    }
    // Las tomas por revisar se abren solas la primera vez (después respeta lo que hagas tú)
    var det = $('shotCardsDetails');
    if (det && !det.dataset.vyAuto && rev && rev.status === 'en_revision' &&
        (rev.assets || []).some(function (a) { return a.kind === 'video_clip' && !a.approved; })) {
      det.open = true; det.dataset.vyAuto = '1';
    }

    // ---------- PRODUCCIÓN ----------
    var etapa = function (e) {
      var p = pasos(e);
      if (e.status === 'guion_pendiente' || !p[0]) return 'Escribiendo guion';
      if (e.status === 'generando_media') return 'Creando video';
      if (e.status === 'en_revision') return 'Esperando tu revisión';
      if (p[3] === 2) return 'Listo para publicar';
      if (e.status === 'guion_generado') return 'Listo para producir';
      return (ESTADO[e.status] || [e.status])[0];
    };
    var genAhora = eps.find(function (e) { return e.status === 'generando_media'; });
    var sig = $('vySiguiente');
    if (sig) sig.classList.toggle('flow', !!genAhora);

    var fila = $('vyFilaRows');
    if (fila) {
      var falta = eps.filter(function (e) { return e.status !== 'publicado' && e.status !== 'en_revision' && (e.continuity && e.continuity.en_produccion) && !(e.continuity && e.continuity.parent_episode_id); }) // SOLO movidos a producción, solo el largo (sus Shorts van con él, no como filas sueltas) — Franklin oct-13
        .sort(function (a, b) { return (a.episode_number || 0) - (b.episode_number || 0); });
      if ($('vyFilaCount')) $('vyFilaCount').textContent = falta.length ? falta.length + ' por terminar' : '';
      fila.innerHTML = falta.length ? falta.map(function (e) {
        var p = pasos(e);
        var shots = (e.shots || []).length;
        var clips = (e.assets || []).filter(function (a) { return a.kind === 'video_clip'; }).length;
        var prog = e.status === 'generando_media' && shots
          ? '<div class="flex items-center gap-2"><div class="vy-bar w-32"><div class="vy-fill" style="width:' + Math.max(4, Math.round(clips / shots * 100)) + '%"></div></div><span class="font-mono text-[11px] text-slate-300">' + Math.round(clips / shots * 100) + '%</span></div>'
          : '<div class="flex gap-1" title="Guion · Imágenes · Video · Video final · Publicado">' + p.map(function (v) { return '<span class="vy-seg' + (v === 2 ? ' on' : v === 1 ? ' half' : '') + '"></span>'; }).join('') + '</div>';
        var go = e.status === 'en_revision' ? 'vyPanel.irARevisar(\'' + esc(e.id) + '\')' : 'vyPanel.abrirEpisodio(\'' + esc(e.id) + '\')';
        var label = e.status === 'en_revision' ? 'Revisar' : (e.status === 'guion_generado' ? 'Abrir y producir' : 'Abrir guion');
        var tone = e.status === 'en_revision' ? 'gold' : (e.status === 'generando_media' || e.status === 'guion_generado' ? 'a' : (e.status === 'guion_rechazado' ? 'pink' : 'muted'));
        return '<tr class="vy-row" onclick="if(!event.target.closest(\'button\'))' + go + '">' +
          '<td class="vy-td"><div class="flex flex-col gap-0.5"><strong class="font-semibold text-white">Ep. ' + esc(e.episode_number) + (e.title ? ' · ' + esc(e.title) : '') + '</strong>' +
            '<span class="font-mono text-[11px] text-slate-400">' + (aspectoDe(e, serie) === '16:9' ? 'LARGO · 16:9' : 'SHORT · 9:16') + '</span></div></td>' +
          '<td class="vy-td"><span class="vy-pill vy-pill-' + tone + '">' + (e.status === 'generando_media' ? '<span class="vy-live" aria-hidden="true"></span>' : '') + esc(etapa(e)) + '</span></td>' +
          '<td class="vy-td">' + prog + '</td>' +
          '<td class="vy-td font-mono text-right text-slate-300">' + (shots ? clips + '/' + shots : '—') + '</td>' +
          '<td class="vy-td text-right"><button type="button" class="vy-link" onclick="' + go + '">' + label + '</button></td>' +
        '</tr>';
      }).join('') : '<tr><td class="vy-td text-cyber-emerald" colspan="5"><i class="fa-solid fa-check mr-2"></i>Todos los episodios están terminados.</td></tr>';
    }

    // Trabajando ahora
    var work = $('vyWork');
    if (work) {
      var run = jobs.find(function (j) { return j.status === 'running'; }) || jobs[0];
      if (run) {
        var epJ = epDeComando(run.command, eps);
        var shN = epJ ? (epJ.shots || []).length : 0;
        var clN = epJ ? (epJ.assets || []).filter(function (a) { return a.kind === 'video_clip'; }).length : 0;
        var pctW = shN && /gen_local/.test(run.command) ? Math.round(clN / shN * 100) : null;
        work.innerHTML =
          '<div class="flex justify-between items-center"><span class="vy-lab text-cyber-cyan inline-flex items-center gap-2"><span class="vy-live" aria-hidden="true"></span>' + (run.status === 'running' ? 'Trabajando ahora' : 'En la fila') + '</span>' +
            (pctW != null ? '<span class="font-mono text-xs text-white">' + pctW + '%</span>' : '') + '</div>' +
          '<strong class="text-[15px] font-semibold text-white">' + esc(trabajo(run.command)) + (epJ ? ' · Ep. ' + esc(epJ.episode_number) : '') + '</strong>' +
          '<div class="vy-bar"><div class="vy-fill' + (pctW == null ? ' vy-indet' : '') + '" style="width:' + (pctW == null ? 35 : Math.max(4, pctW)) + '%"></div></div>' +
          '<span class="text-xs text-slate-400">' + (jobs.length > 1 ? (jobs.length - 1) + ' más en la fila de tu PC' : 'Nada más en la fila') + '</span>';
        work.classList.add('flow');
        // Clic → te lleva a ese trabajo (el episodio en "Revisar y publicar", donde se ve el avance toma por toma).
        if (epJ) { work.style.cursor = 'pointer'; work.title = 'Ver este trabajo'; work.onclick = function () { irATrabajo(epJ.id); }; }
        else { work.style.cursor = ''; work.title = ''; work.onclick = null; }
      } else {
        work.innerHTML =
          '<span class="vy-lab">Trabajando ahora</span>' +
          '<strong class="text-[15px] font-semibold text-slate-300">Nada en proceso</strong>' +
          '<span class="text-xs text-slate-400">Tu PC está libre. Produce el siguiente episodio cuando quieras.</span>';
        work.classList.remove('flow');
        work.style.cursor = ''; work.onclick = null;
      }
    }

    pintarRedes();

    // Fila de trabajo de la PC (datos reales de agent_jobs: pendientes y en curso)
    var q = $('vyQueue');
    if (q) {
      q.innerHTML = jobs.length ? jobs.slice(0, 6).map(function (j) {
        var epQ = epDeComando(j.command, eps);
        var t = j.created_at ? new Date(j.created_at) : null;
        var hora = t ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        return '<div class="flex gap-3 text-sm' + (epQ ? ' cursor-pointer hover:bg-white/5 rounded -mx-1 px-1' : '') + '"' + (epQ ? ' role="link" tabindex="0" title="Ver este trabajo" onclick="vyPanel.irATrabajo(\'' + esc(epQ.id) + '\')"' : '') + '><span class="font-mono text-[11px] w-11 flex-none pt-0.5 ' + (j.status === 'running' ? 'text-cyber-cyan' : 'text-slate-400') + '">' + esc(hora) + '</span>' +
          '<span>' + esc(trabajo(j.command)) + (epQ ? ' · Ep. ' + esc(epQ.episode_number) : '') +
          ' <span class="text-[11px] text-slate-500">' + (j.status === 'running' ? '(en curso)' : '(en espera)') + '</span></span></div>';
      }).join('') : '<p class="text-sm text-slate-400">No hay trabajos pendientes en tu PC.</p>';
    }

    // Estado de la PC en el menú
    var ag = window.__agent;
    var dot = $('vyAgentDot'), lab = $('vyAgentLabel'), sub = $('vyAgentSub');
    if (dot && lab && sub && !(me && !me.is_admin)) {
      var on = !!(ag && ag.online);
      dot.style.background = on ? 'rgb(var(--vy-emerald))' : 'rgb(var(--vy-gold))';
      lab.textContent = on ? 'PC EN LÍNEA' : 'PC SIN CONEXIÓN';
      lab.style.color = on ? 'rgb(var(--vy-emerald))' : 'rgb(var(--vy-gold))';
      var __act = on ? tareaActual(jobs, eps) : null;
      var __pend = 0; for (var __i = 0; __i < jobs.length; __i++) if (jobs[__i].status !== 'running') __pend++;
      sub.textContent = !on ? 'Abre el agente en tu PC para producir'
                        : __act ? ('\u25b6 ' + __act + (__pend ? '  \u00b7  +' + __pend + ' en la fila' : ''))
                        : (jobs.length ? jobs.length + ' tarea' + (jobs.length === 1 ? '' : 's') + ' en la fila' : 'Agente local listo');
    }
  }

  window.vyPanel = { render: render, irARevisar: irARevisar, irATrabajo: irATrabajo, abrirEpisodio: abrirEpisodio, setView: setView, filtro: setFiltro, apiGuardar: apiGuardar, apiQuitar: apiQuitar, apiProbar: apiProbar,
    usersCrear: usersCrear, usersPermiso: usersPermiso, usersCreditos: usersCreditos, usersActiva: usersActiva, usersClave: usersClave, usersBorrar: usersBorrar, usersPrecios: usersPrecios, genPass: genPass, sinNovela: sinNovela };
  document.addEventListener('input', function (ev) { if (ev.target && ev.target.id === 'vyArcSearch') filtrarArco(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initViews);
  else initViews();
})();
