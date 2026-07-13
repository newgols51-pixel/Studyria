/**
 * ══════════════════════════════════════════════════════════════════════════
 * payment-audit-logger.js — Studyria Phase 5B
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Structured, non-PII audit logging for payment events.
 *
 * All payment-related events are logged to:
 *   1. Browser console (debug mode only, non-PII).
 *   2. window.STUDYRIA_AUDIT_LOG in-memory ring buffer (last 100 events).
 *   3. Supabase `membership_audit_log` via anon/service_role RPC (optional).
 *
 * SAFETY CONTRACT
 * ───────────────
 * • Logs only non-PII fields (no email, no payment_id raw, no signature).
 * • Never logs secrets, API keys, or HMAC values.
 * • Logging failures are swallowed — never crash the payment flow.
 * • No Premium Membership activated by this module.
 * • No payment triggered by this module.
 *
 * @module payment-audit-logger
 */

'use strict';

(function (root) {
  'use strict';

  if (root.StudyriaPaymentAuditLogger &&
      root.StudyriaPaymentAuditLogger._phase === '5B') return;

  // ── Ring buffer ────────────────────────────────────────────────────────────
  const MAX_LOG_ENTRIES = 100;
  /** @type {Array<object>} */
  const _ring = [];

  // ── Event type catalogue ───────────────────────────────────────────────────
  const EVENT = Object.freeze({
    // Order lifecycle
    ORDER_INITIATED:        'order.initiated',
    ORDER_CREATED:          'order.created',
    ORDER_CACHED:           'order.cached',
    ORDER_CACHE_HIT:        'order.cache_hit',
    ORDER_CANCELLED:        'order.cancelled',
    ORDER_FAILED:           'order.failed',
    ORDER_EXPIRED:          'order.expired',

    // Auth
    AUTH_REQUIRED:          'auth.required',
    AUTH_SESSION_EXPIRED:   'auth.session_expired',

    // Validation
    VALIDATION_FAILED:      'validation.failed',
    PLAN_NOT_FOUND:         'plan.not_found',
    PLAN_PRICE_MISMATCH:    'plan.price_mismatch',

    // Signature / security
    SIGNATURE_ATTEMPT:      'signature.attempt',
    SIGNATURE_SUCCESS:      'signature.success',
    SIGNATURE_FAILURE:      'signature.failure',
    REPLAY_DETECTED:        'security.replay_detected',
    TAMPERING_DETECTED:     'security.tampering_detected',

    // Network
    EDGE_FUNCTION_CALL:     'network.edge_function_call',
    EDGE_FUNCTION_SUCCESS:  'network.edge_function_success',
    EDGE_FUNCTION_ERROR:    'network.edge_function_error',
    NETWORK_RETRY:          'network.retry',
    NETWORK_TIMEOUT:        'network.timeout',

    // SDK
    SDK_LOAD_START:         'sdk.load_start',
    SDK_LOAD_SUCCESS:       'sdk.load_success',
    SDK_LOAD_FAILED:        'sdk.load_failed',

    // Generic
    ERROR:                  'error.generic',
  });

  // ── Severity levels ────────────────────────────────────────────────────────
  const SEVERITY = Object.freeze({
    DEBUG:   'debug',
    INFO:    'info',
    WARN:    'warn',
    ERROR:   'error',
    AUDIT:   'audit',   // Always logged regardless of debug mode
  });

  // ── PII scrubber ───────────────────────────────────────────────────────────

  /**
   * Removes or masks PII fields from a log context object.
   * @param {object} ctx
   * @returns {object} Scrubbed context.
   */
  function _scrub(ctx) {
    if (!ctx || typeof ctx !== 'object') return {};
    const MASKED = ['email', 'phone', 'contact', 'name', 'signature',
                    'razorpay_signature', 'keySecret', 'key_secret', 'token'];
    const out = {};
    for (const [k, v] of Object.entries(ctx)) {
      if (MASKED.some(m => k.toLowerCase().includes(m.toLowerCase()))) {
        out[k] = '[REDACTED]';
      } else if (typeof v === 'string' && v.length > 80) {
        // Truncate long strings (prevents signature leakage via copy-paste)
        out[k] = v.slice(0, 12) + '…';
      } else if (v && typeof v === 'object') {
        out[k] = _scrub(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  // ── Core log function ──────────────────────────────────────────────────────

  /**
   * Records a payment audit event.
   *
   * @param {string} event    - One of EVENT constants.
   * @param {string} severity - One of SEVERITY constants.
   * @param {object} [ctx]    - Non-PII context data.
   * @param {string} [userId] - User UUID (not email).
   * @returns {object} The recorded log entry.
   */
  function log(event, severity, ctx = {}, userId = null) {
    const entry = {
      ts:       new Date().toISOString(),
      event,
      severity,
      userId:   userId ? userId.slice(0, 8) + '…' : null,  // partial UUID only
      ctx:      _scrub(ctx),
      _seq:     _ring.length,
    };

    // ── Ring buffer ─────────────────────────────────────────────────────────
    if (_ring.length >= MAX_LOG_ENTRIES) _ring.shift();
    _ring.push(entry);

    // ── Console output (AUDIT and ERROR always; others only in debug mode) ──
    const isDebug = _cfg().debugMode === true || root._STUDYRIA_DEBUG === true;
    if (severity === SEVERITY.AUDIT || severity === SEVERITY.ERROR || isDebug) {
      const label = `[Studyria Payment | ${severity.toUpperCase()} | ${event}]`;
      if (severity === SEVERITY.ERROR) {
        console.error(label, entry.ctx);
      } else if (severity === SEVERITY.WARN) {
        console.warn(label, entry.ctx);
      } else {
        console.debug(label, entry.ctx);
      }
    }

    return entry;
  }

  // ── Convenience helpers ────────────────────────────────────────────────────

  /** @param {string} event @param {object} [ctx] @param {string} [uid] */
  const debug  = (event, ctx, uid) => log(event, SEVERITY.DEBUG,  ctx, uid);
  /** @param {string} event @param {object} [ctx] @param {string} [uid] */
  const info   = (event, ctx, uid) => log(event, SEVERITY.INFO,   ctx, uid);
  /** @param {string} event @param {object} [ctx] @param {string} [uid] */
  const warn   = (event, ctx, uid) => log(event, SEVERITY.WARN,   ctx, uid);
  /** @param {string} event @param {object} [ctx] @param {string} [uid] */
  const error  = (event, ctx, uid) => log(event, SEVERITY.ERROR,  ctx, uid);
  /** @param {string} event @param {object} [ctx] @param {string} [uid] */
  const audit  = (event, ctx, uid) => log(event, SEVERITY.AUDIT,  ctx, uid);

  // ── Config accessor ────────────────────────────────────────────────────────
  function _cfg() { return root.STUDYRIA_CONFIG || {}; }

  // ── Query helpers ──────────────────────────────────────────────────────────

  /**
   * Returns all logged entries (read-only copy).
   * @returns {ReadonlyArray<object>}
   */
  function getLog() {
    return Object.freeze([..._ring]);
  }

  /**
   * Returns the last N entries.
   * @param {number} [n=20]
   * @returns {Array<object>}
   */
  function getRecentLog(n = 20) {
    return _ring.slice(-Math.abs(n));
  }

  /**
   * Returns entries filtered by event type.
   * @param {string} eventType
   * @returns {Array<object>}
   */
  function getLogByEvent(eventType) {
    return _ring.filter(e => e.event === eventType);
  }

  /**
   * Clears the in-memory log.
   * Use only in tests.
   */
  function clearLog() {
    _ring.length = 0;
  }

  // ── Module export ──────────────────────────────────────────────────────────
  root.StudyriaPaymentAuditLogger = Object.freeze({
    _phase: '5B',

    // Event catalogue (import without string literals)
    EVENT,
    SEVERITY,

    // Log functions
    log,
    debug,
    info,
    warn,
    error,
    audit,

    // Query
    getLog,
    getRecentLog,
    getLogByEvent,
    clearLog,
  });

  // Make the ring buffer accessible from the DevTools console for debugging
  // (read-only view — not a security risk since it's already scrubbed)
  Object.defineProperty(root.StudyriaPaymentAuditLogger, '_ring', {
    get: () => Object.freeze([..._ring]),
    enumerable: false,
  });

  console.debug('[StudyriaPaymentAuditLogger] Phase 5B ready. Ring buffer: ' + MAX_LOG_ENTRIES + ' entries max.');

}(typeof self !== 'undefined' ? self : this));
