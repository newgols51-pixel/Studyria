
(function () {
  'use strict';

  var WA_NUMBER  = '918011267054'; // +91 8011267054, E.164 without '+'
  var WA_MESSAGE = 'Hello Studyria Team, I need help regarding your PDFs.';

  // FAIL-OPEN by design: show the button on every page EXCEPT a short
  // explicit denylist (auth/admin/checkout screens). The previous version
  // used an allowlist of exact page names — any page name it didn't know
  // about (or a mismatch with how navigate() names things) meant the
  // button silently never appeared. A denylist is far more robust: new
  // pages get the button by default instead of needing to be added here.
  var WA_HIDDEN_PAGES = ['login', 'register', 'admin', 'admin-login', 'checkout'];

  var STYLE_ID   = 'wa-fab-style-v2';
  var WRAP_ID    = 'waFabWrap';
  var BTN_ID     = 'waFabBtn';
  var TOOLTIP_ID = 'waFabTooltip';

  // ── 1. Styles (self-reinjecting: safe if this runs more than once) ──
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + WRAP_ID + '{position:fixed;inset:auto 0 0 auto;width:0;height:0;pointer-events:none;z-index:2147483000;}',
      '.wa-fab{',
      '  position:fixed !important;',
      '  right:18px;',
      '  bottom:calc(84px + env(safe-area-inset-bottom, 0px));',
      '  width:58px;height:58px;border-radius:50%;',
      '  background:linear-gradient(145deg,#25D366,#128C7E);',
      '  display:flex;align-items:center;justify-content:center;',
      '  box-shadow:0 4px 18px rgba(37,211,102,.45),0 0 0 rgba(37,211,102,.55);',
      '  z-index:999999999 !important;',
      '  cursor:pointer;border:none;padding:0;margin:0;',
      '  -webkit-tap-highlight-color:rgba(37,211,102,.25);',
      '  touch-action:manipulation;',
      '  animation:wa-pulse 2.4s ease-in-out infinite;',
      '  transition:transform .18s ease,box-shadow .18s ease,opacity .25s ease,visibility .25s;',
      '  opacity:1;visibility:visible;pointer-events:auto !important;',
      '}',
      '.wa-fab:hover{transform:scale(1.08);}',
      '.wa-fab:active{transform:scale(0.94);}',
      '.wa-fab.wa-hidden{opacity:0;visibility:hidden;pointer-events:none !important;transform:scale(0.6);}',
      '.wa-fab svg{width:30px;height:30px;pointer-events:none;}',
      '@keyframes wa-pulse{',
      '  0%{box-shadow:0 4px 18px rgba(37,211,102,.45),0 0 0 0 rgba(37,211,102,.45);}',
      '  70%{box-shadow:0 4px 18px rgba(37,211,102,.45),0 0 0 14px rgba(37,211,102,0);}',
      '  100%{box-shadow:0 4px 18px rgba(37,211,102,.45),0 0 0 0 rgba(37,211,102,0);}',
      '}',
      '.wa-fab-tooltip{',
      '  position:fixed !important;',
      '  right:84px;',
      '  bottom:calc(96px + env(safe-area-inset-bottom, 0px));',
      '  background:rgba(15,20,30,.94);color:#fff;font-size:13px;font-weight:600;',
      '  padding:7px 12px;border-radius:8px;white-space:nowrap;',
      '  z-index:999999999 !important;',
      '  opacity:0;visibility:hidden;transform:translateX(6px);',
      '  transition:opacity .2s ease,transform .2s ease,visibility .2s;',
      '  pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.3);',
      '}',
      '.wa-fab-wrap:hover .wa-fab-tooltip{opacity:1;visibility:visible;transform:translateX(0);}',
      '@media (min-width:769px){',
      '  .wa-fab{bottom:calc(26px + env(safe-area-inset-bottom, 0px));right:26px;width:60px;height:60px;}',
      '  .wa-fab-tooltip{bottom:calc(40px + env(safe-area-inset-bottom, 0px));}',
      '}',
      '@media (max-width:480px){',
      '  .wa-fab{width:52px;height:52px;right:14px;}',
      '  .wa-fab svg{width:26px;height:26px;}',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  // ── 2. Build the button from JS (does not rely on static markup) ──
  function buildFab() {
    var wrap = document.createElement('div');
    wrap.className = 'wa-fab-wrap';
    wrap.id = WRAP_ID;

    var tooltip = document.createElement('span');
    tooltip.className = 'wa-fab-tooltip';
    tooltip.id = TOOLTIP_ID;
    tooltip.textContent = 'Chat with us';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wa-fab';
    btn.id = BTN_ID;
    btn.setAttribute('aria-label', 'Chat with Studyria support on WhatsApp');
    btn.innerHTML = '<svg viewBox="0 0 32 32" fill="#fff" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M16.004 2.667c-7.363 0-13.333 5.97-13.333 13.333 0 2.353.615 4.646 1.784 6.667L2.667 29.333l6.84-1.795a13.27 13.27 0 006.497 1.687h.006c7.362 0 13.333-5.97 13.333-13.333s-5.977-13.225-13.339-13.225zm0 24.395a11.03 11.03 0 01-5.63-1.542l-.404-.24-4.06 1.066 1.084-3.96-.264-.407a11.02 11.02 0 01-1.69-5.877c0-6.096 4.96-11.057 11.068-11.057 2.956 0 5.735 1.152 7.826 3.244a10.985 10.985 0 013.238 7.822c-.002 6.099-4.963 11.05-11.068 11.05zm6.062-8.283c-.332-.166-1.965-.97-2.27-1.08-.305-.11-.527-.166-.75.166-.222.333-.86 1.08-1.055 1.303-.194.222-.388.25-.72.083-.333-.166-1.404-.518-2.674-1.652-.988-.882-1.656-1.972-1.85-2.305-.194-.333-.02-.513.146-.679.15-.15.333-.389.5-.583.166-.194.222-.333.333-.555.11-.222.055-.417-.028-.583-.083-.166-.75-1.808-1.028-2.475-.27-.65-.545-.563-.75-.573-.194-.01-.416-.012-.638-.012-.222 0-.583.083-.888.417-.305.333-1.166 1.14-1.166 2.782 0 1.642 1.194 3.23 1.361 3.452.166.222 2.351 3.59 5.696 5.034.796.343 1.417.548 1.902.702.799.254 1.526.218 2.101.132.641-.096 1.965-.803 2.242-1.578.277-.775.277-1.44.194-1.579-.083-.138-.305-.222-.638-.388z"/>' +
      '</svg>';

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var url = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(WA_MESSAGE);
      window.open(url, '_blank', 'noopener');
    });

    wrap.appendChild(tooltip);
    wrap.appendChild(btn);
    (document.body || document.documentElement).appendChild(wrap);
    return { wrap: wrap, btn: btn, tooltip: tooltip };
  }

  // ── 3. Always resolve to a *live, attached* set of nodes. Recreates
  //      automatically if a previous copy was removed from the DOM. ──
  function getRefs() {
    var wrap = document.getElementById(WRAP_ID);
    var btn  = document.getElementById(BTN_ID);
    if (wrap && btn && document.body && document.body.contains(wrap)) {
      return { wrap: wrap, btn: btn };
    }
    // Stale/removed — clean up any orphaned duplicate before rebuilding.
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    return buildFab();
  }

  // ── 4. Razorpay / payment-checkout detection (the ONLY reason to hide) ──
  function isCheckoutOrPaymentOpen() {
    if (document.querySelector('iframe[name^="razorpay"]')) return true;
    if (document.querySelector('iframe[src*="razorpay" i]')) return true;
    if (document.querySelector('.razorpay-container, .razorpay-backdrop')) return true;
    if (document.body && document.body.classList.contains('razorpay-open')) return true;
    var el = document.querySelector(
      '[id*="checkout" i].active, [id*="checkout" i][style*="flex"], ' +
      '[id*="payment" i].modal-open, [id*="payment" i].active'
    );
    return !!el;
  }

  // ── 5. Core update loop: ensure existence, correct visibility, top stacking ──
  function update() {
    injectStyles();
    var refs = getRefs();
    var page = window.currentPage || 'home';
    var shouldShow = WA_HIDDEN_PAGES.indexOf(page) === -1 && !isCheckoutOrPaymentOpen();

    refs.btn.classList.toggle('wa-hidden', !shouldShow);
    refs.wrap.style.pointerEvents = shouldShow ? 'auto' : 'none';
    refs.btn.style.pointerEvents = shouldShow ? 'auto' : 'none';

    // Keep it the last node in <body> so it always wins the paint/stacking
    // order versus anything else appended later (drawers, toasts, etc.).
    if (document.body && document.body.lastElementChild !== refs.wrap) {
      document.body.appendChild(refs.wrap);
    }
  }

  // ── 6. Hook the SPA's navigate() without altering its behaviour ──
  function wrapNavigate() {
    if (typeof window.navigate !== 'function' || window.navigate.__waWrapped) return;
    var original = window.navigate;
    var wrapped = function (page) {
      var result = original.apply(this, arguments);
      setTimeout(update, 30);
      return result;
    };
    wrapped.__waWrapped = true;
    window.navigate = wrapped;
  }
  // navigate() may be (re)assigned by later inline scripts during initial
  // page construction, so retry the wrap for a short window after load.
  var wrapAttempts = 0;
  var wrapTimer = setInterval(function () {
    wrapNavigate();
    if (++wrapAttempts > 60) clearInterval(wrapTimer); // ~15s ceiling
  }, 250);

  // ── 7. Also hook history.pushState/replaceState directly, so ANY route
  //      change is detected even if it never calls navigate(). ──
  ['pushState', 'replaceState'].forEach(function (method) {
    var original = history[method];
    if (!original || original.__waWrapped) return;
    var wrapped = function () {
      var result = original.apply(this, arguments);
      setTimeout(update, 30);
      return result;
    };
    wrapped.__waWrapped = true;
    history[method] = wrapped;
  });

  window.addEventListener('popstate',   function () { setTimeout(update, 50); });
  window.addEventListener('hashchange', function () { setTimeout(update, 50); });
  document.addEventListener('studyria:navigate', update);

  // ── 8. Self-healing MutationObserver — catches removal / large
  //      re-renders anywhere in the document (deep, debounced). ──
  var moDebounce = null;
  function scheduleUpdate() {
    if (moDebounce) return;
    moDebounce = setTimeout(function () { moDebounce = null; update(); }, 60);
  }
  function startObserving() {
    var target = document.body || document.documentElement;
    new MutationObserver(scheduleUpdate).observe(target, { childList: true, subtree: true });
  }

  // ── 9. Safety-net polling — guarantees recovery even in the rare case
  //      an event or the observer is ever missed (e.g. iframes, extensions). ──
  setInterval(update, 1500);

  // ── 10. Boot ──
  function boot() {
    update();
    startObserving();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  window.addEventListener('load', update);
})();
