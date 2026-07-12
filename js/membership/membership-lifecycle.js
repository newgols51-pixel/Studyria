/**
 * =============================================================================
 * FILE: js/membership/membership-lifecycle.js
 * PROJECT: Studyria Premium Membership — Phase 4C
 * PURPOSE: Membership lifecycle manager — top-level orchestrator.
 *          Coordinates MembershipService (Phase 4B) + StatusResolver +
 *          FeatureResolver + Validator + Cache + Audit into one coherent API.
 *          Read-only. Zero UI changes. Zero writes. Zero payment logic.
 * BRANCH:  feat/premium-membership-phase-4c
 * SAFE:    Orchestration layer only. Zero writes (audit stubs only).
 * =============================================================================
 *
 * DEPENDENCIES (must load in order before this file):
 *   1. membership-config.js
 *   2. membership-utils.js
 *   3. membership-cache.js
 *   4. membership-status-resolver.js
 *   5. membership-feature-resolver.js
 *   6. membership-validator.js
 *   7. membership-audit.js
 *   8. membership-service.js   (Phase 4B)
 *
 * USAGE:
 *   const engine = window.StudyriaMembershipEngine;
 *   await engine.boot();
 *
 *   const ctx = await engine.getContext();
 *   // ctx.resolved.state      → 'FREE' | 'ACTIVE' | 'GRACE' | 'EXPIRED' ...
 *   // ctx.resolved.isPremium  → boolean
 *   // ctx.features.ad_free    → boolean
 *   // ctx.resolved.daysLeft   → number
 *
 *   engine.canAccess('offline_downloads'); // → Promise<boolean>
 *
 * =============================================================================
 */

'use strict';

(function (root) {
  if (root.StudyriaMembershipEngine) return;

  // ── Dependency accessors ─────────────────────────────────────────────────
  const _svc      = () => root.StudyriaMembershipService;
  const _resolver = () => root.StudyriaMembershipStatusResolver;
  const _features = () => root.StudyriaMembershipFeatureResolver;
  const _cache    = () => root.StudyriaMembershipCache;
  const _audit    = () => root.StudyriaMembershipAudit;
  const _cfg      = () => root.STUDYRIA_MEMBERSHIP;
  const _utils    = () => root.StudyriaMembershipUtils;

  // ── Engine state ──────────────────────────────────────────────────────────
  let _booted      = false;
  let _currentCtx  = null;  // last resolved MembershipContext
  let _featureReg  = null;  // cached membership_features rows

  // ── Event subscribers ─────────────────────────────────────────────────────
  // Simple pub/sub for state-change notifications (no DOM events yet)
  const _subscribers = new Map();
  let _subIdCounter  = 0;

  function _emit(eventName, data) {
    for (const [, fn] of _subscribers) {
      try { fn(eventName, data); } catch (_) {}
    }
  }

  // ── Logging ───────────────────────────────────────────────────────────────
  function _log(fn, msg, data) {
    const tag = '[MembershipEngine:' + fn + ']';
    data !== undefined ? console.debug(tag, msg, data) : console.debug(tag, msg);
  }
  function _warn(fn, msg, err) {
    console.warn('[MembershipEngine:' + fn + ']', msg, err || '');
  }

  // ── Free context (returned when no membership / guest) ───────────────────
  function _freeContext() {
    const resolver = _resolver();
    const features = _features();
    const resolved = resolver ? resolver.resolve(null) : { state: 'FREE', isPremium: false, daysLeft: 0, planName: 'Free', planFeatures: {} };
    const featureMap = features ? features.getFeatureMap(resolved, _featureReg) : {};
    return Object.freeze({
      resolved,
      features: featureMap,
      membership: null,
      plan:       null,
      error:      null,
      fetchedAt:  new Date().toISOString(),
    });
  }

  // ── Build full context from membership row ────────────────────────────────
  async function _buildContext(membershipRow) {
    const resolver = _resolver();
    const featuresModule = _features();

    // Ensure feature registry is loaded
    if (!_featureReg) {
      try {
        _featureReg = await _svc().getEnabledFeatures();
      } catch (_) {
        _featureReg = [];
      }
    }

    const resolved   = resolver
      ? resolver.resolve(membershipRow, 3)   // 3-day grace
      : { state: membershipRow ? 'ACTIVE' : 'FREE', isPremium: !!membershipRow, planFeatures: {} };

    const featureMap = featuresModule
      ? featuresModule.getFeatureMap(resolved, _featureReg)
      : {};

    return Object.freeze({
      resolved,
      features:   featureMap,
      membership: membershipRow || null,
      plan:       membershipRow?.plan || null,
      error:      null,
      fetchedAt:  new Date().toISOString(),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC ENGINE API
  // ═══════════════════════════════════════════════════════════════════════════

  const Engine = {

    _phase: '4C',

    // ─────────────────────────────────────────────────────────────────────────
    // boot()
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Boot the membership engine.
     * Initialises MembershipService (Phase 4B) + hooks auth state changes.
     * Safe to call multiple times.
     *
     * @returns {Promise<void>}
     */
    async boot() {
      if (_booted) return;
      _booted = true;
      _log('boot', 'Phase 4C engine booting...');

      // Init Phase 4B service
      const svc = _svc();
      if (svc?.init) await svc.init();

      // Hook Supabase auth state → clear context cache
      const client = root.supabaseClient;
      if (client?.auth?.onAuthStateChange) {
        client.auth.onAuthStateChange((event) => {
          if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
            _log('boot', 'Auth event — clearing engine context', event);
            _currentCtx  = null;
            _featureReg  = null;
            const cache = _cache();
            if (cache) cache.clear();
            _emit('auth_change', { event });
          }
        });
      }

      _log('boot', 'Engine ready');
      _emit('boot', { phase: '4C' });
    },

    // ─────────────────────────────────────────────────────────────────────────
    // getContext()
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Get the full resolved MembershipContext for the current user.
     * Uses the shared cache (MembershipCache). Refreshes on cache miss.
     * Always returns a valid context — never throws.
     *
     * @param {boolean} [forceRefresh=false] — bypass cache
     * @returns {Promise<MembershipContext>}
     */
    async getContext(forceRefresh) {
      const cache = _cache();

      // Check module-level context cache first (fastest path)
      if (!forceRefresh && _currentCtx) {
        _log('getContext', 'In-memory context hit');
        return _currentCtx;
      }

      // Check shared MembershipCache
      const svc = _svc();
      if (!svc) {
        _warn('getContext', 'MembershipService not ready — returning free context');
        return _freeContext();
      }

      // Get current user id for cache key
      const uid = root.currentUser?.uid || null;
      const cacheKey = uid ? (_cache()?.KEYS?.status?.(uid) || 'stt:' + uid) : null;

      if (!forceRefresh && cacheKey && cache?.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (cached) {
          _log('getContext', 'Cache hit for uid', uid);
          _currentCtx = cached;
          return cached;
        }
      }

      // Fetch from Supabase (via Phase 4B service)
      let membershipRow = null;
      try {
        membershipRow = await svc.getCurrentMembership();
      } catch (err) {
        _warn('getContext', 'getCurrentMembership error', err);
        const audit = _audit();
        if (audit) audit.logError(null, err?.message || 'unknown', { fn: 'getContext' });
        return _freeContext();
      }

      // Build context
      const ctx = await _buildContext(membershipRow);

      // Detect state change
      const prevState = _currentCtx?.resolved?.state;
      const newState  = ctx.resolved.state;
      if (prevState && prevState !== newState) {
        _log('getContext', 'State changed', prevState + ' → ' + newState);
        _emit('state_change', { prev: prevState, next: newState, ctx });
      }

      _currentCtx = ctx;

      // Store in shared cache
      if (cacheKey && cache) {
        cache.set(cacheKey, ctx, cache.TTL?.STATUS || 5 * 60 * 1000);
      }

      // Audit: log status check (client-side only)
      const audit = _audit();
      if (audit) audit.logStatusCheck(ctx.membership?.id || null, ctx.resolved.state);

      _log('getContext', 'Context resolved', {
        state:     ctx.resolved.state,
        isPremium: ctx.resolved.isPremium,
        planSlug:  ctx.resolved.planSlug,
        daysLeft:  ctx.resolved.daysLeft,
      });

      return ctx;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // canAccess()
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Check if the current user can access a specific feature.
     * Uses cached context — fast path.
     *
     * @param {string} featureKey
     * @returns {Promise<boolean>}
     */
    async canAccess(featureKey) {
      if (!featureKey) return false;
      const ctx = await this.getContext();
      const granted = ctx.features[featureKey] === true;

      // Audit feature check (client-side only)
      const audit = _audit();
      if (audit) audit.logFeatureCheck(ctx.membership?.id || null, featureKey, granted);

      _log('canAccess', featureKey + ' → ' + (granted ? 'GRANTED' : 'DENIED'));
      return granted;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // isPremium()
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Quick check: is the current user in a premium-granting state?
     * @returns {Promise<boolean>}
     */
    async isPremium() {
      const ctx = await this.getContext();
      return ctx.resolved.isPremium;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // getResolvedState()
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Get the canonical state string: FREE | ACTIVE | GRACE | EXPIRED | ...
     * @returns {Promise<string>}
     */
    async getResolvedState() {
      const ctx = await this.getContext();
      return ctx.resolved.state;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // getDaysLeft()
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Days remaining in the current membership (0 for free/expired).
     * @returns {Promise<number>}
     */
    async getDaysLeft() {
      const ctx = await this.getContext();
      return ctx.resolved.daysLeft;
    },

    // ─────────────────────────────────────────────────────────────────────────
    // getExpiryLabel()
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Human-readable expiry string, e.g. "Expires in 23 days" | "Expired"
     * @returns {Promise<string>}
     */
    async getExpiryLabel() {
      const ctx = await this.getContext();
      return ctx.resolved.expiryLabel || 'N/A';
    },

    // ─────────────────────────────────────────────────────────────────────────
    // refreshContext()
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Force-refresh the membership context from Supabase.
     * Invalidates all caches and re-fetches.
     * @returns {Promise<MembershipContext>}
     */
    async refreshContext() {
      _log('refreshContext', 'Force refresh triggered');
      _currentCtx  = null;
      _featureReg  = null;
      const cache = _cache();
      if (cache) cache.clear();
      const svc = _svc();
      if (svc?.invalidateCache) svc.invalidateCache();
      return this.getContext(true);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // validate()
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Validate the current context's membership and plan data.
     * Returns { valid, errors, warnings } or null if no membership.
     * @returns {Promise<object|null>}
     */
    async validate() {
      const ctx = await this.getContext();
      if (!ctx.membership) return null;

      const validator = root.StudyriaMembershipValidator;
      if (!validator) return null;

      const mbResult   = validator.validateMembership(ctx.membership);
      const planResult = ctx.plan ? validator.validatePlan(ctx.plan) : null;

      return {
        membership: mbResult,
        plan:       planResult,
        overall:    mbResult.valid && (!planResult || planResult.valid),
      };
    },

    // ─────────────────────────────────────────────────────────────────────────
    // subscribe() / unsubscribe()
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Subscribe to engine events (state_change, auth_change, boot).
     * @param {function} fn - callback(eventName, data)
     * @returns {number} subscription id (pass to unsubscribe)
     */
    subscribe(fn) {
      if (typeof fn !== 'function') return -1;
      const id = ++_subIdCounter;
      _subscribers.set(id, fn);
      return id;
    },

    /**
     * Unsubscribe from engine events.
     * @param {number} id
     */
    unsubscribe(id) {
      _subscribers.delete(id);
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Diagnostics
    // ─────────────────────────────────────────────────────────────────────────
    /**
     * Full engine diagnostic dump. Dev use only.
     * @returns {object}
     */
    _debug() {
      const cache = _cache();
      const audit = _audit();
      return {
        phase:        '4C',
        booted:       _booted,
        currentState: _currentCtx?.resolved?.state || 'none',
        isPremium:    _currentCtx?.resolved?.isPremium || false,
        featureRegOK: Array.isArray(_featureReg),
        cache:        cache?._debug() || null,
        audit:        audit?.getSummary() || null,
        subscribers:  _subscribers.size,
        service:      _svc()?._debug?.() || null,
      };
    },
  };

  root.StudyriaMembershipEngine = Object.freeze(Engine);
  _log('module', 'Registered — Phase 4C');

}(typeof self !== 'undefined' ? self : this));
