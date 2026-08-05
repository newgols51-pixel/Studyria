/* ═══════════════════════════════════════════════════════════════════
   STUDYRIA — HOMEPAGE REDESIGN
   File: homepage-redesign.js
   Namespace: HR (window.HR)
   Safety: zero Supabase, Razorpay, Auth, DB, route changes
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var HR = window.HR || {};
  window.HR = HR;

  /* ── Scroll Reveal ────────────────────────────────────────────── */
  function initScrollReveal() {
    var els = document.querySelectorAll('.hr-reveal');
    if (!els.length) return;

    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('hr-visible'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('hr-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '50px', threshold: 0.05 });

    els.forEach(function (el) { io.observe(el); });
  }

  /* ── Parallax orbs on hero (subtle) ───────────────────────────── */
  function initParallax() {
    var hero = document.querySelector('.hr-hero');
    if (!hero || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var orbs = hero.querySelectorAll('.hr-orb');
    hero.addEventListener('mousemove', function (e) {
      var rect = hero.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width - 0.5;
      var y = (e.clientY - rect.top) / rect.height - 0.5;
      orbs.forEach(function (orb, i) {
        var depth = (i + 1) * 12;
        orb.style.transform = 'translate(' + (x * depth) + 'px, ' + (y * depth) + 'px)';
      });
    });
  }

  /* ── Init ─────────────────────────────────────────────────────── */
  function init() {
    initScrollReveal();
    initParallax();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-init on SPA navigation back to home
  HR.init = init;
})();
