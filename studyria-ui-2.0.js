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

/* ══════════════════════════════════════════════════════════════════════
   WHATSAPP FLOATING SUPPORT BUTTON — Injected via ui-2.0.js (v4.1)
   Pure JS: no static HTML/CSS needed. Safe in any parsing context.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var WA_NUMBER   = '918011267054';
  var WA_MESSAGE  = 'Hello Studyria Team, I need help regarding your PDFs.';
  var STYLE_ID    = 'wa-fab-style-v41';
  var WRAP_ID     = 'waFabWrapV41';
  var BTN_ID      = 'waFabBtnV41';
  var LABEL_ID    = 'waFabLabelV41';
  var HIDDEN_PAGES = ['login', 'register', 'admin', 'admin-login', 'checkout'];

  /* ── 1. Inject CSS into <head> ── */
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#' + WRAP_ID + '{position:fixed;bottom:0;right:0;width:0;height:0;pointer-events:none;z-index:2147483647}' +
      '.wafab41{position:fixed!important;right:18px;bottom:calc(88px + env(safe-area-inset-bottom,0px));width:56px;height:56px;border-radius:50%;background:linear-gradient(145deg,#25D366,#128C7E);display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.12);z-index:2147483647!important;cursor:pointer;padding:0;margin:0;-webkit-tap-highlight-color:transparent;touch-action:manipulation;animation:wafab41pulse 2.5s ease-in-out infinite;transition:transform .2s,box-shadow .2s,opacity .25s,visibility .25s;opacity:1;visibility:visible;pointer-events:auto!important;box-shadow:0 4px 20px rgba(37,211,102,.45),0 0 0 0 rgba(37,211,102,.5),inset 0 1px 0 rgba(255,255,255,.15)}' +
      '.wafab41 svg{width:28px;height:28px;pointer-events:none;display:block}' +
      '.wafab41:hover{transform:scale(1.1) translateY(-2px)}' +
      '.wafab41:active{transform:scale(.95)}' +
      '.wafab41.wafab41-hidden{opacity:0!important;visibility:hidden!important;pointer-events:none!important;transform:scale(.5)!important}' +
      '.wafab41-lbl{position:fixed!important;right:82px;bottom:calc(96px + env(safe-area-inset-bottom,0px));background:rgba(15,20,30,.92);color:#fff;font-size:12px;font-weight:600;padding:6px 14px;border-radius:20px;white-space:nowrap;border:1px solid rgba(37,211,102,.25);z-index:2147483647!important;pointer-events:none;opacity:0;visibility:hidden;transform:translateX(8px);transition:opacity .25s,transform .25s,visibility .25s;font-family:system-ui,sans-serif}' +
      '.wafab41-lbl.show{opacity:1!important;visibility:visible!important;transform:translateX(0)!important}' +
      '.wafab41-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#25D366;margin-right:5px;animation:wafab41blink 1.5s ease-in-out infinite;vertical-align:middle}' +
      '.wafab41-ripple{position:absolute;border-radius:50%;background:rgba(255,255,255,.4);pointer-events:none;transform:scale(0);animation:wafab41ripple .5s ease-out forwards}' +
      '@keyframes wafab41pulse{0%{box-shadow:0 4px 20px rgba(37,211,102,.45),0 0 0 0 rgba(37,211,102,.5),inset 0 1px 0 rgba(255,255,255,.15)}70%{box-shadow:0 4px 20px rgba(37,211,102,.45),0 0 0 16px rgba(37,211,102,0),inset 0 1px 0 rgba(255,255,255,.15)}100%{box-shadow:0 4px 20px rgba(37,211,102,.45),0 0 0 0 rgba(37,211,102,0),inset 0 1px 0 rgba(255,255,255,.15)}}' +
      '@keyframes wafab41blink{0%,100%{opacity:1}50%{opacity:.3}}' +
      '@keyframes wafab41ripple{to{transform:scale(3);opacity:0}}' +
      '@media(min-width:769px){.wafab41{bottom:calc(28px + env(safe-area-inset-bottom,0px));right:24px;width:60px;height:60px}.wafab41-lbl{bottom:calc(38px + env(safe-area-inset-bottom,0px));right:94px}}' +
      '@media(max-width:380px){.wafab41{width:50px;height:50px;right:14px}.wafab41-lbl{right:72px}}';
    (document.head || document.documentElement).appendChild(s);
  }

  /* ── 2. Build DOM ── */
  function buildDOM() {
    if (document.getElementById(WRAP_ID)) return;

    injectStyles();

    var wrap = document.createElement('div');
    wrap.id = WRAP_ID;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.className = 'wafab41';
    btn.setAttribute('aria-label', '24/7 WhatsApp Support — Studyria');
    btn.setAttribute('title', '24/7 Support — Chat on WhatsApp');
    btn.innerHTML =
      '<svg viewBox="0 0 32 32" fill="#fff" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M16 2.667C8.637 2.667 2.667 8.637 2.667 16c0 2.353.615 4.646 1.784 6.667L2.667 29.333l6.84-1.795A13.27 13.27 0 0016 29.225c7.363 0 13.333-5.97 13.333-13.333S23.363 2.667 16 2.667zm0 24.395a11.03 11.03 0 01-5.63-1.542l-.404-.24-4.06 1.066 1.084-3.96-.264-.407A11.02 11.02 0 014.97 16c0-6.096 4.96-11.057 11.068-11.057 2.956 0 5.735 1.152 7.826 3.244A10.985 10.985 0 0127.1 16c0 6.099-4.96 11.062-11.1 11.062zm6.062-8.283c-.332-.166-1.965-.97-2.27-1.08-.305-.11-.527-.166-.75.166-.222.333-.86 1.08-1.055 1.303-.194.222-.388.25-.72.083-.333-.166-1.404-.518-2.674-1.652-.988-.882-1.656-1.972-1.85-2.305-.194-.333-.02-.513.146-.679.15-.15.333-.389.5-.583.166-.194.222-.333.333-.555.11-.222.055-.417-.028-.583-.083-.166-.75-1.808-1.028-2.475-.27-.65-.545-.563-.75-.573-.194-.01-.416-.012-.638-.012-.222 0-.583.083-.888.417-.305.333-1.166 1.14-1.166 2.782 0 1.642 1.194 3.23 1.361 3.452.166.222 2.351 3.59 5.696 5.034.796.343 1.417.548 1.902.702.799.254 1.526.218 2.101.132.641-.096 1.965-.803 2.242-1.578.277-.775.277-1.44.194-1.579-.083-.138-.305-.222-.638-.388z"/>' +
      '</svg>';

    var label = document.createElement('span');
    label.id = LABEL_ID;
    label.className = 'wafab41-lbl';
    label.innerHTML = '<span class="wafab41-dot"></span>24/7 Support';

    wrap.appendChild(btn);
    wrap.appendChild(label);
    document.body.appendChild(wrap);

    /* click → open WhatsApp + ripple */
    btn.addEventListener('click', function (e) {
      var rip = document.createElement('span');
      rip.className = 'wafab41-ripple';
      var rc = btn.getBoundingClientRect();
      var sz = Math.max(rc.width, rc.height);
      rip.style.cssText = 'width:' + sz + 'px;height:' + sz + 'px;left:' + (e.clientX - rc.left - sz / 2) + 'px;top:' + (e.clientY - rc.top - sz / 2) + 'px';
      btn.appendChild(rip);
      setTimeout(function () { rip.parentNode && rip.parentNode.removeChild(rip); }, 500);
      window.open('https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(WA_MESSAGE), '_blank', 'noopener,noreferrer');
    });

    /* show label for 4s on first load */
    setTimeout(function () {
      label.classList.add('show');
      setTimeout(function () { label.classList.remove('show'); }, 4000);
    }, 2000);
  }

  /* ── 3. Visibility control ── */
  function updateVisibility() {
    buildDOM();
    var btn   = document.getElementById(BTN_ID);
    var lbl   = document.getElementById(LABEL_ID);
    if (!btn) return;

    var page     = ((window.currentPage || '') + '').toLowerCase();
    var inPayment = !!(
      document.querySelector('iframe[name^="razorpay"]') ||
      document.querySelector('.razorpay-container') ||
      (document.body && document.body.classList.contains('razorpay-open'))
    );
    var hide = HIDDEN_PAGES.indexOf(page) !== -1 || inPayment;

    btn.classList.toggle('wafab41-hidden', hide);
    if (lbl) {
      if (!hide) {
        lbl.classList.add('show');
        clearTimeout(window._wafab41LblTimer);
        window._wafab41LblTimer = setTimeout(function () { lbl.classList.remove('show'); }, 3500);
      } else {
        lbl.classList.remove('show');
      }
    }
  }

  /* ── 4. SPA navigation hooks ── */
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    if (!orig || orig.__wafab41) return;
    history[m] = function () {
      var r = orig.apply(this, arguments);
      setTimeout(updateVisibility, 60);
      return r;
    };
    history[m].__wafab41 = true;
  });
  window.addEventListener('popstate',   function () { setTimeout(updateVisibility, 60); });
  window.addEventListener('hashchange', function () { setTimeout(updateVisibility, 60); });

  /* ── 5. navigate() hook (Studyria SPA) ── */
  var _navHookTries = 0;
  var _navHookInterval = setInterval(function () {
    if (typeof window.navigate === 'function' && !window.navigate.__wafab41) {
      var orig = window.navigate;
      window.navigate = function () {
        var r = orig.apply(this, arguments);
        setTimeout(updateVisibility, 60);
        return r;
      };
      window.navigate.__wafab41 = true;
    }
    if (++_navHookTries > 60) clearInterval(_navHookInterval);
  }, 300);

  /* ── 6. Self-healing: rebuild if removed ── */
  setInterval(function () {
    if (!document.getElementById(BTN_ID)) buildDOM();
    updateVisibility();
  }, 2500);

  /* ── Boot ── */
  function boot() {
    buildDOM();
    updateVisibility();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  window.addEventListener('load', updateVisibility);
})();
