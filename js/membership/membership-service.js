/**
 * =============================================================================
 * FILE: js/membership/membership-service.js
 * PROJECT: Studyria Premium Membership — Phase 4B
 * PURPOSE: READ-ONLY Supabase membership service.
 *          Connects to membership_plans, user_memberships, membership_features.
 *          Returns FREE status if no membership exists.
 *          Zero writes. Zero unlocks. Zero UI changes. Zero payment logic.
 * BRANCH:  feat/premium-membership-phase-4b
 * SAFE:    Read-only. No activation. No payment. No Premium unlock.
 * =============================================================================
 *
 * DEPENDENCIES (must load before this file):
 *   - supabase.js          → sets window.supabaseClient
 *   - membership-config.js → sets window.STUDYRIA_MEMBERSHIP
 *   - membership-utils.js  → sets window.StudyriaMembershipUtils
 *
 * USAGE:
 *   const svc = window.StudyriaMembershipService;
 *   await svc.init();
 *   const status = await svc.getMembershipStatus();
 *   // { isPremium: false, status: 'none', daysLeft: 0, ... }
 *
 * =============================================================================
 */

'use strict';

(function (root) {

  // Guard against double-initialisation
  if (root.StudyriaMembershipService && root.StudyriaMembershipService._phase === '4B') return;

  // ── Dependency accessors (lazy — tolerates any load order) ──────────────────
  const _sb    = () => root.supabaseClient;
  const _cfg   = () => root.STUDYRIA_MEMBERSHIP;
  const _utils = () => root.StudyriaMembershipUtils;

  // ── Internal state ───────────────────────────────────────────────────────────
  /** @type {object|null} Cached membership result */
  let _cache = null;
  /** @type {number|null} Cache expiry ms timestamp */
  let _cacheExpiry = null;
  /** @type {boolean} */
  let _initialised = false;
  /** @type {boolean} Supabase tables confirmed to exist */
  let _tablesReady = false;

  // ── Logging ──────────────────────────────────────────────────────────────────
  function _log(fn, msg, data) {
    const tag = '[MembershipService:' + fn + ']';
    data !== undefined
      ? console.debug(tag, msg, data)
      : console.debug(tag, msg);
  }
  function _warn(fn, msg, err) {
    console.warn('[MembershipService:' + fn + ']', msg, err || '');
  }

  // ── Cache helpers ─────────────────────────────────────────────────────────────
  function _isCacheValid() {
    if (!_cache || !_cacheExpiry) return false;
    return Date.now() < _cacheExpiry;
  }
  function _setCache(value) {
    const ttl = (_cfg() || {}).DEFAULTS?.CACHE_TTL_MS ?? 5 * 60 * 1000;
    _cache       = value;
    _cacheExpiry = Date.now() + ttl;
  }
  function _clearCache() {
    _cache       = null;
    _cacheExpiry = null;
  }

  // ── Safe FREE status object ───────────────────────────────────────────────────
  function _freeStatus() {
    return Object.freeze({
      isPremium:    false,
      status:       'none',           // user has no membership
      planSlug:     null,
      planName:     'Free',
      expiresAt:    null,
      daysLeft:     0,
      isExpired:    false,
      isExpiringSoon: false,
      features:     {},
      membership:   null,
      plan:         null,
    });
  }

  // ── Get current user ID (reads window.currentUser set by supabase.js) ────────
  async function _getUserId() {
    // Primary: window.currentUser set by syncNavToAuth
    if (root.currentUser?.uid) return root.currentUser.uid;

    // Fallback: ask Supabase Auth directly
    const client = _sb();
    if (!client) return null;
    try {
      const { data: { user } } = await client.auth.getUser();
      return user?.id ?? null;
    } catch (e) {
      _warn('_getUserId', 'getUser failed', e);
      return null;
    }
  }

  // ── Confirm tables exist (once per session) ───────────────────────────────────
  async function _ensureTablesReady() {
    if (_tablesReady) return true;
    const client = _sb();
    if (!client) return false;
    try {
      // Lightweight probe: fetch one row with limit 1 — read-only
      const { error } = await client
        .from('membership_plans')
        .select('id')
        .limit(1);
      if (error) {
        _warn('_ensureTablesReady', 'membership_plans not accessible yet', error.message);
        return false;
      }
      _tablesReady = true;
      _log('_ensureTablesReady', 'Tables confirmed ready');
      return true;
    } catch (e) {
      _warn('_ensureTablesReady', 'Table probe failed', e);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PUBLIC SERVICE API
  // ═══════════════════════════════════════════════════════════════════════════════

  const Service = {

    /** Phase tag for guard check */
    _phase: '4B',

    /**
     * Initialise the service.
     * - Probes membership_plans table availability.
     * - Hooks into auth state changes to clear cache on sign-in/out.
     * - Safe to call multiple times.
     *
     * @returns {Promise<void>}
     */
    async init() {
      if (_initialised) return;
      _initialised = true;
      _log('init', 'Phase 4B initialising...');

      // Probe tables (non-blocking — failure is graceful)
      await _ensureTablesReady();

      // Hook auth state changes → invalidate cache
      const client = _sb();
      if (client?.auth?.onAuthStateChange) {
        client.auth.onAuthStateChange((event) => {
          if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
            _log('init', 'Auth event — clearing membership cache', event);
            _clearCache();
          }
        });
      }

      _log('init', 'Phase 4B ready', { tablesReady: _tablesReady });
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // getCurrentMembership()
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Fetch the current user's active membership row from Supabase.
     * Returns null if: not logged in, no membership, tables not ready,
     * or any error (fail-safe).
     *
     * Supabase query:
     *   SELECT user_memberships.*, membership_plans.*
     *   FROM user_memberships
     *   JOIN membership_plans ON plan_id = membership_plans.id
     *   WHERE user_id = :uid AND status = 'active'
     *   LIMIT 1
     *
     * @returns {Promise<object|null>}
     */
    async getCurrentMembership() {
      // Cache check
      if (_isCacheValid()) {
        _log('getCurrentMembership', 'Cache hit');
        return _cache;
      }

      const uid = await _getUserId();
      if (!uid) {
        _log('getCurrentMembership', 'No user — returning null');
        return null;
      }

      const client = _sb();
      if (!client) {
        _warn('getCurrentMembership', 'Supabase client not ready');
        return null;
      }

      if (!await _ensureTablesReady()) {
        _warn('getCurrentMembership', 'Tables not ready — returning null');
        return null;
      }

      try {
        // READ-ONLY — SELECT only, no writes
        const { data, error } = await client
          .from('user_memberships')
          .select(`
            id,
            user_id,
            plan_id,
            status,
            started_at,
            expires_at,
            cancelled_at,
            auto_renew,
            created_at,
            plan:membership_plans (
              id,
              slug,
              name,
              description,
              duration_days,
              price,
              currency,
              badge,
              features,
              active
            )
          `)
          .eq('user_id', uid)
          .eq('status', 'active')
          .maybeSingle();  // returns null instead of error if no row found

        if (error) {
          _warn('getCurrentMembership', 'Query error', error.message);
          return null;
        }

        _log('getCurrentMembership', 'Query result', data ? { id: data.id, status: data.status, expires_at: data.expires_at } : null);
        _setCache(data || null);
        return data || null;

      } catch (e) {
        _warn('getCurrentMembership', 'Unexpected error', e);
        return null;
      }
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // getMembershipStatus()
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Get the full derived status object for the current user.
     * Always returns a valid object — never throws.
     * Returns _freeStatus() for guests or users with no active membership.
     *
     * @returns {Promise<object>} { isPremium, status, planSlug, planName, expiresAt,
     *                              daysLeft, isExpired, isExpiringSoon, features, membership, plan }
     */
    async getMembershipStatus() {
      const membership = await this.getCurrentMembership();
      const utils = _utils();

      if (!membership) {
        _log('getMembershipStatus', 'No membership — returning freeStatus');
        return _freeStatus();
      }

      const expiresAt = membership.expires_at;
      const isExpired      = utils ? utils.isExpired(expiresAt)          : false;
      const daysLeft       = utils ? utils.daysUntilExpiry(expiresAt)    : 0;
      const isExpiringSoon = utils ? utils.isExpiringSoon(expiresAt, 7)  : false;

      // If DB says 'active' but expiry has passed — treat as expired client-side
      // NOTE: this does NOT write to DB; it's a read-time resolution only
      const effectiveStatus = (membership.status === 'active' && isExpired)
        ? 'expired'
        : membership.status;

      const isPremium = effectiveStatus === 'active' && !isExpired;

      const result = Object.freeze({
        isPremium,
        status:         effectiveStatus,
        planSlug:       membership.plan?.slug     ?? null,
        planName:       membership.plan?.name     ?? 'Unknown Plan',
        expiresAt:      expiresAt                 ?? null,
        daysLeft:       isPremium ? daysLeft : 0,
        isExpired,
        isExpiringSoon: isPremium && isExpiringSoon,
        features:       membership.plan?.features ?? {},
        membership,
        plan:           membership.plan           ?? null,
      });

      _log('getMembershipStatus', 'Status resolved', {
        isPremium,
        status:    effectiveStatus,
        planSlug:  result.planSlug,
        daysLeft:  result.daysLeft,
      });

      return result;
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // isPremium()
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Returns true ONLY if the user has an active, non-expired membership.
     * Always returns false for guests or on any error.
     *
     * @returns {Promise<boolean>}
     */
    async isPremium() {
      const s = await this.getMembershipStatus();
      _log('isPremium', s.isPremium ? 'YES — active premium' : 'NO — not premium');
      return s.isPremium;
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // hasFeature()
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Check if the user's active plan includes a specific feature key.
     * Also checks membership_features.enabled as a global kill-switch.
     *
     * Steps:
     *  1. User must be premium (isPremium === true)
     *  2. Plan's features JSONB must have featureKey === true
     *  3. membership_features.enabled must be true for that key
     *
     * Returns false on any error or missing data.
     *
     * @param {string} featureKey - e.g. 'offline_downloads'
     * @returns {Promise<boolean>}
     */
    async hasFeature(featureKey) {
      if (!featureKey) return false;

      const s = await this.getMembershipStatus();
      if (!s.isPremium) {
        _log('hasFeature', 'Not premium — feature denied', featureKey);
        return false;
      }

      // Check plan features JSONB
      const planFeatures = s.features || {};
      if (planFeatures[featureKey] !== true) {
        _log('hasFeature', 'Feature not in plan', { featureKey, planFeatures });
        return false;
      }

      // Check global kill-switch from membership_features table
      const client = _sb();
      if (client && _tablesReady) {
        try {
          const { data, error } = await client
            .from('membership_features')
            .select('enabled')
            .eq('feature_key', featureKey)
            .maybeSingle();

          if (!error && data && data.enabled === false) {
            _log('hasFeature', 'Feature globally disabled', featureKey);
            return false;
          }
        } catch (e) {
          // Kill-switch check failed — fail-open (allow feature if plan has it)
          _warn('hasFeature', 'Kill-switch check failed — fail-open', e);
        }
      }

      _log('hasFeature', 'Feature granted', featureKey);
      return true;
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // getMembershipPlan()
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Fetch a plan by slug from membership_plans.
     * READ-ONLY. Returns null if not found or on error.
     *
     * @param {string} planSlug - e.g. 'monthly' | 'quarterly' | 'yearly'
     * @returns {Promise<object|null>}
     */
    async getMembershipPlan(planSlug) {
      if (!planSlug) return null;

      const client = _sb();
      if (!client) return null;
      if (!await _ensureTablesReady()) return null;

      try {
        const { data, error } = await client
          .from('membership_plans')
          .select('*')
          .eq('slug', planSlug)
          .eq('is_active', true)
          .maybeSingle();

        if (error) {
          _warn('getMembershipPlan', 'Query error', error.message);
          return null;
        }
        _log('getMembershipPlan', 'Plan fetched', data?.slug ?? null);
        return data || null;
      } catch (e) {
        _warn('getMembershipPlan', 'Unexpected error', e);
        return null;
      }
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // getMembershipExpiry()
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Get the expiry Date of the current active membership.
     * Returns null for guests / free users.
     *
     * @returns {Promise<Date|null>}
     */
    async getMembershipExpiry() {
      const m = await this.getCurrentMembership();
      if (!m?.expires_at) return null;
      const utils = _utils();
      return utils ? utils.parseDate(m.expires_at) : new Date(m.expires_at);
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // getRemainingDays()
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Get the number of whole days remaining in the current membership.
     * Returns 0 for guests, expired members, or on any error.
     *
     * @returns {Promise<number>}
     */
    async getRemainingDays() {
      const s = await this.getMembershipStatus();
      return s.daysLeft;
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // getAllPlans()
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Fetch all active plans ordered by sort_order.
     * READ-ONLY. Returns [] on error.
     *
     * @returns {Promise<object[]>}
     */
    async getAllPlans() {
      const client = _sb();
      if (!client) return [];
      if (!await _ensureTablesReady()) return [];

      try {
        const { data, error } = await client
          .from('membership_plans')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true });

        if (error) {
          _warn('getAllPlans', 'Query error', error.message);
          return [];
        }
        return data || [];
      } catch (e) {
        _warn('getAllPlans', 'Unexpected error', e);
        return [];
      }
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Cache management
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Manually invalidate the client-side membership cache.
     * Call after auth state changes or if stale data is suspected.
     */
    invalidateCache() {
      _log('invalidateCache', 'Cache cleared');
      _clearCache();
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Diagnostics (dev only)
    // ─────────────────────────────────────────────────────────────────────────────
    /**
     * Internal state dump for debugging. Never surface in production UI.
     * @returns {object}
     */
    _debug() {
      return {
        phase:        '4B',
        initialised:  _initialised,
        tablesReady:  _tablesReady,
        cacheValid:   _isCacheValid(),
        cacheExpiry:  _cacheExpiry,
        cachedStatus: _cache ? { id: _cache.id, status: _cache.status } : null,
      };
    },
  };

  // Expose globally
  root.StudyriaMembershipService = Object.freeze(Service);
  _log('module', 'Registered — Phase 4B');

}(typeof self !== 'undefined' ? self : this));
