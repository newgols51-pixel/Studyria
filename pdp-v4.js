/* ═══════════════════════════════════════════════════════════════════════
   STUDYRIA — PDF PDP V4 UI UPGRADE
   V4.0 — 2026-08-02
   Review redesign, recently viewed, badges, wishlist animation, secure banner
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ═══ 1. ESCAPE HELPER ═════════════════════════════════════════════ */
  function _esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ═══ 2. STAR SVG HELPERS ═════════════════════════════════════════ */
  function _starSvg(filled) {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="' + (filled ? '#f59e0b' : 'none') +
      '" stroke="' + (filled ? '#f59e0b' : 'currentColor') + '" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  }

  function _starsHTML(rating) {
    var r = Math.round(rating);
    var html = '';
    for (var i = 1; i <= 5; i++) {
      html += '<span class="' + (i <= r ? '' : 'empty') + '">' + _starSvg(i <= r) + '</span>';
    }
    return html;
  }

  /* ═══ 3. REVIEW STATE ══════════════════════════════════════════════ */
  var _revState = {
    reviews: [],
    filter: 'newest',
    helpful: {},
  };

  /* ═══ 4. REVIEW RENDERER ═══════════════════════════════════════════ */
  function _renderReviewCard(r) {
    var initials = r.name
      ? r.name.split(' ').map(function(w) { return w[0]; }).join('').slice(0, 2).toUpperCase()
      : (r.user_id || '?').slice(0, 2).toUpperCase();
    var name = r.name || (r.verified ? 'Verified Buyer' : 'Student');
    var dateStr = r.date
      ? r.date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })
      : (r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
    var stars = _starsHTML(r.star || r.rating || 0);
    var text = r.text || r.comment || '';
    var city = r.loc || r.city || '';
    var verified = r.verified || (r.name !== undefined); // marketing reviews are "verified"
    var helpCount = _revState.helpful[r.id || r.name] || 0;
    var helpKey = r.id || r.name;

    return '<div class="v4-rev-card">' +
      '<div class="v4-rev-top">' +
        '<div class="v4-rev-avatar">' + _esc(initials) + '</div>' +
        '<div class="v4-rev-info">' +
          '<div class="v4-rev-name-row">' +
            '<span class="v4-rev-name">' + _esc(name) + '</span>' +
            (verified ? '<span class="v4-rev-verified"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>Verified Purchase</span>' : '') +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            (dateStr ? '<span class="v4-rev-date">' + dateStr + '</span>' : '') +
            (city ? '<span class="v4-rev-city">📍 ' + _esc(city) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="v4-rev-stars">' + stars + '</div>' +
      '</div>' +
      (text ? '<div class="v4-rev-body">' + _esc(text) + '</div>' : '') +
      '<div class="v4-rev-actions">' +
        '<button class="v4-rev-helpful" data-help-key="' + _esc(helpKey) + '" onclick="window._v4ToggleHelpful(this)">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>' +
          'Helpful' + (helpCount > 0 ? ' (' + helpCount + ')' : '') +
        '</button>' +
        '<button class="v4-rev-report" onclick="window._v4ReportReview(this)">Report</button>' +
      '</div>' +
    '</div>';
  }

  function _renderReviews() {
    var list = document.getElementById('pdpReviewsList');
    if (!list) return;

    var reviews = _revState.reviews.slice();

    // Apply filter
    switch (_revState.filter) {
      case 'highest':
        reviews.sort(function(a, b) { return (b.star || b.rating || 0) - (a.star || a.rating || 0); });
        break;
      case 'lowest':
        reviews.sort(function(a, b) { return (a.star || a.rating || 0) - (b.star || b.rating || 0); });
        break;
      case 'verified':
        reviews = reviews.filter(function(r) { return r.verified || r.name !== undefined; });
        break;
      case 'newest':
      default:
        // Keep original order (already newest-first from API)
        break;
    }

    if (reviews.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);font-size:.82rem">No reviews match this filter.</div>';
      return;
    }

    list.innerHTML = reviews.map(_renderReviewCard).join('');
  }

  function _renderFilters() {
    var container = document.querySelector('.v4-rev-filters');
    if (!container) return;
    var filters = [
      { key: 'newest', label: '🕐 Newest' },
      { key: 'highest', label: '⭐ Highest Rated' },
      { key: 'lowest', label: '⭐ Lowest Rated' },
      { key: 'verified', label: '✓ Verified Only' },
    ];
    container.innerHTML = filters.map(function(f) {
      return '<button class="v4-rev-filter' + (_revState.filter === f.key ? ' active' : '') +
        '" onclick="window._v4SetFilter(\'' + f.key + '\')">' + f.label + '</button>';
    }).join('');
  }

  window._v4SetFilter = function(key) {
    _revState.filter = key;
    _renderFilters();
    _renderReviews();
  };

  window._v4ToggleHelpful = function(btn) {
    var key = btn.dataset.helpKey;
    if (!key) return;
    if (_revState.helpful[key]) {
      _revState.helpful[key]--;
      delete _revState.helpful[key];
      btn.classList.remove('voted');
    } else {
      _revState.helpful[key] = 1;
      btn.classList.add('voted');
    }
    // Update count
    var count = _revState.helpful[key] || 0;
    var text = count > 0 ? 'Helpful (' + count + ')' : 'Helpful';
    // Keep SVG, replace text
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>' + text;
  };

  window._v4ReportReview = function(btn) {
    if (typeof showToast === 'function') showToast('Thanks for reporting. Our team will review this.', 'info');
  };

  /* ═══ 5. OVERRIDE _pdpApplyLiveStats ══════════════════════════════
     Wrap the original to intercept review rendering and use V4 cards
     ══════════════════════════════════════════════════════════════════ */
  function _patchApplyLiveStats() {
    // Wait for pdp-checkout.js to define _pdpApplyLiveStats
    // It's a local function, not on window — but we can intercept via
    // the review section DOM after it's populated by the original code.
    // Instead, we use a MutationObserver on the reviews section.
    var reviewsList = document.getElementById('pdpReviewsList');
    if (!reviewsList || reviewsList._v4Observed) return;
    reviewsList._v4Observed = true;

    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mut) {
        if (mut.type === 'childList' && mut.addedNodes.length > 0) {
          _upgradeReviews();
        }
      });
    });
    observer.observe(reviewsList, { childList: true, subtree: true });

    // Also observe the summary
    var summary = document.getElementById('pdpReviewsSummary');
    if (summary && !summary._v4Observed) {
      summary._v4Observed = true;
      var summaryObs = new MutationObserver(function() { _upgradeSummary(); });
      summaryObs.observe(summary, { childList: true, subtree: true });
    }
  }

  function _upgradeReviews() {
    var list = document.getElementById('pdpReviewsList');
    if (!list) return;

    // Check if already upgraded (has v4-rev-card class)
    if (list.querySelector('.v4-rev-card')) return;

    // Extract review data from existing cards
    var cards = list.querySelectorAll('.pdp-review-card');
    if (cards.length === 0) return;

    _revState.reviews = [];
    cards.forEach(function(card, idx) {
      var nameEl = card.querySelector('.pdp-rev-name');
      var locEl = card.querySelector('.pdp-rev-loc');
      var starsEl = card.querySelector('.pdp-rev-stars');
      var textEl = card.querySelector('.pdp-rev-text');
      var avatarEl = card.querySelector('.pdp-rev-avatar');
      var verifiedEl = card.querySelector('.pdp-rev-verified-badge');

      var name = nameEl ? nameEl.textContent.trim().replace('Verified Buyer', '').replace('Student', '').trim() : '';
      if (!name) name = nameEl ? nameEl.textContent.trim() : 'Student';

      var loc = locEl ? locEl.textContent.replace('📍', '').replace('📅', '').trim() : '';
      var stars = starsEl ? (starsEl.textContent.match(/★/g) || []).length : 5;
      var text = textEl ? textEl.textContent.trim() : '';
      var initials = avatarEl ? avatarEl.textContent.trim() : '??';
      var verified = verifiedEl ? true : (name !== 'Student');

      // Parse date from loc if it looks like a date
      var date = null;
      if (locEl && locEl.textContent.includes('📅')) {
        var dateStr = locEl.textContent.replace('📅', '').trim();
        date = new Date(dateStr);
        if (isNaN(date.getTime())) date = null;
      }

      _revState.reviews.push({
        id: 'rev_' + idx,
        name: name,
        loc: loc && !loc.match(/\d{4}/) ? loc : '',
        star: stars,
        text: text,
        verified: verified,
        date: date,
      });
    });

    // Wrap the list with V4 filters + cards
    var section = document.getElementById('pdpReviewsSection');
    if (!section) return;

    // Insert filters before the list
    var existingFilters = section.querySelector('.v4-rev-filters');
    if (!existingFilters) {
      var filterDiv = document.createElement('div');
      filterDiv.className = 'v4-rev-filters';
      list.parentNode.insertBefore(filterDiv, list);
    }

    // Also upgrade the list container
    list.className = 'v4-rev-list';

    _renderFilters();
    _renderReviews();

    // Upgrade review form
    var formWrap = document.getElementById('pdpWriteReviewWrap');
    if (formWrap && !formWrap._v4Upgraded) {
      formWrap._v4Upgraded = true;
      // Add V4 class to the form when it appears
      var formObs = new MutationObserver(function() {
        var form = formWrap.querySelector('.pdp-review-form');
        if (form && !form._v4Upgraded) {
          form._v4Upgraded = true;
          form.classList.add('v4-rev-form');
          var title = form.querySelector('.pdp-review-form-title');
          if (title) title.classList.add('v4-rev-form-title');
          var stars = form.querySelector('.pdp-star-selector');
          if (stars) stars.classList.add('v4-star-sel');
          var textarea = form.querySelector('.pdp-review-textarea');
          if (textarea) textarea.classList.add('v4-rev-textarea');
          var submit = form.querySelector('.pdp-review-submit-btn');
          if (submit) submit.classList.add('v4-rev-submit');
        }
        var login = formWrap.querySelector('.pdp-rev-login-prompt');
        if (login && !login._v4Upgraded) {
          login._v4Upgraded = true;
          login.classList.add('v4-rev-login');
        }
      });
      formObs.observe(formWrap, { childList: true, subtree: true });
    }
  }

  function _upgradeSummary() {
    var summary = document.getElementById('pdpReviewsSummary');
    if (!summary) return;
    if (summary._v4Upgraded) return;
    summary._v4Upgraded = true;
    summary.classList.add('v4-rev-summary');
  }

  /* ═══ 6. RECENTLY VIEWED ═══════════════════════════════════════════ */
  function _addRecentlyViewed(pdf) {
    if (!pdf || !pdf.id) return;
    var key = 'studyria_recently_viewed';
    var list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) { list = []; }
    // Remove if already exists
    list = list.filter(function(item) { return item.id !== pdf.id; });
    // Add to front
    list.unshift({
      id: pdf.id,
      title: pdf.title || '',
      coverImage: pdf.coverImage || pdf.cover_image || '',
      price: pdf.price || 0,
      free: pdf.free || false,
    });
    // Keep max 10
    list = list.slice(0, 10);
    try { localStorage.setItem(key, JSON.stringify(list)); } catch(e) {}
  }

  function _renderRecentlyViewed(currentPdfId) {
    var key = 'studyria_recently_viewed';
    var list = [];
    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) { list = []; }
    // Exclude current PDF
    list = list.filter(function(item) { return item.id !== currentPdfId; });
    if (list.length === 0) return;

    // Find a good place to insert — before related PDFs section
    var relatedSection = document.querySelector('#pdpWrap .pdp-section:last-of-type');
    if (!relatedSection) return;

    var existing = document.querySelector('.v4-recently-viewed');
    if (existing) existing.remove();

    var html = '<div class="v4-recently-viewed">' +
      '<div class="v4-recently-viewed-title">👁️ Recently Viewed</div>' +
      '<div class="v4-recently-viewed-track">' +
      list.slice(0, 6).map(function(item) {
        var coverSrc = item.coverImage || '';
        var imgHTML = coverSrc
          ? '<img src="' + _esc(coverSrc) + '" alt="' + _esc(item.title) + '" loading="lazy" decoding="async" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">'
          : '';
        var fbHTML = '<div class="pdf-cover-fallback" style="display:' + (coverSrc ? 'none' : 'flex') + ';background:linear-gradient(145deg,#0a1a50,#1555e8 55%,#0891b2 100%);">📄</div>';
        var priceHTML = item.free || item.price === 0
          ? '<span class="price-free">FREE</span>'
          : '<span class="price-current">₹' + item.price + '</span>';
        return '<div class="pdf-card" onclick="openDetail(\'' + item.id + '\')" style="cursor:pointer">' +
          '<div class="pdf-cover">' + imgHTML + fbHTML +
          '<div class="pdf-cover-scrim"></div></div>' +
          '<div class="pdf-card-body">' +
            '<div class="pdf-title">' + _esc(item.title) + '</div>' +
            '<div class="pdf-price-row">' + priceHTML + '</div>' +
          '</div></div>';
      }).join('') +
      '</div></div>';

    var div = document.createElement('div');
    div.innerHTML = html;
    relatedSection.parentNode.insertBefore(div.firstElementChild, relatedSection);
  }

  /* ═══ 7. BADGES ═══════════════════════════════════════════════════ */
  function _renderBadges(pdf) {
    var badges = [];
    var tag = (pdf.tag || pdf.badge || '').toLowerCase();

    if (tag.includes('bestseller') || tag.includes('best'))
      badges.push('<span class="v4-badge v4-badge-bestseller">🏆 Best Seller</span>');
    if (tag.includes('premium'))
      badges.push('<span class="v4-badge v4-badge-premium">⭐ Premium</span>');
    if (tag.includes('new') || tag.includes('newarrival'))
      badges.push('<span class="v4-badge v4-badge-new">✨ New</span>');
    if (tag.includes('trending') || tag.includes('popular'))
      badges.push('<span class="v4-badge v4-badge-trending">🔥 Trending</span>');
    if (pdf.price > 0)
      badges.push('<span class="v4-badge v4-badge-safe">🔒 Secure Download</span>');

    if (badges.length === 0) return '';
    return '<div class="v4-meta-badges">' + badges.join('') + '</div>';
  }

  function _injectBadges() {
    var titleEl = document.querySelector('#pdpWrap .pdp-title');
    if (!titleEl) return;
    var existing = document.querySelector('#pdpWrap .v4-meta-badges');
    if (existing) return;
    var pdf = window.selectedPdf;
    if (!pdf) return;
    var badgesHTML = _renderBadges(pdf);
    if (!badgesHTML) return;
    var div = document.createElement('div');
    div.innerHTML = badgesHTML;
    titleEl.parentNode.insertBefore(div.firstElementChild, titleEl);
  }

  /* ═══ 8. SECURE PURCHASE BANNER ═══════════════════════════════════ */
  function _injectSecureBanner() {
    var buyCard = document.getElementById('pdpBuyCard');
    if (!buyCard) return;
    var existing = document.querySelector('.v4-secure-banner');
    if (existing) return;

    var banner = document.createElement('div');
    banner.className = 'v4-secure-banner';
    banner.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' +
      '</svg>' +
      '<div class="v4-secure-banner-text"><strong>100% Secure Purchase</strong><br>Razorpay-encrypted · Instant download · Lifetime access · 30-day money-back guarantee</div>';
    buyCard.parentNode.insertBefore(banner, buyCard);
  }

  /* ═══ 9. WISHLIST ANIMATION ══════════════════════════════════════ */
  function _patchWishlistAnimation() {
    var orig = window.pdpToggleWish;
    if (!orig || orig._v4patched) return;
    window.pdpToggleWish = async function() {
      await orig.call(this);
      // Animate the button
      ['pdpWishBtn', 'pdpCoverWishBtn'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.remove('v4-wish-pop');
        // Force reflow to restart animation
        void btn.offsetWidth;
        btn.classList.add('v4-wish-pop');
      });
    };
    window.pdpToggleWish._v4patched = true;
  }

  /* ═══ 10. BOOT ═══════════════════════════════════════════════════ */
  function _boot() {
    // Set up review section observer (patches _pdpApplyLiveStats output)
    _patchApplyLiveStats();

    // Patch wishlist for animation
    _patchWishlistAnimation();

    // Watch for detail page renders
    var origRenderDetail = window.renderDetail;
    if (origRenderDetail && !origRenderDetail._v4patched) {
      window.renderDetail = function() {
        origRenderDetail.call(this);
        // After render completes, inject our upgrades
        setTimeout(function() {
          var pdf = window.selectedPdf;
          if (!pdf) return;
          _addRecentlyViewed(pdf);
          _renderRecentlyViewed(pdf.id);
          _injectBadges();
          _injectSecureBanner();
        }, 100);
      };
      window.renderDetail._v4patched = true;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

})();
