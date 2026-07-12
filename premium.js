/**
 * premium.js — Studyria Premium Membership UI Logic
 * Branch: feat/premium-membership
 *
 * SCOPE: Page init, FAQ accordion, testimonials carousel.
 * RULES:
 *   - No writes to window.PDFS, window.currentUser, or any shared state
 *   - No calls to renderHome, renderLibrary, or any core SPA functions
 *   - No modifications to _SPA_PUBLIC_PAGES or navigate()
 *   - navigate('premium') is handled in index.html (single addition)
 *   - All functions are namespaced under window.PRM.*
 */

(function () {
  'use strict';

  /* ── namespace ───────────────────────────────────────────────────── */
  const PRM = {};
  window.PRM = PRM;

  /* ── FAQ accordion ───────────────────────────────────────────────── */
  PRM.toggleFaq = function (btn) {
    if (!btn) return;
    const item = btn.closest('.prm-faq-item');
    if (!item) return;
    const isOpen = item.classList.contains('open');
    // Close all others in the same list
    const list = item.closest('.prm-faq-list');
    if (list) {
      list.querySelectorAll('.prm-faq-item.open').forEach(el => el.classList.remove('open'));
    }
    if (!isOpen) item.classList.add('open');
  };

  /* ── Testimonials carousel ───────────────────────────────────────── */
  PRM.initTestiCarousel = function () {
    const track  = document.getElementById('prmTestiTrack');
    const dotsEl = document.getElementById('prmTestiDots');
    if (!track || !dotsEl) return;

    const cards = Array.from(track.querySelectorAll('.prm-testi-card'));
    const total = cards.length;
    if (total === 0) return;

    let current = 0;
    let timer   = null;

    // Build dots
    dotsEl.innerHTML = '';
    cards.forEach(function (_, i) {
      const d = document.createElement('button');
      d.className = 'prm-testi-dot' + (i === 0 ? ' active' : '');
      d.setAttribute('aria-label', 'Go to slide ' + (i + 1));
      d.addEventListener('click', function () { goTo(i); });
      dotsEl.appendChild(d);
    });

    const dots = dotsEl.querySelectorAll('.prm-testi-dot');

    function getCardWidth () {
      if (!cards[0]) return 0;
      return cards[0].offsetWidth + 14; // 14 = gap
    }

    function goTo (idx) {
      current = ((idx % total) + total) % total;
      track.style.transform = 'translateX(-' + (current * getCardWidth()) + 'px)';
      dots.forEach(function (d, i) { d.classList.toggle('active', i === current); });
    }

    function startTimer () {
      clearInterval(timer);
      timer = setInterval(function () { goTo(current + 1); }, 4000);
    }

    // Touch / swipe
    let startX = 0;
    track.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
    }, { passive: true });
    track.addEventListener('touchend', function (e) {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) {
        goTo(dx < 0 ? current + 1 : current - 1);
        startTimer();
      }
    }, { passive: true });

    // Pause on hover
    track.addEventListener('mouseenter', function () { clearInterval(timer); });
    track.addEventListener('mouseleave', startTimer);

    // Re-compute offset on resize (orientation change)
    window.addEventListener('resize', function () { goTo(current); }, { passive: true });

    goTo(0);
    startTimer();
  };

  /* ── Scroll to plans (used by plan card buttons) ─────────────────── */
  PRM.scrollToPlans = function () {
    const grid = document.querySelector('#page-premium .prm-plans-grid');
    if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ── Page init (called by navigate hook in index.html) ───────────── */
  PRM.initPage = function () {
    // Use rAF to ensure DOM is painted before measuring card widths
    requestAnimationFrame(function () {
      PRM.initTestiCarousel();
    });
  };

})();
