
/* ═══════════════════════════════════════════════════════════════════
   CAREER HUB MENU BOOTSTRAP  — v3 (all bugs fixed — see inline docs)
   ═══════════════════════════════════════════════════════════════════ */
window._chMenuBootstrap = (function() {
  'use strict';
  /* ═══════════════════════════════════════════════════════════════════
     CAREER HUB MENU BOOTSTRAP  — v3 (all bugs fixed)
     ═══════════════════════════════════════════════════════════════════
     KEY FIXES vs v2:
     • Overlay + swipe listeners call window.chCloseMenu() via the live
       global reference — they never capture a stale stub. This means
       the _ovlayBound / _swipeBound guards are safe to keep (they
       prevent duplicate listeners) because the handler always reads the
       current window.chCloseMenu value at call time.
     • Open-button also calls window.chOpenMenu() via live reference —
       same pattern, consistent.
     • Close-button re-binding: _chBound sentinel is REMOVED so
       activate() can re-attach after the real functions load. A named
       handler object (_handlers) is used with removeEventListener to
       prevent duplicates instead of a boolean sentinel.
     • touchend on open button fires chOpenMenu with stopPropagation to
       prevent the 300 ms ghost click on Android from double-firing.
     • Swipe: touchstart records timestamp; moves older than 500 ms are
       ignored (prevents accidental swipe-away after a scroll pause).
     ═══════════════════════════════════════════════════════════════════ */

  var _pendingOpen = false;
  var _ovlayBound  = false;
  var _swipeBound  = false;

  /* Stored handler references so we can removeEventListener cleanly */
  var _handlers = {
    openClick:  null,
    openTouch:  null,
    closeClick: null,
  };

  /* ── Queuing stubs (active until career-hub.js calls activate()) ── */
  window.chOpenMenu  = function() { _pendingOpen = true; };
  window.chCloseMenu = function() { /* no-op stub — real fn not loaded yet */ };

  /* ── Overlay backdrop click → close ─────────────────────────────── */
  /* NOTE: listener calls window.chCloseMenu() — the live global —
     so it automatically uses the real function once activate() runs.
     Therefore _ovlayBound only needs to be set once. */
  function _bindOverlay() {
    if (_ovlayBound) return;
    var ov = document.getElementById('chMenuOverlay');
    if (!ov) return;
    ov.addEventListener('click', function(e) {
      /* Only close when the click landed directly on the dark backdrop,
         not bubbled up from inside the drawer */
      if (e.target === ov) {
        e.stopPropagation();
        window.chCloseMenu(); /* always the live function */
      }
    });
    _ovlayBound = true;
  }

  /* ── Swipe-left on the drawer → close ───────────────────────────── */
  function _bindSwipe() {
    if (_swipeBound) return;
    var drawer = document.getElementById('chMenuDrawer');
    if (!drawer) return;
    var startX = 0, startY = 0, startT = 0, dragging = false;

    drawer.addEventListener('touchstart', function(e) {
      var t = e.touches[0];
      startX   = t.clientX;
      startY   = t.clientY;
      startT   = Date.now();
      dragging = true;
    }, { passive: true });

    drawer.addEventListener('touchmove', function(e) {
      if (!dragging) return;
      if (Date.now() - startT > 500) { dragging = false; return; } /* stale move */
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;
      /* Left swipe: dx < -40px, predominantly horizontal */
      if (dx < -40 && Math.abs(dy) < Math.abs(dx)) {
        dragging = false;
        window.chCloseMenu(); /* live global */
      }
    }, { passive: true });

    drawer.addEventListener('touchend',   function() { dragging = false; }, { passive: true });
    drawer.addEventListener('touchcancel',function() { dragging = false; }, { passive: true });
    _swipeBound = true;
  }

  /* ── Bind ☰ open btn + ✕ close btn ──────────────────────────────── */
  function _bindButtons() {
    var openBtn  = document.getElementById('careerMenuBtn');
    var closeBtn = document.getElementById('careerMenuCloseBtn');

    /* ── Open button ── */
    if (openBtn) {
      /* Remove any previously attached handlers before re-attaching */
      if (_handlers.openClick) {
        openBtn.removeEventListener('click',    _handlers.openClick);
        openBtn.removeEventListener('touchend', _handlers.openTouch);
      }

      _handlers.openClick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        window.chOpenMenu(); /* live global */
      };

      /* touchend fires first on mobile — call open and mark handled so
         the synthetic click event that follows (300 ms later) is ignored */
      var _touchFired = false;
      _handlers.openTouch = function(e) {
        e.preventDefault(); /* prevents the ghost click */
        e.stopPropagation();
        _touchFired = true;
        window.chOpenMenu();
        /* reset after ghost-click window */
        setTimeout(function() { _touchFired = false; }, 600);
      };

      /* Wrap click so it skips when touchend already handled it */
      var _safeOpenClick = function(e) {
        if (_touchFired) return;
        _handlers.openClick(e);
      };

      openBtn.addEventListener('touchend', _handlers.openTouch,  { passive: false });
      openBtn.addEventListener('click',    _safeOpenClick);
      /* Store the wrapper too so we can remove it later */
      _handlers.openClick = _safeOpenClick;
    }

    /* ── Close button ── */
    if (closeBtn) {
      if (_handlers.closeClick) {
        closeBtn.removeEventListener('click', _handlers.closeClick);
      }

      _handlers.closeClick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        window.chCloseMenu(); /* no-arg → unconditional close (fixed guard in career-hub.js) */
      };

      closeBtn.addEventListener('click', _handlers.closeClick);
    }

    _bindOverlay();
    _bindSwipe();
  }

  /* ── Run once DOM is interactive ─────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bindButtons);
  } else {
    _bindButtons();
  }

  return {
    /* Called by career-hub.js once chOpenMenu / chCloseMenu are real */
    activate: function(openFn, closeFn) {
      window.chOpenMenu  = openFn;
      window.chCloseMenu = closeFn;
      /* Re-bind buttons now that the real functions are in place.
         Overlay + swipe don't need re-binding — they use window.chCloseMenu
         by live reference and are already attached. */
      _bindButtons();
      /* Replay any tap that arrived before the script finished loading */
      if (_pendingOpen) { _pendingOpen = false; openFn(); }
    }
  };
})();
