/* ═══════════════════════════════════════════════════════════════
   STUDYRIA — HOMEPAGE PREMIUM REDESIGN — JS (hpr- namespace)
   Purely additive / presentational. Does NOT touch auth, payments,
   database, routing definitions, or business logic. It only:
     • Relocates existing header nodes into one clean row.
     • Merges the two mobile menus into a single right-side drawer.
     • Re-implements the OPEN/CLOSE ANIMATION of that drawer
       (slide-from-right instead of slide-from-bottom) by
       redefining window.mhToggleBurger / mhCloseBurger — the
       underlying navigate()/auth/admin functions called BY the
       menu items are untouched and still invoked exactly as before.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    try { buildHeaderBar(); } catch (e) { console.warn('[hpr] header build skipped:', e); }
    try { mergeDrawers(); } catch (e) { console.warn('[hpr] drawer merge skipped:', e); }
    try { wireDrawerAnimation(); } catch (e) { console.warn('[hpr] drawer animation skipped:', e); }
    try { wireCartBadge(); } catch (e) { console.warn('[hpr] cart badge skipped:', e); }
  });

  /* ── 1. Build the single clean header row (mobile) ──────────── */
  function buildHeaderBar() {
    var header = document.getElementById('mobileHeader');
    if (!header || document.querySelector('.hpr-header-bar')) return;

    var bar = document.createElement('div');
    bar.className = 'hpr-header-bar';

    // Relocate the real logo node (keeps its onclick + animation intact)
    var logo = document.getElementById('mhLogo');
    if (logo) bar.appendChild(logo);

    var actions = document.createElement('div');
    actions.className = 'hpr-header-actions';

    // Relocate the real sign-in / user-area node (keeps auth-state swap logic intact)
    var userArea = document.getElementById('mhUserArea');
    if (userArea) actions.appendChild(userArea);

    // New "Get Pass" trigger — reuses the existing navigate() router only
    var getPassBtn = document.createElement('button');
    getPassBtn.className = 'hpr-getpass-btn';
    getPassBtn.type = 'button';
    getPassBtn.textContent = 'Get Pass';
    getPassBtn.setAttribute('aria-label', 'Get Studyria Pass');
    getPassBtn.addEventListener('click', function () {
      if (typeof navigate === 'function') navigate('premium');
    });
    actions.appendChild(getPassBtn);

    // Cart / Wishlist — relocate the existing wishlist icon button, restyle only
    var wishlistBtn = header.querySelector('.mh-icon-btn[onclick*="wishlist"]');
    if (wishlistBtn) {
      wishlistBtn.classList.add('hpr-cart-btn');
      var badge = document.createElement('span');
      badge.className = 'hpr-cart-badge';
      badge.id = 'hprCartBadge';
      wishlistBtn.appendChild(badge);
      actions.appendChild(wishlistBtn);
    }

    // Menu button — relocate the existing Control Center trigger (single remaining menu button)
    var menuBtn = document.querySelector('.mh-burger-btn');
    if (menuBtn) {
      menuBtn.classList.add('hpr-menu-btn');
      menuBtn.setAttribute('aria-label', 'Menu');
      menuBtn.setAttribute('title', 'Menu');
      actions.appendChild(menuBtn);
    }

    bar.appendChild(actions);
    header.insertBefore(bar, header.firstChild);

    // Hide the now-superseded left "navigation" burger trigger (function stays intact, just unused visually)
    var navBurgerWrap = document.getElementById('mhNavBurgerWrap');
    if (navBurgerWrap) navBurgerWrap.style.display = 'none';
  }

  /* ── 2. Merge the LEFT nav menu + RIGHT control-center menu ──── */
  function mergeDrawers() {
    var burgerMenu = document.getElementById('mhBurgerMenu');
    var navMenu = document.getElementById('mhNavMenu');
    if (!burgerMenu || document.querySelector('.hpr-drawer-search')) return;

    var scroll = burgerMenu.querySelector('.hm-scroll') || burgerMenu;

    // Close (X) button
    var closeBtn = document.createElement('button');
    closeBtn.className = 'hpr-drawer-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close menu');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function () {
      if (typeof window.mhCloseBurger === 'function') window.mhCloseBurger();
    });
    burgerMenu.appendChild(closeBtn);

    // Search row — reuses the existing mhOpenSearch() feature (scrolls + focuses the real search input)
    var searchRow = document.createElement('div');
    searchRow.className = 'hpr-drawer-search';
    searchRow.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<span>Search PDFs, exams, topics&hellip;</span>';
    searchRow.addEventListener('click', function () {
      if (typeof window.mhCloseBurger === 'function') window.mhCloseBurger();
      if (typeof window.mhOpenSearch === 'function') window.mhOpenSearch();
    });
    scroll.insertBefore(searchRow, scroll.firstChild);

    // "Navigate" label to match the merged section
    var navLabel = document.createElement('div');
    navLabel.className = 'hpr-drawer-section-label';
    navLabel.textContent = '🧭 Navigate';
    scroll.insertBefore(navLabel, searchRow.nextSibling);

    // Relocate the real nav items (Home / APSC / ADRE / Free Materials / etc.) — same nodes, same onclick handlers
    if (navMenu) {
      var navItems = Array.prototype.slice.call(navMenu.querySelectorAll('.hamburger-item'));
      var anchor = navLabel.nextSibling;
      navItems.forEach(function (item) {
        scroll.insertBefore(item, anchor);
      });
      // The old left-menu shell is now empty; hide it (still present, still functional if ever referenced)
      navMenu.style.display = 'none';
      var navBackdrop = document.getElementById('mhNavBackdrop');
      if (navBackdrop) navBackdrop.style.display = 'none';
    }

    // Sign In / Get Pass pair inside the drawer (per requested menu contents)
    var authRow = document.createElement('div');
    authRow.className = 'hpr-drawer-auth-row';

    var signinBtn = document.createElement('button');
    signinBtn.className = 'hpr-drawer-signin-btn';
    signinBtn.type = 'button';
    signinBtn.textContent = 'Sign In';
    signinBtn.addEventListener('click', function () {
      if (typeof window.mhCloseBurger === 'function') window.mhCloseBurger();
      if (typeof navigate === 'function') navigate('login');
    });

    var getpassBtn = document.createElement('button');
    getpassBtn.className = 'hpr-drawer-getpass-btn';
    getpassBtn.type = 'button';
    getpassBtn.textContent = 'Get Pass';
    getpassBtn.addEventListener('click', function () {
      if (typeof window.mhCloseBurger === 'function') window.mhCloseBurger();
      if (typeof navigate === 'function') navigate('premium');
    });

    authRow.appendChild(signinBtn);
    authRow.appendChild(getpassBtn);

    // Place the auth row right after the relocated nav items, before the existing "Control Center" section
    var controlCenterLabel = scroll.querySelector('div');
    // find the original "⚙️ Control Center" label (first div with that text) to insert before it
    var labels = scroll.querySelectorAll('div');
    var ccLabel = null;
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].textContent && labels[i].textContent.indexOf('Control Center') !== -1) { ccLabel = labels[i]; break; }
    }
    if (ccLabel) scroll.insertBefore(authRow, ccLabel);
    else scroll.appendChild(authRow);
  }

  /* ── 3. Right-side slide animation for the merged drawer ─────── */
  function wireDrawerAnimation() {
    var menu = document.getElementById('mhBurgerMenu');
    var backdrop = document.getElementById('mhBackdrop');
    if (!menu || !backdrop) return;

    window.mhToggleBurger = function (e) {
      if (e) e.stopPropagation();
      var isOpen = menu.classList.contains('hpr-open');
      if (isOpen) { window.mhCloseBurger(); return; }
      menu.style.display = 'block';
      backdrop.style.display = 'block';
      requestAnimationFrame(function () {
        menu.classList.add('hpr-open');
        backdrop.classList.add('hpr-open');
      });
      document.body.style.overflow = 'hidden';
    };

    window.mhCloseBurger = function () {
      menu.classList.remove('hpr-open');
      backdrop.classList.remove('hpr-open');
      setTimeout(function () {
        if (!menu.classList.contains('hpr-open')) menu.style.display = 'none';
        if (!backdrop.classList.contains('hpr-open')) backdrop.style.display = 'none';
      }, 320);
      document.body.style.overflow = '';
    };

    // Close on Android/back-button (popstate) without touching app routing/history
    window.addEventListener('popstate', function () {
      if (menu.classList.contains('hpr-open')) window.mhCloseBurger();
    });

    // Close on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('hpr-open')) window.mhCloseBurger();
    });
  }

  /* ── 4. Cart/Wishlist badge count (read-only, non-destructive) ── */
  function wireCartBadge() {
    var badge = document.getElementById('hprCartBadge');
    if (!badge) return;
    function refresh() {
      try {
        var count = (window.wishlist && window.wishlist.length) || 0;
        badge.textContent = count > 0 ? String(count) : '';
        badge.setAttribute('data-count', String(count));
      } catch (e) { /* no-op — never throw from a badge refresh */ }
    }
    refresh();
    // Re-check periodically; cheap and avoids hooking into wishlist internals
    setInterval(refresh, 2000);
  }

})();
