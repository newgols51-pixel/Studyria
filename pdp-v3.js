/* ═══════════════════════════════════════════════════════════════════════
   STUDYRIA — PDF PRODUCT DETAIL PAGE V3 GALLERY ENGINE
   Click/tap-driven gallery replaces scroll-driven preview.
   Fixes auto-zoom on Android/iOS.
   Zero new dependencies. Fully compatible with pdp-v2.js + pdp-checkout.js.
   V3 — 2026-08-01
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════
     SECTION 1 — VIEWPORT ZOOM LOCK
     Prevents iOS/Android from auto-zooming the product image on scroll.
     ══════════════════════════════════════════════════════════════════ */

  // Store original viewport content so we can restore on leave
  var _origViewportContent = null;

  function _lockViewport() {
    var vp = document.querySelector('meta[name="viewport"]');
    if (!vp) return;
    _origViewportContent = vp.getAttribute('content');
    // maximum-scale=1 + user-scalable=no prevents ALL browser-level zoom
    vp.setAttribute('content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
  }

  function _unlockViewport() {
    var vp = document.querySelector('meta[name="viewport"]');
    if (!vp) return;
    // Restore to original — important for other pages (auth, login etc)
    if (_origViewportContent) {
      vp.setAttribute('content', _origViewportContent);
    } else {
      vp.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
    }
    _origViewportContent = null;
  }

  // Install the viewport lock override for V2 (replaces the old one)
  window._pdpInstallZoomControl = function () {
    _lockViewport();
    // Belt-and-suspenders: reset visual viewport scale if it drifted
    var resetScale = function () {
      if (window.visualViewport && window.visualViewport.scale > 1.02) {
        _lockViewport(); // toggling content resets scale
      }
    };
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', resetScale, { passive: true });
      window._pdpVpResizeHandler = resetScale;
    }
    // cleanup fn called by _pdpLeavePage in pdp-v2.js
    window._pdpZoomCleanup = function () {
      _unlockViewport();
      if (window.visualViewport && window._pdpVpResizeHandler) {
        window.visualViewport.removeEventListener('resize', window._pdpVpResizeHandler);
        window._pdpVpResizeHandler = null;
      }
    };
  };

  /* ══════════════════════════════════════════════════════════════════
     SECTION 2 — GALLERY STATE
     ══════════════════════════════════════════════════════════════════ */

  var _gallery = {
    items: [],        // [{type:'cover'|'preview', label, dataUrl, pageNum}]
    activeIdx: 0,
    pdfObj: null,     // pdf data object from window.selectedPdf
    pdfJsDoc: null,   // loaded pdf.js document (if preview PDF exists)
    renderCache: {},  // pageNum → dataURL cache
    thumbCache: {},   // pageNum → thumb dataURL cache
    fsOpen: false,
    fsScale: 1,
    fsOriginX: 0,
    fsOriginY: 0,
    swipeStartX: 0,
    swipeStartY: 0,
    swipeActive: false,
    fsSwipeStartX: 0,
    fsSwipeActive: false,
  };

  /* ══════════════════════════════════════════════════════════════════
     SECTION 3 — WATERMARK
     ══════════════════════════════════════════════════════════════════ */

  function _wm() {
    var u = window.currentUser;
    if (u && u.email) return 'STUDYRIA PREVIEW\nNOT FOR REDISTRIBUTION\n' + (u.email.split('@')[0].slice(0, 14));
    return 'STUDYRIA PREVIEW\nNOT FOR REDISTRIBUTION';
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 4 — PDF.js RENDER HELPERS
     ══════════════════════════════════════════════════════════════════ */

  function _renderPage(pdfDoc, pageNum, scale) {
    scale = scale || 1.8;
    if (_gallery.renderCache[pageNum]) return Promise.resolve(_gallery.renderCache[pageNum]);

    return pdfDoc.getPage(pageNum).then(function (page) {
      var vp = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width  = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      var ctx = canvas.getContext('2d');
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        // Burn diagonal watermark
        var wm = _wm();
        ctx.save();
        ctx.globalAlpha = 0.11;
        ctx.fillStyle   = '#0d1220';
        ctx.font = 'bold ' + Math.max(12, Math.round(canvas.width * 0.038)) + 'px Arial,sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        var step = canvas.width * 0.48;
        for (var x = -canvas.width; x < canvas.width * 2; x += step) {
          for (var y = -canvas.height; y < canvas.height * 2; y += step * 0.58) {
            ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 7);
            wm.split('\n').forEach(function (line, li) {
              ctx.fillText(line, 0, li * Math.max(16, canvas.width * 0.045));
            });
            ctx.restore();
          }
        }
        ctx.restore();
        var url = canvas.toDataURL('image/jpeg', 0.86);
        _gallery.renderCache[pageNum] = url;
        return url;
      });
    });
  }

  function _renderThumb(pdfDoc, pageNum) {
    if (_gallery.thumbCache[pageNum]) return Promise.resolve(_gallery.thumbCache[pageNum]);
    return _renderPage(pdfDoc, pageNum, 0.38).then(function (url) {
      _gallery.thumbCache[pageNum] = url;
      return url;
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 5 — GALLERY INIT
     Called by pdpInitPreview (override below) after the shell renders.
     ══════════════════════════════════════════════════════════════════ */

  async function _initGallery(pdf) {
    // Reset state
    _gallery.items       = [];
    _gallery.activeIdx   = 0;
    _gallery.pdfObj      = pdf;
    _gallery.pdfJsDoc    = null;
    _gallery.renderCache = {};
    _gallery.thumbCache  = {};

    var galleryEl = document.getElementById('pdpV3Gallery');
    if (!galleryEl) return;

    var coverSrc = (pdf.coverImage || pdf.cover_image || pdf.cover_url || '').trim();

    // ITEM 0: always the cover image
    _gallery.items.push({ type: 'cover', label: 'Cover', src: coverSrc });

    // Load preview PDF pages (if available)
    var previewUrl = (pdf.previewPdfUrl || pdf.preview_pdf_url || '').trim();
    if (previewUrl && window.pdfjsLib) {
      _setLoading(true);
      try {
        var doc = await window.pdfjsLib.getDocument({
          url: previewUrl,
          withCredentials: false,
          disableAutoFetch: false,
        }).promise;
        _gallery.pdfJsDoc = doc;
        var total = doc.numPages || 0;

        // Determine which pages to show (max 3, or admin-configured)
        var spec      = pdf.preview_pages || pdf.previewPages || null;
        var looksSpec = spec && /^\d/.test(String(spec).trim());
        var pages;
        if (looksSpec && typeof window._pdpParsePreviewPages === 'function') {
          pages = window._pdpParsePreviewPages(spec, total).slice(0, 3);
        } else {
          pages = [];
          for (var i = 1; i <= Math.min(total, 3); i++) pages.push(i);
        }

        pages.forEach(function (pg) {
          _gallery.items.push({ type: 'preview', label: 'Page ' + pg, pageNum: pg });
        });
      } catch (e) {
        console.warn('[PDP V3] Preview load failed:', e);
      } finally {
        _setLoading(false);
      }
    }

    _buildGalleryDOM();
    _showItem(0, false);
    _buildThumbnails(); // async, fills in gradually
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 6 — GALLERY DOM BUILD
     ══════════════════════════════════════════════════════════════════ */

  function _buildGalleryDOM() {
    var galleryEl = document.getElementById('pdpV3Gallery');
    if (!galleryEl) return;

    var hasMultiple = _gallery.items.length > 1;

    // Only show arrows if multiple items
    var arrowHTML = hasMultiple ? (
      '<button class="pdp-v3-arrow pdp-v3-arrow-prev" id="pdpV3Prev" aria-label="Previous" onclick="window._pdpV3Prev()">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>' +
      '</button>' +
      '<button class="pdp-v3-arrow pdp-v3-arrow-next" id="pdpV3Next" aria-label="Next" onclick="window._pdpV3Next()">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>' +
      '</button>'
    ) : '';

    var indicatorHTML = hasMultiple
      ? '<div class="pdp-v3-page-indicator" id="pdpV3Indicator">1 / ' + _gallery.items.length + '</div>'
      : '';

    galleryEl.innerHTML =
      '<div class="pdp-v3-stage" id="pdpV3Stage">' +
        '<img class="pdp-v3-cover-img" id="pdpV3CoverImg" alt="PDF Cover" draggable="false">' +
        '<img class="pdp-v3-preview-img" id="pdpV3PreviewImg" alt="PDF Preview" draggable="false">' +
        '<div class="pdp-v3-watermark" id="pdpV3Watermark"><div class="pdp-v3-watermark-text" id="pdpV3WmText"></div></div>' +
        '<div class="pdp-v3-loading" id="pdpV3Loading"><div class="pdp-v3-spinner"></div><span class="pdp-v3-loading-text">Loading preview…</span></div>' +
        arrowHTML +
        indicatorHTML +
        '<button class="pdp-v3-fullscreen-btn" id="pdpV3FsBtn" aria-label="Fullscreen preview" onclick="window._pdpV3OpenFullscreen()">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>' +
        '</button>' +
      '</div>' +
      (hasMultiple ? '<div class="pdp-v3-thumb-strip" id="pdpV3ThumbStrip"></div>' : '') +
      '<div class="pdp-v3-action-row">' +
        '<button class="pdp-v3-action-btn" onclick="pdpToggleWish()" id="pdpV3WishBtn">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>' +
          'Wishlist' +
        '</button>' +
        '<button class="pdp-v3-action-btn" onclick="pdpSharePDF()">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>' +
          'Share' +
        '</button>' +
      '</div>';

    // Install swipe on stage
    _installStageSwipe(document.getElementById('pdpV3Stage'));

    // Cover image: no zoom, no transform
    var coverImg = document.getElementById('pdpV3CoverImg');
    if (coverImg) {
      coverImg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      coverImg.addEventListener('dragstart',   function (e) { e.preventDefault(); });
    }

    // Fullscreen button only visible on preview pages
    var fsBtn = document.getElementById('pdpV3FsBtn');
    if (fsBtn) fsBtn.style.display = 'none'; // hidden until a preview is shown
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 7 — SHOW ITEM (cover or preview page)
     ══════════════════════════════════════════════════════════════════ */

  function _showItem(idx, animate) {
    if (idx < 0 || idx >= _gallery.items.length) return;
    _gallery.activeIdx = idx;
    var item      = _gallery.items[idx];
    var coverImg  = document.getElementById('pdpV3CoverImg');
    var previewImg= document.getElementById('pdpV3PreviewImg');
    var wm        = document.getElementById('pdpV3Watermark');
    var wmText    = document.getElementById('pdpV3WmText');
    var fsBtn     = document.getElementById('pdpV3FsBtn');
    var indicator = document.getElementById('pdpV3Indicator');
    var prevBtn   = document.getElementById('pdpV3Prev');
    var nextBtn   = document.getElementById('pdpV3Next');

    if (!coverImg) return;

    // Update arrow states
    if (prevBtn) prevBtn.disabled = (idx === 0);
    if (nextBtn) nextBtn.disabled = (idx === _gallery.items.length - 1);

    // Update indicator
    if (indicator) indicator.textContent = (idx + 1) + ' / ' + _gallery.items.length;

    // Update thumbnail highlight
    _updateThumbHighlight(idx);

    if (item.type === 'cover') {
      // Show cover, hide preview
      if (animate && previewImg.classList.contains('visible')) {
        previewImg.classList.remove('visible');
        coverImg.style.opacity = '1';
      } else {
        previewImg.classList.remove('visible');
        coverImg.style.opacity = '1';
      }
      if (wm) { wm.classList.remove('visible'); }
      if (fsBtn) fsBtn.style.display = 'none';

      // Set cover src
      if (item.src && coverImg.src !== item.src) {
        coverImg.src = item.src;
      } else if (!item.src) {
        coverImg.src = '';
      }

    } else {
      // Preview page
      if (fsBtn) fsBtn.style.display = '';

      _setLoading(true);

      // Fade out: cover becomes faint, preview comes in
      coverImg.style.opacity = '0.12';

      _renderPage(_gallery.pdfJsDoc, item.pageNum, 1.8).then(function (url) {
        // Check we're still on the same item
        if (_gallery.activeIdx !== idx) return;
        if (!document.getElementById('pdpV3Gallery')) return; // navigated away

        previewImg.src = url;
        previewImg.classList.add('visible');
        _setLoading(false);

        if (wm && wmText) {
          wmText.textContent = _wm();
          wm.classList.add('visible');
        }

        // Content protection
        previewImg.addEventListener('contextmenu', function (e) { e.preventDefault(); }, { once: false });
        previewImg.addEventListener('dragstart',   function (e) { e.preventDefault(); }, { once: false });

        // Pre-warm neighbours
        var next = _gallery.items[idx + 1];
        var prev = _gallery.items[idx - 1];
        if (next && next.type === 'preview') _renderPage(_gallery.pdfJsDoc, next.pageNum, 1.8).catch(function () {});
        if (prev && prev.type === 'preview') _renderPage(_gallery.pdfJsDoc, prev.pageNum, 1.8).catch(function () {});

      }).catch(function (e) {
        console.warn('[PDP V3] Render error page', item.pageNum, e);
        _setLoading(false);
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 8 — THUMBNAIL STRIP
     ══════════════════════════════════════════════════════════════════ */

  function _buildThumbnails() {
    var strip = document.getElementById('pdpV3ThumbStrip');
    if (!strip) return;
    strip.innerHTML = '';

    _gallery.items.forEach(function (item, idx) {
      var btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'pdp-v3-thumb' + (idx === 0 ? ' active' : '');
      btn.setAttribute('aria-label', item.label);
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
      btn.onclick = function () { _showItem(idx, true); };

      var placeholder = document.createElement('div');
      placeholder.className = 'pdp-v3-thumb-placeholder';
      placeholder.textContent = item.label || String(idx + 1);
      btn.appendChild(placeholder);

      var labelDiv = document.createElement('div');
      labelDiv.className   = 'pdp-v3-thumb-label';
      labelDiv.textContent = item.label;
      btn.appendChild(labelDiv);

      strip.appendChild(btn);

      // Async load thumbnail
      if (item.type === 'cover' && item.src) {
        // Use cover image directly
        var img = new Image();
        img.onload = function () {
          if (!document.getElementById('pdpV3ThumbStrip')) return;
          var imgEl = document.createElement('img');
          imgEl.src = item.src;
          imgEl.alt = item.label;
          imgEl.draggable = false;
          btn.removeChild(placeholder);
          btn.insertBefore(imgEl, btn.firstChild);
        };
        img.src = item.src;
      } else if (item.type === 'preview' && _gallery.pdfJsDoc) {
        _renderThumb(_gallery.pdfJsDoc, item.pageNum).then(function (url) {
          if (!document.getElementById('pdpV3ThumbStrip')) return;
          var imgEl = document.createElement('img');
          imgEl.src = url;
          imgEl.alt = item.label;
          imgEl.draggable = false;
          imgEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
          btn.removeChild(placeholder);
          btn.insertBefore(imgEl, btn.firstChild);
        }).catch(function () {});
      }
    });
  }

  function _updateThumbHighlight(idx) {
    var strip = document.getElementById('pdpV3ThumbStrip');
    if (!strip) return;
    strip.querySelectorAll('.pdp-v3-thumb').forEach(function (el, i) {
      var isActive = (i === idx);
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    // Auto-scroll active thumb into view
    var activeThumb = strip.children[idx];
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 9 — LOADING STATE
     ══════════════════════════════════════════════════════════════════ */

  function _setLoading(on) {
    var el = document.getElementById('pdpV3Loading');
    if (!el) return;
    if (on) el.classList.add('active');
    else    el.classList.remove('active');
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 10 — SWIPE GESTURES ON STAGE
     ══════════════════════════════════════════════════════════════════ */

  function _installStageSwipe(stage) {
    if (!stage) return;
    var startX = 0, startY = 0, moved = false;

    stage.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      startX   = e.touches[0].clientX;
      startY   = e.touches[0].clientY;
      moved    = false;
    }, { passive: true });

    stage.addEventListener('touchmove', function (e) {
      if (e.touches.length !== 1) return;
      var dx = Math.abs(e.touches[0].clientX - startX);
      var dy = Math.abs(e.touches[0].clientY - startY);
      if (dx > dy && dx > 8) {
        moved = true;
        // Don't call preventDefault — we're passive:true (to not block scroll)
        // The horizontal swipe is detected on touchend
      }
    }, { passive: true });

    stage.addEventListener('touchend', function (e) {
      if (!moved) return;
      var endX = e.changedTouches[0].clientX;
      var diff = startX - endX;
      if (Math.abs(diff) > 50) {
        if (diff > 0) _pdpV3Next(); // swipe left → next
        else          _pdpV3Prev(); // swipe right → prev
      }
      moved = false;
    }, { passive: true });
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 11 — PUBLIC NAV FUNCTIONS
     ══════════════════════════════════════════════════════════════════ */

  function _pdpV3Prev() {
    if (_gallery.activeIdx > 0) _showItem(_gallery.activeIdx - 1, true);
  }
  function _pdpV3Next() {
    if (_gallery.activeIdx < _gallery.items.length - 1) _showItem(_gallery.activeIdx + 1, true);
  }
  window._pdpV3Prev = _pdpV3Prev;
  window._pdpV3Next = _pdpV3Next;

  /* ══════════════════════════════════════════════════════════════════
     SECTION 12 — FULLSCREEN OVERLAY (preview pages only)
     ══════════════════════════════════════════════════════════════════ */

  function _openFullscreen() {
    var item = _gallery.items[_gallery.activeIdx];
    if (!item || item.type === 'cover') return;

    var overlay = document.getElementById('pdpV3Overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id        = 'pdpV3Overlay';
      overlay.className = 'pdp-v3-fullscreen-overlay';
      overlay.innerHTML =
        '<button class="pdp-v3-fs-close" onclick="window._pdpV3CloseFullscreen()" aria-label="Close">✕</button>' +
        '<div class="pdp-v3-fs-img-wrap" id="pdpV3FsImgWrap">' +
          '<img class="pdp-v3-fs-img" id="pdpV3FsImg" alt="Preview" draggable="false">' +
          '<div class="pdp-v3-fs-wm" id="pdpV3FsWm"></div>' +
        '</div>' +
        '<button class="pdp-v3-fs-nav pdp-v3-fs-prev" onclick="window._pdpV3FsPrev()" aria-label="Previous">‹</button>' +
        '<button class="pdp-v3-fs-nav pdp-v3-fs-next" onclick="window._pdpV3FsNext()" aria-label="Next">›</button>' +
        '<div class="pdp-v3-fs-indicator" id="pdpV3FsIndicator"></div>';
      document.body.appendChild(overlay);

      // Install fullscreen swipe + pinch zoom
      _installFsInteraction(overlay);

      // Keyboard nav
      document.addEventListener('keydown', _fsKeyHandler);
    }

    // Load the current preview item
    _gallery.fsOpen = true;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    _fsShowItem(_gallery.activeIdx);
  }

  function _closeFullscreen() {
    var overlay = document.getElementById('pdpV3Overlay');
    if (overlay) {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      setTimeout(function () {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 280);
    }
    _gallery.fsOpen = false;
    document.removeEventListener('keydown', _fsKeyHandler);
  }
  window._pdpV3OpenFullscreen = _openFullscreen;
  window._pdpV3CloseFullscreen = _closeFullscreen;

  function _fsShowItem(idx) {
    if (idx < 0 || idx >= _gallery.items.length) return;
    var item = _gallery.items[idx];
    if (item.type === 'cover') {
      // Skip to next preview
      var nxt = _gallery.items.findIndex(function (it, i) { return i > idx && it.type === 'preview'; });
      if (nxt > -1) { _gallery.activeIdx = nxt; _fsShowItem(nxt); return; }
      _closeFullscreen(); return;
    }
    _gallery.activeIdx = idx;
    var fsImg  = document.getElementById('pdpV3FsImg');
    var fsWm   = document.getElementById('pdpV3FsWm');
    var fsInd  = document.getElementById('pdpV3FsIndicator');
    if (!fsImg) return;

    // Count only preview items for indicator
    var previews    = _gallery.items.filter(function (it) { return it.type === 'preview'; });
    var previewRank = previews.indexOf(item) + 1;
    if (fsInd) fsInd.textContent = 'Preview ' + previewRank + ' / ' + previews.length;
    if (fsWm)  fsWm.textContent  = _wm().split('\n')[0];

    _renderPage(_gallery.pdfJsDoc, item.pageNum, 2.5).then(function (url) {
      if (!document.getElementById('pdpV3Overlay')) return;
      fsImg.src = url;
    }).catch(function () {});

    // Reset zoom
    _gallery.fsScale   = 1;
    _gallery.fsOriginX = 0;
    _gallery.fsOriginY = 0;
    if (fsImg) { fsImg.style.transform = ''; }
  }

  function _pdpV3FsPrev() {
    var previews = _gallery.items.map(function (it, i) { return it.type === 'preview' ? i : -1; }).filter(function (i) { return i >= 0; });
    var curPos   = previews.indexOf(_gallery.activeIdx);
    if (curPos > 0) _fsShowItem(previews[curPos - 1]);
  }
  function _pdpV3FsNext() {
    var previews = _gallery.items.map(function (it, i) { return it.type === 'preview' ? i : -1; }).filter(function (i) { return i >= 0; });
    var curPos   = previews.indexOf(_gallery.activeIdx);
    if (curPos < previews.length - 1) _fsShowItem(previews[curPos + 1]);
  }
  window._pdpV3FsPrev = _pdpV3FsPrev;
  window._pdpV3FsNext = _pdpV3FsNext;

  function _fsKeyHandler(e) {
    if (!_gallery.fsOpen) return;
    if (e.key === 'ArrowRight') _pdpV3FsNext();
    else if (e.key === 'ArrowLeft')  _pdpV3FsPrev();
    else if (e.key === 'Escape')      _closeFullscreen();
  }

  function _installFsInteraction(overlay) {
    var wrap  = overlay.querySelector('.pdp-v3-fs-img-wrap');
    var img   = overlay.querySelector('.pdp-v3-fs-img');
    if (!wrap || !img) return;

    // Pinch-zoom state
    var startDist = 0, lastScale = 1;
    var panStartX = 0, panStartY = 0, isPanning = false;
    var lastTapTime = 0, lastTapX = 0, lastTapY = 0;

    function getDistance(touches) {
      var dx = touches[0].clientX - touches[1].clientX;
      var dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    }
    function clampScale(s) { return Math.min(4, Math.max(1, s)); }
    function applyTransform(animated) {
      var t = 'translate(' + _gallery.fsOriginX + 'px,' + _gallery.fsOriginY + 'px) scale(' + _gallery.fsScale + ')';
      img.style.transition = animated ? 'transform .2s ease' : 'none';
      img.style.transform  = t;
    }
    function resetTransform(animated) {
      _gallery.fsScale = 1; _gallery.fsOriginX = 0; _gallery.fsOriginY = 0;
      applyTransform(animated);
    }
    function toggleZoomAt(cx, cy) {
      if (_gallery.fsScale > 1) { resetTransform(true); return; }
      var rect = img.getBoundingClientRect();
      _gallery.fsScale   = 2.5;
      _gallery.fsOriginX = (rect.width  / 2 - (cx - rect.left)) * (_gallery.fsScale - 1) / _gallery.fsScale;
      _gallery.fsOriginY = (rect.height / 2 - (cy - rect.top))  * (_gallery.fsScale - 1) / _gallery.fsScale;
      applyTransform(true);
    }

    wrap.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        startDist = getDistance(e.touches); lastScale = _gallery.fsScale;
      } else if (e.touches.length === 1) {
        if (_gallery.fsScale > 1) {
          isPanning  = true;
          panStartX  = e.touches[0].clientX - _gallery.fsOriginX;
          panStartY  = e.touches[0].clientY - _gallery.fsOriginY;
        } else {
          // Swipe detection
          _gallery.fsSwipeStartX  = e.touches[0].clientX;
          _gallery.fsSwipeActive  = true;
        }
        var now = Date.now();
        var dx  = Math.abs(e.touches[0].clientX - lastTapX);
        var dy  = Math.abs(e.touches[0].clientY - lastTapY);
        if (now - lastTapTime < 300 && dx < 30 && dy < 30) {
          toggleZoomAt(e.touches[0].clientX, e.touches[0].clientY);
          lastTapTime = 0;
        } else { lastTapTime = now; lastTapX = e.touches[0].clientX; lastTapY = e.touches[0].clientY; }
      }
    }, { passive: true });

    wrap.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && startDist) {
        e.preventDefault();
        _gallery.fsScale = clampScale(lastScale * (getDistance(e.touches) / startDist));
        applyTransform(false);
      } else if (e.touches.length === 1 && isPanning) {
        e.preventDefault();
        _gallery.fsOriginX = e.touches[0].clientX - panStartX;
        _gallery.fsOriginY = e.touches[0].clientY - panStartY;
        applyTransform(false);
      }
    }, { passive: false });

    wrap.addEventListener('touchend', function (e) {
      if (e.touches.length < 2) startDist = 0;
      if (e.touches.length === 0) {
        isPanning = false;
        if (_gallery.fsScale <= 1) resetTransform(false);
        // Swipe nav
        if (_gallery.fsSwipeActive && _gallery.fsScale <= 1) {
          var diff = _gallery.fsSwipeStartX - (e.changedTouches[0] ? e.changedTouches[0].clientX : _gallery.fsSwipeStartX);
          if (Math.abs(diff) > 60) {
            if (diff > 0) _pdpV3FsNext();
            else          _pdpV3FsPrev();
          }
        }
        _gallery.fsSwipeActive = false;
      }
    }, { passive: true });

    // Dblclick zoom on desktop
    img.addEventListener('dblclick', function (e) { toggleZoomAt(e.clientX, e.clientY); });

    // Wheel zoom on desktop
    wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      _gallery.fsScale = clampScale(_gallery.fsScale + (e.deltaY < 0 ? 0.3 : -0.3));
      if (_gallery.fsScale <= 1) { _gallery.fsOriginX = 0; _gallery.fsOriginY = 0; }
      applyTransform(false);
    }, { passive: false });

    // Backdrop close
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _closeFullscreen();
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     SECTION 13 — OVERRIDE pdpInitPreview (called by pdp-v2.js)
     ══════════════════════════════════════════════════════════════════ */

  window.pdpInitPreview = async function pdpInitPreview(pdf) {
    // Cleanup old overlay if any
    var old = document.getElementById('pdpV3Overlay');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    _gallery.fsOpen = false;
    document.removeEventListener('keydown', _fsKeyHandler);

    await _initGallery(pdf);
  };

  /* ══════════════════════════════════════════════════════════════════
     SECTION 14 — OVERRIDE _pdpRenderShell to inject V3 gallery
     ══════════════════════════════════════════════════════════════════
     We patch the rendered HTML to swap out the old pdp-cover-card
     for the V3 gallery. We do this by overriding the pdpWrap
     innerHTML setter — but a simpler approach is to override
     _pdpRenderShell to insert the V3 gallery ID in the cover slot.
     ═══════════════════════════════════════════════════════════════ */

  // Wait for pdp-v2.js to define _pdpRenderShell (it's deferred), then wrap it
  // We use a DOM mutation approach: after pdpWrap is populated, we upgrade it
  var _v2RenderShellOrig = null;

  function _upgradeCoverToGallery() {
    // Replace .pdp-cover-card with a V3 gallery div
    var coverCard = document.querySelector('#pdpWrap .pdp-cover-card');
    if (!coverCard) return false;

    var galleryDiv = document.createElement('div');
    galleryDiv.id        = 'pdpV3Gallery';
    galleryDiv.className = 'pdp-v3-gallery';

    // Also HIDE the old preview track (CSS hides it, but remove to be safe)
    var track = document.getElementById('pdpPreviewTrack');
    if (track) track.style.display = 'none';

    coverCard.replaceWith(galleryDiv);
    return true;
  }

  // Intercept after renderDetail calls _pdpRenderShell → innerHTML populated
  // We do this by watching for 'page-detail' becoming visible via the existing
  // navigate() flow, OR by wrapping renderDetail itself.
  var _renderDetailOrig = window.renderDetail;
  window.renderDetail = function renderDetail() {
    if (typeof _renderDetailOrig === 'function') _renderDetailOrig.apply(this, arguments);
    // After pdp-v2.js has written the shell, upgrade the cover card
    // Use a microtask to ensure the DOM write is complete
    Promise.resolve().then(function () {
      if (_upgradeCoverToGallery()) {
        var pdf = window.selectedPdf;
        if (pdf && typeof window.pdpInitPreview === 'function') {
          window.pdpInitPreview(pdf);
        }
      }
    });
  };

})();
