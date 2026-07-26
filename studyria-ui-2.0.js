/* ═════════════════════════════════════════════════════════════════════
   STUDYRIA UI/UX 2.0 — MICRO INTERACTIONS (v2.0.1 hotfix)
   Progressive enhancement only. Zero existing functionality touched.
   ═════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 1. SCROLL FADE-IN ─────────────────────────────────────────── */
  function initFadeIn() {
    if (reduced) {
      document.querySelectorAll('.ui2-fade-in, .ui2-stagger').forEach(function (el) {
        el.classList.add('ui2-visible');
      });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('ui2-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.ui2-fade-in, .ui2-stagger').forEach(function (el) {
      io.observe(el);
    });
  }

  /* ── 2. ANIMATED COUNTERS ──────────────────────────────────────── */
  function initCounters() {
    if (reduced) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        if (el.dataset.ui2Done) return;
        el.dataset.ui2Done = '1';
        io.unobserve(el);

        var raw = el.textContent.trim();
        var num = parseFloat(raw.replace(/[^\d.]/g, ''));
        if (isNaN(num) || num === 0) return;

        var suffix = raw.replace(/[\d.,\s]/g, '');
        var isFloat = raw.includes('.');
        var dur = 900;
        var start = performance.now();

        function tick(now) {
          var p = Math.min((now - start) / dur, 1);
          var ease = 1 - Math.pow(1 - p, 3);
          var val = num * ease;
          el.textContent = (isFloat ? val.toFixed(1) : Math.round(val).toLocaleString('en-IN')) + suffix;
          if (p < 1) requestAnimationFrame(tick);
          else el.textContent = (isFloat ? num.toFixed(1) : Math.round(num).toLocaleString('en-IN')) + suffix;
        }
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.5 });

    document.querySelectorAll('.stat-num, .sh-hero-stat-num, .ottlib-stat-num').forEach(function (el) {
      if (/\d/.test(el.textContent)) io.observe(el);
    });
  }

  /* ── 3. BUTTON RIPPLE ──────────────────────────────────────────── */
  function initRipple() {
    if (reduced) return;
    document.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('.btn, .sh-btn');
      if (!btn) return;
      var r = btn.getBoundingClientRect();
      var x = ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%';
      var y = ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%';

      var ripple = document.createElement('span');
      ripple.style.cssText = [
        'position:absolute',
        'inset:0',
        'pointer-events:none',
        'border-radius:inherit',
        'background:radial-gradient(circle at ' + x + ' ' + y + ', rgba(255,255,255,0.22) 0%, transparent 55%)',
        'opacity:1',
        'transition:opacity 0.5s ease'
      ].join(';');

      /* btn needs relative positioning */
      if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
      btn.style.overflow = 'hidden';
      btn.appendChild(ripple);

      requestAnimationFrame(function () {
        ripple.style.opacity = '0';
        setTimeout(function () { ripple.remove(); }, 550);
      });
    }, { passive: true });
  }

  /* ── 4. MOBILE CARD TAP SCALE ──────────────────────────────────── */
  function initCardTap() {
    if (reduced) return;
    var sel = '.pdf-card, .ottlib-card, .card, .stat-card, .prm-plan-card';

    document.addEventListener('touchstart', function (e) {
      var card = e.target.closest(sel);
      if (!card) return;
      card.style.transition = 'transform 0.1s ease';
      card.style.transform = 'scale(0.975)';
    }, { passive: true });

    document.addEventListener('touchend', function (e) {
      var card = e.target.closest(sel);
      if (!card) return;
      card.style.transform = '';
      setTimeout(function () { card.style.transition = ''; }, 250);
    }, { passive: true });

    document.addEventListener('touchcancel', function (e) {
      var card = e.target.closest(sel);
      if (card) { card.style.transform = ''; card.style.transition = ''; }
    }, { passive: true });
  }

  /* ── 5. SPA PAGE CHANGE — re-run observers ─────────────────────── */
  function initPageObserver() {
    if (reduced) return;
    var lastPage = null;

    var mo = new MutationObserver(function () {
      var active = document.querySelector('.page.active');
      if (!active || active.id === lastPage) return;
      lastPage = active.id;

      /* tiny delay to let Alpine / existing JS render the page first */
      setTimeout(function () {
        initFadeIn();
        initCounters();
      }, 80);
    });

    mo.observe(document.body, { subtree: true, attributeFilter: ['class'] });
  }

  /* ── 6. SMOOTH SCROLL for hash links ──────────────────────────── */
  function initSmoothScroll() {
    if (reduced) return;
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute('href');
      if (id.length < 2) return;
      var target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  /* ── BOOT ──────────────────────────────────────────────────────── */
  function boot() {
    initFadeIn();
    initCounters();
    initRipple();
    initCardTap();
    initSmoothScroll();
    initPageObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
