

/* ══════════════════════════════════════════════════════════════
   ADAPTIVE HERO BACKGROUND SYSTEM — Auto Day/Night JS
   ══════════════════════════════════════════════════════════════ */
(function initAdaptiveHeroBg() {
  'use strict';

  var NIGHT_START = 17; // 5 PM
  var DAY_START   =  5; // 5 AM

  function isNightTime() {
    try {
      var h = new Date().getHours();
      return h >= NIGHT_START || h < DAY_START;
    } catch(e) { return true; } // fallback night
  }

  function buildBgHTML() {
    return [
      '<div class="hero-adaptive-bg" id="heroAdaptiveBg" aria-hidden="true">',
        // Night layers
        '<div class="hab-layer hab-night-desktop" id="habNightDesktop"></div>',
        '<div class="hab-layer hab-night-mobile"  id="habNightMobile"></div>',
        // Day layers
        '<div class="hab-layer hab-day-desktop"   id="habDayDesktop"></div>',
        '<div class="hab-layer hab-day-mobile"    id="habDayMobile"></div>',
        // Readability overlay
        '<div class="hab-overlay" id="habOverlay"></div>',
      '</div>'
    ].join('');
  }

  function applyMode(isNight, animate) {
    var root = document.getElementById('heroAdaptiveBg');
    if (!root) return;

    var nightD = document.getElementById('habNightDesktop');
    var nightM = document.getElementById('habNightMobile');
    var dayD   = document.getElementById('habDayDesktop');
    var dayM   = document.getElementById('habDayMobile');

    if (!animate) {
      // instant on first load — avoid flash
      root.style.transition = 'none';
      [nightD, nightM, dayD, dayM].forEach(function(el){ if(el){ el.style.transition='none'; } });
    }

    if (isNight) {
      root.classList.remove('hab-day-active');
      if(nightD) nightD.classList.add('hab-active');
      if(nightM) nightM.classList.add('hab-active');
      if(dayD)   dayD.classList.remove('hab-active');
      if(dayM)   dayM.classList.remove('hab-active');
    } else {
      root.classList.add('hab-day-active');
      if(dayD)   dayD.classList.add('hab-active');
      if(dayM)   dayM.classList.add('hab-active');
      if(nightD) nightD.classList.remove('hab-active');
      if(nightM) nightM.classList.remove('hab-active');
    }

    if (!animate) {
      // Re-enable transitions after paint
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          if(root) root.style.transition = '';
          [nightD, nightM, dayD, dayM].forEach(function(el){ if(el){ el.style.transition=''; } });
        });
      });
    }
  }

  function inject() {
    var hero = document.getElementById('dynamicHero');
    if (!hero) return;

    // Insert adaptive bg as first child of hero
    var tmp = document.createElement('div');
    tmp.innerHTML = buildBgHTML();
    hero.insertBefore(tmp.firstChild, hero.firstChild);

    // Apply mode immediately (no transition flash)
    applyMode(isNightTime(), false);

    // Schedule next check at the transition boundary
    scheduleModeCheck();
  }

  function scheduleModeCheck() {
    // PERF: Calculate exact ms until next mode boundary (6:00 or 18:00)
    // instead of polling every minute — fires only 2x per day
    function scheduleNext() {
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
      const todaySecs = h * 3600 + m * 60 + s;
      const daySecs = 6 * 3600;   // 06:00
      const nightSecs = 18 * 3600; // 18:00
      let secsUntilNext;
      if (todaySecs < daySecs) secsUntilNext = daySecs - todaySecs;
      else if (todaySecs < nightSecs) secsUntilNext = nightSecs - todaySecs;
      else secsUntilNext = 86400 - todaySecs + daySecs;
      setTimeout(function() {
        applyMode(isNightTime(), true);
        scheduleNext(); // chain to next boundary
      }, (secsUntilNext + 5) * 1000); // +5s buffer past the boundary
    }
    scheduleNext();
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();

