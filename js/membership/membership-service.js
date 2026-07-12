/**
 * =============================================================================
 * FILE: js/membership/membership-service.js
 * PROJECT: Studyria Premium Membership — Phase 4A (Foundation)
 * PURPOSE: Safe, read-only membership service layer.
 *          All methods return safe placeholder/null values.
 *          No Supabase queries. No activation. No payment. No unlock.
 * STATUS: PLACEHOLDER ONLY — Phase 4B will wire real Supabase queries.
 * SAFE: Does NOT modify any existing functionality.
 * =============================================================================
 *
 * USAGE (Phase 4B+):
 *   const svc = window.StudyriaMembershipService;
 *   const membership = await svc.getCurrentMembership();
 *   const isPrem = await svc.isPremium();
 *
 * DEPENDENCIES:
 *   - membership-config.js (must load first)
 *   - membership-utils.js  (must load first)
 *
 * =============================================================================
 */

'use strict';

(function (root) {

  // Guard: prevent double-initialisation
  if (root.StudyriaMembershipService) return;

  // Dependency references (resolved lazily to handle any load order)
  const _cfg  = () => root.STUDYRIA_MEMBERSHIP;
  const _utils = () => root.StudyriaMembershipUtils;

  // ===========================================================================
  // INTERNAL STATE (Phase 4A: all null / safe defaults)
  // ===========================================================================

  /** @type {object|null} In-memory membership cache */
  let _cachedMembership = null;

  /** @type {number|null} Cache expiry timestamp (ms) */
  let _cacheExpiry = null;

  /** @type {boolean} Whether the service has been initialised */
  let _initialised = false;

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Logs a service message (grouped under [MembershipService]).
   * @param {string} method
   * @param {string} message
   * @param {*} [data]
   */
  function _log(method, message, data) {
    const prefix = '[StudyriaMembershipService:' + method + ']';
    if (data !== undefined) {
      console.debug(prefix, message, data);
    } else {
      console.debug(prefix, message);
    }
  }

  /**
   * Returns true if the in-memory cache is still valid.
   * @returns {boolean}
   */
  function _isCacheValid() {
    if (!_cachedMembership || !_cacheExpiry) return false;
    return Date.now() < _cacheExpiry;
  }

  /**
   * Stores a value in the membership cache.
   * @param {object|null} membership
   */
  function _setCache(membership) {
    const cfg = _cfg();
    const ttl = cfg ? cfg.DEFAULTS.CACHE_TTL_MS : 5 * 60 * 1000;
    _cachedMembership = membership;
    _cacheExpiry = Date.now() + ttl;
  }

  /**
   * Clears the in-memory membership cache.
   */
  function _clearCache() {
    _cachedMembership = null;
    _cacheExpiry = null;
  }

  /**
   * Returns a safe "no membership" result object.
   * @returns {object}
   */
  function _noMembership() {
    const cfg = _cfg();
    return {
      membership:   null,
      plan:         null,
      status:       cfg ? cfg.STATUS.NONE : 'none',
      isPremium:    false,
      isExpired:    false,
      expiresAt:    null,
      daysLeft:     0,
      features:     {},
    };
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  const Service = {

    /**
     * Initialise the membership service.
     * Phase 4A: no-op placeholder.
     * Phase 4B: will verify Supabase client, set up listeners.
     *
     * @returns {Promise<void>}
     */
    async init() {
      if (_initialised) return;
      _initialised = true;
      _log('init', 'MembershipService initialised (Phase 4A placeholder)');
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CORE READ METHODS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get the current user's active membership record.
     * Phase 4A: returns null (no Supabase query yet).
     * Phase 4B: queries user_memberships WHERE user_id = auth.uid() AND status = 'active'.
     *
     * @returns {Promise<object|null>} membership row or null
     */
    async getCurrentMembership() {
      _log('getCurrentMembership', 'Phase 4A placeholder — returning null');
      if (_isCacheValid()) {
        _log('getCurrentMembership', 'Cache hit', _cachedMembership);
        return _cachedMembership;
      }
      // Phase 4B: replace with Supabase query
      // const { data } = await supabase
      //   .from('user_memberships')
      //   .select('*, plan:membership_plans(*)')
      //   .eq('user_id', userId)
      //   .eq('status', 'active')
      //   .maybeSingle();
      _setCache(null);
      return null;
    },

    /**
     * Check if the current user has an active (non-expired) premium membership.
     * Phase 4A: always returns false.
     * Phase 4B: checks getCurrentMembership() + expiry date.
     *
     * @returns {Promise<boolean>}
     */
    async isPremium() {
      _log('isPremium', 'Phase 4A placeholder — returning false');
      // Phase 4B:
      // const m = await this.getCurrentMembership();
      // if (!m) return false;
      // const utils = _utils();
      // return !utils.isExpired(m.expires_at);
      return false;
    },

    /**
     * Check if the current user's membership includes a specific feature.
     * Phase 4A: always returns false.
     * Phase 4B: checks plan.features[featureKey] AND membership_features.enabled.
     *
     * @param {string} featureKey - e.g. 'offline_downloads'
     * @returns {Promise<boolean>}
     */
    async hasFeature(featureKey) {
      _log('hasFeature', 'Phase 4A placeholder — returning false', { featureKey });
      // Phase 4B:
      // const m = await this.getCurrentMembership();
      // if (!m || !m.plan) return false;
      // const planFeatures = m.plan.features || {};
      // return planFeatures[featureKey] === true;
      return false;
    },

    /**
     * Get the full membership status object for the current user.
     * Phase 4A: returns safe _noMembership() object.
     * Phase 4B: queries DB and returns enriched status.
     *
     * @returns {Promise<object>} { membership, plan, status, isPremium, isExpired, expiresAt, daysLeft, features }
     */
    async getMembershipStatus() {
      _log('getMembershipStatus', 'Phase 4A placeholder — returning noMembership');
      // Phase 4B:
      // const m = await this.getCurrentMembership();
      // const utils = _utils();
      // if (!m) return _noMembership();
      // return {
      //   membership: m,
      //   plan: m.plan,
      //   status: m.status,
      //   isPremium: !utils.isExpired(m.expires_at),
      //   isExpired: utils.isExpired(m.expires_at),
      //   expiresAt: m.expires_at,
      //   daysLeft: utils.daysUntilExpiry(m.expires_at),
      //   features: m.plan?.features || {},
      // };
      return _noMembership();
    },

    /**
     * Get the plan details for a given plan slug.
     * Phase 4A: returns null (no Supabase query yet).
     * Phase 4B: queries membership_plans WHERE slug = planSlug.
     *
     * @param {string} planSlug - e.g. 'monthly'
     * @returns {Promise<object|null>} plan row or null
     */
    async getMembershipPlan(planSlug) {
      _log('getMembershipPlan', 'Phase 4A placeholder — returning null', { planSlug });
      // Phase 4B:
      // const { data } = await supabase
      //   .from('membership_plans')
      //   .select('*')
      //   .eq('slug', planSlug)
      //   .eq('active', true)
      //   .maybeSingle();
      // return data || null;
      return null;
    },

    /**
     * Get all active membership plans.
     * Phase 4A: returns empty array.
     * Phase 4B: queries membership_plans WHERE active = true ORDER BY sort_order.
     *
     * @returns {Promise<object[]>}
     */
    async getAllPlans() {
      _log('getAllPlans', 'Phase 4A placeholder — returning []');
      // Phase 4B:
      // const { data } = await supabase
      //   .from('membership_plans')
      //   .select('*')
      //   .eq('active', true)
      //   .order('sort_order', { ascending: true });
      // return data || [];
      return [];
    },

    /**
     * Get all enabled membership features from the registry.
     * Phase 4A: returns empty array.
     * Phase 4B: queries membership_features WHERE enabled = true.
     *
     * @returns {Promise<object[]>}
     */
    async getEnabledFeatures() {
      _log('getEnabledFeatures', 'Phase 4A placeholder — returning []');
      return [];
    },

    /**
     * Get the user's transaction history.
     * Phase 4A: returns empty array.
     * Phase 4B: queries membership_transactions WHERE user_id = auth.uid().
     *
     * @returns {Promise<object[]>}
     */
    async getTransactionHistory() {
      _log('getTransactionHistory', 'Phase 4A placeholder — returning []');
      return [];
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CACHE MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Invalidate the client-side membership cache.
     * Call this after auth state changes or post-payment.
     */
    invalidateCache() {
      _log('invalidateCache', 'Cache cleared');
      _clearCache();
    },

    // ─────────────────────────────────────────────────────────────────────────
    // DIAGNOSTICS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Returns internal service state for debugging.
     * NEVER expose this in production UI.
     * @returns {object}
     */
    _debug() {
      return {
        initialised:    _initialised,
        cacheValid:     _isCacheValid(),
        cacheExpiry:    _cacheExpiry,
        cachedValue:    _cachedMembership,
        phase:          'phase-4a-foundation',
      };
    },
  };

  // Expose on global
  root.StudyriaMembershipService = Object.freeze(Service);

}(typeof self !== 'undefined' ? self : this));
