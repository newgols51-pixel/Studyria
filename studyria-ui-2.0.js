/* ═════════════════════════════════════════════════════════════════════
   STUDYRIA UI/UX 2.0 — MICRO INTERACTIONS
   ═════════════════════════════════════════════════════════════════════
   Progressive enhancement — adds ripple effects, animated counters,
   scroll fade-ins, lazy image loading, and smooth interactions.
   Does NOT modify any existing JS or functionality.
   ═════════════════════════════════════════════════════════════════════ */

(function() {
  'use strict';

  // ── Skip if prefers-reduced-motion ──────────────────────────────
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ══ 1. RIPPLE EFFECT ON BUTTONS ═════════════════════════════════
  function initRippleEffect() {
    if (prefersReducedMotion) return;

    document.addEventListener('pointerdown', function(e) {
      const btn = e.target.closest('.btn, .sh-btn');
      if (!btn) return;

      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      btn.style.setProperty('--ripple-x', x + 'px');
      btn.style.setProperty('--ripple-y', y + 'px');
    }, { passive: true });
  }

  // ══ 2. LAZY IMAGE FADE-IN ════════════════════════════════════════
  function initLazyImageFade() {
    if (prefersReducedMotion) {
      document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        img.classList.add('loaded');
      });
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.classList.add('loaded');

          // Also handle img onload
          img.addEventListener('load', () => img.classList.add('loaded'), { once: true });

          observer.unobserve(img);
        }
      });
    }, { rootMargin: '50px' });

    // Observe all lazy images
    document.querySelectorAll('img[loading="lazy"]').forEach(img => {
      if (img.complete && img.naturalWidth > 0) {
        img.classList.add('loaded');
      } else {
        observer.observe(img);
      }
    });

    // Re-observe new images added dynamically
    const bodyObserver = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            const imgs = node.querySelectorAll ? node.querySelectorAll('img[loading="lazy"]') : [];
            imgs.forEach(img => {
              if (img.complete && img.naturalWidth > 0) {
                img.classList.add('loaded');
              } else {
                observer.observe(img);
              }
            });
          }
        });
      });
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ══ 3. SCROLL FADE-IN ANIMATIONS ═════════════════════════════════
  function initScrollFadeIn() {
    if (prefersReducedMotion) {
      document.querySelectorAll('.ui2-fade-in, .ui2-fade-in-stagger').forEach(el => {
        el.classList.add('ui2-visible');
      });
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('ui2-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    // Auto-add fade-in to sections and cards on the home page
    const homePage = document.getElementById('page-home');
    if (homePage) {
      const sections = homePage.querySelectorAll('.ottlib-section, section, .stat-card, .pdf-card');
      sections.forEach((el, i) => {
        if (!el.classList.contains('ui2-fade-in')) {
          el.classList.add('ui2-fade-in');
        }
        observer.observe(el);
      });
    }

    // Observe any existing ui2-fade-in elements
    document.querySelectorAll('.ui2-fade-in, .ui2-fade-in-stagger').forEach(el => {
      observer.observe(el);
    });
  }

  // ══ 4. ANIMATED COUNTERS ═════════════════════════════════════════
  function initAnimatedCounters() {
    if (prefersReducedMotion) return;

    function animateCounter(el) {
      const text = el.textContent.trim();
      const target = parseFloat(text.replace(/[^\d.-]/g, ''));

      if (isNaN(target) || target === 0) return;

      const suffix = text.replace(/[\d.,\s+-]/g, '');
      const isFloat = text.includes('.');
      const duration = 1200;
      const startTime = performance.now();

      function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out-cubic

        const value = target * eased;
        el.textContent = (isFloat ? value.toFixed(1) : Math.round(value).toLocaleString('en-IN')) + suffix;

        if (progress < 1) {
          requestAnimationFrame(update);
        } else {
          el.textContent = (isFloat ? target.toFixed(1) : Math.round(target).toLocaleString('en-IN')) + suffix;
        }
      }

      requestAnimationFrame(update);
    }

    // Animate stat numbers when they come into view
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    // Target stat numbers
    document.querySelectorAll('.stat-num, .sh-hero-stat-num, .ottlib-stat-num').forEach(el => {
      // Only animate if it has a number
      const text = el.textContent.trim();
      if (/\d/.test(text) && !el.dataset.ui2Animated) {
        el.dataset.ui2Animated = '1';
        observer.observe(el);
      }
    });
  }

  // ══ 5. CARD TOUCH FEEDBACK ═══════════════════════════════════════
  function initCardTouchFeedback() {
    if (prefersReducedMotion) return;

    // Scale-down on touch for cards
    document.addEventListener('touchstart', function(e) {
      const card = e.target.closest('.pdf-card, .ottlib-card, .card, .stat-card');
      if (card) {
        card.style.transition = 'transform 0.1s ease';
        card.style.transform = 'scale(0.98)';
      }
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
      const card = e.target.closest('.pdf-card, .ottlib-card, .card, .stat-card');
      if (card) {
        card.style.transform = '';
        setTimeout(() => {
          card.style.transition = '';
        }, 200);
      }
    }, { passive: true });
  }

  // ══ 6. SMOOTH SCROLL ENHANCEMENT ═════════════════════════════════
  function initSmoothScroll() {
    if (prefersReducedMotion) return;

    // Enhance scrollIntoView calls
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', function(e) {
        const targetId = this.getAttribute('href');
        if (targetId === '#' || targetId.length < 2) return;

        const target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  // ══ 7. NAV LINK ACTIVE INDICATOR ════════════════════════════════
  function initNavLinkIndicator() {
    // The underline is handled by CSS, but we ensure active class persists
    const navLinks = document.querySelectorAll('.nav-link[data-page]');
    navLinks.forEach(link => {
      link.addEventListener('mouseenter', function() {
        this.style.zIndex = '2';
      });
      link.addEventListener('mouseleave', function() {
        this.style.zIndex = '';
      });
    });
  }

  // ══ 8. PAGE TRANSITION ENHANCEMENT ═══════════════════════════════
  function initPageTransitions() {
    if (prefersReducedMotion) return;

    // Watch for page visibility changes (SPA navigation)
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        if (mutation.attributeName === 'style' || mutation.attributeName === 'class') {
          const target = mutation.target;
          if (target.classList && target.classList.contains('page') && target.classList.contains('active')) {
            // Re-trigger entrance animation
            target.style.animation = 'none';
            void target.offsetWidth; // force reflow
            target.style.animation = '';
          }
        }
      });
    });

    document.querySelectorAll('.page').forEach(page => {
      observer.observe(page, { attributes: true, attributeFilter: ['class', 'style'] });
    });
  }

  // ══ 9. PREMIUM INPUT FOCUS GLOW ══════════════════════════════════
  function initInputFocusGlow() {
    // Dynamic glow that follows the input border color
    document.addEventListener('focusin', function(e) {
      if (e.target.matches('input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="number"], textarea')) {
        e.target.dataset.ui2Focused = '1';
      }
    });

    document.addEventListener('focusout', function(e) {
      if (e.target.matches('input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="number"], textarea')) {
        delete e.target.dataset.ui2Focused;
      }
    });
  }

  // ══ 10. PERFORMANCE: Debounce scroll handlers ═══════════════════
  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // ══ INIT ALL ════════════════════════════════════════════════════
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initAll);
    } else {
      initAll();
    }
  }

  function initAll() {
    initRippleEffect();
    initLazyImageFade();
    initScrollFadeIn();
    initAnimatedCounters();
    initCardTouchFeedback();
    initSmoothScroll();
    initNavLinkIndicator();
    initPageTransitions();
    initInputFocusGlow();

    // Re-init fade-in observer after SPA page changes
    let lastPage = '';
    setInterval(() => {
      const activePage = document.querySelector('.page.active');
      if (activePage && activePage.id !== lastPage) {
        lastPage = activePage.id;
        // Re-run fade-in for the new page
        setTimeout(() => {
          initScrollFadeIn();
          initAnimatedCounters();
        }, 100);
      }
    }, 300);

    console.log('%c✨ Studyria UI/UX 2.0 loaded', 'color: #3d8ef8; font-weight: bold');
  }

  init();
})();
