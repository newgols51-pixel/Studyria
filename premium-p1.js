/**
 * premium-p1.js — Studyria Premium Page · Phase 1 (Pure UI)
 * Branch: feat/premium-membership-phase-1
 *
 * PHASE 1 SCOPE:
 *   ✓ FAQ accordion
 *   ✓ Testimonials carousel (auto-advance + touch + dots)
 *   ✓ Page init hook
 *
 * STRICTLY FORBIDDEN:
 *   ✗ Razorpay / payment
 *   ✗ Supabase / database
 *   ✗ Auth / user state
 *   ✗ window.PDFS or any shared state writes
 *   ✗ navigate() calls (routing)
 *   ✗ Any modification to existing functions
 *
 * All functions live under window.PRM1 namespace.
 */

(function () {
  'use strict';

  /* ── Namespace ─────────────────────────────────────────────────── */
  var PRM1 = {};
  window.PRM1 = PRM1;

  /* ── Scroll to plans ───────────────────────────────────────────── */
  PRM1.scrollToPlans = function () {
    var el = document.querySelector('#page-premium .prm-plans-grid');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ── FAQ accordion ─────────────────────────────────────────────── */
  PRM1.toggleFaq = function (btn) {
    if (!btn) return;
    var item = btn.closest('.prm-faq-item');
    if (!item) return;
    var isOpen = item.classList.contains('prm-open');
    // Close all in same list
    var list = item.closest('.prm-faq-list');
    if (list) {
      list.querySelectorAll('.prm-faq-item.prm-open').forEach(function (el) {
        el.classList.remove('prm-open');
      });
    }
    if (!isOpen) item.classList.add('prm-open');
  };

  /* ── Testimonials carousel ─────────────────────────────────────── */
  PRM1.initCarousel = function () {
    var track  = document.getElementById('prmTestiTrack');
    var dotsEl = document.getElementById('prmTestiDots');
    if (!track || !dotsEl) return;

    var cards = Array.from(track.querySelectorAll('.prm-testi-card'));
    if (cards.length === 0) return;

    var total   = cards.length;
    var current = 0;
    var timer   = null;

    /* Build dots */
    dotsEl.innerHTML = '';
    cards.forEach(function (_, i) {
      var btn = document.createElement('button');
      btn.className = 'prm-testi-dot' + (i === 0 ? ' prm-dot-active' : '');
      btn.setAttribute('aria-label', 'Slide ' + (i + 1));
      btn.addEventListener('click', function () { goTo(i); restart(); });
      dotsEl.appendChild(btn);
    });
    var dots = dotsEl.querySelectorAll('.prm-testi-dot');

    function cardW () {
      return cards[0] ? cards[0].offsetWidth + 14 : 0; /* 14 = gap */
    }

    function goTo (idx) {
      current = ((idx % total) + total) % total;
      track.style.transform = 'translateX(-' + (current * cardW()) + 'px)';
      dots.forEach(function (d, i) {
        d.classList.toggle('prm-dot-active', i === current);
      });
    }

    function restart () {
      clearInterval(timer);
      timer = setInterval(function () { goTo(current + 1); }, 4200);
    }

    /* Touch / swipe */
    var startX = 0;
    track.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
    }, { passive: true });
    track.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) { goTo(dx < 0 ? current + 1 : current - 1); restart(); }
    }, { passive: true });

    /* Pause on hover */
    track.addEventListener('mouseenter', function () { clearInterval(timer); });
    track.addEventListener('mouseleave', restart);

    /* Re-measure on resize / orientation change */
    window.addEventListener('resize', function () { goTo(current); }, { passive: true });

    goTo(0);
    restart();
  };

  /* ── Page init — called by navigate('premium') hook ───────────── */
  PRM1.init = function () {
    requestAnimationFrame(function () {
      PRM1.initCarousel();
    });
    /* MEMBER-BANNER-FIX: Show/hide member banner and CTA based on real premium status */
    (async function() {
      try {
        var banner   = document.getElementById('prmMemberBanner');
        var ctaNon   = document.getElementById('prmCtaNonMember');
        var ctaMem   = document.getElementById('prmCtaMember');
        var isPrem   = false;
        if (window.SMCI && typeof window.SMCI.getStatus === 'function') {
          var st = await window.SMCI.getStatus(false);
          isPrem = !!(st && st.isPremium);
        }
        if (banner)  banner.style.display  = isPrem ? '' : 'none';
        if (ctaNon)  ctaNon.style.display  = isPrem ? 'none' : '';
        if (ctaMem)  ctaMem.style.display  = isPrem ? '' : 'none';
      } catch(_) {}
    })();
  };

})();
