/* ═══════════════════════════════════════════════════════════════════
   STUDYRIA — PREMIUM MEMBERSHIP PHASE 2
   File: premium-p2.js
   Namespace: PP2 (window.PP2)
   Phase 1 file: premium-edit-pdf-styles.css / premium-p1.css (DO NOT TOUCH)
   Safety: zero Supabase, Razorpay, Auth, DB, global CSS changes
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── helpers ──────────────────────────────────────────────────── */
  function _nav(page) {
    if (typeof window.navigate === 'function') {
      window.navigate(page);
    } else {
      // Fallback: hash routing (SPA)
      window.location.hash = '#' + page;
    }
  }

  /* ── floating particles for the home banner ──────────────────── */
  function _createParticles(container, count) {
    if (!container) return;
    container.innerHTML = '';
    for (var i = 0; i < count; i++) {
      var p = document.createElement('span');
      p.className = 'pp2-particle';
      var size = Math.random() * 4 + 2;          // 2–6px
      var left = Math.random() * 100;             // % from left
      var delay = Math.random() * 6;              // 0–6s delay
      var dur   = Math.random() * 6 + 5;          // 5–11s duration
      var gold  = Math.random() > 0.5;
      p.style.cssText = [
        'width:' + size + 'px',
        'height:' + size + 'px',
        'left:' + left + '%',
        'bottom:10%',
        'animation-delay:' + delay + 's',
        'animation-duration:' + dur + 's',
        gold ? 'background:rgba(251,191,36,0.75)' : 'background:rgba(139,92,246,0.6)'
      ].join(';');
      container.appendChild(p);
    }
  }

  /* ── HOME BANNER HTML ─────────────────────────────────────────── */
  function _homeBannerHTML() {
    return '<section class="pp2-home-banner-section">'
      + '<div class="container">'
      + '  <div class="pp2-home-banner" id="pp2HomeBanner" role="button" tabindex="0"'
      + '       aria-label="Explore Premium Membership">'
      + '    <span class="pp2-particles" id="pp2HomeParticles"></span>'
      + '    <div class="pp2-hb-inner">'
      + '      <div class="pp2-hb-top">'
      + '        <div class="pp2-hb-badge">&#x2B50; PREMIUM</div>'
      + '        <span class="pp2-hb-crown" aria-hidden="true">\uD83D\uDC51</span>'
      + '      </div>'
      + '      <div class="pp2-hb-title">Unlock Unlimited Premium Notes</div>'
      + '      <div class="pp2-hb-sub">'
      + '        Unlimited Premium Handwritten Notes &middot; Ad-Free Reading &middot;'
      + '        Member Discounts &middot; Future Premium Features.'
      + '      </div>'
      + '      <div class="pp2-hb-chips">'
      + '        <span class="pp2-hb-chip"><span class="pp2-hb-chip-check">&#x2714;</span> Premium Notes</span>'
      + '        <span class="pp2-hb-chip"><span class="pp2-hb-chip-check">&#x2714;</span> Reading Room</span>'
      + '        <span class="pp2-hb-chip"><span class="pp2-hb-chip-check">&#x2714;</span> Ad-Free</span>'
      + '        <span class="pp2-hb-chip"><span class="pp2-hb-chip-check">&#x2714;</span> Continue Reading</span>'
      + '      </div>'
      + '      <div class="pp2-hb-btns">'
      + '        <button class="pp2-hb-btn-primary" id="pp2HBtnExplore" type="button">\uD83D\uDC51 Explore Premium</button>'
      + '        <button class="pp2-hb-btn-secondary" id="pp2HBtnLearn" type="button">Learn More</button>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      + '</div>'
      + '</section>';
  }

  /* ── ME TAB PANEL HTML ────────────────────────────────────────── */
  function _meTabHTML() {
    return '<div class="pp2-me-tab">'
      /* mini hero banner */
      + '  <div class="pp2-me-banner">'
      + '    <span class="pp2-me-banner-crown" aria-hidden="true">\uD83D\uDC51</span>'
      + '    <div class="pp2-me-banner-title">Studyria Premium</div>'
      + '    <div class="pp2-me-banner-sub">Get unlimited access to Premium Handwritten Notes, ad-free reading and more.</div>'
      + '  </div>'
      /* current plan card — Task 3 */
      + '  <div class="pp2-plan-card">'
      + '    <div class="pp2-plan-card-left">'
      + '      <span class="pp2-plan-badge">&#x25CF; Free Plan</span>'
      + '      <div class="pp2-plan-name">Free Account</div>'
      + '      <div class="pp2-plan-desc">Limited access &middot; Ads enabled</div>'
      + '    </div>'
      + '    <button class="pp2-plan-upgrade-btn" id="pp2PlanUpgradeBtn" type="button">Upgrade Now</button>'
      + '  </div>'
      /* benefits grid */
      + '  <div class="pp2-benefits-section">'
      + '    <div class="pp2-benefits-title">What you&rsquo;ll unlock</div>'
      + '    <div class="pp2-benefits-grid">'
      + '      <div class="pp2-benefit-card">'
      + '        <span class="pp2-benefit-icon" aria-hidden="true">\uD83D\uDCDD</span>'
      + '        <div><div class="pp2-benefit-name">Premium Notes</div><div class="pp2-benefit-desc">Unlimited handwritten notes &amp; guides</div></div>'
      + '      </div>'
      + '      <div class="pp2-benefit-card">'
      + '        <span class="pp2-benefit-icon" aria-hidden="true">\uD83D\uDCFA</span>'
      + '        <div><div class="pp2-benefit-name">Reading Room</div><div class="pp2-benefit-desc">Distraction-free reading experience</div></div>'
      + '      </div>'
      + '      <div class="pp2-benefit-card">'
      + '        <span class="pp2-benefit-icon" aria-hidden="true">\u26A1</span>'
      + '        <div><div class="pp2-benefit-name">Ad-Free</div><div class="pp2-benefit-desc">Clean, ad-free browsing everywhere</div></div>'
      + '      </div>'
      + '      <div class="pp2-benefit-card">'
      + '        <span class="pp2-benefit-icon" aria-hidden="true">\uD83D\uDD16</span>'
      + '        <div><div class="pp2-benefit-name">Continue Reading</div><div class="pp2-benefit-desc">Pick up exactly where you left off</div></div>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      /* feature chips */
      + '  <div class="pp2-chips-row">'
      + '    <span class="pp2-chip">\uD83D\uDC51 Premium Notes</span>'
      + '    <span class="pp2-chip">\uD83D\uDCFA Reading Room</span>'
      + '    <span class="pp2-chip">\u26A1 Ad-Free</span>'
      + '    <span class="pp2-chip">\uD83D\uDD16 Continue Reading</span>'
      + '    <span class="pp2-chip">\uD83C\uDF81 Member Discounts</span>'
      + '  </div>'
      /* CTA block — Task 4 */
      + '  <div class="pp2-cta-block">'
      + '    <div class="pp2-cta-title">Ready to go Premium?</div>'
      + '    <div class="pp2-cta-sub">Join students already studying smarter with Studyria Premium.</div>'
      + '    <button class="pp2-cta-btn" id="pp2MeExploreBtn" type="button">'
      + '      \uD83D\uDC51 Explore Premium'
      + '    </button>'
      + '  </div>'
      + '</div>';
  }

  /* ── INJECT HOME BANNER ───────────────────────────────────────── */
  function _injectHomeBanner() {
    // Find the Phase-1 banner section and replace it
    var oldBanner = document.querySelector('.prm-home-banner');
    if (!oldBanner) return;

    // Walk up to the <section> wrapper
    var section = oldBanner;
    while (section && section.tagName !== 'SECTION') {
      section = section.parentElement;
    }
    if (!section) return;

    // Guard: don't double-inject
    if (document.getElementById('pp2HomeBanner')) return;

    // Replace with the new banner
    var wrap = document.createElement('div');
    wrap.innerHTML = _homeBannerHTML();
    var newSection = wrap.firstElementChild;
    section.parentNode.replaceChild(newSection, section);

    // Wire events
    _wireHomeBanner();
  }

  function _wireHomeBanner() {
    // Whole banner click (keyboard + mouse)
    var banner = document.getElementById('pp2HomeBanner');
    if (banner) {
      banner.addEventListener('click', function (e) {
        // Prevent double-fire if a button inside was clicked
        if (e.target.closest('.pp2-hb-btn-primary, .pp2-hb-btn-secondary')) return;
        _nav('premium');
      });
      banner.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _nav('premium');
        }
      });
    }

    var btnExplore = document.getElementById('pp2HBtnExplore');
    if (btnExplore) {
      btnExplore.addEventListener('click', function (e) {
        e.stopPropagation();
        _nav('premium');
      });
    }

    var btnLearn = document.getElementById('pp2HBtnLearn');
    if (btnLearn) {
      btnLearn.addEventListener('click', function (e) {
        e.stopPropagation();
        _nav('premium');
      });
    }

    // Particles
    _createParticles(document.getElementById('pp2HomeParticles'), 18);
  }

  /* ── INJECT ME PAGE TAB BUTTON ────────────────────────────────── */
  function _injectMeTabButton() {
    var tabsContainer = document.querySelector('#page-dashboard .me-hero-tabs');
    if (!tabsContainer) return;

    // Guard: don't double-inject
    if (tabsContainer.querySelector('[data-tab="premium-membership"]')) return;

    // Insert after the Overview button (first .me-htab)
    var overviewBtn = tabsContainer.querySelector('.me-htab[data-tab="overview"]');
    if (!overviewBtn) return;

    var btn = document.createElement('button');
    btn.className = 'me-htab';
    btn.setAttribute('data-tab', 'premium-membership');
    btn.setAttribute('type', 'button');
    btn.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
      + '<path d="M2 4l3 12h14l3-12-6 4-4-8-4 8-6-4z"/>'
      + '</svg>'
      + ' \uD83D\uDC51 Premium';

    btn.addEventListener('click', function () {
      _switchToPremiumTab();
    });

    overviewBtn.after(btn);
  }

  /* ── SWITCH TO PREMIUM TAB ────────────────────────────────────── */
  function _switchToPremiumTab() {
    var tabsContainer = document.querySelector('#page-dashboard .me-hero-tabs');
    if (!tabsContainer) return;

    // Deactivate all tabs
    tabsContainer.querySelectorAll('.me-htab[data-tab]').forEach(function (b) {
      b.classList.remove('active');
    });

    // Activate our tab button
    var btn = tabsContainer.querySelector('[data-tab="premium-membership"]');
    if (btn) btn.classList.add('active');

    // Render premium tab content
    var main = document.getElementById('dashMain');
    if (!main) return;

    main.innerHTML = '<div class="me-tab-panel">' + _meTabHTML() + '</div>';

    // Wire CTA buttons inside the tab
    var exploreBtn = document.getElementById('pp2MeExploreBtn');
    if (exploreBtn) {
      exploreBtn.addEventListener('click', function () {
        _nav('premium');
      });
    }
    var upgradeBtn = document.getElementById('pp2PlanUpgradeBtn');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', function () {
        _nav('premium');
      });
    }
  }

  /* ── PATCH switchMeTab TO HANDLE PREMIUM-MEMBERSHIP ──────────── */
  function _patchSwitchMeTab() {
    var original = window.switchMeTab;
    if (typeof original !== 'function') return;

    window.switchMeTab = async function (tab) {
      if (tab === 'premium-membership') {
        _switchToPremiumTab();
        return;
      }
      return original.apply(this, arguments);
    };
  }

  /* ── MAIN INIT ────────────────────────────────────────────────── */
  function _init() {
    _injectHomeBanner();

    // Me page: inject tab + patch switchMeTab
    _injectMeTabButton();
    _patchSwitchMeTab();

    // If home page re-renders (SPA navigate back), re-inject the banner
    var _origRenderHome = window.renderHome;
    if (typeof _origRenderHome === 'function') {
      window.renderHome = function () {
        _origRenderHome.apply(this, arguments);
        // Give the render a tick to complete
        setTimeout(_injectHomeBanner, 50);
      };
    }

    // If the Me page is navigated to, re-inject the tab button (SPA)
    var _origNavigate = window._realNavigate || window.navigate;
    // We'll hook into the navigate function to re-inject the me tab on arrival
    // Using MutationObserver on #page-dashboard activation is more robust
    var dashPage = document.getElementById('page-dashboard');
    if (dashPage) {
      var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          if (m.type === 'attributes' && m.attributeName === 'class') {
            if (dashPage.classList.contains('active')) {
              setTimeout(_injectMeTabButton, 80);
            }
          }
        });
      });
      observer.observe(dashPage, { attributes: true });
    }
  }

  /* ── BOOT ─────────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // Expose for debugging
  window.PP2 = { init: _init, nav: _nav, meTabHTML: _meTabHTML };

})();
