/* ═══════════════════════════════════════════════════════════════════
   STUDYRIA — PREMIUM EXPERIENCE PHASE 3
   File     : premium-p3.js
   Namespace: window.PP3
   Branch   : feat/premium-membership-phase-3

   SAFETY RULES (enforced):
   ✅  UI ONLY — zero Supabase, Razorpay, Auth, DB changes
   ✅  All selectors namespaced: .prm-p3-*  (CSS) / PP3 (JS)
   ✅  Never touches: PDF Reader, Checkout, Wishlist logic,
       Login, Auth, Admin, Dashboard logic, Existing Library logic,
       Search, Career Hub, Routes, API, Existing JS
   ✅  Every button only calls navigate() or does nothing
   ✅  Reads window.PDFS (already populated by main app) — read-only
   ══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────
     SECTION 0 — Utilities
  ──────────────────────────────────────────────────────────────────*/

  /** Safe navigation — uses the app's own navigate() or hash fallback */
  function _nav(page, param) {
    try {
      // If the target page element doesn't exist in this build (e.g. premium-library
      // was added in a later phase), fall back to the premium landing page.
      var safePage = page;
      if (page !== 'home' && page !== 'library' && page !== 'premium'
          && page !== 'dashboard' && page !== 'login' && page !== 'register') {
        if (!document.getElementById('page-' + page)) {
          safePage = 'premium';
        }
      }
      if (param && typeof window.navigate === 'function') {
        window.navigate(safePage, param);
      } else if (typeof window.navigate === 'function') {
        window.navigate(safePage);
      } else {
        window.location.hash = '#' + safePage;
      }
    } catch (_) {}
  }

  /** Floating particles inside a container element */
  function _spawnParticles(container, count) {
    if (!container) return;
    for (var i = 0; i < count; i++) {
      var p = document.createElement('span');
      p.className = 'prm-p3-particle';
      var size  = Math.random() * 4 + 2;
      var left  = Math.random() * 100;
      var delay = Math.random() * 8;
      var dur   = Math.random() * 7 + 6;
      var gold  = Math.random() > 0.45;
      p.style.cssText = [
        'width:'             + size + 'px',
        'height:'            + size + 'px',
        'left:'              + left + '%',
        'bottom:5%',
        'animation-delay:'   + delay + 's',
        'animation-duration:'+ dur   + 's',
        gold
          ? 'background:rgba(251,191,36,0.70)'
          : 'background:rgba(139,92,246,0.55)'
      ].join(';');
      container.appendChild(p);
    }
  }

  /** Read PDFS from window.PDFS (populated by main app) — never mutates */
  function _getPDFs() {
    return Array.isArray(window.PDFS) ? window.PDFS : [];
  }

  /** Filter to only "premium" tagged PDFs (is_premium or tags includes premium) */
  function _premiumPDFs() {
    return _getPDFs().filter(function (p) {
      return (
        p.is_premium === true ||
        p.is_premium === 'true' ||
        p.is_premium === 1 ||
        (Array.isArray(p.tags) && p.tags.some(function (t) {
          return String(t).toLowerCase().indexOf('premium') !== -1;
        })) ||
        String(p.tier || '').toLowerCase() === 'premium'
      );
    });
  }

  /** Return top-N PDFs for a given tab type */
  function _getPDFsForTab(tab, count) {
    var pdfs = _getPDFs();
    count = count || 8;

    switch (tab) {
      case 'featured':
        // Featured PDFs or fall back to most recent
        var feat = pdfs.filter(function (p) { return p.featured || p.is_featured; });
        return (feat.length >= 3 ? feat : pdfs.slice(0, count)).slice(0, count);

      case 'new':
        // Sort by created_at desc
        return pdfs.slice().sort(function (a, b) {
          return (new Date(b.created_at || b.createdAt || 0)) -
                 (new Date(a.created_at || a.createdAt || 0));
        }).slice(0, count);

      case 'editors':
        // Editors choice: PDFs with editor_pick flag or highest rating
        var ed = pdfs.filter(function (p) { return p.editor_pick || p.editors_choice; });
        if (ed.length >= 3) return ed.slice(0, count);
        // fallback: high download count
        return pdfs.slice().sort(function (a, b) {
          return (b.downloads || b.download_count || 0) -
                 (a.downloads || a.download_count || 0);
        }).slice(0, count);

      case 'collection':
        // Premium collection
        var prem = _premiumPDFs();
        return (prem.length >= 3 ? prem : pdfs.slice(0, count)).slice(0, count);

      case 'picks':
      default:
        // Crown Picks: sort by views or downloads
        return pdfs.slice().sort(function (a, b) {
          return (b.views || b.view_count || b.downloads || 0) -
                 (a.views || a.view_count || a.downloads || 0);
        }).slice(0, count);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 1 — PremiumBadge (standalone JS helper)
     Creates a DOM element for PremiumBadge — can be used programmatically
  ──────────────────────────────────────────────────────────────────*/

  function createBadge(text, variant) {
    var el = document.createElement('span');
    el.className = 'prm-p3-badge' +
      (variant ? ' prm-p3-badge--' + variant : '');
    el.textContent = text || '\uD83D\uDC51 PREMIUM';
    return el;
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 2 — PremiumPreviewCard HTML builder
  ──────────────────────────────────────────────────────────────────*/

  function _previewCardHTML() {
    return [
      '<div class="prm-p3-preview-card">',
      '  <span class="prm-p3-pc-crown" aria-hidden="true">\uD83D\uDC51</span>',
      '  <div class="prm-p3-pc-title">Studyria Premium</div>',
      '  <div class="prm-p3-pc-sub">Unlock the full Studyria Premium experience.</div>',
      '  <ul class="prm-p3-pc-benefits">',
      '    <li class="prm-p3-pc-benefit">',
      '      <span class="prm-p3-pc-benefit-icon" aria-hidden="true">\uD83D\uDCDD</span>',
      '      <span>Unlimited Premium Notes</span>',
      '    </li>',
      '    <li class="prm-p3-pc-benefit">',
      '      <span class="prm-p3-pc-benefit-icon" aria-hidden="true">\uD83D\uDCFA</span>',
      '      <span>Reading Room Access</span>',
      '    </li>',
      '    <li class="prm-p3-pc-benefit">',
      '      <span class="prm-p3-pc-benefit-icon" aria-hidden="true">\u26A1</span>',
      '      <span>Ad-Free Experience</span>',
      '    </li>',
      '    <li class="prm-p3-pc-benefit">',
      '      <span class="prm-p3-pc-benefit-icon" aria-hidden="true">\uD83C\uDF81</span>',
      '      <span>Member Discounts</span>',
      '    </li>',
      '    <li class="prm-p3-pc-benefit">',
      '      <span class="prm-p3-pc-benefit-icon" aria-hidden="true">\uD83D\uDD16</span>',
      '      <span>Continue Reading</span>',
      '    </li>',
      '  </ul>',
      '  <div class="prm-p3-pc-btns">',
      '    <button class="prm-p3-pc-btn-primary" data-p3-nav="premium" type="button">',
      '      \uD83D\uDC51 Explore Premium',
      '    </button>',
      '    <button class="prm-p3-pc-btn-secondary" data-p3-nav="library" type="button">',
      '      \uD83D\uDCDA Buy Individually',
      '    </button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 3 — Showcase Card HTML builder
  ──────────────────────────────────────────────────────────────────*/

  function _showcaseCardHTML(pdf) {
    if (!pdf) return '';

    var id      = pdf.id || '';
    var title   = pdf.title || 'Premium Study Notes';
    var cover   = pdf.cover_url || pdf.coverImage || pdf.cover_image || pdf.thumbnail || '';
    var subject = pdf.subject || pdf.category || '';
    var isPrem  = pdf.is_premium || pdf.is_premium === 'true';

    var coverHTML = cover
      ? '<img class="prm-p3-sc-cover" src="' + _escAttr(cover) + '" alt="' + _escAttr(title) + '" loading="lazy">'
      : '<div class="prm-p3-sc-cover-placeholder" aria-hidden="true">\uD83D\uDCDA</div>';

    var badgeHTML = isPrem
      ? '<span class="prm-p3-badge prm-p3-badge--sm">\uD83D\uDC51 Premium</span>'
      : '<span class="prm-p3-badge prm-p3-badge--blue prm-p3-badge--sm">Free</span>';

    return [
      '<div class="prm-p3-showcase-card" data-p3-pdf="' + _escAttr(id) + '" role="button" tabindex="0"',
      '     aria-label="' + _escAttr(title) + '">',
      coverHTML,
      '  <div class="prm-p3-sc-body">',
      '    <div class="prm-p3-sc-badge-row">',
      '      ' + badgeHTML,
      '    </div>',
      '    <div class="prm-p3-sc-title">' + _escHTML(title) + '</div>',
      '    <div class="prm-p3-sc-meta">' + _escHTML(subject) + '</div>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 4 — Home Premium Showcase Section HTML
  ──────────────────────────────────────────────────────────────────*/

  function _showcaseSectionHTML(initialTab) {
    initialTab = initialTab || 'picks';
    var tabs = [
      { id: 'picks',      label: '\uD83D\uDC51 Premium Picks'         },
      { id: 'featured',   label: '\u2728 Featured Notes'              },
      { id: 'new',        label: '\uD83D\uDD25 New Releases'          },
      { id: 'editors',    label: '\u2B50 Editor\'s Choice'            },
      { id: 'collection', label: '\uD83D\uDC8E Collection'            }
    ];

    var tabsHTML = tabs.map(function (t) {
      var active = t.id === initialTab ? ' active' : '';
      return '<button class="prm-p3-tab' + active + '" data-p3-tab="' + t.id + '" type="button">'
        + t.label + '</button>';
    }).join('\n        ');

    return [
      '<section class="prm-p3-showcase-section" id="prm-p3-showcase-section" aria-label="Premium Content Showcase">',
      '  <span class="prm-p3-particles" id="prm-p3-particles" aria-hidden="true"></span>',
      '  <div class="container">',
      '',
      '    <!-- Section header -->',
      '    <div class="prm-p3-section-head">',
      '      <div class="prm-p3-section-label">',
      '        <span class="prm-p3-section-icon" aria-hidden="true">\uD83D\uDC51</span>',
      '        <div>',
      '          <div class="prm-p3-section-title">Premium Content</div>',
      '          <div class="prm-p3-section-subtitle">Handcrafted for Assam Exams</div>',
      '        </div>',
      '      </div>',
      '      <button class="prm-p3-section-see-all" data-p3-nav="premium" type="button">',
      '        Explore All \u2192',
      '      </button>',
      '    </div>',
      '',
      '    <hr class="prm-p3-divider" aria-hidden="true">',
      '',
      '    <!-- Tab row -->',
      '    <div class="prm-p3-tabs" role="tablist" aria-label="Premium categories">',
      '      ' + tabsHTML,
      '    </div>',
      '',
      '    <!-- Scroll track -->',
      '    <div class="prm-p3-scroll-track" id="prm-p3-track" role="list">',
      '    </div>',
      '',
      '    <!-- See All row -->',
      '    <div class="prm-p3-see-all-row">',
      '      <button class="prm-p3-section-see-all" data-p3-nav="premium-library" type="button">',
      '        View Full Library \u2192',
      '      </button>',
      '    </div>',
      '',
      '    <!-- Preview Card (Premium CTA) -->',
      '    <div style="margin-top:18px">',
      _previewCardHTML(),
      '    </div>',
      '',
      '  </div>',
      '</section>'
    ].join('\n');
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 5 — Render cards in scroll track
  ──────────────────────────────────────────────────────────────────*/

  function _renderTrack(tab) {
    var track = document.getElementById('prm-p3-track');
    if (!track) return;

    var pdfs = _getPDFsForTab(tab, 10);

    if (!pdfs || pdfs.length === 0) {
      track.innerHTML = [
        '<div class="prm-p3-empty">',
        '  <span class="prm-p3-empty-icon" aria-hidden="true">\uD83D\uDCDC</span>',
        '  <span>Premium notes coming soon</span>',
        '</div>'
      ].join('');
      return;
    }

    track.innerHTML = pdfs.map(function (pdf) {
      return _showcaseCardHTML(pdf);
    }).join('');

    // Wire card click events
    var cards = track.querySelectorAll('.prm-p3-showcase-card');
    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        var pdfId = card.getAttribute('data-p3-pdf');
        if (pdfId) {
          _nav('pdf-detail', pdfId);
        }
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 6 — Wire tab switching
  ──────────────────────────────────────────────────────────────────*/

  function _wireTabs(section) {
    if (!section) return;
    var tabs = section.querySelectorAll('.prm-p3-tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        _renderTrack(tab.getAttribute('data-p3-tab') || 'picks');
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 7 — Wire global data-p3-nav buttons
  ──────────────────────────────────────────────────────────────────*/

  function _wireNavBtns(root) {
    var btns = (root || document).querySelectorAll('[data-p3-nav]');
    btns.forEach(function (btn) {
      if (btn._p3Wired) return;
      btn._p3Wired = true;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        _nav(btn.getAttribute('data-p3-nav'));
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 8 — Inject Premium Showcase into Home page
     Inserts AFTER the Phase-2 home banner (pp2-home-banner-section
     or the Phase-1 prm-home-banner section), BEFORE .sh-why-section
  ──────────────────────────────────────────────────────────────────*/

  function _injectShowcase() {
    // Guard: already injected
    if (document.getElementById('prm-p3-showcase-section')) return;

    // Preferred: inject after Phase-2 banner
    var afterEl =
      document.getElementById('pp2HomeBanner') ||
      document.querySelector('.pp2-home-banner-section') ||
      document.querySelector('.prm-home-banner');

    if (afterEl) {
      // Walk up to the nearest <section> wrapper
      var section = afterEl;
      while (section && section.tagName !== 'SECTION') {
        section = section.parentElement;
      }
      afterEl = section || afterEl;
    }

    // Fallback: inject before .sh-why-section
    if (!afterEl) {
      afterEl = document.querySelector('.sh-why-section');
      if (afterEl) {
        var wrap = document.createElement('div');
        wrap.innerHTML = _showcaseSectionHTML('picks');
        afterEl.parentNode.insertBefore(wrap.firstElementChild, afterEl);
        _onShowcaseReady();
        return;
      }
    }

    // Default fallback: append to #page-home
    var pageHome = document.getElementById('page-home');
    if (!pageHome && !afterEl) return;

    var wrap = document.createElement('div');
    wrap.innerHTML = _showcaseSectionHTML('picks');
    var newSection = wrap.firstElementChild;

    if (afterEl && afterEl.nextSibling) {
      afterEl.parentNode.insertBefore(newSection, afterEl.nextSibling);
    } else if (pageHome) {
      pageHome.appendChild(newSection);
    }

    _onShowcaseReady();
  }

  function _onShowcaseReady() {
    var sec = document.getElementById('prm-p3-showcase-section');
    if (!sec) return;

    // Particles
    _spawnParticles(document.getElementById('prm-p3-particles'), 16);

    // Initial render of first tab
    _renderTrack('picks');

    // Wire tabs
    _wireTabs(sec);

    // Wire nav buttons inside section
    _wireNavBtns(sec);

    // Animate section in
    sec.style.opacity = '0';
    sec.style.transform = 'translateY(20px)';
    sec.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        sec.style.opacity = '';
        sec.style.transform = '';
        sec.style.transition = '';
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 9 — Inject member badge into Me/Dashboard page
     Only UI — reads no Supabase data, uses placeholder only
  ──────────────────────────────────────────────────────────────────*/

  function _injectMemberBadge() {
    // Guard: already injected
    if (document.getElementById('prm-p3-member-badge')) return;

    // Target the PP2 plan card's badge area, or the me-hero area
    var planBadge = document.querySelector('.pp2-plan-badge');
    if (planBadge && !planBadge.querySelector('.prm-p3-member-badge')) {
      var badge = document.createElement('span');
      badge.id = 'prm-p3-member-badge';
      badge.className = 'prm-p3-member-badge prm-p3-member-badge--free';
      badge.setAttribute('aria-label', 'Free Member');
      badge.innerHTML = [
        '<span class="prm-p3-member-badge-dot" aria-hidden="true"></span>',
        'Free Member'
      ].join('');
      planBadge.appendChild(badge);
      return;
    }

    // Fallback: inject into me-hero tabs area
    var meHero = document.querySelector('#page-dashboard .me-hero-inner, #page-dashboard .me-hero');
    if (meHero) {
      var badge2 = document.createElement('div');
      badge2.id = 'prm-p3-member-badge';
      badge2.style.cssText = 'padding:8px 0 4px;';
      badge2.innerHTML = [
        '<span class="prm-p3-member-badge prm-p3-member-badge--free" aria-label="Free Member">',
        '  <span class="prm-p3-member-badge-dot" aria-hidden="true"></span>',
        '  Free Member',
        '</span>'
      ].join('');
      meHero.appendChild(badge2);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 10 — Observe page navigation events
     Listen for SPA navigate events to inject on correct page
  ──────────────────────────────────────────────────────────────────*/

  function _onPageVisible(pageId) {
    if (pageId === 'home') {
      // Wait a tick for PP2 to finish its own injection
      setTimeout(function () {
        _injectShowcase();
        _wireNavBtns();
      }, 120);
    }

    if (pageId === 'dashboard' || pageId === 'me') {
      setTimeout(function () {
        _injectMemberBadge();
        _wireNavBtns();
      }, 200);
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 11 — Intersection Observer: lazy-animate showcase cards
  ──────────────────────────────────────────────────────────────────*/

  function _observeCards() {
    if (!('IntersectionObserver' in window)) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'none';
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    // Observe all showcase cards (runs after render)
    function _observe() {
      document.querySelectorAll('.prm-p3-showcase-card').forEach(function (card) {
        if (card._p3Observed) return;
        card._p3Observed = true;
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        io.observe(card);
      });
    }

    // Re-run whenever track content changes (tab switch)
    var track = document.getElementById('prm-p3-track');
    if (track && 'MutationObserver' in window) {
      var mo = new MutationObserver(_observe);
      mo.observe(track, { childList: true });
    }

    _observe();
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 12 — BOOT
  ──────────────────────────────────────────────────────────────────*/

  function _boot() {
    // Listen for SPA page-change custom events (fired by main app)
    document.addEventListener('studyria:navigate', function (e) {
      if (e && e.detail && e.detail.page) {
        _onPageVisible(e.detail.page);
      }
    });

    // Also listen for hashchange
    window.addEventListener('hashchange', function () {
      var hash = (window.location.hash || '').replace('#', '').toLowerCase();
      _onPageVisible(hash || 'home');
    });

    // Also intercept the app's navigate() wrapper to detect page changes
    var _origNavigate = window.navigate;
    if (typeof _origNavigate === 'function') {
      window.navigate = function (page, param) {
        _origNavigate.call(this, page, param);
        _onPageVisible(String(page || '').toLowerCase());
      };
    }

    // Initial page injection based on currently active page
    var activePage = document.querySelector('.page.active');
    if (activePage) {
      var activeId = activePage.id || '';
      _onPageVisible(activeId.replace('page-', ''));
    } else {
      // Default: assume home
      setTimeout(function () {
        _injectShowcase();
        _wireNavBtns();
      }, 300);
    }

    // Wire all nav buttons that are already in the DOM
    _wireNavBtns();

    // Start intersection observer for lazy card animations
    setTimeout(_observeCards, 500);

    // Listen for PDFS ready event (fired by main app after Supabase fetch)
    document.addEventListener('studyria:pdfs-ready', function () {
      var track = document.getElementById('prm-p3-track');
      var activeTab = document.querySelector('.prm-p3-tab.active');
      if (track && activeTab) {
        _renderTrack(activeTab.getAttribute('data-p3-tab') || 'picks');
        _observeCards();
      }
    });

    // Expose public API
    window.PP3 = {
      createBadge: createBadge,
      renderTrack: _renderTrack,
      refreshShowcase: function () {
        var activeTab = document.querySelector('.prm-p3-tab.active');
        _renderTrack(activeTab ? activeTab.getAttribute('data-p3-tab') : 'picks');
        _observeCards();
      },
      injectShowcase: _injectShowcase,
      injectMemberBadge: _injectMemberBadge
    };
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 13 — HTML escape helpers (no XSS)
  ──────────────────────────────────────────────────────────────────*/

  function _escHTML(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _escAttr(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ── Entry point ─────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

})();
