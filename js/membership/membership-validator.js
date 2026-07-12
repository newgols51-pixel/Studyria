/**
 * =============================================================================
 * FILE: js/membership/membership-validator.js
 * PROJECT: Studyria Premium Membership — Phase 4C
 * PURPOSE: Validate membership rows, plan objects, transaction data,
 *          feature keys, and user inputs before any operation.
 *          Zero network calls. Zero side effects. Zero writes.
 * BRANCH:  feat/premium-membership-phase-4c
 * SAFE:    Pure validation only.
 * =============================================================================
 *
 * USAGE:
 *   const v = window.StudyriaMembershipValidator;
 *   v.validatePlan(planRow);        // → ValidationResult
 *   v.validateMembership(row);      // → ValidationResult
 *   v.validateFeatureKey('ad_free');// → ValidationResult
 *
 * ValidationResult: { valid: boolean, errors: string[], warnings: string[] }
 *
 * =============================================================================
 */

'use strict';

(function (root) {
  if (root.StudyriaMembershipValidator) return;

  // ── Dependency accessors ─────────────────────────────────────────────────
  const _cfg   = () => root.STUDYRIA_MEMBERSHIP;
  const _utils = () => root.StudyriaMembershipUtils;

  // ── Constants ─────────────────────────────────────────────────────────────
  const VALID_STATUSES      = ['active', 'expired', 'cancelled', 'pending', 'suspended'];
  const VALID_CURRENCIES    = ['INR', 'USD', 'EUR'];
  const MIN_PRICE_PAISE     = 0;
  const MAX_PRICE_PAISE     = 100000 * 100;  // ₹1,00,000 upper bound
  const MAX_DURATION_DAYS   = 36500;          // 100 years (lifetime)
  const UUID_REGEX          = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SLUG_REGEX          = /^[a-z0-9_-]{2,32}$/;

  // ── Result builder ────────────────────────────────────────────────────────
  function _result(errors, warnings) {
    return Object.freeze({
      valid:    errors.length === 0,
      errors:   Object.freeze([...errors]),
      warnings: Object.freeze([...warnings || []]),
    });
  }

  function _isUUID(val) {
    return typeof val === 'string' && UUID_REGEX.test(val);
  }

  function _isISO(val) {
    if (!val) return false;
    const d = new Date(val);
    return !isNaN(d.getTime());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATORS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validate a membership_plans row.
   * @param {object} plan
   * @returns {ValidationResult}
   */
  function validatePlan(plan) {
    const err = []; const warn = [];
    if (!plan || typeof plan !== 'object') { return _result(['plan must be a non-null object']); }
    if (!_isUUID(plan.id))           err.push('plan.id must be a valid UUID');
    if (!plan.slug || !SLUG_REGEX.test(plan.slug)) err.push('plan.slug invalid (2-32 chars, a-z0-9_-)');
    if (!plan.name || typeof plan.name !== 'string') err.push('plan.name must be a non-empty string');
    if (typeof plan.duration_days !== 'number' || plan.duration_days <= 0 || plan.duration_days > MAX_DURATION_DAYS)
      err.push('plan.duration_days must be 1–' + MAX_DURATION_DAYS);
    if (typeof plan.price !== 'number' || plan.price < MIN_PRICE_PAISE || plan.price > MAX_PRICE_PAISE)
      err.push('plan.price must be 0–' + MAX_PRICE_PAISE + ' paise');
    if (!VALID_CURRENCIES.includes(plan.currency)) err.push('plan.currency must be one of ' + VALID_CURRENCIES.join(', '));
    if (plan.features === null || typeof plan.features !== 'object') err.push('plan.features must be an object');
    if (typeof plan.active !== 'boolean') warn.push('plan.active missing — assuming true');
    if (typeof plan.sort_order !== 'number') warn.push('plan.sort_order missing — display order undefined');
    return _result(err, warn);
  }

  /**
   * Validate a user_memberships row.
   * @param {object} membership
   * @returns {ValidationResult}
   */
  function validateMembership(membership) {
    const err = []; const warn = [];
    if (!membership || typeof membership !== 'object') { return _result(['membership must be a non-null object']); }
    if (!_isUUID(membership.id))       err.push('membership.id must be a valid UUID');
    if (!_isUUID(membership.user_id))  err.push('membership.user_id must be a valid UUID');
    if (!_isUUID(membership.plan_id))  err.push('membership.plan_id must be a valid UUID');
    if (!VALID_STATUSES.includes(membership.status))
      err.push('membership.status must be one of: ' + VALID_STATUSES.join(', '));

    const utils = _utils();
    // started_at
    if (membership.started_at && !_isISO(membership.started_at))
      err.push('membership.started_at must be an ISO datetime string');
    // expires_at
    if (membership.expires_at) {
      if (!_isISO(membership.expires_at)) {
        err.push('membership.expires_at must be an ISO datetime string');
      } else if (membership.started_at && _isISO(membership.started_at)) {
        const start = new Date(membership.started_at);
        const exp   = new Date(membership.expires_at);
        if (exp <= start) err.push('membership.expires_at must be after started_at');
      }
      // Warn if active membership is already expired
      if (membership.status === 'active' && utils && utils.isExpired(membership.expires_at)) {
        warn.push('membership status is active but expires_at is in the past — resolve status needed');
      }
    }
    // cancelled_at
    if (membership.cancelled_at && !_isISO(membership.cancelled_at))
      err.push('membership.cancelled_at must be an ISO datetime string');
    // Plan join
    if (membership.plan !== undefined && membership.plan !== null) {
      const pr = validatePlan(membership.plan);
      if (!pr.valid) warn.push('embedded plan has issues: ' + pr.errors.join('; '));
    }
    return _result(err, warn);
  }

  /**
   * Validate a feature key string.
   * @param {string} featureKey
   * @returns {ValidationResult}
   */
  function validateFeatureKey(featureKey) {
    const err = [];
    if (!featureKey || typeof featureKey !== 'string') {
      return _result(['featureKey must be a non-empty string']);
    }
    const utils = _utils();
    if (utils && !utils.isValidFeatureKey(featureKey)) {
      err.push('featureKey "' + featureKey + '" is not a recognised membership feature key');
    }
    return _result(err);
  }

  /**
   * Validate a plan slug string.
   * @param {string} slug
   * @returns {ValidationResult}
   */
  function validatePlanSlug(slug) {
    const err = [];
    if (!slug || typeof slug !== 'string') return _result(['slug must be a non-empty string']);
    if (!SLUG_REGEX.test(slug)) err.push('slug must match /^[a-z0-9_-]{2,32}$/');
    const utils = _utils();
    if (utils && !utils.isValidPlanSlug(slug)) {
      err.push('"' + slug + '" is not a recognised plan slug');
    }
    return _result(err);
  }

  /**
   * Validate a membership_transactions row.
   * @param {object} tx
   * @returns {ValidationResult}
   */
  function validateTransaction(tx) {
    const err = []; const warn = [];
    if (!tx || typeof tx !== 'object') return _result(['transaction must be a non-null object']);
    if (!_isUUID(tx.id))       err.push('tx.id must be a valid UUID');
    if (!_isUUID(tx.user_id))  err.push('tx.user_id must be a valid UUID');
    if (!tx.payment_provider || typeof tx.payment_provider !== 'string')
      err.push('tx.payment_provider is required');
    if (typeof tx.amount !== 'number' || tx.amount < 0)
      err.push('tx.amount must be >= 0 paise');
    if (typeof tx.amount === 'number' && tx.amount > MAX_PRICE_PAISE)
      warn.push('tx.amount exceeds ₹1,00,000 — unusually large');
    if (!['INR','USD','EUR'].includes(tx.currency))
      err.push('tx.currency must be INR/USD/EUR');
    if (!['pending','success','failed','refunded'].includes(tx.status))
      err.push('tx.status must be pending|success|failed|refunded');
    if (!_isISO(tx.created_at)) warn.push('tx.created_at missing or invalid');
    return _result(err, warn);
  }

  /**
   * Validate a membership_logs event row (used by audit helper).
   * @param {object} logEntry
   * @returns {ValidationResult}
   */
  function validateLogEntry(logEntry) {
    const err = []; const warn = [];
    if (!logEntry || typeof logEntry !== 'object') return _result(['logEntry must be a non-null object']);
    if (!_isUUID(logEntry.membership_id)) err.push('logEntry.membership_id must be a valid UUID');
    const cfg = _cfg();
    const validEvents = cfg
      ? Object.values(cfg.EVENTS)
      : ['activated','expired','cancelled','suspended','renewed','restored',
         'admin_override','payment_received','refund_issued'];
    if (!validEvents.includes(logEntry.event))
      err.push('logEntry.event "' + logEntry.event + '" not in allowed list');
    if (logEntry.metadata !== undefined && typeof logEntry.metadata !== 'object')
      warn.push('logEntry.metadata should be an object');
    return _result(err, warn);
  }

  /**
   * Batch-validate an array of plans (e.g. from getAllPlans()).
   * Returns { valid: boolean, results: ValidationResult[] }
   * @param {object[]} plans
   * @returns {{ valid: boolean, results: object[] }}
   */
  function validatePlanList(plans) {
    if (!Array.isArray(plans)) return { valid: false, results: [_result(['plans must be an array'])] };
    const results = plans.map(validatePlan);
    const valid   = results.every(r => r.valid);
    return { valid, results };
  }

  // ── Public API ────────────────────────────────────────────────────────────
  root.StudyriaMembershipValidator = Object.freeze({
    validatePlan,
    validateMembership,
    validateFeatureKey,
    validatePlanSlug,
    validateTransaction,
    validateLogEntry,
    validatePlanList,
    // Expose constraint constants (read-only)
    VALID_STATUSES,
    VALID_CURRENCIES,
    MAX_DURATION_DAYS,
    MAX_PRICE_PAISE,
  });

  console.debug('[MembershipValidator] Registered — Phase 4C');

}(typeof self !== 'undefined' ? self : this));
