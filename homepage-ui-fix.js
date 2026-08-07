/* ═══════════════════════════════════════════════════════════════
   STUDYRIA — HOMEPAGE UI FIX JS
   Adds hui- classes to existing elements + menu overlay logic
   Does NOT modify any existing logic, IDs, or functionality
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function huiInit() {
    // ── 1. HEADER — add hui-nav class to existing nav ──
    var nav = document.querySelector('nav.nav');
    if (nav && !nav.classList.contains('hui-nav')) {
      nav.classList.add('hui-nav');
    }

    // ── 2. HERO — add hui-hero class to existing hero ──
    var hero = document.getElementById('dynamicHero');
    if (hero && !hero.classList.contains('hui-hero')) {
      hero.classList.add('hui-hero');
    }

    // ── 3. HAMBURGER MENU — full height panel + overlay ──
    var hamburgerMenu = document.getElementById('hamburgerMenu');
    if (hamburgerMenu && !hamburgerMenu.dataset.huiInit) {
      hamburgerMenu.dataset.huiInit = '1';

      // Create overlay element
      var overlay = document.createElement('div');
      overlay.className = 'hui-menu-overlay';
      overlay.id = 'huiMenuOverlay';
      document.body.appendChild(overlay);

      // Create close button inside the menu
      var closeBtn = document.createElement('button');
      closeBtn.className = 'hui-menu-close';
      closeBtn.innerHTML = '✕';
      closeBtn.setAttribute('aria-label', 'Close menu');
      closeBtn.id = 'huiMenuClose';
      hamburgerMenu.insertBefore(closeBtn, hamburgerMenu.firstChild);

      // Close function
      function huiCloseMenu() {
        if (window._alpine) {
          window._alpine.sidebarOpen = false;
        }
        var menuEl = document.getElementById('hamburgerMenu');
        if (menuEl && menuEl.__x) {
          menuEl.__x.$data.sidebarOpen = false;
        }
        overlay.classList.remove('hui-menu-open');
      }

      // Close on overlay tap
      overlay.addEventListener('click', huiCloseMenu);

      // Close on close button
      closeBtn.addEventListener('click', huiCloseMenu);

      // Close on back button
      window.addEventListener('popstate', function (e) {
        if (overlay.classList.contains('hui-menu-open')) {
          huiCloseMenu();
          // Don't actually go back — just close the menu
          if (e.state) {
            history.forward();
          }
        }
      });

      // Watch for menu open state via MutationObserver on style attribute
      var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mut) {
          if (mut.attributeName === 'style' || mut.attributeName === 'class') {
            var isOpen = hamburgerMenu.style.display !== 'none' &&
              (hamburgerMenu.getAttribute('x-show') !== 'false');
            // Check Alpine state more reliably
            var alpineOpen = false;
            if (window._alpine && window._alpine.sidebarOpen) {
              alpineOpen = true;
            }
            if (hamburgerMenu.__x && hamburgerMenu.__x.$data.sidebarOpen) {
              alpineOpen = true;
            }
            // Check computed visibility
            var computed = window.getComputedStyle(hamburgerMenu);
            var isVisible = computed.display !== 'none';

            if (alpineOpen || isVisible) {
              overlay.classList.add('hui-menu-open');
              // Push history state for back button support
              if (!window.huiMenuPushed) {
                window.huiMenuPushed = true;
                history.pushState({ huiMenu: true }, '');
              }
            } else {
              overlay.classList.remove('hui-menu-open');
              if (window.huiMenuPushed) {
                window.huiMenuPushed = false;
              }
            }
          }
        });
      });
      observer.observe(hamburgerMenu, { attributes: true });

      // Also intercept the hamburger button to manage overlay
      var hamburgerBtn = document.getElementById('hamburgerBtn');
      if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', function () {
          // Toggle overlay based on new state after Alpine processes it
          setTimeout(function () {
            var alpineOpen = false;
            if (window._alpine && window._alpine.sidebarOpen) {
              alpineOpen = true;
            }
            if (hamburgerMenu.__x && hamburgerMenu.__x.$data.sidebarOpen) {
              alpineOpen = true;
            }
            if (alpineOpen) {
              overlay.classList.add('hui-menu-open');
              if (!window.huiMenuPushed) {
                window.huiMenuPushed = true;
                history.pushState({ huiMenu: true }, '');
              }
            } else {
              overlay.classList.remove('hui-menu-open');
              if (window.huiMenuPushed) {
                window.huiMenuPushed = false;
              }
            }
          }, 50);
        }, true);
      }
    }

    // ── 4. BOTTOM NAV — add hui-bottom-nav class ──
    var bottomNav = document.querySelector('.mobile-nav-bar');
    if (bottomNav && !bottomNav.classList.contains('hui-bottom-nav')) {
      bottomNav.classList.add('hui-bottom-nav');
    }

    // ── 5. SECTIONS — add hui-section class to row sections ──
    var sections = document.querySelectorAll('.sh-row-section');
    sections.forEach(function (s) {
      if (!s.classList.contains('hui-section')) {
        s.classList.add('hui-section');
      }
    });
  }

  // Run on DOMContentLoaded or immediately if already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', huiInit);
  } else {
    huiInit();
  }

  // Also re-run on SPA navigation back to home
  var origNavigate = window.navigate;
  if (origNavigate && !window._huiNavigateHooked) {
    window._huiNavigateHooked = true;
    window.navigate = function () {
      var result = origNavigate.apply(this, arguments);
      setTimeout(huiInit, 200);
      return result;
    };
  }

  // Re-run after dynamic content loads
  setTimeout(huiInit, 500);
  setTimeout(huiInit, 1500);
})();
