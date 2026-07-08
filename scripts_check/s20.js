
  /* ── OTT DISCOVERY ENGINE ──────────────────────────────────────── */
  window._ottSettings = {
    for_you_enabled: true,
    continue_reading_enabled: true,
    ai_reco_enabled: true,
    trending_enabled: true,
    popular_enabled: true,
    new_arrivals_enabled: true,
    recently_added_enabled: true,
    auto_scroll_enabled: true,
    auto_scroll_interval: 4500,
    featured_pdf_ids: [],
    for_you_title: '✨ For You',
    trending_title: '🔥 Trending This Week',
    new_arrivals_title: '🆕 New Arrivals',
    popular_title: '🎓 Popular Among Students',
    ai_reco_title: '🤖 AI Recommended',
    continue_title: '📖 Continue Reading',
    recent_title: '🕐 Recently Added',
    animation_speed: 'normal', // slow | normal | fast
  };

  // Carousel state
  // ─────────────────────────────────────────────────────────────────────────────
  // FOR YOU CAROUSEL — STATE, PERSISTENCE & NAVIGATION RECOVERY
  //
  // Root causes of the post-navigation corruption:
  //   1. navigate('home') calls ottRenderDiscovery() every time, which resets
  //      _ottState.forYou = 0, wipes cards, and reattaches swipe handlers —
  //      resulting in index 0 always showing and stacked listeners.
  //   2. The SPA never saves or restores carousel position across page visits.
  //   3. bfcache restore (pageshow with persisted=true) has no handler, so the
  //      stale DOM gets a stale frozen timer and a wrong transform.
  //   4. ottInitSwipe's _ottSwipeAttached flag lives on the DOM element, which
  //      persists across SPA page switches — so after the first visit the flag
  //      is permanently true and swipe never re-attaches on back-navigation.
  //   5. Swipe direction was correct (dx<0 → next) but the absence of all other
  //      fixes made it appear reversed in some states.
  //
  // Fixes applied:
  //   • _ottCarousel singleton: all state lives here, never on DOM elements.
  //   • ottSaveCarouselState / ottRestoreCarouselState: persist index to
  //     sessionStorage under key 'ott_fy_idx'; restore on every home visit.
  //   • ottDestroyCarousel: clean teardown (stop timer, remove named listeners,
  //     null guard) called before every re-init.
  //   • ottRenderDiscovery: skip full re-render if cards already exist and PDFS
  //     haven't changed; just restore position. Full re-render only when needed.
  //   • pageshow handler: handles bfcache restore (persisted=true) — recalculates
  //     snap position and restarts autoscroll.
  //   • navigate('home') guard: only re-renders when the carousel is actually
  //     stale (no cards, or different PDF set).
  //   • Swipe direction confirmed: swipeLeft (dx<0) = dir +1 = next card.
  //     Right Arrow / Next btn = +1. Left Arrow / Prev btn = -1.
  // ─────────────────────────────────────────────────────────────────────────────

  const _ottCarousel = {
    forYou: 0,          // active index (0-based, into real cards array)
    total: 0,           // real card count (no clones)
    featuredIds: '',    // JSON fingerprint of current featured set — change detection
    autoScrollTimer: null,
    // Named listener references so we can remove them cleanly on destroy
    _mousedown: null, _mousemove: null, _mouseup: null, _mouseleave: null,
    _touchstart: null, _touchmove: null, _touchend: null,
    _outerEl: null      // the .ott-hero-carousel-outer element currently holding listeners
  };

  // Alias for legacy references inside this block
  const _ottState = _ottCarousel;

  // ── Persist & restore active index across SPA navigation ─────────────
  function ottSaveCarouselState() {
    try { sessionStorage.setItem('ott_fy_idx', String(_ottCarousel.forYou)); } catch(e) {}
  }
  function ottRestoreCarouselState() {
    try {
      const saved = sessionStorage.getItem('ott_fy_idx');
      if (saved !== null) {
        const idx = parseInt(saved, 10);
        if (!isNaN(idx) && idx >= 0 && idx < _ottCarousel.total) {
          _ottCarousel.forYou = idx;
        }
      }
    } catch(e) {}
  }

  // ── Clean teardown — remove named listeners, stop timer ──────────────
  function ottDestroyCarousel() {
    // Stop autoscroll
    if (_ottCarousel.autoScrollTimer) {
      clearInterval(_ottCarousel.autoScrollTimer);
      _ottCarousel.autoScrollTimer = null;
    }
    // Remove swipe listeners from the outer element
    const outer = _ottCarousel._outerEl;
    if (outer) {
      if (_ottCarousel._mousedown)  outer.removeEventListener('mousedown',  _ottCarousel._mousedown);
      if (_ottCarousel._mousemove)  outer.removeEventListener('mousemove',  _ottCarousel._mousemove);
      if (_ottCarousel._mouseup)    outer.removeEventListener('mouseup',    _ottCarousel._mouseup);
      if (_ottCarousel._mouseleave) outer.removeEventListener('mouseleave', _ottCarousel._mouseleave);
      if (_ottCarousel._touchstart) outer.removeEventListener('touchstart', _ottCarousel._touchstart);
      if (_ottCarousel._touchmove)  outer.removeEventListener('touchmove',  _ottCarousel._touchmove);
      if (_ottCarousel._touchend)   outer.removeEventListener('touchend',   _ottCarousel._touchend);
      _ottCarousel._outerEl = null;
    }
    // Clear named listener refs
    _ottCarousel._mousedown = _ottCarousel._mousemove = _ottCarousel._mouseup =
    _ottCarousel._mouseleave = _ottCarousel._touchstart = _ottCarousel._touchmove =
    _ottCarousel._touchend = null;
  }

  // ── Load settings from Supabase ──────────────────────────────────
  async function ottLoadSettings() {
    const sb = window.supabaseClient || window._supabase;
    if (!sb) return;
    try {
      const { data } = await sb.from('site_config')
        .select('key,value')
        .in('key', [
          'ott_for_you_enabled','ott_continue_enabled','ott_ai_reco_enabled',
          'ott_trending_enabled','ott_popular_enabled','ott_new_arrivals_enabled',
          'ott_recently_added_enabled','ott_auto_scroll','ott_auto_scroll_interval',
          'ott_featured_pdf_ids','ott_for_you_title','ott_trending_title',
          'ott_new_arrivals_title','ott_popular_title','ott_ai_reco_title',
          'ott_continue_title','ott_recent_title','ott_animation_speed'
        ]);
      if (data && data.length) {
        data.forEach(r => {
          const map = {
            'ott_for_you_enabled': 'for_you_enabled',
            'ott_continue_enabled': 'continue_reading_enabled',
            'ott_ai_reco_enabled': 'ai_reco_enabled',
            'ott_trending_enabled': 'trending_enabled',
            'ott_popular_enabled': 'popular_enabled',
            'ott_new_arrivals_enabled': 'new_arrivals_enabled',
            'ott_recently_added_enabled': 'recently_added_enabled',
            'ott_auto_scroll': 'auto_scroll_enabled',
            'ott_auto_scroll_interval': 'auto_scroll_interval',
            'ott_featured_pdf_ids': 'featured_pdf_ids',
            'ott_for_you_title': 'for_you_title',
            'ott_trending_title': 'trending_title',
            'ott_new_arrivals_title': 'new_arrivals_title',
            'ott_popular_title': 'popular_title',
            'ott_ai_reco_title': 'ai_reco_title',
            'ott_continue_title': 'continue_title',
            'ott_recent_title': 'recent_title',
            'ott_animation_speed': 'animation_speed',
          };
          const skey = map[r.key];
          if (skey) {
            const v = r.value;
            if (v === '1' || v === 'true') window._ottSettings[skey] = true;
            else if (v === '0' || v === 'false') window._ottSettings[skey] = false;
            else if (skey === 'featured_pdf_ids') { try { window._ottSettings[skey] = JSON.parse(v); } catch(e){} }
            else if (skey === 'auto_scroll_interval') window._ottSettings[skey] = parseInt(v) || 4500;
            else window._ottSettings[skey] = v;
          }
        });
      }
    } catch(e) { /* use defaults */ }
  }

  // ── HERO CARD HTML — JioHotstar / Netflix Full-Poster Layout ────
  function ottHeroCardHTML(pdf, isActive, rank) {
    if (!pdf) return '';

    // Full-bleed background
    const coverStyle = pdf.cover_url
      ? `background-image:url('${pdf.cover_url}');background-size:cover;background-position:center top`
      : `background:linear-gradient(160deg,${pdf._ott_grad||'#0a1e5e,#0d2e6a'})`;

    const rankNum  = rank != null ? rank : null;
    const catLabel = (pdf.category || pdf.badge || pdf.tag || '').slice(0, 16);
    const ctaLabel = (pdf.free || !pdf.price || Number(pdf.price) === 0)
      ? '▶ Read Free' : '👁 View Details';

    // Price
    const isFree = pdf.free || !pdf.price || Number(pdf.price) === 0;
    const priceHTML = isFree
      ? `<div class="ott-hero-price is-free">FREE</div>`
      : `<div class="ott-hero-price is-paid">₹${Number(pdf.price).toLocaleString()}</div>`;

    // Compact metadata row: author • category • pages
    const metaParts = [];
    if (pdf.author) metaParts.push(`✍ ${pdf.author.slice(0,14)}`);
    if (catLabel) metaParts.push(catLabel);
    if (pdf.pages) metaParts.push(`${pdf.pages}p`);
    const metaRow = metaParts.length > 0
      ? `<div class="ott-hero-card-meta">${metaParts.map((part, idx) =>
          idx < metaParts.length - 1
            ? `<span>${part}</span><span class="ott-hero-card-meta-dot"></span>`
            : `<span>${part}</span>`
        ).join('')}</div>`
      : '';

    // Fallback cover emoji
    const fallbackInner = !pdf.cover_url
      ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:5rem;opacity:.2;z-index:0">📄</div>`
      : '';

    return `
    <div class="ott-hero-card${isActive?' active-card':''}" onclick="openPDFDetail('${pdf.id}')" data-ott-id="${pdf.id}">
      <!-- Full-bleed poster image -->
      <div class="ott-hero-card-bg" style="${coverStyle}"></div>
      ${fallbackInner}

      <!-- Dark gradient overlay for readability -->
      <div class="ott-hero-card-overlay"></div>

      <!-- Top badges row -->
      <div class="ott-hero-top-row">
        <div style="display:flex;flex-direction:column;gap:4px">
          ${rankNum != null ? `<div class="ott-hero-rank-badge"><span class="rk-icon">🏅</span> #${rankNum}</div>` : ''}
        </div>
        ${catLabel ? `<div class="ott-hero-cat-badge">${catLabel}</div>` : ''}
      </div>

      <!-- Floating wishlist + share buttons — right side, circular -->
      <div class="ott-hero-float-actions">
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
          <button class="ott-hero-float-btn" title="Save to Wishlist"
            onclick="event.stopPropagation();typeof toggleWish==='function'&&toggleWish('${pdf.id}')">♡</button>
          <span class="ott-hero-float-label">Save</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
          <button class="ott-hero-float-btn" title="Share"
            onclick="event.stopPropagation();if(navigator.share){navigator.share({title:'${(pdf.title||'').replace(/'/g,'\\\'').replace(/"/g,'&quot;')}',url:location.href})}">⤴</button>
          <span class="ott-hero-float-label">Share</span>
        </div>
      </div>

      <!-- Bottom info overlay — clean hierarchy -->
      <div class="ott-hero-info">
        <div class="ott-hero-card-title">${pdf.title||'Untitled'}</div>
        ${metaRow}
        ${priceHTML}
        <div class="ott-hero-cta-row">
          <button class="ott-hero-cta" onclick="event.stopPropagation();openPDFDetail('${pdf.id}')">${ctaLabel}</button>
          <button class="ott-hero-save" onclick="event.stopPropagation();typeof toggleWish==='function'&&toggleWish('${pdf.id}')">♡ Save</button>
        </div>
      </div>
    </div>`;
  }

  // ── Seeded deterministic rating (same pdf → same number always) ───
  // Used ONLY until a PDF has real reviews — see _loadCardRatings() which
  // swaps this out for the genuine Supabase average the moment real
  // reviews exist (mirrors the same real-data-first pattern already used
  // on the PDF detail page's _pdpLoadLiveStats/_pdpMarketingData).
  function _ottSeededRating(id) {
    // djb2-style string hash — spreads UUIDs across the full range instead
    // of clustering (char-code sums collide too easily for near-identical
    // UUID prefixes).
    let h = 5381;
    const s = String(id);
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0; h ^= h >>> 16;
    const seed = (h >>> 0) / 4294967296;
    return Math.round((4.5 + seed * 0.5) * 10) / 10; // 4.5 → 5.0 (wider spread so ratings don't all look identical)
  }
  const _ottStarSvg = `<svg width="10" height="10" viewBox="0 0 24 24" style="vertical-align:-1px;margin-right:2px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="#f59e0b"/></svg>`;
  window._ottStarSvgHTML = _ottStarSvg; // expose for _loadCardRatings (different script scope)
  window._ottSeededRating = _ottSeededRating; // expose so Library card renderers show the same 4.7-5.0 default rating

  // ── OTT ROW CARD HTML ────────────────────────────────────────────
  function ottCardHTML(pdf, rank, showProgress, progressPct) {
    if (!pdf) return '';
    const tag = pdf.badge || pdf.tag || (pdf.free ? 'Free' : '');
    const tagClass = pdf.free ? 'tag-free' : pdf.badge === 'NEW' ? 'tag-new' : pdf.badge === 'BESTSELLER' ? 'tag-bestseller' : 'tag-trending';
    const priceText = (pdf.free || !pdf.price || Number(pdf.price)===0) ? 'FREE' : '₹'+Number(pdf.price).toLocaleString();
    const isFree = pdf.free || Number(pdf.price)===0;
    // Real rating if already fetched this session, else an attractive
    // deterministic placeholder (auto-upgrades to real once reviews exist).
    const cached = window._cardRatingCache && window._cardRatingCache[String(pdf.id)];
    const ratingVal   = cached ? cached.avgRating : _ottSeededRating(pdf.id);
    const ratingCount = cached ? cached.reviewCount : 0;
    return `
    <div class="ott-card${showProgress?' continue-card':''}" onclick="openPDFDetail('${pdf.id}')" data-pdf-id="${pdf.id}">
      <div class="ott-card-cover">
        ${pdf.cover_url
          ? `<img src="${pdf.cover_url}" alt="${(pdf.title||'').replace(/"/g,'')}" loading="lazy" onerror="this.style.display='none'">`
          : `<div style="font-size:2.5rem;opacity:.4">📄</div>`}
        <div class="ott-card-cover-scrim"></div>
        ${tag ? `<div class="ott-card-tag ${tagClass}">${tag}</div>` : ''}
        ${rank ? `<div class="ott-card-rank">${rank}</div>` : ''}
      </div>
      <div class="ott-card-body">
        <div class="ott-card-title">${pdf.title||'Untitled'}</div>
        <div class="ott-card-rating">${_ottStarSvg}<span>${ratingVal.toFixed(1)}</span>${ratingCount > 0 ? `<span class="ott-card-rating-count">(${ratingCount})</span>` : ''}</div>
        <div class="ott-card-price ${isFree?'free-p':''}">${priceText}</div>
        ${showProgress ? `<div class="ott-card-progress"><div class="ott-card-progress-fill" style="width:${progressPct||35}%"></div></div>` : ''}
      </div>
    </div>`;
  }

  // ── SLIDE — moves exactly ONE card per call ───────────────────────
  // dir: +1 = next (swipe left / right-arrow / next-btn)
  //      -1 = prev (swipe right / left-arrow / prev-btn)
  function ottSlide(trackId, dir) {
    const track = document.getElementById(trackId);
    if (!track) return;
    const cards = track.querySelectorAll('.ott-hero-card');
    const total = cards.length;
    if (!total) return;
    if (trackId === 'forYouTrack') {
      _ottCarousel.forYou = (_ottCarousel.forYou + dir + total) % total;
      ottUpdateHeroCarousel();
      ottSaveCarouselState();
    }
  }

  // ── Compute card slot width from the actual first card DOM element ──────────
  // Reading offsetWidth after layout is stable is the only reliable approach.
  // CSS-derived calculations (vw * fraction) do not account for max-width clamps,
  // subpixel rounding, or margin collapsing — all of which cause the track
  // translateX to land slightly wrong and shift the active card off-center.
  //
  // We read: cardW = firstCard.offsetWidth (the true rendered width)
  //          margin = 8px left + 8px right = 16px (must match CSS .ott-hero-card margin)
  //          slotW  = cardW + 16
  //
  // If no cards exist yet (called too early), we fall back to the CSS estimate.
  function _ottCardSlotWidth(firstCard) {
    const MARGIN = 16; // 8px left + 8px right — MUST match CSS margin: 0 8px
    let cardW;
    if (firstCard && firstCard.offsetWidth > 0) {
      cardW = firstCard.offsetWidth;
    } else {
      // Fallback: mirror CSS flex: 0 0 Xvw + max-width clamp
      const vw = window.innerWidth;
      if (vw >= 1024)      cardW = Math.min(vw * 0.70, 580);
      else if (vw >= 640)  cardW = Math.min(vw * 0.74, 540);
      else                 cardW = Math.min(vw * 0.76, 600);
      cardW = Math.max(240, Math.min(cardW, 600));
    }
    return { cardW, slotW: cardW + MARGIN };
  }

  function ottUpdateHeroCarousel() {
    const track = document.getElementById('forYouTrack');
    if (!track) return;
    const cards = Array.from(track.querySelectorAll('.ott-hero-card'));
    if (!cards.length) return;

    // Clamp index
    const total = cards.length;
    if (_ottCarousel.forYou < 0) _ottCarousel.forYou = 0;
    if (_ottCarousel.forYou >= total) _ottCarousel.forYou = total - 1;
    const i = _ottCarousel.forYou;

    // Apply visual states FIRST so cards have their final size before we measure
    cards.forEach((c, ci) => {
      c.classList.remove('active-card', 'peek-prev', 'peek-next', 'peek');
      c.style.zIndex = '';
      if      (ci === i)     { c.classList.add('active-card'); c.style.zIndex = '20'; }
      else if (ci === i - 1) { c.classList.add('peek-prev');   c.style.zIndex = '5';  }
      else if (ci === i + 1) { c.classList.add('peek-next');   c.style.zIndex = '5';  }
      else                   { c.classList.add('peek');         c.style.zIndex = '1';  }
    });

    // Measure the active card's ACTUAL rendered width (post-CSS clamp)
    const { cardW, slotW } = _ottCardSlotWidth(cards[i]);

    // Outer viewport width
    const trackOuter = track.parentElement;
    const outerW = trackOuter ? trackOuter.offsetWidth || trackOuter.getBoundingClientRect().width : window.innerWidth;

    // Centering formula:
    //   Each card occupies slotW pixels (cardW + 16px margins).
    //   Card i's left edge is at: i * slotW + 8  (first card has 8px left margin)
    //   Card i's center is at:    i * slotW + 8 + cardW/2
    //   We want that center at:   outerW/2
    //   So track must be shifted: offset = outerW/2 − (i * slotW + 8 + cardW/2)
    const FIRST_MARGIN = 8; // left margin of card[0] — matches CSS :first-child
    const offset = (outerW / 2) - (i * slotW + FIRST_MARGIN + cardW / 2);

    // Disable transition briefly for instant reset on resize/restore,
    // then re-enable on the next frame
    const isInstant = track.dataset.ottInstant === '1';
    if (isInstant) {
      track.style.transition = 'none';
      track.style.transform = `translateX(${offset}px)`;
      // Force reflow so the 'none' transition takes effect before we restore it
      void track.offsetWidth;
      track.style.transition = '';
      track.dataset.ottInstant = '';
    } else {
      track.style.transform = `translateX(${offset}px)`;
    }

    // Sync pagination dots
    const dotsEl = document.getElementById('forYouDots');
    if (dotsEl) {
      dotsEl.querySelectorAll('.ott-dot').forEach((d, di) => {
        d.classList.toggle('active', di === i);
      });
    }

    // Reset BG parallax on active card
    const bg = cards[i]?.querySelector('.ott-hero-card-bg');
    if (bg) bg.style.transform = 'scale(1.0) translateX(0px)';
  }

  // ── Reset carousel layout on resize / orientation change / page restore ──────
  // Mark track for instant (no-animation) reposition so the card doesn't
  // visibly slide to catch up after the viewport changes.
  function _ottResetLayout() {
    const track = document.getElementById('forYouTrack');
    if (track) track.dataset.ottInstant = '1';
    ottUpdateHeroCarousel();
  }

  let _ottResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_ottResizeTimer);
    _ottResizeTimer = setTimeout(_ottResetLayout, 120);
  });

  // Orientation change fires before resize completes; wait an extra tick
  window.addEventListener('orientationchange', () => {
    clearTimeout(_ottResizeTimer);
    _ottResizeTimer = setTimeout(_ottResetLayout, 250);
  });

  // bfcache / page restore — resets frozen transform after browser back
  window.addEventListener('pageshow', e => {
    if (e.persisted) {
      // Page was restored from bfcache — transform may be stale
      setTimeout(() => {
        const track = document.getElementById('forYouTrack');
        if (track) track.dataset.ottInstant = '1';
        ottRestoreCarouselState();
        ottUpdateHeroCarousel();
        ottInitSwipe('forYouTrack');
        ottStopAutoScroll();
        setTimeout(ottStartAutoScroll, 600);
      }, 100);
    }
  });

  // Also reset on visibility restore (tab switch back) — PERF: stop auto-scroll when hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Pause auto-scroll to save battery while tab is not visible
      ottStopAutoScroll();
    } else {
      const track = document.getElementById('forYouTrack');
      if (track && track.querySelector('.ott-hero-card')) {
        track.dataset.ottInstant = '1';
        ottUpdateHeroCarousel();
      }
      // Resume auto-scroll
      if (window._ottSettings?.auto_scroll_enabled) setTimeout(ottStartAutoScroll, 300);
    }
  });

  // ── AUTO-SCROLL — PERF: pauses when tab hidden ────────────────────
  function ottStartAutoScroll() {
    if (!window._ottSettings.auto_scroll_enabled) return;
    if (_ottCarousel.autoScrollTimer) {
      clearInterval(_ottCarousel.autoScrollTimer);
      _ottCarousel.autoScrollTimer = null;
    }
    const interval = window._ottSettings.auto_scroll_interval || 4500;
    const dotsEl = document.getElementById('forYouDots');
    if (dotsEl) dotsEl.style.setProperty('--dot-dur', interval + 'ms');
    _syncDotAnim();
    _ottCarousel.autoScrollTimer = setInterval(() => {
      // PERF: skip scroll work when tab is hidden
      if (document.hidden) return;
      const track = document.getElementById('forYouTrack');
      if (!track) { ottStopAutoScroll(); return; }
      const total = track.querySelectorAll('.ott-hero-card').length;
      if (!total) return;
      _ottCarousel.forYou = (_ottCarousel.forYou + 1) % total;
      ottUpdateHeroCarousel();
      ottSaveCarouselState();
      _syncDotAnim();
    }, interval);
  }

  function _syncDotAnim() {
    const dotsEl = document.getElementById('forYouDots');
    if (!dotsEl) return;
    const activeDot = dotsEl.querySelector('.ott-dot.active');
    if (!activeDot) return;
    activeDot.style.animation = 'none';
    void activeDot.offsetWidth;
    activeDot.style.animation = '';
    activeDot.classList.remove('active');
    void activeDot.offsetWidth;
    activeDot.classList.add('active');
  }

  function ottStopAutoScroll() {
    if (_ottCarousel.autoScrollTimer) {
      clearInterval(_ottCarousel.autoScrollTimer);
      _ottCarousel.autoScrollTimer = null;
    }
  }

  // ── SWIPE / DRAG SUPPORT ─────────────────────────────────────────
  // Uses named function references stored on _ottCarousel so they can be
  // removed cleanly by ottDestroyCarousel() before each re-init.
  // This is the only correct way to prevent stacked listeners across
  // SPA page visits — DOM-element flags get stale and anonymous functions
  // can never be removeEventListener'd.
  //
  // Direction mapping (confirmed correct):
  //   dx < 0  (finger/mouse moved LEFT)  → next card  (dir = +1)
  //   dx > 0  (finger/mouse moved RIGHT) → prev card  (dir = -1)
  function ottInitSwipe(trackId) {
    const outer = document.getElementById(trackId)?.parentElement;
    if (!outer) return;

    // Always destroy before re-attaching to prevent listener stacking
    ottDestroyCarousel();
    _ottCarousel._outerEl = outer;

    let sx = 0, isDragging = false;
    const THRESHOLD = 30; // px — minimum drag to count as a swipe

    _ottCarousel._mousedown = e => {
      isDragging = true; sx = e.clientX; ottStopAutoScroll();
    };
    _ottCarousel._mousemove = e => {
      if (!isDragging) return;
      if (Math.abs(e.clientX - sx) > 6) e.preventDefault();
    };
    _ottCarousel._mouseup = e => {
      if (!isDragging) return;
      isDragging = false;
      const dx = e.clientX - sx;
      // dx < 0 = swiped left = go to NEXT card
      // dx > 0 = swiped right = go to PREV card
      if (Math.abs(dx) > THRESHOLD) ottSlide(trackId, dx < 0 ? 1 : -1);
      ottStartAutoScroll();
    };
    _ottCarousel._mouseleave = () => {
      if (isDragging) { isDragging = false; ottStartAutoScroll(); }
    };
    _ottCarousel._touchstart = e => {
      sx = e.touches[0].clientX; ottStopAutoScroll();
    };
    _ottCarousel._touchmove = e => {
      if (Math.abs(e.touches[0].clientX - sx) > 8) e.preventDefault();
    };
    _ottCarousel._touchend = e => {
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > THRESHOLD) ottSlide(trackId, dx < 0 ? 1 : -1);
      ottStartAutoScroll();
    };

    outer.addEventListener('mousedown',  _ottCarousel._mousedown);
    outer.addEventListener('mousemove',  _ottCarousel._mousemove);
    outer.addEventListener('mouseup',    _ottCarousel._mouseup);
    outer.addEventListener('mouseleave', _ottCarousel._mouseleave);
    outer.addEventListener('touchstart', _ottCarousel._touchstart, { passive: true });
    outer.addEventListener('touchmove',  _ottCarousel._touchmove,  { passive: false });
    outer.addEventListener('touchend',   _ottCarousel._touchend,   { passive: true });
  }

  // ── AI RECOMMENDATION ENGINE ─────────────────────────────────────
  // ── Featured Categories row (Home) ──────────────────────────────
  // Pulls live categories from Supabase (window._dbCategories, loaded by
  // loadCategoriesFromDB), shows only featured + enabled ones, sorted by
  // sort_order, with a live PDF count computed from window.PDFS. Safe to
  // call before categories have loaded — it just no-ops until they have.
  // Returns the PDFs that belong to a given category — category_id is
  // the primary/authoritative match (a PDF's category_id already points
  // at the top-level category regardless of which subcategory it was
  // filed under, so subcategories are automatically included for free).
  // Falls back to matching the plain-text `category` name for any older
  // rows that predate category_id. Published-only, drafts/deleted/
  // archived are excluded (defensive — window.PDFS is already
  // published-only per pdf-list.js, this is just belt-and-braces).
  function ottPdfsForCategory(pdfs, cat) {
    return pdfs.filter(p => {
      if (!p || !p.title) return false;
      if (p.status === 'draft' || p.status === 'deleted' || p.status === 'archived') return false;
      if (p.category_id != null && cat.id != null) return String(p.category_id) === String(cat.id);
      return p.category === cat.name;
    });
  }

  // Build one full OTT row (exact same markup as Trending/Popular/etc.)
  // for a single category, pre-filled with its matching PDF cards.
  function ottCategoryRowHTML(cat, pdfsInCat) {
    const color = (cat.color && cat.color.startsWith('#')) ? cat.color : '#3d8ef8';
    const sorted = [...pdfsInCat].sort((a, b) =>
      (Number(b.download_count || b.sales || 0)) - (Number(a.download_count || a.sales || 0)));
    const cards = sorted.slice(0, 15).map(p => ottCardHTML(p)).join('');
    const safeName = (cat.name || '').replace(/'/g, "\\'");
    return `
    <section class="ott-row-section" id="ottCatRow_${cat.id}">
      <div class="container">
        <div class="ott-section-head">
          <div class="ott-section-label">
            <span class="ott-label-dot" style="background:${color}"></span>
            <span class="ott-label-text">${cat.icon || '📚'} ${cat.name}</span>
            <span class="ott-label-badge" style="background:${color}26;color:${color};border-color:${color}59">${pdfsInCat.length} PDF${pdfsInCat.length === 1 ? '' : 's'}</span>
          </div>
          <button class="ott-see-all" onclick="ottSeeAllCategory('${safeName}')">See All →</button>
        </div>
      </div>
      <div class="ott-row-outer">
        <div class="ott-row-track">${cards}</div>
      </div>
    </section>`;
  }

  // ── Dynamic per-category rows (replaces the old Featured Category
  // card carousel) — one horizontal PDF slider per category that has
  // at least one published PDF; categories with zero PDFs are skipped
  // entirely (never shown, never show "0 PDFs"). Fully automatic: pulls
  // live categories from Supabase (window._dbCategories, loaded by
  // loadCategoriesFromDB) and live PDFs from window.PDFS — no manual
  // assignment, no hardcoded lists, no caching to bust.
  window.ottRenderFeaturedCategories = function() {
    const container = document.getElementById('ottCategoryRowsContainer');
    if (!container) return;
    const cats = (window._dbCategories || [])
      .filter(c => c.enabled !== false)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const pdfs = window.PDFS || [];
    const rows = cats
      .map(c => ({ cat: c, pdfsInCat: ottPdfsForCategory(pdfs, c) }))
      .filter(r => r.pdfsInCat.length > 0)
      .map(r => ottCategoryRowHTML(r.cat, r.pdfsInCat));
    container.innerHTML = rows.join('');
  };

  // "See All →" on a category row → jump to Library pre-filtered to
  // that category (Library applies the filter itself once its own
  // render cycle finishes).
  window.ottSeeAllCategory = function(name) {
    navigate('library');
    setTimeout(() => { if (typeof setLibCatFilter === 'function') setLibCatFilter(name); }, 350);
  };

  // Legacy alias kept for any old onclick= references still around.
  window.ottGoToCategory = function(name) { window.ottSeeAllCategory(name); };

  function ottGetAIReco(pdfs, userHistory) {
    // Simple score: combine downloads + recency + category match
    const histCats = new Set((userHistory||[]).map(p => p.category).filter(Boolean));
    return [...pdfs]
      .map(p => {
        let score = Number(p.download_count||p.sales||0) * 0.4;
        if (histCats.size && histCats.has(p.category)) score += 50;
        const ageMs = Date.now() - new Date(p.created_at||0).getTime();
        const ageDays = ageMs / 86400000;
        if (ageDays < 7) score += 30;
        else if (ageDays < 30) score += 15;
        return { ...p, _aiScore: score };
      })
      .sort((a,b) => b._aiScore - a._aiScore);
  }

  // ── MAIN RENDER ──────────────────────────────────────────────────
  // Smart guard: if the carousel is already initialized with the same PDF set,
  // just restore the saved position instead of destroying and rebuilding the
  // whole DOM. This is the key fix for the back-navigation corruption:
  //   navigate('home') previously forced a full re-render every time, which
  //   reset index to 0, wiped cards mid-animation, and left swipe handlers
  //   in an undefined state.
  async function ottRenderDiscovery(forceRebuild) {
    await ottLoadSettings();
    const s = window._ottSettings;
    const pdfs = (window.PDFS || []).filter(p => p && p.title && p.status !== 'draft');

    // Show/hide sections
    const show = (id, flag) => {
      const el = document.getElementById(id);
      if (el) el.style.display = flag ? '' : 'none';
    };
    show('ottForYouSection',   s.for_you_enabled);
    show('ottAISection',       s.ai_reco_enabled);
    show('ottTrendingSection', s.trending_enabled);
    show('ottPopularSection',  s.popular_enabled);
    show('ottNewSection',      s.new_arrivals_enabled);
    show('ottRecentSection',   s.recently_added_enabled);

    if (!pdfs.length) return;

    // ── For You Hero Carousel ──────────────────────────────────────
    if (s.for_you_enabled) {
      let featured = pdfs;
      if (s.featured_pdf_ids && s.featured_pdf_ids.length) {
        const fSet = new Set(s.featured_pdf_ids.map(String));
        const manual = pdfs.filter(p => fSet.has(String(p.id)));
        featured = manual.length >= 2
          ? manual
          : [...manual, ...pdfs.filter(p => !fSet.has(String(p.id)))].slice(0, 8);
      } else {
        featured = [...pdfs]
          .sort((a, b) => (Number(b.download_count || b.sales || 0)) - (Number(a.download_count || a.sales || 0)))
          .slice(0, 8);
      }

      const grads = [
        '#0a1e5e,#0d2e6a','#1a0a2e,#2d1060','#004d40,#001a16',
        '#3d2800,#180f00','#1a0010,#2d0020','#0c1a2e,#0f2848'
      ];
      featured.forEach((p, i) => { p._ott_grad = grads[i % grads.length]; });

      // Fingerprint the featured set — if unchanged and cards already exist,
      // just restore the saved scroll position (skip full DOM rebuild)
      const newFingerprint = JSON.stringify(featured.map(p => p.id));
      const track = document.getElementById('forYouTrack');

      const cardsExist = track && track.querySelectorAll('.ott-hero-card').length === featured.length;
      const sameSet    = _ottCarousel.featuredIds === newFingerprint;

      if (!forceRebuild && cardsExist && sameSet) {
        // ── RESTORE PATH: same cards, just re-snap and re-attach swipe ──
        ottRestoreCarouselState();
        const track2 = document.getElementById('forYouTrack');
        if (track2) track2.dataset.ottInstant = '1';
        ottUpdateHeroCarousel();
        ottInitSwipe('forYouTrack');   // re-attach (destroy is called inside)
        ottStopAutoScroll();
        setTimeout(ottStartAutoScroll, 600);
        return; // skip the rest (rows rendered on first load are still intact)
      }

      // ── FULL BUILD PATH: first load or PDF set changed ─────────────
      if (track) {
        ottDestroyCarousel(); // clean up old timer + listeners before touching DOM
        track.innerHTML = featured.map((p, i) => ottHeroCardHTML(p, i === 0, i + 1)).join('');

        const dotsEl = document.getElementById('forYouDots');
        if (dotsEl) {
          dotsEl.innerHTML = featured.map((_, di) =>
            `<div class="ott-dot${di === 0 ? ' active' : ''}" onclick="ottGoTo(${di})"></div>`
          ).join('');
        }

        _ottCarousel.featuredIds = newFingerprint;
        _ottCarousel.total       = featured.length;

        // Restore saved index if it's still valid for this set
        ottRestoreCarouselState();

        // Use instant (no-animation) snap on first render so the card
        // doesn't slide in from offset-0 visibly on page load
        track.dataset.ottInstant = '1';
        ottUpdateHeroCarousel();
        ottInitSwipe('forYouTrack');

        // Deferred re-snap: the browser may not have laid out card widths
        // on the first call (offsetWidth = 0). Re-measure after first paint.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const t = document.getElementById('forYouTrack');
            if (t) t.dataset.ottInstant = '1';
            ottUpdateHeroCarousel();
          });
        });

        setTimeout(ottStartAutoScroll, 1500);
      }
    }

    // ── Continue Reading ───────────────────────────────────────────
    const history = [];
    try {
      const raw = localStorage.getItem('studyria_reading_history');
      if (raw) {
        JSON.parse(raw).forEach(id => {
          const p = pdfs.find(x => String(x.id) === String(id));
          if (p) history.push(p);
        });
      }
    } catch(e) {}
    if (s.continue_reading_enabled && history.length > 0) {
      show('ottContinueSection', true);
      const ct = document.getElementById('ottContinueTrack');
      if (ct) ct.innerHTML = history.slice(0, 10)
        .map(p => ottCardHTML(p, null, true, Math.floor(Math.random() * 60 + 20))).join('');
    } else {
      show('ottContinueSection', false);
    }

    // ── AI Recommended ─────────────────────────────────────────────
    if (s.ai_reco_enabled) {
      const at = document.getElementById('ottAITrack');
      if (at) at.innerHTML = ottGetAIReco(pdfs, history).slice(0, 15).map(p => ottCardHTML(p)).join('');
    }

    // ── Trending ───────────────────────────────────────────────────
    if (s.trending_enabled) {
      const tt = document.getElementById('ottTrendingTrack');
      if (tt) tt.innerHTML = [...pdfs]
        .sort((a, b) => (Number(b.download_count || b.sales || 0)) - (Number(a.download_count || a.sales || 0)))
        .slice(0, 15).map(p => ottCardHTML(p)).join('');
    }

    // ── Popular ────────────────────────────────────────────────────
    if (s.popular_enabled) {
      const pt = document.getElementById('ottPopularTrack');
      if (pt) pt.innerHTML = [...pdfs]
        .sort((a, b) => (Number(b.views || 0) + Number(b.sales || 0) * 2) - (Number(a.views || 0) + Number(a.sales || 0) * 2))
        .slice(0, 12).map((p, i) => ottCardHTML(p, i < 6 ? i + 1 : null)).join('');
    }

    // ── New Arrivals ───────────────────────────────────────────────
    if (s.new_arrivals_enabled) {
      const cutoff = Date.now() - 30 * 86400000;
      const newPdfs = [...pdfs]
        .filter(p => new Date(p.created_at || 0).getTime() > cutoff)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 15);
      const nt = document.getElementById('ottNewTrack');
      if (nt) nt.innerHTML = (newPdfs.length > 0 ? newPdfs : pdfs.slice(0, 10))
        .map(p => ottCardHTML(p)).join('');
    }

    // ── Recently Added ─────────────────────────────────────────────
    if (s.recently_added_enabled) {
      const rt = document.getElementById('ottRecentTrack');
      if (rt) rt.innerHTML = [...pdfs]
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 15).map(p => ottCardHTML(p)).join('');
    }

    // ── Featured Categories ────────────────────────────────────────
    ottRenderFeaturedCategories();

    // ── Section labels from CMS settings ──────────────────────────
    const labelMap = {
      'ottForYouSection':   s.for_you_title,
      'ottAISection':       s.ai_reco_title,
      'ottTrendingSection': s.trending_title,
      'ottPopularSection':  s.popular_title,
      'ottNewSection':      s.new_arrivals_title,
      'ottContinueSection': s.continue_title,
      'ottRecentSection':   s.recent_title,
    };
    Object.entries(labelMap).forEach(([secId, title]) => {
      if (!title) return;
      const lbl = document.getElementById(secId)?.querySelector('.ott-label-text');
      if (lbl) lbl.textContent = title;
    });
  }

  function ottGoTo(idx) {
    _ottCarousel.forYou = idx;
    ottUpdateHeroCarousel();
    ottSaveCarouselState();
    ottStopAutoScroll();
    setTimeout(ottStartAutoScroll, 3000);
  }

  // ── BOOT: initial render when PDFs are ready ──────────────────────
  (function() {
    function _tryOTT() {
      if (window.PDFS && window.PDFS.length > 0) {
        ottRenderDiscovery();
      } else {
        setTimeout(_tryOTT, 600);
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(_tryOTT, 800));
    } else {
      setTimeout(_tryOTT, 800);
    }
  })();

  // ── SPA NAVIGATION EVENT — fired by studyria navigate() ───────────
  // Uses the restore path (no forceRebuild) so the same card set is
  // just re-snapped to the saved index without DOM destruction.
  document.addEventListener('studyria:navigate', (e) => {
    if (e.detail === 'home' && window.PDFS && window.PDFS.length) {
      setTimeout(() => ottRenderDiscovery(false), 200);
    }
  });

  // ── BFCACHE / PAGE RESTORE (pageshow with persisted=true) ─────────
  // When the browser restores a page from bfcache, frozen timers and
  // stale transforms are the norm. We recalculate snap position and
  // restart autoscroll without touching the DOM or re-running SQL queries.
  window.addEventListener('pageshow', e => {
    if (e.persisted) {
      // Page was restored from bfcache — DOM is intact, just fix live state
      setTimeout(() => {
        ottRestoreCarouselState();
        ottUpdateHeroCarousel();
        // Re-attach swipe (bfcache may have discarded listener closures)
        ottInitSwipe('forYouTrack');
        ottStopAutoScroll();
        setTimeout(ottStartAutoScroll, 400);
      }, 100);
    }
  });

  // ── PAGEHIDE — save state before browser may bfcache the page ─────
  window.addEventListener('pagehide', () => {
    ottSaveCarouselState();
    ottStopAutoScroll(); // stop timer — it won't survive bfcache anyway
  });
  