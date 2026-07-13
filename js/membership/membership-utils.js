/**
 * =============================================================================
 * FILE: js/membership/membership-utils.js
 * PROJECT: Studyria Premium Membership — Phase 4A (Foundation)
 * PURPOSE: Pure utility functions — date helpers, expiry helpers,
 *          status helpers, validation helpers.
 *          Zero UI code. Zero side effects. Zero Supabase calls.
 * STATUS: IMPLEMENTED — fully usable in Phase 4B+
 * SAFE: Does NOT modify any existing functionality.
 * =============================================================================
 *
 * USAGE:
 *   const utils = window.StudyriaMembershipUtils;
 *   utils.isExpired('2025-12-31T23:59:59Z');  // → true/false
 *   utils.daysUntilExpiry('2025-12-31T23:59:59Z');  // → number
 *
 * =============================================================================
 */

'use strict';

(function (root) {

  // Guard against double-initialisation
  if (root.StudyriaMembershipUtils) return;

  // ===========================================================================
  // DATE & EXPIRY HELPERS
  // ===========================================================================

  /**
   * Parse a date value safely to a Date object.
   * Handles ISO strings, timestamps (ms), Date objects, null/undefined.
   *
   * @param {string|number|Date|null|undefined} value
   * @returns {Date|null}
   */
  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Check if a membership expiry date is in the past.
   * Null/undefined expiry = treat as never expires (returns false).
   *
   * @param {string|Date|null} expiresAt
   * @returns {boolean}
   */
  function isExpired(expiresAt) {
    const d = parseDate(expiresAt);
    if (!d) return false; // null = no expiry = not expired
    return Date.now() > d.getTime();
  }

  /**
   * Check if a membership expiry is in the future (still valid).
   *
   * @param {string|Date|null} expiresAt
   * @returns {boolean}
   */
  function isActive(expiresAt) {
    const d = parseDate(expiresAt);
    if (!d) return true; // null = no expiry = always active
    return Date.now() <= d.getTime();
  }

  /**
   * Get the number of whole days remaining until expiry.
   * Returns 0 if expired or no expiry date.
   *
   * @param {string|Date|null} expiresAt
   * @returns {number} days remaining (≥ 0)
   */
  function daysUntilExpiry(expiresAt) {
    const d = parseDate(expiresAt);
    if (!d) return 0;
    const ms = d.getTime() - Date.now();
    if (ms <= 0) return 0;
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  }

  /**
   * Check if a membership is expiring soon (within `thresholdDays`).
   *
   * @param {string|Date|null} expiresAt
   * @param {number} [thresholdDays=7]
   * @returns {boolean}
   */
  function isExpiringSoon(expiresAt, thresholdDays) {
    const days = daysUntilExpiry(expiresAt);
    const threshold = typeof thresholdDays === 'number' ? thresholdDays : 7;
    return days > 0 && days <= threshold;
  }

  /**
   * Calculate the expiry date for a new membership given a plan's duration.
   *
   * @param {number} durationDays - plan.duration_days
   * @param {Date|string|null} [startFrom] - defaults to now
   * @returns {Date}
   */
  function calculateExpiry(durationDays, startFrom) {
    const start = parseDate(startFrom) || new Date();
    const expiry = new Date(start);
    expiry.setDate(expiry.getDate() + (durationDays || 0));
    return expiry;
  }

  /**
   * Get a human-friendly expiry label.
   * e.g. "Expires in 23 days" | "Expires tomorrow" | "Expired" | "Lifetime"
   *
   * @param {string|Date|null} expiresAt
   * @returns {string}
   */
  function expiryLabel(expiresAt) {
    if (!expiresAt) return 'Lifetime';
    const days = daysUntilExpiry(expiresAt);
    if (days === 0) return 'Expired';
    if (days === 1) return 'Expires tomorrow';
    if (days <= 7)  return 'Expires in ' + days + ' days';
    if (days <= 30) return 'Expires in ' + days + ' days';
    const months = Math.floor(days / 30);
    if (months === 1) return 'Expires in 1 month';
    if (months < 12) return 'Expires in ' + months + ' months';
    return 'Expires in ' + Math.floor(months / 12) + ' year(s)';
  }

  /**
   * Format a date for display in Indian locale.
   * e.g. "12 Jul 2026"
   *
   * @param {string|Date|null} value
   * @returns {string}
   */
  function formatDate(value) {
    const d = parseDate(value);
    if (!d) return '—';
    return d.toLocaleDateString('en-IN', {
      day:   'numeric',
      month: 'short',
      year:  'numeric',
    });
  }

  // ===========================================================================
  // STATUS HELPERS
  // ===========================================================================

  /**
   * Resolve the effective display status of a membership row.
   * Handles the case where DB status is 'active' but expires_at is past.
   *
   * @param {object|null} membershipRow - row from user_memberships
   * @returns {string} canonical status string
   */
  function resolveStatus(membershipRow) {
    const cfg = root.STUDYRIA_MEMBERSHIP;
    const STATUS = cfg ? cfg.STATUS : {
      NONE: 'none', ACTIVE: 'active', EXPIRED: 'expired',
      CANCELLED: 'cancelled', PENDING: 'pending', SUSPENDED: 'suspended',
    };

    if (!membershipRow) return STATUS.NONE;

    const dbStatus = membershipRow.status;

    // If DB says active but expiry has passed, treat as expired client-side
    if (dbStatus === STATUS.ACTIVE && isExpired(membershipRow.expires_at)) {
      return STATUS.EXPIRED;
    }

    return dbStatus || STATUS.NONE;
  }

  /**
   * Returns a human-readable label for a membership status code.
   *
   * @param {string} status
   * @returns {string}
   */
  function statusLabel(status) {
    const labels = {
      active:     'Active',
      expired:    'Expired',
      cancelled:  'Cancelled',
      pending:    'Pending',
      suspended:  'Suspended',
      none:       'No Membership',
      loading:    'Loading...',
      error:      'Error',
    };
    return labels[status] || status;
  }

  /**
   * Returns a CSS color/token for a given status (for UI badges).
   *
   * @param {string} status
   * @returns {string} hex or CSS var
   */
  function statusColor(status) {
    const colors = {
      active:     '#10d98e',
      expired:    '#ff8fa8',
      cancelled:  '#94a3b8',
      pending:    '#fbbf24',
      suspended:  '#f97316',
      none:       '#6b7280',
    };
    return colors[status] || '#6b7280';
  }

  // ===========================================================================
  // PRICE / CURRENCY HELPERS
  // ===========================================================================

  /**
   * Convert paise (smallest INR unit) to formatted rupee string.
   * e.g. 9900 → '₹99' | 24900 → '₹249'
   *
   * @param {number} paise
   * @param {string} [currency='INR']
   * @returns {string}
   */
  function formatPrice(paise, currency) {
    const amount = (paise || 0) / 100;
    const cur = currency || 'INR';
    if (cur === 'INR') {
      return '₹' + amount.toLocaleString('en-IN', {
        minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      });
    }
    return amount.toString();
  }

  /**
   * Calculate savings percentage between two prices.
   * e.g. original=9900*12 (yearly if monthly), discounted=79900
   *
   * @param {number} originalPaise
   * @param {number} discountedPaise
   * @returns {number} integer percentage saved (0–100)
   */
  function savingsPercent(originalPaise, discountedPaise) {
    if (!originalPaise || originalPaise <= 0) return 0;
    const pct = ((originalPaise - discountedPaise) / originalPaise) * 100;
    return Math.max(0, Math.round(pct));
  }

  // ===========================================================================
  // VALIDATION HELPERS
  // ===========================================================================

  /**
   * Validate a plan slug against known values.
   *
   * @param {string} slug
   * @returns {boolean}
   */
  function isValidPlanSlug(slug) {
    const cfg = root.STUDYRIA_MEMBERSHIP;
    if (cfg) {
      return Object.values(cfg.PLANS).includes(slug);
    }
    return ['monthly', 'quarterly', 'yearly', 'lifetime', 'trial'].includes(slug);
  }

  /**
   * Validate a membership status string.
   *
   * @param {string} status
   * @returns {boolean}
   */
  function isValidStatus(status) {
    return ['active','expired','cancelled','pending','suspended'].includes(status);
  }

  /**
   * Validate a feature key string.
   *
   * @param {string} featureKey
   * @returns {boolean}
   */
  function isValidFeatureKey(featureKey) {
    const cfg = root.STUDYRIA_MEMBERSHIP;
    if (cfg) {
      return Object.values(cfg.FEATURES).includes(featureKey);
    }
    return typeof featureKey === 'string' && featureKey.length > 0;
  }

  /**
   * Validate a price in paise.
   *
   * @param {number} paise
   * @returns {boolean}
   */
  function isValidPrice(paise) {
    return typeof paise === 'number' && paise >= 0 && Number.isFinite(paise);
  }

  // ===========================================================================
  // GRACE PERIOD
  // ===========================================================================

  /**
   * Check if a membership is within the grace period after expiry.
   * During grace period, Premium is still effectively accessible.
   *
   * @param {string|Date|null} expiresAt
   * @param {number} [graceDays=3]
   * @returns {boolean}
   */
  function isInGracePeriod(expiresAt, graceDays) {
    const d = parseDate(expiresAt);
    if (!d) return false;
    const grace = typeof graceDays === 'number' ? graceDays : 3;
    const now = Date.now();
    const graceEnd = d.getTime() + (grace * 24 * 60 * 60 * 1000);
    return now > d.getTime() && now <= graceEnd;
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================
  root.StudyriaMembershipUtils = Object.freeze({
    // Date & expiry
    parseDate,
    isExpired,
    isActive,
    daysUntilExpiry,
    isExpiringSoon,
    calculateExpiry,
    expiryLabel,
    formatDate,
    // Status
    resolveStatus,
    statusLabel,
    statusColor,
    // Price
    formatPrice,
    savingsPercent,
    // Validation
    isValidPlanSlug,
    isValidStatus,
    isValidFeatureKey,
    isValidPrice,
    // Grace period
    isInGracePeriod,
  });

}(typeof self !== 'undefined' ? self : this));
