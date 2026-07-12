/**
 * =============================================================================
 * FILE: js/membership/membership-status-resolver.js
 * PROJECT: Studyria Premium Membership — Phase 4C
 * PURPOSE: Pure status resolver — takes a raw membership row and resolves
 *          the canonical display state: Free | Active | Grace | Expired | Suspended
 *          Zero network calls. Zero side effects. Zero writes.
 * BRANCH:  feat/premium-membership-phase-4c
 * SAFE:    Pure functions only.
 * =============================================================================
 *
 * USAGE:
 *   const resolver = window.StudyriaMembershipStatusResolver;
 *   const resolved = resolver.resolve(membershipRow);
 *   // → { state: 'ACTIVE', isPremium: true, daysLeft: 23, ... }
 *
 * STATES (canonical):
 *   FREE       — no membership row / null
 *   ACTIVE     — status='active' + not expired
 *   GRACE      — status='active' + expired within grace window
 *   EXPIRED    — status='active'/'expired' + past grace window
 *   CANCELLED  — status='cancelled' (may still be active if expires_at > now)
 *   SUSPENDED  — status='suspended'
 *   PENDING    — status='pending' (payment initiated, not confirmed)
 *
 * =============================================================================
 */

'use strict';

(function (root) {
  if (root.StudyriaMembershipStatusResolver) return;

  // ── Dependency accessors ─────────────────────────────────────────────────
  const _utils = () => root.StudyriaMembershipUtils;
  const _cfg   = () => root.STUDYRIA_MEMBERSHIP;

  // ── Canonical state constants ─────────────────────────────────────────────
  const STATE = Object.freeze({
    FREE:      'FREE',
    ACTIVE:    'ACTIVE',
    GRACE:     'GRACE',
    EXPIRED:   'EXPIRED',
    CANCELLED: 'CANCELLED',
    SUSPENDED: 'SUSPENDED',
    PENDING:   'PENDING',
    UNKNOWN:   'UNKNOWN',
  });

  // ── Human labels ─────────────────────────────────────────────────────────
  const STATE_LABEL = Object.freeze({
    FREE:      'Free',
    ACTIVE:    'Premium Active',
    GRACE:     'Premium (Grace Period)',
    EXPIRED:   'Expired',
    CANCELLED: 'Cancelled',
    SUSPENDED: 'Suspended',
    PENDING:   'Pending Activation',
    UNKNOWN:   'Unknown',
  });

  // ── State colours (for future badge use — no UI change now) ──────────────
  const STATE_COLOR = Object.freeze({
    FREE:      '#6b7280',
    ACTIVE:    '#10d98e',
    GRACE:     '#fbbf24',
    EXPIRED:   '#ff8fa8',
    CANCELLED: '#94a3b8',
    SUSPENDED: '#f97316',
    PENDING:   '#60a5fa',
    UNKNOWN:   '#6b7280',
  });

  // ── isPremium state set ───────────────────────────────────────────────────
  // These states grant Premium access
  const PREMIUM_STATES = new Set([STATE.ACTIVE, STATE.GRACE]);

  // ── Core resolver ─────────────────────────────────────────────────────────

  /**
   * Resolve membership row → canonical ResolvedStatus object.
   * All logic is pure — reads no globals, makes no network calls.
   *
   * @param {object|null} row - user_memberships row (with plan joined)
   * @param {number}      [graceDays=3]
   * @returns {ResolvedStatus}
   */
  function resolve(row, graceDays) {
    const utils = _utils();
    const grace = typeof graceDays === 'number' ? graceDays : 3;

    // ── NULL → FREE ────────────────────────────────────────────────────────
    if (!row) return _buildResult(STATE.FREE, null, null, utils);

    const dbStatus  = row.status || 'unknown';
    const expiresAt = row.expires_at || null;

    // ── PENDING ────────────────────────────────────────────────────────────
    if (dbStatus === 'pending')   return _buildResult(STATE.PENDING,   expiresAt, row, utils);

    // ── SUSPENDED ─────────────────────────────────────────────────────────
    if (dbStatus === 'suspended') return _buildResult(STATE.SUSPENDED, expiresAt, row, utils);

    // ── CANCELLED — may still be active until expiry ──────────────────────
    if (dbStatus === 'cancelled') {
      // If cancelled but expires_at is in future → still active until expiry
      const stillActive = expiresAt && utils && !utils.isExpired(expiresAt);
      const state = stillActive ? STATE.ACTIVE : STATE.CANCELLED;
      return _buildResult(state, expiresAt, row, utils, { cancelledAt: row.cancelled_at });
    }

    // ── EXPIRED (DB-confirmed) ─────────────────────────────────────────────
    if (dbStatus === 'expired') return _buildResult(STATE.EXPIRED, expiresAt, row, utils);

    // ── ACTIVE — resolve sub-states based on expiry ───────────────────────
    if (dbStatus === 'active') {
      if (!expiresAt) {
        // No expiry = lifetime (treat as active)
        return _buildResult(STATE.ACTIVE, null, row, utils);
      }

      if (utils) {
        if (!utils.isExpired(expiresAt)) {
          // Not expired → ACTIVE
          return _buildResult(STATE.ACTIVE, expiresAt, row, utils);
        }
        if (utils.isInGracePeriod(expiresAt, grace)) {
          // Expired but within grace window → GRACE
          return _buildResult(STATE.GRACE, expiresAt, row, utils);
        }
        // Past grace → EXPIRED
        return _buildResult(STATE.EXPIRED, expiresAt, row, utils);
      }

      // utils not available — fallback: use raw Date comparison
      const isExp = Date.now() > new Date(expiresAt).getTime();
      return _buildResult(isExp ? STATE.EXPIRED : STATE.ACTIVE, expiresAt, row, utils);
    }

    // ── UNKNOWN ────────────────────────────────────────────────────────────
    return _buildResult(STATE.UNKNOWN, expiresAt, row, utils);
  }

  /**
   * Build the canonical ResolvedStatus result object.
   * @private
   */
  function _buildResult(state, expiresAt, row, utils, extra) {
    const isPremium     = PREMIUM_STATES.has(state);
    const daysLeft      = (utils && expiresAt) ? utils.daysUntilExpiry(expiresAt) : 0;
    const isExpiringSoon = isPremium && daysLeft > 0 && daysLeft <= 7;
    const expiryLabel   = utils ? utils.expiryLabel(expiresAt) : (expiresAt || 'N/A');

    return Object.freeze({
      // Canonical state
      state,
      stateLabel:    STATE_LABEL[state] || state,
      stateColor:    STATE_COLOR[state] || '#6b7280',

      // Premium access
      isPremium,

      // Expiry
      expiresAt:     expiresAt || null,
      daysLeft:      isPremium ? daysLeft : 0,
      isExpiringSoon,
      expiryLabel,

      // Plan info
      planSlug:      row?.plan?.slug  ?? null,
      planName:      row?.plan?.name  ?? (state === STATE.FREE ? 'Free' : 'Unknown'),
      planFeatures:  row?.plan?.features ?? {},
      planBadge:     row?.plan?.badge ?? null,

      // Raw row (null-safe)
      membershipId:  row?.id          ?? null,
      membershipRow: row              ?? null,

      // Extras (e.g. cancelledAt)
      ...(extra || {}),
    });
  }

  // ── Convenience helpers ───────────────────────────────────────────────────

  /**
   * Quick check — is this resolved status premium-granting?
   * @param {object} resolved - output of resolve()
   * @returns {boolean}
   */
  function isPremiumState(resolved) {
    return resolved?.isPremium === true;
  }

  /**
   * Quick check — is this state expired (past grace)?
   * @param {object} resolved
   * @returns {boolean}
   */
  function isExpiredState(resolved) {
    return resolved?.state === STATE.EXPIRED;
  }

  /**
   * Quick check — is this in grace period?
   * @param {object} resolved
   * @returns {boolean}
   */
  function isGraceState(resolved) {
    return resolved?.state === STATE.GRACE;
  }

  /**
   * Compare two resolved statuses — returns true if state has changed.
   * Used to decide whether to fire a state-change event.
   * @param {object} prev
   * @param {object} next
   * @returns {boolean}
   */
  function hasStateChanged(prev, next) {
    if (!prev && !next) return false;
    if (!prev || !next) return true;
    return prev.state !== next.state || prev.membershipId !== next.membershipId;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  root.StudyriaMembershipStatusResolver = Object.freeze({
    resolve,
    isPremiumState,
    isExpiredState,
    isGraceState,
    hasStateChanged,
    STATE,
    STATE_LABEL,
    STATE_COLOR,
    PREMIUM_STATES: Array.from(PREMIUM_STATES), // serialisable copy
  });

  console.debug('[MembershipStatusResolver] Registered — Phase 4C');

}(typeof self !== 'undefined' ? self : this));
