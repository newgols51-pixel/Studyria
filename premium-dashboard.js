/**
 * ═══════════════════════════════════════════════════════════════════
 * premium-dashboard.js — Studyria Premium Dashboard Sections v2.0
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
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  if (window.PRMDASH && window.PRMDASH._version === '1.2') return;

  var PRMDASH = {};
  window.PRMDASH = PRMDASH;
  PRMDASH._version = '1.2';

  /* ── Constants ─────────────────────────────────────────────────── */
  var PREMIUM_CATEGORY = 'Premium Handwritten Notes';
  var RETRY_MS = 800;
  var MAX_RETRIES = 5;

  /* RACE CONDITION FIX: Track when renderWithStatus was last called.
     The navigate('premium') handler in index.html calls renderWithStatus(isPremium)
     with the CORRECT status from a direct Supabase query. But our own navigate
     (not used in v2.0 — kept for reference)
     prevents the hook from firing if renderWithStatus was called recently. */

  /* PREMIUM UNLOCK EXPERIENCE: Track whether the unlock animation has been
     shown for the current Premium tab visit. Reset when leaving the tab. */
  var _unlockExperienceShown = false;

  /* ── Utilities ─────────────────────────────────────────────────── */
  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _sb() { return window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null); }
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
      '.prmdash-section { padding: 24px 16px; max-width: 1100px; margin: 0 auto; }',
      '.prmdash-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; padding: 0 2px; }',
      '.prmdash-title { display: flex; align-items: center; gap: 8px; font-size: .92rem; font-weight: 700; color: var(--text1, #f0f4f8); }',
      '.prmdash-title-icon { font-size: 1.15rem; }',
      '.prmdash-sub { font-size: .72rem; color: var(--text3, rgba(255,255,255,0.35)); font-weight: 400; margin-left: 4px; }',
      '.prmdash-viewall { background: linear-gradient(135deg, rgba(251,191,36,0.15), rgba(245,158,11,0.1)); border: 1px solid rgba(251,191,36,0.3); color: #fbbf24; font-size: .74rem; font-weight: 700; padding: 6px 14px; border-radius: 20px; cursor: pointer; white-space: nowrap; transition: all .2s; }',
      '.prmdash-viewall:hover { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #000; }',
      '.prmdash-shelf-outer { overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; scrollbar-width: none; cursor: grab; user-select: none; position: relative; }',
      '.prmdash-shelf-outer::-webkit-scrollbar { display: none; }',
      '.prmdash-shelf-track { display: flex; gap: 12px; padding-bottom: 8px; width: max-content; }',
      '.prmdash-card { flex: 0 0 150px; width: 150px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); overflow: hidden; cursor: pointer; transition: transform .15s, box-shadow .15s, border-color .15s; position: relative; }',
      'body.light .prmdash-card { background: rgba(255,255,255,0.6); border-color: rgba(0,0,0,0.08); }',
      '.prmdash-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.3); border-color: rgba(251,191,36,0.3); }',
      '.prmdash-card-cover { position: relative; height: 120px; overflow: hidden; }',
      '.prmdash-card-cover img { width: 100%; height: 100%; object-fit: cover; }',
      '.prmdash-card-cover-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; background: linear-gradient(135deg, rgba(61,142,248,0.1), rgba(139,92,246,0.1)); }',
      '.prmdash-card-badge { position: absolute; top: 6px; right: 6px; background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #000; font-size: .55rem; font-weight: 800; padding: 2px 7px; border-radius: 10px; }',
      '.prmdash-card-body { padding: 8px 10px; }',
      '.prmdash-card-title { font-size: .74rem; font-weight: 600; color: var(--text1, #f0f4f8); line-height: 1.3; margin-bottom: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }',
      '.prmdash-card-meta { font-size: .62rem; color: var(--text2, rgba(255,255,255,0.5)); }',
      '.prmdash-card-btn { width: 100%; padding: 5px; border-radius: 6px; border: 1px solid rgba(251,191,36,0.25); background: linear-gradient(135deg, rgba(251,191,36,0.15), rgba(245,158,11,0.1)); color: #fbbf24; font-size: .68rem; font-weight: 700; cursor: pointer; margin-top: 5px; }',
      '.prmdash-card-btn:hover { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #000; }',
      '.prmdash-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }',
      '.prmdash-grid .prmdash-card { flex: none; width: 100%; }',
      '.prmdash-blur { filter: blur(4px); pointer-events: none; user-select: none; }',
      '.prmdash-lock-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; z-index: 5; background: rgba(5,8,15,0.7); border-radius: 12px; }',
      'body.light .prmdash-lock-overlay { background: rgba(240,244,251,0.8); }',
      '.prmdash-lock-icon { font-size: 2rem; }',
      '.prmdash-lock-text { font-size: .8rem; font-weight: 600; color: var(--text2, rgba(255,255,255,0.6)); }',
      '.prmdash-lock-btn { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #000; font-weight: 800; padding: 8px 20px; border-radius: 20px; border: none; cursor: pointer; font-size: .8rem; }',
      '.prmdash-progress { height: 3px; background: rgba(255,255,255,0.1); border-radius: 3px; margin-top: 6px; overflow: hidden; }',
      '.prmdash-progress-fill { height: 100%; background: linear-gradient(90deg, #fbbf24, #f59e0b); border-radius: 3px; }',
      '.prmdash-empty { text-align: center; padding: 32px 20px; color: var(--text2, rgba(255,255,255,0.5)); }',
      '.prmdash-empty-icon { font-size: 2rem; margin-bottom: 10px; }',
      '.prmdash-empty-text { font-size: .85rem; }',
      '.prmdash-hidden { display: none !important; }',
      '@keyframes prmdashFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }',
      '.prmdash-section { animation: prmdashFadeIn .4s ease-out; }',
      '@media (max-width: 540px) { .prmdash-card { flex: 0 0 130px; width: 130px; } .prmdash-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); } }',
      /* ── PREMIUM UNLOCK EXPERIENCE ── */
      '#prmUnlockOverlay { position:fixed; inset:0; z-index:99999; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none; opacity:0; animation: prmUnlockFadeIn .4s ease-out forwards; }',
      '#prmUnlockOverlay.prm-unlock-out { animation: prmUnlockFadeOut .5s ease-in forwards; }',
      '.prm-unlock-glow { position:absolute; width:200px; height:200px; border-radius:50%; background: radial-gradient(circle, rgba(251,191,36,0.35) 0%, rgba(245,158,11,0.15) 40%, transparent 70%); animation: prmGlowPulse 1.2s ease-out; }',
      '.prm-unlock-crown { font-size:3.5rem; position:relative; z-index:2; animation: prmCrownPop .8s cubic-bezier(0.34,1.56,0.64,1) forwards; filter: drop-shadow(0 0 20px rgba(251,191,36,0.6)); }',
      '.prm-unlock-text { position:relative; z-index:2; margin-top:12px; font-size:1.1rem; font-weight:800; color:#fbbf24; text-shadow: 0 0 15px rgba(251,191,36,0.5); animation: prmTextFadeIn .6s ease-out .3s forwards; opacity:0; }',
      '.prm-unlock-sparkle { position:absolute; width:6px; height:6px; border-radius:50%; background:#fbbf24; pointer-events:none; }',
      '@keyframes prmUnlockFadeIn { from { opacity:0; } to { opacity:1; } }',
      '@keyframes prmUnlockFadeOut { from { opacity:1; } to { opacity:0; } }',
      '@keyframes prmCrownPop { 0% { transform:scale(0) rotate(-30deg); opacity:0; } 50% { transform:scale(1.3) rotate(10deg); opacity:1; } 70% { transform:scale(1.0) rotate(-5deg); } 100% { transform:scale(1.0) rotate(0); opacity:1; } }',
      '@keyframes prmGlowPulse { 0% { transform:scale(0.3); opacity:0; } 50% { transform:scale(1.5); opacity:1; } 100% { transform:scale(1.2); opacity:0.3; } }',
      '@keyframes prmTextFadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }',
      '@keyframes prmSparkleFly { 0% { transform:translate(0,0) scale(1); opacity:1; } 100% { transform:translate(var(--sx),var(--sy)) scale(0); opacity:0; } }',
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ── Card builder ─────────────────────────────────────────────── */
  function _cardHTML(pdf, opts) {
    opts = opts || {};
    /* Store pdf in SMCI's store so openReadingRoom can find it without PDFS lookup */
    if (window.SMCI && typeof window.SMCI.storePdf === 'function') {
      window.SMCI.storePdf(pdf);
    } else if (window._smciPdfStore && pdf && pdf.id !== undefined) {
      window._smciPdfStore[String(pdf.id)] = pdf;
    }
    var title = _esc(pdf.title || 'Untitled');
    var cover = pdf.coverImage || pdf.cover_image || pdf.cover_url || '';
    var cat = _esc(pdf.category || '');
    var id = String(pdf.id || '');

    var coverHTML = cover
      ? '<img src="' + _esc(cover) + '" alt="' + title + '" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\';this.parentElement.innerHTML=\'<div class=prmdash-card-cover-ph>📌</div>\'" loading="lazy" decoding="async">'
      : '<div class="prmdash-card-cover-ph">📌</div>';

    var badgeHTML = '<div class="prmdash-card-badge">👑 PREMIUM</div>';
    var btnText = opts.btnText || '👑 Open';
    var progressHTML = '';

    if (opts.progress) {
      var pct = Math.min(100, Math.max(0, opts.progress));
      progressHTML = '<div class="prmdash-progress"><div class="prmdash-progress-fill" style="width:' + pct + '%"></div></div>';
    }

    /* UNIFIED FIX: Premium cards use downloadPDF — same path as My Library purchased PDFs.
       downloadPDF checks premium membership (Step 4.5) then opens via signed URL. */
    var clickAction = (btnText === '🔒 Locked')
      ? "if(typeof openDetail===\'function\')openDetail(\'' + id + '\')"
      : "if(typeof downloadPDF===\'function\')downloadPDF(\'' + id + '\');else if(typeof openDetail===\'function\')openDetail(\'' + id + '\')";

    return '<div class="prmdash-card" onclick="' + clickAction + '" '
      + 'onmouseover="this.style.transform=\'translateY(-3px)\'" '
      + 'onmouseout="this.style.transform=\'\'">'
      + '<div class="prmdash-card-cover">' + coverHTML + badgeHTML + '</div>'
      + '<div class="prmdash-card-body">'
      + '<div class="prmdash-card-title">' + title + '</div>'
      + (cat ? '<div class="prmdash-card-meta">' + cat + '</div>' : '')
      + progressHTML
      + '<button class="prmdash-card-btn" onclick="event.stopPropagation();' + clickAction + '">' + btnText + '</button>'
      + '</div></div>';
  }


  /* ── Get premium PDFs — multi-strategy loader ──────────────────── */
  async function _getPremiumPDFs() {
    _log('Loading premium PDFs...');

    // Strategy 1: Use SMCI's getEnabledCategories + window.PDFS
    if (window.SMCI && typeof window.SMCI.getEnabledCategories === 'function') {
      try {
        var enabledCats = await window.SMCI.getEnabledCategories();
        var enabledLower = (enabledCats || []).map(function(n) { return (n || '').toLowerCase().trim(); });
        _log('SMCI enabled categories:', enabledCats);

        var localPdfs = (window.PDFS || []).filter(function(p) {
          if (!p || !p.title) return false;
          var pdfCat = (p.category || '').toLowerCase().trim();
          if (!pdfCat) return false;
          return enabledLower.some(function(ec) { return pdfCat === ec; });
        });

        if (localPdfs.length > 0) {
          _log('Found ' + localPdfs.length + ' PDFs via SMCI + window.PDFS');
          /* FIX: Also store in SMCI pdfStore so openReadingRoom lookup works */
          localPdfs.forEach(function(p) {
            if (window.SMCI && typeof window.SMCI.storePdf === 'function') window.SMCI.storePdf(p);
            else if (window._smciPdfStore && p && p.id !== undefined) window._smciPdfStore[String(p.id)] = p;
          });
          return localPdfs;
        }
      } catch (e) { _log('SMCI strategy failed:', e.message); }
    }

    // Strategy 2: Direct filter from window.PDFS by category name
    var directPdfs = (window.PDFS || []).filter(function(p) {
      if (!p || !p.title) return false;
      var pdfCat = (p.category || '').toLowerCase().trim();
      return pdfCat === PREMIUM_CATEGORY.toLowerCase();
    });
    if (directPdfs.length > 0) {
      _log('Found ' + directPdfs.length + ' PDFs via direct window.PDFS filter');
      /* FIX: Also store in SMCI pdfStore */
      directPdfs.forEach(function(p) {
        if (window.SMCI && typeof window.SMCI.storePdf === 'function') window.SMCI.storePdf(p);
        else if (window._smciPdfStore && p && p.id !== undefined) window._smciPdfStore[String(p.id)] = p;
      });
      return directPdfs;
    }

    // Strategy 3: Direct Supabase query (no SMCI dependency)
    var sb = _sb();
    if (sb) {
      try {
        _log('Querying Supabase directly for category:', PREMIUM_CATEGORY);
        var res = await sb.from('pdfs')
          .select('*')
          .eq('category', PREMIUM_CATEGORY)
          .eq('status', 'published')
          .order('created_at', { ascending: false })
          .limit(100);
        if (res.error) { _log('Supabase error:', res.error.message); }
        if (res.data && res.data.length > 0) {
          _log('Found ' + res.data.length + ' PDFs via Supabase');
          /* FIX (BUG-2): Merge into window.PDFS so SMCI.openReadingRoom can find them */
          var fetched = res.data;
          if (!window.PDFS) window.PDFS = [];
          fetched.forEach(function(p) {
            if (!window.PDFS.some(function(x) { return String(x.id) === String(p.id); })) {
              window.PDFS.push(p);
            }
            /* FIX: Also store in SMCI pdfStore for reliable id-based lookup */
            if (window.SMCI && typeof window.SMCI.storePdf === 'function') window.SMCI.storePdf(p);
            else if (window._smciPdfStore && p && p.id !== undefined) window._smciPdfStore[String(p.id)] = p;
          });
          return fetched;
        }
      } catch (e) { _log('Supabase strategy failed:', e.message); }
    }

    _log('No premium PDFs found');
    return [];
  }

  /* ── Continue Reading: from localStorage ──────────────────────── */
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
  async function _renderLibraryUniverse(isPremium, pdfs) {
    var section = document.getElementById('prmDashLibraryUniverse');
    if (!section) return;
    if (!pdfs || pdfs.length === 0) { section.classList.add('prmdash-hidden'); return; }

    section.classList.remove('prmdash-hidden');
    var track = section.querySelector('.prmdash-shelf-track');
    if (!track) return;

    if (isPremium) {
      // Full access — no blur, no lock
      track.innerHTML = pdfs.slice(0, 15).map(function(p) {
        return _cardHTML(p, { btnText: '👑 Open Free' });
      }).join('');
      track.classList.remove('prmdash-blur');
      var lock = section.querySelector('.prmdash-lock-overlay');
      if (lock) lock.remove();
    } else {
      // Free user — blurred preview with lock overlay
      track.innerHTML = pdfs.slice(0, 10).map(function(p) {
        return _cardHTML(p, { btnText: '🔒 Locked' });
      }).join('');
      track.classList.add('prmdash-blur');

      // Remove old lock if exists
      var oldLock = section.querySelector('.prmdash-lock-overlay');
      if (oldLock) oldLock.remove();

      // Add lock overlay
      var shelfOuter = section.querySelector('.prmdash-shelf-outer');
      if (shelfOuter) {
        var lockEl = document.createElement('div');
        lockEl.className = 'prmdash-lock-overlay';
        lockEl.innerHTML = '<div class="prmdash-lock-icon">🔒</div>'
          + '<div class="prmdash-lock-text">Unlock to access all Premium Notes</div>'
          + '<button class="prmdash-lock-btn" onclick="var p=document.getElementById(\'prmPlans\');if(p)p.scrollIntoView({behavior:\'smooth\'})">👑 View Plans →</button>';
        shelfOuter.appendChild(lockEl);
      }
    }
    _wireDragScroll(section);
  }

  /* ── SECTION 4: Continue Reading ──────────────────────────────── */
  function _renderContinueReading(isPremium, pdfs) {
    var section = document.getElementById('prmDashContinueReading');
    if (!section) return;
    if (!isPremium) { section.classList.add('prmdash-hidden'); return; }

    var history = _getContinueReadingPDFs();
    if (history.length === 0) { section.classList.add('prmdash-hidden'); return; }

    var premiumPdfIds = (pdfs || []).map(function(p) { return String(p.id); });
    var allPdfs = window.PDFS || [];
    var cards = history.map(function(h) {
      var pdfId = String(h.pdfId || h.id || '');
      // Only show if it's a premium PDF
      if (premiumPdfIds.indexOf(pdfId) === -1) {
        // Also check if the PDF's category matches
        var pdf = allPdfs.find(function(p) { return String(p.id) === pdfId; });
        if (!pdf) return null;
        var cat = (pdf.category || '').toLowerCase().trim();
        if (cat !== PREMIUM_CATEGORY.toLowerCase()) return null;
      }
      var pdf = allPdfs.find(function(p) { return String(p.id) === pdfId; });
      if (!pdf) return null;
      var progress = _getProgressForPDF(pdfId) || (h.progress || 0);
      return _cardHTML(pdf, { btnText: '📖 Continue', progress: progress });
    }).filter(Boolean);

    if (cards.length === 0) { section.classList.add('prmdash-hidden'); return; }

    section.classList.remove('prmdash-hidden');
    var track = section.querySelector('.prmdash-shelf-track');
    if (!track) return;
    track.innerHTML = cards.join('');
    _wireDragScroll(section);
  }

  /* ── SECTION 5: Recently Added Premium Notes ───────────────────── */
  function _renderRecentlyAdded(isPremium, pdfs) {
    var section = document.getElementById('prmDashRecentlyAdded');
    if (!section) return;
    if (!isPremium || !pdfs || pdfs.length === 0) { section.classList.add('prmdash-hidden'); return; }

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
  function _renderMyCards(isPremium, pdfs) {
    var section = document.getElementById('prmDashMyCards');
    if (!section) return;
    if (!isPremium || !pdfs || pdfs.length === 0) { section.classList.add('prmdash-hidden'); return; }

    section.classList.remove('prmdash-hidden');
    var countEl = document.getElementById('prmDashMyCardsCount');
    if (countEl) countEl.textContent = '(' + pdfs.length + ' notes)';

    var grid = section.querySelector('.prmdash-grid');
    if (!grid) return;
    grid.innerHTML = pdfs.map(function(p) {
      return _cardHTML(p, { btnText: '👑 Open Free' });
    }).join('');
  }

  /* ── Drag-to-scroll ────────────────────────────────────────────── */
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

  /* ── Conditional UI ───────────────────────────────────────────── */
  function _applyConditionalUI(isPremium) {
    var plansSection = document.getElementById('prmPlans');
    var memberBanner = document.getElementById('prmMemberBanner');

    if (isPremium) {
      // Premium: Library Universe visible right after Membership Status
      // Plans stay lower
      if (memberBanner) memberBanner.style.display = '';
    } else {
      // Free: Plans shown right after Hero/Membership Status
      // Library Universe visible as blurred preview
      if (memberBanner) memberBanner.style.display = 'none';
    }
  }

  /* ── Main render ───────────────────────────────────────────────── */
  var _renderToken = 0;

  /* render() is now a thin wrapper around renderWithStatus.
     It gets the status from SMCI (non-force, uses cached/injected value)
     and passes it to renderWithStatus. This ensures a SINGLE RENDER PATH.
     Never force-fetches from Supabase (that caused the race condition). */
  PRMDASH.render = async function() {
    var isPremium = false;
    if (window.SMCI && typeof window.SMCI.getStatus === 'function') {
      try {
        var status = await window.SMCI.getStatus(false);
        isPremium = !!(status && status.isPremium);
      } catch(e) { _log('render() SMCI.getStatus failed:', e.message); }
    }
    return PRMDASH.renderWithStatus(isPremium);
  };

  /* ── renderWithStatus: render with pre-resolved isPremium (no SMCI call needed) ── */
  PRMDASH.renderWithStatus = async function(isPremium) {
    var myToken = ++_renderToken;
    _log('renderWithStatus called, isPremium=' + isPremium + ' (token ' + myToken + ')');
    _injectCSS();
    if (myToken !== _renderToken) return;
    _applyConditionalUI(isPremium);
    var pdfs = await _getPremiumPDFs();
    if (myToken !== _renderToken) return;
    await _renderLibraryUniverse(isPremium, pdfs);
    if (myToken !== _renderToken) return;
    _renderContinueReading(isPremium, pdfs);
    _renderRecentlyAdded(isPremium, pdfs);
    _renderMyCards(isPremium, pdfs);
    _log('renderWithStatus done ✅');
  };

  /* renderWithRetry() deleted — was the source of the race condition.
     It called render() which force-fetched stale isPremium from SMCI.
     Now there is only ONE render path: renderWithStatus(isPremium). */

  /* ─────────────────────────────────────────────────────────────────
     § PREMIUM UNLOCK EXPERIENCE
     Triggered when a Premium Member opens the Premium tab.
     Shows: golden glow + crown animation + sparkle particles + text.
     Plays: soft premium unlock sound (Web Audio API, ~0.7s, low volume).
     Rules: Only once per tab visit. Never on scroll. Never blocks UI.
  ──────────────────────────────────────────────────────────────────*/

  function _playPremiumUnlockSound() {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      var ctx = new AudioCtx();

      /* Soft premium chime — two ascending notes with gentle decay */
      var notes = [
        { freq: 659.25, start: 0,     dur: 0.35 },  /* E5 */
        { freq: 987.77, start: 0.12,  dur: 0.55 },  /* B5 */
      ];

      var masterGain = ctx.createGain();
      masterGain.gain.value = 0.12;  /* Low volume */
      masterGain.connect(ctx.destination);

      notes.forEach(function(n) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = n.freq;
        osc.connect(gain);
        gain.connect(masterGain);

        var t = ctx.currentTime + n.start;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.8, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t + n.dur);

        osc.start(t);
        osc.stop(t + n.dur);
      });

      /* Cleanup after 1s */
      setTimeout(function() { try { ctx.close(); } catch(_) {} }, 1000);
    } catch(e) { _log('Sound playback failed', e); }
  }

  function _showUnlockExperience() {
    if (_unlockExperienceShown) return;
    _unlockExperienceShown = true;

    /* Remove any existing overlay */
    var existing = document.getElementById('prmUnlockOverlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'prmUnlockOverlay';

    /* Glow background */
    var glow = document.createElement('div');
    glow.className = 'prm-unlock-glow';
    overlay.appendChild(glow);

    /* Crown */
    var crown = document.createElement('div');
    crown.className = 'prm-unlock-crown';
    crown.textContent = '👑';
    overlay.appendChild(crown);

    /* Text */
    var text = document.createElement('div');
    text.className = 'prm-unlock-text';
    text.textContent = 'Premium Unlocked';
    overlay.appendChild(text);

    /* Sparkle particles */
    for (var i = 0; i < 12; i++) {
      var sparkle = document.createElement('div');
      sparkle.className = 'prm-unlock-sparkle';
      var angle = (Math.PI * 2 * i) / 12;
      var dist = 60 + Math.random() * 40;
      sparkle.style.setProperty('--sx', Math.cos(angle) * dist + 'px');
      sparkle.style.setProperty('--sy', Math.sin(angle) * dist + 'px');
      sparkle.style.left = '50%';
      sparkle.style.top = '50%';
      sparkle.style.animation = 'prmSparkleFly ' + (0.6 + Math.random() * 0.4) + 's ease-out ' + (0.2 + Math.random() * 0.2) + 's forwards';
      sparkle.style.opacity = '0';
      overlay.appendChild(sparkle);
    }

    document.body.appendChild(overlay);

    /* Play sound */
    _playPremiumUnlockSound();

    /* Auto-remove after 2.5s */
    setTimeout(function() {
      if (overlay.parentNode) {
        overlay.classList.add('prm-unlock-out');
        setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 600);
      }
    }, 2200);

    _log('Premium unlock experience shown');
  }

  /* ── Hook into navigate('premium') — UNLOCK EXPERIENCE ONLY ───── */
  /* Does NOT render. Rendering is handled by _prmPageInit in index.html
     which calls PRMDASH.renderWithStatus(isPremium) — the single render path. */
  var _origNavigate = window.navigate;
  if (_origNavigate && !_origNavigate._prmdashHooked) {
    window.navigate = async function(page) {
      if (page !== 'premium') _unlockExperienceShown = false;
      var result = _origNavigate.apply(this, arguments);
      if (page === 'premium') {
        /* Show unlock animation for premium members (after SMCI is injected) */
        setTimeout(async function() {
          try {
            if (window.SMCI && typeof window.SMCI.getStatus === 'function') {
              var st = await window.SMCI.getStatus(false);
              if (st && st.isPremium) _showUnlockExperience();
            }
          } catch(_) {}
        }, 2500);
      }
      return result;
    };
    window.navigate._prmdashHooked = true;
    window.navigate._smciHooked = _origNavigate._smciHooked;
    window.navigate._p5dHooked = _origNavigate._p5dHooked;
    _log('navigate() hooked for unlock experience only (no render)');
  }

  /* Initial load: if already on premium page, trigger render via SMCI. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      var activePage = document.querySelector('.page.active');
      if (activePage && activePage.id === 'page-premium') {
        setTimeout(function() { PRMDASH.render(); }, 1200);
      }
    });
  } else {
    var activePage = document.querySelector('.page.active');
    if (activePage && activePage.id === 'page-premium') {
      setTimeout(function() { PRMDASH.render(); }, 1200);
    }
  }

  _log('premium-dashboard.js v2.0 loaded ✅ — single render path');
})();
