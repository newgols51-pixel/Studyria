/**
 * ═══════════════════════════════════════════════════════════════════
 * premium-dashboard.js — Studyria Premium Dashboard Sections
 * Namespace: window.PRMDASH
 *
 * Renders the 4 dynamic sections on the Premium Dashboard page:
 *   3. 📚 Premium Library Universe (preview shelf)
 *   4. Continue Reading
 *   5. Recently Added Premium Notes
 *   6. My Premium Cards
 *
 * SAFETY CONTRACT:
 *   ✅ Uses SMCI (window.SMCI) as the SINGLE shared Premium Loader
 *   ✅ Never creates duplicate Premium lists or filtering logic
 *   ✅ Loads ONLY PDFs where category === "Premium Handwritten Notes"
 *   ✅ Never touches: Razorpay, Purchases, Public Library, Reading Room
 *   ✅ Reuses existing: Routing, Membership Service, SMCI Loader
 *   ✅ All functions under window.PRMDASH namespace
 *   ✅ Conditional UI: shows/hides sections based on premium status
 *
 * @version 1.0
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  if (window.PRMDASH && window.PRMDASH._version === '1.0') return;

  var PRMDASH = {};
  window.PRMDASH = PRMDASH;
  PRMDASH._version = '1.0';

  /* ── Utilities ─────────────────────────────────────────────────── */
  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _sb() { return window.supabaseClient || null; }
  function _user() { return window.currentUser || null; }
  function _uid() { var u = _user(); return u ? (u.uid || u.id || null) : null; }

  function _log(m, d) {
    if (d !== undefined) console.debug('[PRMDASH]', m, d);
    else console.debug('[PRMDASH]', m);
  }

  /* ── CSS injection (once) ───────────────────────────────────────── */
  function _injectCSS() {
    if (document.getElementById('prmdash-css')) return;
    var s = document.createElement('style');
    s.id = 'prmdash-css';
    s.textContent = [
      '/* Premium Dashboard Sections — glassmorphism, responsive, dark-mode compatible */',
      '',
      '.prmdash-section {',
      '  padding: 24px 16px;',
      '  max-width: 1100px;',
      '  margin: 0 auto;',
      '}',
      '',
      '.prmdash-head {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  margin-bottom: 14px;',
      '  padding: 0 2px;',
      '}',
      '',
      '.prmdash-title {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  font-size: .92rem;',
      '  font-weight: 700;',
      '  color: var(--text1, #f0f4f8);',
      '}',
      '',
      '.prmdash-title-icon { font-size: 1.15rem; }',
      '',
      '.prmdash-sub {',
      '  font-size: .72rem;',
      '  color: var(--text3, rgba(255,255,255,0.35));',
      '  font-weight: 400;',
      '  margin-left: 4px;',
      '}',
      '',
      '.prmdash-viewall {',
      '  background: linear-gradient(135deg, rgba(251,191,36,0.15), rgba(245,158,11,0.1));',
      '  border: 1px solid rgba(251,191,36,0.3);',
      '  color: #fbbf24;',
      '  font-size: .74rem;',
      '  font-weight: 700;',
      '  padding: 6px 14px;',
      '  border-radius: 20px;',
      '  cursor: pointer;',
      '  white-space: nowrap;',
      '  transition: all .2s;',
      '}',
      '.prmdash-viewall:hover {',
      '  background: linear-gradient(135deg, #fbbf24, #f59e0b);',
      '  color: #000;',
      '}',
      '',
      '/* Horizontal scroll shelf */',
      '.prmdash-shelf-outer {',
      '  overflow-x: auto;',
      '  overflow-y: hidden;',
      '  -webkit-overflow-scrolling: touch;',
      '  scrollbar-width: none;',
      '  cursor: grab;',
      '  user-select: none;',
      '}',
      '.prmdash-shelf-outer::-webkit-scrollbar { display: none; }',
      '.prmdash-shelf-track {',
      '  display: flex;',
      '  gap: 12px;',
      '  padding-bottom: 8px;',
      '  width: max-content;',
      '}',
      '',
      '/* Premium card — glassmorphism */',
      '.prmdash-card {',
      '  flex: 0 0 150px;',
      '  width: 150px;',
      '  border-radius: 12px;',
      '  background: rgba(255,255,255,0.04);',
      '  border: 1px solid rgba(255,255,255,0.08);',
      '  overflow: hidden;',
      '  cursor: pointer;',
      '  transition: transform .15s, box-shadow .15s, border-color .15s;',
      '  position: relative;',
      '}',
      'body.light .prmdash-card {',
      '  background: rgba(255,255,255,0.6);',
      '  border-color: rgba(0,0,0,0.08);',
      '}',
      '.prmdash-card:hover {',
      '  transform: translateY(-3px);',
      '  box-shadow: 0 8px 24px rgba(0,0,0,0.3);',
      '  border-color: rgba(251,191,36,0.3);',
      '}',
      '.prmdash-card-cover {',
      '  position: relative;',
      '  height: 120px;',
      '  overflow: hidden;',
      '}',
      '.prmdash-card-cover img {',
      '  width: 100%;',
      '  height: 100%;',
      '  object-fit: cover;',
      '}',
      '.prmdash-card-cover-ph {',
      '  width: 100%;',
      '  height: 100%;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  font-size: 2rem;',
      '  background: linear-gradient(135deg, rgba(61,142,248,0.1), rgba(139,92,246,0.1));',
      '}',
      '.prmdash-card-badge {',
      '  position: absolute;',
      '  top: 6px;',
      '  right: 6px;',
      '  background: linear-gradient(135deg, #fbbf24, #f59e0b);',
      '  color: #000;',
      '  font-size: .55rem;',
      '  font-weight: 800;',
      '  padding: 2px 7px;',
      '  border-radius: 10px;',
      '}',
      '.prmdash-card-body { padding: 8px 10px; }',
      '.prmdash-card-title {',
      '  font-size: .74rem;',
      '  font-weight: 600;',
      '  color: var(--text1, #f0f4f8);',
      '  line-height: 1.3;',
      '  margin-bottom: 4px;',
      '  display: -webkit-box;',
      '  -webkit-line-clamp: 2;',
      '  -webkit-box-orient: vertical;',
      '  overflow: hidden;',
      '}',
      '.prmdash-card-meta {',
      '  font-size: .62rem;',
      '  color: var(--text2, rgba(255,255,255,0.5));',
      '}',
      '.prmdash-card-btn {',
      '  width: 100%;',
      '  padding: 5px;',
      '  border-radius: 6px;',
      '  border: 1px solid rgba(251,191,36,0.25);',
      '  background: linear-gradient(135deg, rgba(251,191,36,0.15), rgba(245,158,11,0.1));',
      '  color: #fbbf24;',
      '  font-size: .68rem;',
      '  font-weight: 700;',
      '  cursor: pointer;',
      '  margin-top: 5px;',
      '}',
      '.prmdash-card-btn:hover {',
      '  background: linear-gradient(135deg, #fbbf24, #f59e0b);',
      '  color: #000;',
      '}',
      '',
      '/* Grid view (My Premium Cards) */',
      '.prmdash-grid {',
      '  display: grid;',
      '  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));',
      '  gap: 12px;',
      '}',
      '.prmdash-grid .prmdash-card {',
      '  flex: none;',
      '  width: 100%;',
      '}',
      '',
      '/* Blurred preview (for free users) */',
      '.prmdash-blur {',
      '  filter: blur(4px);',
      '  pointer-events: none;',
      '  user-select: none;',
      '}',
      '.prmdash-lock-overlay {',
      '  position: absolute;',
      '  inset: 0;',
      '  display: flex;',
      '  flex-direction: column;',
      '  align-items: center;',
      '  justify-content: center;',
      '  gap: 8px;',
      '  z-index: 5;',
      '  background: rgba(5,8,15,0.7);',
      '  border-radius: 12px;',
      '}',
      'body.light .prmdash-lock-overlay { background: rgba(240,244,251,0.8); }',
      '.prmdash-lock-icon { font-size: 2rem; }',
      '.prmdash-lock-text {',
      '  font-size: .8rem;',
      '  font-weight: 600;',
      '  color: var(--text2, rgba(255,255,255,0.6));',
      '}',
      '.prmdash-lock-btn {',
      '  background: linear-gradient(135deg, #fbbf24, #f59e0b);',
      '  color: #000;',
      '  font-weight: 800;',
      '  padding: 8px 20px;',
      '  border-radius: 20px;',
      '  border: none;',
      '  cursor: pointer;',
      '  font-size: .8rem;',
      '}',
      '',
      '/* Continue Reading progress bar */',
      '.prmdash-progress {',
      '  height: 3px;',
      '  background: rgba(255,255,255,0.1);',
      '  border-radius: 3px;',
      '  margin-top: 6px;',
      '  overflow: hidden;',
      '}',
      '.prmdash-progress-fill {',
      '  height: 100%;',
      '  background: linear-gradient(90deg, #fbbf24, #f59e0b);',
      '  border-radius: 3px;',
      '}',
      '',
      '/* Empty state */',
      '.prmdash-empty {',
      '  text-align: center;',
      '  padding: 32px 20px;',
      '  color: var(--text2, rgba(255,255,255,0.5));',
      '}',
      '.prmdash-empty-icon { font-size: 2rem; margin-bottom: 10px; }',
      '.prmdash-empty-text { font-size: .85rem; }',
      '',
      '/* Section hide */',
      '.prmdash-hidden { display: none !important; }',
      '',
      '/* Entrance animation */',
      '@keyframes prmdashFadeIn {',
      '  from { opacity: 0; transform: translateY(10px); }',
      '  to { opacity: 1; transform: translateY(0); }',
      '}',
      '.prmdash-section {',
      '  animation: prmdashFadeIn .4s ease-out;',
      '}',
      '',
      '@media (max-width: 540px) {',
      '  .prmdash-card { flex: 0 0 130px; width: 130px; }',
      '  .prmdash-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }',
      '}',
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ── Card builder (shared by all sections) ─────────────────────── */
  function _cardHTML(pdf, opts) {
    opts = opts || {};
    var title = _esc(pdf.title || 'Untitled');
    var cover = pdf.coverImage || pdf.cover_image || pdf.cover_url || '';
    var cat = _esc(pdf.category || '');
    var id = String(pdf.id || '');

    var coverHTML = cover
      ? '<img src="' + _esc(cover) + '" alt="' + title + '" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'" loading="lazy" decoding="async">'
      : '<div class="prmdash-card-cover-ph">📌</div>';

    var badgeHTML = '<div class="prmdash-card-badge">👑 PREMIUM</div>';
    var btnText = opts.btnText || '👑 Open Free';
    var progressHTML = '';

    if (opts.progress) {
      var pct = Math.min(100, Math.max(0, opts.progress));
      progressHTML = '<div class="prmdash-progress"><div class="prmdash-progress-fill" style="width:' + pct + '%"></div></div>';
    }

    return '<div class="prmdash-card" onclick="if(typeof openDetail===\'function\')openDetail(\'' + id + '\');else navigate(\'detail\')" '
      + 'onmouseover="this.style.transform=\'translateY(-3px)\'" '
      + 'onmouseout="this.style.transform=\'\'">'
      + '<div class="prmdash-card-cover">'
      + coverHTML
      + badgeHTML
      + '</div>'
      + '<div class="prmdash-card-body">'
      + '<div class="prmdash-card-title">' + title + '</div>'
      + (cat ? '<div class="prmdash-card-meta">' + cat + '</div>' : '')
      + progressHTML
      + '<button class="prmdash-card-btn" onclick="event.stopPropagation();if(typeof openDetail===\'function\')openDetail(\'' + id + '\');else navigate(\'detail\')">' + btnText + '</button>'
      + '</div>'
      + '</div>';
  }

  /* ── Get premium PDFs via SMCI shared loader ───────────────────── */
  async function _getPremiumPDFs() {
    if (window.SMCI && typeof window.SMCI.getStatus === 'function') {
      var enabledCats = await window.SMCI.getEnabledCategories();
      var enabledLower = (enabledCats || []).map(function(n) { return (n || '').toLowerCase().trim(); });

      // Filter from window.PDFS (same source as SMCI)
      var localPdfs = (window.PDFS || []).filter(function(p) {
        if (!p || !p.title) return false;
        var pdfCat = (p.category || '').toLowerCase().trim();
        if (!pdfCat) return false;
        return enabledLower.some(function(ec) { return pdfCat === ec; });
      });

      if (localPdfs.length > 0) return localPdfs;

      // Supabase fallback (same as SMCI)
      var sb = _sb();
      if (!sb) return [];
      try {
        var res = await sb.from('pdfs')
          .select('id,title,category,price,cover_url,cover_image,pdf_url,free,slug,rating,downloads,discount,is_published,created_at')
          .in('category', enabledCats)
          .eq('is_published', true)
          .order('created_at', { ascending: false })
          .limit(100);
        if (res.error) return [];
        var rows = res.data || [];
        return rows.filter(function(p) {
          var pdfCat = (p.category || '').toLowerCase().trim();
          return enabledLower.some(function(ec) { return pdfCat === ec; });
        });
      } catch (e) { return []; }
    }
    return [];
  }

  /* ── Continue Reading: get from localStorage ───────────────────── */
  function _getContinueReadingPDFs() {
    try {
      var raw = localStorage.getItem('studyria_reading_history');
      if (!raw) return [];
      var history = JSON.parse(raw);
      if (!Array.isArray(history)) return [];
      return history.slice(0, 10);
    } catch (_) { return []; }
  }

  function _getProgressForPDF(pdfId) {
    try {
      var raw = localStorage.getItem('studyria_reading_progress');
      if (!raw) return 0;
      var progress = JSON.parse(raw);
      if (!progress || typeof progress !== 'object') return 0;
      var p = progress[String(pdfId)];
      if (p && typeof p.percent === 'number') return p.percent;
      if (p && typeof p.progress === 'number') return p.progress;
    } catch (_) {}
    return 0;
  }

  /* ── SECTION 3: Premium Library Universe ──────────────────────── */
  async function _renderLibraryUniverse(isPremium) {
    var section = document.getElementById('prmDashLibraryUniverse');
    if (!section) return;

    var pdfs = await _getPremiumPDFs();

    if (pdfs.length === 0) {
      section.classList.add('prmdash-hidden');
      return;
    }

    section.classList.remove('prmdash-hidden');

    var track = section.querySelector('.prmdash-shelf-track');
    if (!track) return;

    if (isPremium) {
      track.innerHTML = pdfs.slice(0, 15).map(function(p) {
        return _cardHTML(p, { btnText: '👑 Open Free' });
      }).join('');
      var lock = section.querySelector('.prmdash-lock-overlay');
      if (lock) lock.remove();
      track.classList.remove('prmdash-blur');
    } else {
      track.innerHTML = pdfs.slice(0, 10).map(function(p) {
        return _cardHTML(p, { btnText: '🔒 Locked' });
      }).join('');
      track.classList.add('prmdash-blur');
      var existingLock = section.querySelector('.prmdash-lock-overlay');
      if (!existingLock) {
        var shelfOuter = section.querySelector('.prmdash-shelf-outer');
        if (shelfOuter) {
          shelfOuter.style.position = 'relative';
          var lockEl = document.createElement('div');
          lockEl.className = 'prmdash-lock-overlay';
          lockEl.innerHTML = '<div class="prmdash-lock-icon">🔒</div>'
            + '<div class="prmdash-lock-text">Unlock to access all Premium Notes</div>'
            + '<button class="prmdash-lock-btn" onclick="navigate(\'premium\');setTimeout(function(){if(typeof PRM1!==\'undefined\'&&PRM1.scrollToPlans)PRM1.scrollToPlans();},300)">👑 View Plans →</button>';
          shelfOuter.appendChild(lockEl);
        }
      }
    }

    _wireDragScroll(section);
  }

  /* ── SECTION 4: Continue Reading ──────────────────────────────── */
  function _renderContinueReading(isPremium) {
    var section = document.getElementById('prmDashContinueReading');
    if (!section) return;

    if (!isPremium) {
      section.classList.add('prmdash-hidden');
      return;
    }

    var history = _getContinueReadingPDFs();
    if (history.length === 0) {
      section.classList.add('prmdash-hidden');
      return;
    }

    section.classList.remove('prmdash-hidden');
    var track = section.querySelector('.prmdash-shelf-track');
    if (!track) return;

    var allPdfs = window.PDFS || [];
    var cards = history.map(function(h) {
      var pdfId = String(h.pdfId || h.id || '');
      var pdf = allPdfs.find(function(p) { return String(p.id) === pdfId; });
      if (!pdf) return null;
      var progress = _getProgressForPDF(pdfId) || (h.progress || 0);
      return _cardHTML(pdf, { btnText: '📖 Continue', progress: progress });
    }).filter(Boolean);

    if (cards.length === 0) {
      section.classList.add('prmdash-hidden');
      return;
    }

    track.innerHTML = cards.join('');
    _wireDragScroll(section);
  }

  /* ── SECTION 5: Recently Added Premium Notes ───────────────────── */
  async function _renderRecentlyAdded(isPremium) {
    var section = document.getElementById('prmDashRecentlyAdded');
    if (!section) return;

    if (!isPremium) {
      section.classList.add('prmdash-hidden');
      return;
    }

    var pdfs = await _getPremiumPDFs();
    if (pdfs.length === 0) {
      section.classList.add('prmdash-hidden');
      return;
    }

    section.classList.remove('prmdash-hidden');
    var track = section.querySelector('.prmdash-shelf-track');
    if (!track) return;

    var sorted = pdfs.slice().sort(function(a, b) {
      return (new Date(b.created_at || b.createdAt || 0)) - (new Date(a.created_at || a.createdAt || 0));
    });

    track.innerHTML = sorted.slice(0, 12).map(function(p) {
      return _cardHTML(p, { btnText: '👑 Open Free' });
    }).join('');

    _wireDragScroll(section);
  }

  /* ── SECTION 6: My Premium Cards ───────────────────────────────── */
  async function _renderMyCards(isPremium) {
    var section = document.getElementById('prmDashMyCards');
    if (!section) return;

    if (!isPremium) {
      section.classList.add('prmdash-hidden');
      return;
    }

    var pdfs = await _getPremiumPDFs();
    if (pdfs.length === 0) {
      section.classList.add('prmdash-hidden');
      return;
    }

    section.classList.remove('prmdash-hidden');
    var grid = section.querySelector('.prmdash-grid');
    if (!grid) return;

    grid.innerHTML = pdfs.map(function(p) {
      return _cardHTML(p, { btnText: '👑 Open Free' });
    }).join('');
  }

  /* ── Drag-to-scroll helper ──────────────────────────────────────── */
  function _wireDragScroll(section) {
    var shelves = section.querySelectorAll('.prmdash-shelf-outer');
    shelves.forEach(function(el) {
      if (el._prmdashDrag) return;
      el._prmdashDrag = true;
      var dragging = false, startX = 0, scrollL = 0;
      el.addEventListener('mousedown', function(e) {
        dragging = true; startX = e.pageX - el.offsetLeft; scrollL = el.scrollLeft;
        el.style.cursor = 'grabbing';
      });
      window.addEventListener('mouseup', function() { dragging = false; el.style.cursor = 'grab'; });
      el.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        e.preventDefault();
        el.scrollLeft = scrollL - (e.pageX - el.offsetLeft - startX);
      });
    });
  }

  /* ── Conditional UI: show/hide sections based on premium status ── */
  async function _applyConditionalUI(isPremium) {
    var plansSection = document.getElementById('prmPlans');
    var libUniverse = document.getElementById('prmDashLibraryUniverse');

    // For FREE users: show Plans immediately after Hero/Membership Status
    // For PREMIUM users: show Library Universe immediately after Membership Status
    // Plans remain lower on the page for premium users
    if (isPremium) {
      if (libUniverse) libUniverse.classList.remove('prmdash-hidden');
    } else {
      if (libUniverse) libUniverse.classList.remove('prmdash-hidden');
    }
  }

  /* ── Main render: called by navigate('premium') ────────────────── */
  PRMDASH.render = async function() {
    _log('Rendering Premium Dashboard sections...');

    _injectCSS();

    var isPremium = false;
    if (window.SMCI && typeof window.SMCI.getStatus === 'function') {
      var status = await window.SMCI.getStatus(true);
      isPremium = !!(status && status.isPremium);
    }
    _log('Premium status:', isPremium);

    await _applyConditionalUI(isPremium);

    await _renderLibraryUniverse(isPremium);
    _renderContinueReading(isPremium);
    await _renderRecentlyAdded(isPremium);
    await _renderMyCards(isPremium);

    _log('Premium Dashboard sections rendered');
  };

  /* ── Init: hook into navigate('premium') ───────────────────────── */
  var _origNavigate = window.navigate;
  if (_origNavigate && !_origNavigate._prmdashHooked) {
    window.navigate = async function(page) {
      var result = _origNavigate.apply(this, arguments);
      if (page === 'premium') {
        setTimeout(function() {
          if (window.PRMDASH && typeof window.PRMDASH.render === 'function') {
            window.PRMDASH.render();
          }
        }, 500);
      }
      return result;
    };
    window.navigate._prmdashHooked = true;
    window.navigate._smciHooked = _origNavigate._smciHooked;
    window.navigate._p5dHooked = _origNavigate._p5dHooked;
    _log('navigate() hooked for Premium Dashboard');
  }

  // Also render on initial load if already on premium page
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      var activePage = document.querySelector('.page.active');
      if (activePage && activePage.id === 'page-premium') {
        setTimeout(function() { PRMDASH.render(); }, 1000);
      }
    });
  } else {
    var activePage = document.querySelector('.page.active');
    if (activePage && activePage.id === 'page-premium') {
      setTimeout(function() { PRMDASH.render(); }, 1000);
    }
  }

  _log('premium-dashboard.js loaded ✅');
})();
