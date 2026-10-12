/* =====================================================================
   VYRALES · tema.js  (rediseño "Estudio futurista", fase 1)
   1) Por novela solo cambian sus letras (color + tipo); el panel es siempre azul + rosado
   2) Ola de color que deja el mouse al moverse (desaparece sola)
   3) Bordes de los paneles que se encienden cerca del mouse
   No toca datos ni funciones del panel: solo apariencia.
   ===================================================================== */
(function () {
  'use strict';

  // ---------- 1) Temas ----------
  // a = color principal, b = secundario (R G B). font = letra del nombre de la novela.
  var TEMAS = {
    azul_rosa:    { a: '45 140 255', b: '255 62 165', font: "'Playfair Display', serif" },
    dorado_fuego: { a: '255 183 0',  b: '255 77 46',  font: "'Cinzel', serif" },
    cian_verde:   { a: '0 240 255',  b: '0 255 136',  font: "'Orbitron', sans-serif" },
    violeta_cian: { a: '155 92 255', b: '0 240 255',  font: "'Space Grotesk', sans-serif" }
  };

  // Qué tema usa cada novela si no tiene uno guardado (story_bible.theme).
  function temaPorSlug(slug) {
    slug = String(slug || '').toLowerCase();
    if (slug.indexOf('dulce') >= 0) return 'azul_rosa';
    if (slug.indexOf('casada') >= 0 || slug.indexOf('enemigo') >= 0) return 'dorado_fuego';
    if (/curiosidad|historia|cibertal/.test(slug)) return 'cian_verde';
    if (slug.indexOf('vyrales') >= 0) return 'violeta_cian';
    return 'azul_rosa';
  }

  var actual = TEMAS.azul_rosa; // colores del panel (fijos)

  function apply(serie) {
    var t = null;
    if (serie && typeof serie === 'object') {
      var custom = serie.story_bible && serie.story_bible.theme;
      if (custom && TEMAS[custom]) t = TEMAS[custom];
      else if (custom && custom.a && custom.b) t = custom; // tema hecho a mano
      if (!t) t = TEMAS[temaPorSlug(serie.slug || serie.title)];
    } else {
      t = TEMAS[temaPorSlug(serie)];
    }
    t = t || TEMAS.azul_rosa;
    // Franklin: el fondo y los colores del panel quedan FIJOS en azul + rosado.
    // Lo único que cambia por novela son las LETRAS de la novela (color + tipo de letra).
    var r = document.documentElement.style;
    r.setProperty('--vy-na', t.a);
    r.setProperty('--vy-nb', t.b);
    if (t.font) r.setProperty('--vy-font-novela', t.font);
  }

  window.vyTema = { apply: apply, temas: TEMAS };

  // Tema inicial: la serie guardada en este navegador (antes de que cargue Supabase)
  try {
    var q = new URLSearchParams(location.search).get('series');
    apply(q || localStorage.getItem('vyrales_series') || 'dulce_engano');
  } catch (_) { apply('dulce_engano'); }

  // ---------- 2) Ola de color + 3) bordes ----------
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function start() {
    var cv = document.createElement('canvas');
    cv.id = 'vyTrail';
    cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d');
    var pts = [], loop = null, raf = null, idle = null, lastX = 0, lastY = 0;
    var LIFE = 900; // ms que dura cada mancha

    function rgb(s) { return s.split(' ').map(Number); }

    function draw() {
      var dpr = window.devicePixelRatio || 1;
      var w = window.innerWidth, h = window.innerHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      var A = rgb(actual.a), B = rgb(actual.b), now = performance.now();
      pts = pts.filter(function (p) { return now - p.t < LIFE; });
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i], age = (now - p.t) / LIFE;
        var k = (Math.sin(p.t / 260) + 1) / 2;
        var c = Math.round(A[0] + (B[0] - A[0]) * k) + ',' + Math.round(A[1] + (B[1] - A[1]) * k) + ',' + Math.round(A[2] + (B[2] - A[2]) * k);
        var rad = 40 + 70 * age, al = 0.07 * Math.pow(1 - age, 2); // suave (Franklin: "que se vea menos")
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
        g.addColorStop(0, 'rgba(' + c + ',' + al + ')');
        g.addColorStop(1, 'rgba(' + c + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill();
      }
      loop = pts.length ? requestAnimationFrame(draw) : (ctx.clearRect(0, 0, w, h), null);
    }

    function add(x, y) {
      var now = performance.now(), steps = 1, last = pts[pts.length - 1];
      if (last) {
        var d = Math.hypot(x - last.x, y - last.y);
        if (d < 6) return;
        steps = Math.min(6, Math.ceil(d / 18));
      }
      for (var i = 1; i <= steps; i++) {
        pts.push({ x: last ? last.x + (x - last.x) * i / steps : x, y: last ? last.y + (y - last.y) * i / steps : y, t: now });
      }
      if (pts.length > 160) pts.splice(0, pts.length - 160);
      if (!loop) loop = requestAnimationFrame(draw);
    }

    function bordes() {
      raf = null;
      document.documentElement.style.setProperty('--vy-go', '1');
      var panels = document.querySelectorAll('.glass-panel');
      for (var i = 0; i < panels.length; i++) {
        var b = panels[i].getBoundingClientRect();
        // Solo los que están cerca del mouse (ahorra trabajo con muchas tarjetas)
        if (lastX < b.left - 300 || lastX > b.right + 300 || lastY < b.top - 300 || lastY > b.bottom + 300) continue;
        panels[i].style.setProperty('--x', (lastX - b.left) + 'px');
        panels[i].style.setProperty('--y', (lastY - b.top) + 'px');
      }
    }

    document.addEventListener('mousemove', function (e) {
      lastX = e.clientX; lastY = e.clientY;
      add(lastX, lastY);
      if (!raf) raf = requestAnimationFrame(bordes);
      if (idle) clearTimeout(idle);
      idle = setTimeout(function () { document.documentElement.style.setProperty('--vy-go', '0'); }, 140);
    }, { passive: true });
    document.addEventListener('mouseleave', function () { document.documentElement.style.setProperty('--vy-go', '0'); });
  }

  if (!reduce) {
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }
})();
