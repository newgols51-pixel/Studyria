/* ═══════════════════════════════════════════════════════════════════════
   STUDYRIA — PDF PRODUCT DETAIL PAGE V3 GALLERY ENGINE
   V3.4 — 2026-08-04 — Auto-generated preview images support — Root cause fix: V2 no-op trick removed, V2 preview elements cleaned up
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ═══ 1. VIEWPORT ZOOM LOCK ═════════════════════════════════════════ */
  var _origVp = null;

  function _lockVp() {
    var vp = document.querySelector('meta[name="viewport"]');
    if (!vp) return;
    if (!_origVp) _origVp = vp.getAttribute('content');
    vp.setAttribute('content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
  }

  function _unlockVp() {
    var vp = document.querySelector('meta[name="viewport"]');
    if (!vp) return;
    vp.setAttribute('content', _origVp ||
      'width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=5.0');
    _origVp = null;
  }

  window._pdpInstallZoomControl = function () {
    _lockVp();
    var onResize = function () {
      if (window.visualViewport && window.visualViewport.scale > 1.02) _lockVp();
    };
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onResize, { passive: true });
    }
    window._pdpZoomCleanup = function () {
      _unlockVp();
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize);
    };
  };
  window._pdpResetPageZoom = function () {};

  /* ═══ 2. GALLERY STATE ══════════════════════════════════════════════ */
  var G = {
    items: [], idx: 0,
    pdfJsDoc: null,
    renderCache: {}, thumbCache: {},
    fsOpen: false, fsScale: 1, fsOX: 0, fsOY: 0,
    swX: 0, swActive: false,
    fsSwX: 0, fsSwActive: false,
  };

  /* ═══ 3. WATERMARK ═════════════════════════════════════════════════ */
  function _wm() {
    var u = window.currentUser;
    if (u && u.email) return 'STUDYRIA PREVIEW\nNOT FOR REDISTRIBUTION\n' + u.email.split('@')[0].slice(0, 14);
    return 'STUDYRIA PREVIEW\nNOT FOR REDISTRIBUTION';
  }

  /* ═══ 4. RENDER HELPERS ════════════════════════════════════════════ */
  function _renderPage(doc, pageNum, scale) {
    if (G.renderCache[pageNum]) return Promise.resolve(G.renderCache[pageNum]);
    return doc.getPage(pageNum).then(function (page) {
      var vp = page.getViewport({ scale: scale || 1.8 });
      var canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      var ctx = canvas.getContext('2d');
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        // Burn watermark into canvas
        var wm = _wm();
        ctx.save();
        ctx.globalAlpha = 0.11;
        ctx.fillStyle = '#0d1220';
        ctx.font = 'bold ' + Math.max(12, Math.round(canvas.width * 0.038)) + 'px Arial,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var step = canvas.width * 0.48;
        for (var x = -canvas.width; x < canvas.width * 2; x += step) {
          for (var y = -canvas.height; y < canvas.height * 2; y += step * 0.58) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(-Math.PI / 7);
            wm.split('\n').forEach(function (line, li) {
              ctx.fillText(line, 0, li * Math.max(16, canvas.width * 0.045));
            });
            ctx.restore();
          }
        }
        ctx.restore();
        var url = canvas.toDataURL('image/jpeg', 0.86);
        G.renderCache[pageNum] = url;
        return url;
      });
    });
  }

  function _renderThumb(doc, pageNum) {
    if (G.thumbCache[pageNum]) return Promise.resolve(G.thumbCache[pageNum]);
    return _renderPage(doc, pageNum, 0.38).then(function (url) {
      G.thumbCache[pageNum] = url;
      return url;
    });
  }

  /* ═══ 5. GALLERY HTML BUILDER ══════════════════════════════════════ */
  function _esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _galleryHTML(pdf) {
    var inWish = (window.wishlist || []).includes(pdf.id) ||
                 (window.wishlist || []).includes(String(pdf.id));
    var coverSrc = (pdf.coverImage || pdf.cover_image || pdf.cover_url || '').trim();
    var coverFrom = pdf.coverFrom || '#930205';
    var coverTo = pdf.coverTo || '#930205';
    var price = Number(pdf.price ?? 0);
    var origPrice = Number(pdf.originalPrice ?? pdf.original_price ?? 0);
    var discount = (origPrice > 0 && price > 0 && origPrice > price)
      ? Math.round((1 - price / origPrice) * 100) : 0;

    var coverContent = coverSrc
      ? '<img id="pdpV3CoverImg" class="pdp-v3-cover-img" src="' + _esc(coverSrc) +
        '" alt="' + _esc(pdf.title || 'PDF Cover') + '" draggable="false">' +
        '<div class="pdp-v3-cover-fallback" id="pdpV3CoverFallback" style="display:none;' +
        'background:linear-gradient(135deg,' + coverFrom + ',' + coverTo + ')">📄</div>'
      : '<div class="pdp-v3-cover-fallback" style="background:linear-gradient(135deg,' +
        coverFrom + ',' + coverTo + ')">📄</div>';

    var tagHTML = pdf.tag ? '<div class="pdp-v3-tag">' + _esc(pdf.tag) + '</div>' : '';
    var discHTML = discount > 0 ? '<div class="pdp-v3-discount-badge">-' + discount + '%</div>' : '';

    return (
      '<div class="pdp-v3-gallery" id="pdpV3Gallery">' +
        '<div class="pdp-v3-stage" id="pdpV3Stage">' +
          coverContent +
          '<img id="pdpV3PreviewImg" class="pdp-v3-preview-img" alt="Preview" draggable="false">' +
          '<div class="pdp-v3-watermark" id="pdpV3Watermark"><div class="pdp-v3-wm-text" id="pdpV3WmText"></div></div>' +
          '<div class="pdp-v3-loading" id="pdpV3Loading"><div class="pdp-v3-spinner"></div><span>Loading preview…</span></div>' +
          tagHTML + discHTML +
          '<button class="pdp-v3-arrow pdp-v3-arrow-prev" id="pdpV3Prev" style="display:none" onclick="window._v3Prev()" aria-label="Previous">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>' +
          '</button>' +
          '<button class="pdp-v3-arrow pdp-v3-arrow-next" id="pdpV3Next" style="display:none" onclick="window._v3Next()" aria-label="Next">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>' +
          '</button>' +
          '<div class="pdp-v3-indicator" id="pdpV3Ind" style="display:none"></div>' +
          '<button class="pdp-v3-fs-btn" id="pdpV3FsBtn" style="display:none" onclick="window._v3OpenFs()" aria-label="Fullscreen">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="pdp-v3-thumb-strip" id="pdpV3Strip"></div>' +
        '<div class="pdp-v3-action-row">' +
          '<button class="pdp-v3-action-btn" id="pdpCoverWishBtn" onclick="pdpToggleWish()">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="' + (inWish ? 'var(--danger)' : 'none') +
            '" stroke="' + (inWish ? 'var(--danger)' : 'currentColor') +
            '" stroke-width="2.2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>' +
            (inWish ? 'Saved' : 'Wishlist') +
          '</button>' +
          '<button class="pdp-v3-action-btn" onclick="pdpSharePDF()">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>' +
            'Share' +
          '</button>' +
        '</div>' +
      '</div>'
    );
  }

  /* ═══ 6. PATCH _pdpRenderShell ═════════════════════════════════════
     ROOT CAUSE FIX: V2 _pdpRenderShell no longer calls pdpInitPreview
     (removed at source in pdp-v2.js). The V3 patch only needs to:
     1. Call orig to write the base HTML
     2. Swap cover-card for V3 gallery
     3. Call pdpInitPreview (V3 version) after gallery is in DOM
     ══════════════════════════════════════════════════════════════════ */
  function _patchRenderShell() {
    var orig = window._pdpRenderShell;
    if (!orig || orig._v3patched) return;

    window._pdpRenderShell = function _pdpRenderShellV3(pdf) {
      // 1. Run original — writes base HTML (cover-card, meta, reviews, related)
      //    No pdpInitPreview call anymore (removed at source)
      orig.call(this, pdf);

      // 2. Swap cover-card for V3 gallery
      var coverCard = document.querySelector('#pdpWrap .pdp-cover-card');
      if (coverCard) {
        var temp = document.createElement('div');
        temp.innerHTML = _galleryHTML(pdf);
        var galleryEl = temp.firstElementChild;
        coverCard.replaceWith(galleryEl);
      }

      // 3. Remove any leftover preview-track elements (belt-and-suspenders)
      var track = document.getElementById('pdpPreviewTrack');
      if (track) track.remove();
      var oldStrip = document.getElementById('pdpThumbStrip');
      if (oldStrip) oldStrip.remove();

      // 4. Install swipe on stage
      _installStageSwipe(document.getElementById('pdpV3Stage'));

      // 5. Cover image protections
      var ci = document.getElementById('pdpV3CoverImg');
      if (ci) {
        ci.addEventListener('error', function () {
          ci.style.display = 'none';
          var fb = document.getElementById('pdpV3CoverFallback');
          if (fb) fb.style.display = 'flex';
        });
        ci.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        ci.addEventListener('dragstart', function (e) { e.preventDefault(); });
      }

      // 6. Call pdpInitPreview (V3 version) — gallery is in DOM
      if (typeof window.pdpInitPreview === 'function') {
        window.pdpInitPreview(pdf);
      }
    };
    window._pdpRenderShell._v3patched = true;
  }

  function _patchRenderDetail() {
    var orig = window.renderDetail;
    if (!orig || orig._v3patched) return;
    window.renderDetail = function () {
      _patchRenderShell();
      orig.call(this);
    };
    window.renderDetail._v3patched = true;
  }

  /* ═══ 7. pdpInitPreview OVERRIDE ═══════════════════════════════════ */
  window.pdpInitPreview = async function pdpInitPreview(pdf) {
    _closeFs();

    G.items = [];
    G.idx = 0;
    G.pdfJsDoc = null;
    G.renderCache = {};
    G.thumbCache = {};

    var galleryEl = document.getElementById('pdpV3Gallery');
    if (!galleryEl) {
      console.warn('[PDP V3] pdpV3Gallery not in DOM');
      return;
    }

    var coverSrc = (pdf.coverImage || pdf.cover_image || pdf.cover_url || '').trim();
    G.items.push({ type: 'cover', label: 'Cover', src: coverSrc });

    // ═══ PRIORITY 1: Use pre-generated preview images from database ═══
    // These are stored as public URLs in the covers bucket, generated
    // automatically when the admin uploads the PDF. Fast, no PDF.js needed.
    var pp1 = (pdf.previewPage1 || pdf.preview_page_1 || '').trim();
    var pp2 = (pdf.previewPage2 || pdf.preview_page_2 || '').trim();
    var pp3 = (pdf.previewPage3 || pdf.preview_page_3 || '').trim();

    if (pp1 || pp2 || pp3) {
      console.log('[PDP V3] Using pre-generated preview images');
      if (pp1) G.items.push({ type: 'preview', label: 'Page 1', src: pp1, pageNum: 1 });
      if (pp2) G.items.push({ type: 'preview', label: 'Page 2', src: pp2, pageNum: 2 });
      if (pp3) G.items.push({ type: 'preview', label: 'Page 3', src: pp3, pageNum: 3 });
    }

    // ═══ PRIORITY 2: Fall back to PDF.js rendering from preview PDF ═══
    // Only used if pre-generated images don't exist AND a preview PDF URL exists
    if (G.items.length <= 1) {
      var previewUrl = (pdf.previewPdfUrl || pdf.preview_pdf_url || '').trim();
      if (previewUrl && window.pdfjsLib) {
        _setLoading(true);
        try {
          // Resolve signed URL if it's a storage path (pdfs bucket is private)
          var docUrl = previewUrl;
          if (!previewUrl.startsWith('http') && window.supabaseClient) {
            try {
              var sd = await window.supabaseClient.storage.from('pdfs')
                .createSignedUrl(previewUrl, 3600);
              if (sd?.signedUrl) docUrl = sd.signedUrl;
            } catch(e) {}
          }
          var doc = await window.pdfjsLib.getDocument({
            url: docUrl, withCredentials: false
          }).promise;
          G.pdfJsDoc = doc;
          var total = doc.numPages || 0;

          var spec = pdf.preview_pages || pdf.previewPages || null;
          var looksSpec = spec && /^\d/.test(String(spec).trim());
          var pages;
          if (looksSpec && typeof window._pdpParsePreviewPages === 'function') {
            pages = window._pdpParsePreviewPages(spec, total).slice(0, 3);
          } else {
            pages = [];
            for (var i = 1; i <= Math.min(total, 3); i++) pages.push(i);
          }
          pages.forEach(function (pg) {
            G.items.push({ type: 'preview_pdf', label: 'Page ' + pg, pageNum: pg });
          });
          console.log('[PDP V3] Using PDF.js fallback for', pages.length, 'pages');
        } catch (e) {
          console.warn('[PDP V3] Preview PDF load failed:', e);
        } finally {
          _setLoading(false);
        }
      }
    }

    // Show/hide arrows
    var hasMulti = G.items.length > 1;
    var prevBtn = document.getElementById('pdpV3Prev');
    var nextBtn = document.getElementById('pdpV3Next');
    var ind = document.getElementById('pdpV3Ind');
    if (prevBtn) prevBtn.style.display = hasMulti ? '' : 'none';
    if (nextBtn) nextBtn.style.display = hasMulti ? '' : 'none';
    if (ind) ind.style.display = hasMulti ? '' : 'none';

    _buildThumbStrip();
    _showItem(0, false);
  };

  /* ═══ 8. SHOW ITEM ═════════════════════════════════════════════════ */
  function _showItem(idx, animate) {
    if (idx < 0 || idx >= G.items.length) return;
    G.idx = idx;

    var item = G.items[idx];
    var coverImg = document.getElementById('pdpV3CoverImg');
    var previewImg = document.getElementById('pdpV3PreviewImg');
    var wm = document.getElementById('pdpV3Watermark');
    var wmText = document.getElementById('pdpV3WmText');
    var fsBtn = document.getElementById('pdpV3FsBtn');
    var prevBtn = document.getElementById('pdpV3Prev');
    var nextBtn = document.getElementById('pdpV3Next');
    var ind = document.getElementById('pdpV3Ind');

    if (!coverImg && !previewImg) return;

    if (prevBtn) prevBtn.disabled = (idx === 0);
    if (nextBtn) nextBtn.disabled = (idx === G.items.length - 1);
    if (ind) ind.textContent = (idx + 1) + ' / ' + G.items.length;

    _updateThumbHL(idx);

    if (item.type === 'cover') {
      // Show cover
      if (previewImg) previewImg.classList.remove('pdp-v3-visible');
      if (coverImg) coverImg.style.opacity = '1';
      if (wm) wm.classList.remove('pdp-v3-visible');
      if (fsBtn) fsBtn.style.display = 'none';

    } else if (item.type === 'preview' && item.src) {
      // ═══ Pre-generated preview image (direct URL, no PDF.js needed) ═══
      if (fsBtn) fsBtn.style.display = '';
      if (coverImg) coverImg.style.opacity = '0.12';
      _setLoading(true);

      // Use a cached Image to preload, then swap
      var pre = new Image();
      pre.onload = function () {
        if (G.idx !== idx) return; // user already switched
        if (!document.getElementById('pdpV3Gallery')) return;
        if (previewImg) {
          previewImg.src = item.src;
          previewImg.classList.add('pdp-v3-visible');
        }
        _setLoading(false);
        if (wm && wmText) {
          wmText.textContent = _wm();
          wm.classList.add('pdp-v3-visible');
        }
        if (previewImg) {
          previewImg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
          previewImg.addEventListener('dragstart', function (e) { e.preventDefault(); });
        }
      };
      pre.onerror = function () {
        console.warn('[PDP V3] Preview image failed to load:', item.src);
        _setLoading(false);
      };
      pre.src = item.src;

      // Pre-warm adjacent images
      var ni = G.items[idx + 1];
      var pi = G.items[idx - 1];
      if (ni && ni.src) { var preN = new Image(); preN.src = ni.src; }
      if (pi && pi.src) { var preP = new Image(); preP.src = pi.src; }

    } else if (item.type === 'preview_pdf' && G.pdfJsDoc) {
      // ═══ PDF.js fallback: render from preview PDF ═══
      if (fsBtn) fsBtn.style.display = '';
      _setLoading(true);
      if (coverImg) coverImg.style.opacity = '0.12';

      _renderPage(G.pdfJsDoc, item.pageNum, 1.8).then(function (url) {
        if (G.idx !== idx) return;
        if (!document.getElementById('pdpV3Gallery')) return;
        if (previewImg) {
          previewImg.src = url;
          previewImg.classList.add('pdp-v3-visible');
        }
        _setLoading(false);
        if (wm && wmText) {
          wmText.textContent = _wm();
          wm.classList.add('pdp-v3-visible');
        }
        if (previewImg) {
          previewImg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
          previewImg.addEventListener('dragstart', function (e) { e.preventDefault(); });
        }
        // Pre-warm adjacent pages
        var ni = G.items[idx + 1];
        var pi = G.items[idx - 1];
        if (ni && ni.type === 'preview_pdf') _renderPage(G.pdfJsDoc, ni.pageNum).catch(function () {});
        if (pi && pi.type === 'preview_pdf') _renderPage(G.pdfJsDoc, pi.pageNum).catch(function () {});
      }).catch(function (e) {
        console.warn('[PDP V3] Render failed:', e);
        _setLoading(false);
      });
    }
  }

  /* ═══ 9. THUMBNAIL STRIP ═══════════════════════════════════════════ */
  function _buildThumbStrip() {
    var strip = document.getElementById('pdpV3Strip');
    if (!strip) return;
    strip.innerHTML = '';

    G.items.forEach(function (item, idx) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pdp-v3-thumb' + (idx === 0 ? ' active' : '');
      btn.setAttribute('aria-label', item.label);
      btn.onclick = function () { _showItem(idx, true); };

      var ph = document.createElement('div');
      ph.className = 'pdp-v3-thumb-ph';
      ph.textContent = item.label;
      btn.appendChild(ph);

      strip.appendChild(btn);

      // Async load thumb — cover or pre-generated preview
      if (item.type === 'cover' && item.src) {
        var img = new Image();
        img.onload = function () {
          if (!document.getElementById('pdpV3Strip')) return;
          var im = document.createElement('img');
          im.src = item.src;
          im.alt = item.label;
          im.draggable = false;
          btn.innerHTML = '';
          btn.appendChild(im);
          var lbl = document.createElement('div');
          lbl.className = 'pdp-v3-thumb-lbl';
          lbl.textContent = 'Cover';
          btn.appendChild(lbl);
        };
        img.src = item.src;
      } else if (item.type === 'preview' && item.src) {
        // Pre-generated preview image — use src directly
        var img2 = new Image();
        img2.onload = function () {
          if (!document.getElementById('pdpV3Strip')) return;
          var im = document.createElement('img');
          im.src = item.src;
          im.alt = item.label;
          im.draggable = false;
          im.addEventListener('contextmenu', function (e) { e.preventDefault(); });
          btn.innerHTML = '';
          btn.appendChild(im);
          var lbl = document.createElement('div');
          lbl.className = 'pdp-v3-thumb-lbl';
          lbl.textContent = item.label;
          btn.appendChild(lbl);
        };
        img2.src = item.src;
      } else if (item.type === 'preview_pdf' && G.pdfJsDoc) {
        // PDF.js fallback — render thumbnail from PDF
        _renderThumb(G.pdfJsDoc, item.pageNum).then(function (url) {
          if (!document.getElementById('pdpV3Strip')) return;
          var im = document.createElement('img');
          im.src = url;
          im.alt = item.label;
          im.draggable = false;
          im.addEventListener('contextmenu', function (e) { e.preventDefault(); });
          btn.innerHTML = '';
          btn.appendChild(im);
          var lbl = document.createElement('div');
          lbl.className = 'pdp-v3-thumb-lbl';
          lbl.textContent = item.label;
          btn.appendChild(lbl);
        }).catch(function () {});
      }
    });
  }

  function _updateThumbHL(idx) {
    var strip = document.getElementById('pdpV3Strip');
    if (!strip) return;
    Array.prototype.forEach.call(strip.querySelectorAll('.pdp-v3-thumb'), function (el, i) {
      el.classList.toggle('active', i === idx);
      el.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    var active = strip.children[idx];
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  /* ═══ 10. LOADING ═════════════════════════════════════════════════ */
  function _setLoading(on) {
    var el = document.getElementById('pdpV3Loading');
    if (!el) return;
    el.classList.toggle('active', on);
  }

  /* ═══ 11. SWIPE ═══════════════════════════════════════════════════ */
  function _installStageSwipe(stage) {
    if (!stage) return;
    var sx = 0, sy = 0, moved = false;
    stage.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      moved = false;
    }, { passive: true });
    stage.addEventListener('touchmove', function (e) {
      if (e.touches.length !== 1) return;
      if (Math.abs(e.touches[0].clientX - sx) > Math.abs(e.touches[0].clientY - sy)) moved = true;
    }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (!moved) return;
      var diff = sx - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 48) {
        if (diff > 0) _v3Next();
        else _v3Prev();
      }
      moved = false;
    }, { passive: true });
  }

  /* ═══ 12. NAV ════════════════════════════════════════════════════ */
  function _v3Prev() { if (G.idx > 0) _showItem(G.idx - 1, true); }
  function _v3Next() { if (G.idx < G.items.length - 1) _showItem(G.idx + 1, true); }
  window._v3Prev = _v3Prev;
  window._v3Next = _v3Next;

  /* ═══ 13. FULLSCREEN ══════════════════════════════════════════════ */
  function _openFs() {
    var item = G.items[G.idx];
    if (!item || item.type === 'cover') return;
    _buildFsOverlay();
    _fsShowItem(G.idx);
  }

  function _closeFs() {
    var ov = document.getElementById('pdpV3Overlay');
    if (!ov) { G.fsOpen = false; return; }
    ov.classList.remove('open');
    document.body.style.overflow = '';
    G.fsOpen = false;
    document.removeEventListener('keydown', _fsKey);
    setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, 280);
  }

  window._v3OpenFs = _openFs;
  window._v3CloseFs = _closeFs;

  function _buildFsOverlay() {
    var old = document.getElementById('pdpV3Overlay');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var ov = document.createElement('div');
    ov.id = 'pdpV3Overlay';
    ov.className = 'pdp-v3-fs-overlay';
    ov.innerHTML =
      '<button class="pdp-v3-fs-close" onclick="window._v3CloseFs()">✕</button>' +
      '<div class="pdp-v3-fs-wrap" id="pdpV3FsWrap">' +
        '<img class="pdp-v3-fs-img" id="pdpV3FsImg" alt="Preview" draggable="false">' +
        '<div class="pdp-v3-fs-wm" id="pdpV3FsWm"></div>' +
      '</div>' +
      '<button class="pdp-v3-fs-nav pdp-v3-fs-prev" onclick="window._v3FsPrev()">‹</button>' +
      '<button class="pdp-v3-fs-nav pdp-v3-fs-next" onclick="window._v3FsNext()">›</button>' +
      '<div class="pdp-v3-fs-ind" id="pdpV3FsInd"></div>';
    document.body.appendChild(ov);

    requestAnimationFrame(function () { ov.classList.add('open'); });
    document.body.style.overflow = 'hidden';
    G.fsOpen = true;

    _installFsInteraction(ov);
    document.addEventListener('keydown', _fsKey);
    ov.addEventListener('click', function (e) { if (e.target === ov) _closeFs(); });
  }

  function _fsShowItem(idx) {
    var item = G.items[idx];
    if (!item) return;
    if (item.type === 'cover') {
      var nxt = G.items.findIndex(function (it, i) { return i > idx && (it.type === 'preview' || it.type === 'preview_pdf'); });
      if (nxt > -1) { G.idx = nxt; _fsShowItem(nxt); return; }
      _closeFs();
      return;
    }
    G.idx = idx;
    var previews = G.items.filter(function (it) { return it.type === 'preview' || it.type === 'preview_pdf'; });
    var rank = previews.indexOf(item) + 1;
    var ind = document.getElementById('pdpV3FsInd');
    var wm = document.getElementById('pdpV3FsWm');
    if (ind) ind.textContent = 'Preview ' + rank + ' / ' + previews.length;
    if (wm) wm.textContent = _wm().split('\n')[0];
    G.fsScale = 1; G.fsOX = 0; G.fsOY = 0;
    var img = document.getElementById('pdpV3FsImg');
    if (img) img.style.transform = '';

    // Pre-generated preview image — use direct URL (fast, no PDF.js needed)
    if (item.src) {
      var pre = new Image();
      pre.onload = function () {
        var fsImg = document.getElementById('pdpV3FsImg');
        if (fsImg) fsImg.src = item.src;
      };
      pre.src = item.src;
    } else if (G.pdfJsDoc) {
      // PDF.js fallback
      _renderPage(G.pdfJsDoc, item.pageNum, 2.5).then(function (url) {
        var fsImg = document.getElementById('pdpV3FsImg');
        if (fsImg) fsImg.src = url;
      }).catch(function () {});
    }
  }

  function _v3FsPrev() {
    var pIdx = G.items.map(function (it, i) { return (it.type === 'preview' || it.type === 'preview_pdf') ? i : -1; }).filter(function (i) { return i >= 0; });
    var cur = pIdx.indexOf(G.idx);
    if (cur > 0) _fsShowItem(pIdx[cur - 1]);
  }
  function _v3FsNext() {
    var pIdx = G.items.map(function (it, i) { return (it.type === 'preview' || it.type === 'preview_pdf') ? i : -1; }).filter(function (i) { return i >= 0; });
    var cur = pIdx.indexOf(G.idx);
    if (cur < pIdx.length - 1) _fsShowItem(pIdx[cur + 1]);
  }
  window._v3FsPrev = _v3FsPrev;
  window._v3FsNext = _v3FsNext;

  function _fsKey(e) {
    if (!G.fsOpen) return;
    if (e.key === 'Escape') _closeFs();
    else if (e.key === 'ArrowLeft') _v3FsPrev();
    else if (e.key === 'ArrowRight') _v3FsNext();
  }

  function _installFsInteraction(ov) {
    var wrap = ov.querySelector('.pdp-v3-fs-wrap');
    var img = ov.querySelector('.pdp-v3-fs-img');
    if (!wrap || !img) return;
    var startDist = 0, lastScale = 1, isPanning = false, psx = 0, psy = 0;
    var lastTap = 0, ltx = 0, lty = 0;

    function clamp(s) { return Math.min(4, Math.max(1, s)); }
    function applyT(anim) {
      img.style.transition = anim ? 'transform .2s ease' : 'none';
      img.style.transform = 'translate(' + G.fsOX + 'px,' + G.fsOY + 'px) scale(' + G.fsScale + ')';
    }
    function resetT(anim) { G.fsScale = 1; G.fsOX = 0; G.fsOY = 0; applyT(anim); }
    function zoomAt(cx, cy) {
      if (G.fsScale > 1) { resetT(true); return; }
      var r = img.getBoundingClientRect();
      G.fsScale = 2.5;
      G.fsOX = (r.width / 2 - (cx - r.left)) * (G.fsScale - 1) / G.fsScale;
      G.fsOY = (r.height / 2 - (cy - r.top)) * (G.fsScale - 1) / G.fsScale;
      applyT(true);
    }
    function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }

    wrap.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) { startDist = dist(e.touches); lastScale = G.fsScale; }
      else if (e.touches.length === 1) {
        if (G.fsScale > 1) { isPanning = true; psx = e.touches[0].clientX - G.fsOX; psy = e.touches[0].clientY - G.fsOY; }
        else { G.fsSwX = e.touches[0].clientX; G.fsSwActive = true; }
        var now = Date.now();
        var dx = Math.abs(e.touches[0].clientX - ltx), dy = Math.abs(e.touches[0].clientY - lty);
        if (now - lastTap < 300 && dx < 30 && dy < 30) { zoomAt(e.touches[0].clientX, e.touches[0].clientY); lastTap = 0; }
        else { lastTap = now; ltx = e.touches[0].clientX; lty = e.touches[0].clientY; }
      }
    }, { passive: true });

    wrap.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && startDist) {
        e.preventDefault();
        G.fsScale = clamp(lastScale * (dist(e.touches) / startDist));
        applyT(false);
      } else if (e.touches.length === 1 && isPanning) {
        e.preventDefault();
        G.fsOX = e.touches[0].clientX - psx;
        G.fsOY = e.touches[0].clientY - psy;
        applyT(false);
      }
    }, { passive: false });

    wrap.addEventListener('touchend', function (e) {
      if (e.touches.length < 2) startDist = 0;
      if (e.touches.length === 0) {
        isPanning = false;
        if (G.fsScale <= 1) resetT(false);
        if (G.fsSwActive && G.fsScale <= 1) {
          var diff = G.fsSwX - (e.changedTouches[0] ? e.changedTouches[0].clientX : G.fsSwX);
          if (Math.abs(diff) > 60) { if (diff > 0) _v3FsNext(); else _v3FsPrev(); }
        }
        G.fsSwActive = false;
      }
    }, { passive: true });

    img.addEventListener('dblclick', function (e) { zoomAt(e.clientX, e.clientY); });
    wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      G.fsScale = clamp(G.fsScale + (e.deltaY < 0 ? 0.3 : -0.3));
      if (G.fsScale <= 1) { G.fsOX = 0; G.fsOY = 0; }
      applyT(false);
    }, { passive: false });
  }

  /* ═══ 14. BOOT ════════════════════════════════════════════════════ */
  function _boot() {
    var attempts = 0;
    function tryPatch() {
      attempts++;
      if (window._pdpRenderShell && !window._pdpRenderShell._v3patched) {
        _patchRenderShell();
        _patchRenderDetail();
        console.log('[PDP V3] Patched OK (attempt ' + attempts + ')');
      } else if (!window._pdpRenderShell && attempts < 40) {
        setTimeout(tryPatch, 50);
      } else if (!window._pdpRenderShell) {
        console.warn('[PDP V3] _pdpRenderShell not found after ' + attempts + ' attempts');
      }
    }
    tryPatch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

})();
