/**
 * =============================================================================
 * FILE: js/membership/membership-resilience.js
 * PROJECT: Studyria Premium Membership — Phase 4D
 * PURPOSE: Production-hardening helpers: retry, timeout, circuit-breaker,
 *          error classification, and safe async wrappers for all Supabase calls.
 *          Zero side effects. Zero writes. Pure utility.
 * BRANCH:  feat/premium-membership-phase-4d
 * SAFE:    Utility/wrapper layer only.
 * =============================================================================
 *
 * USAGE:
 *   const R = window.StudyriaMembershipResilience;
 *
 *   // Wrap any async fn with retry + timeout:
 *   const data = await R.withRetry(() => supabaseCall(), { maxAttempts: 3 });
 *
 *   // Wrap with timeout only:
 *   const data = await R.withTimeout(() => supabaseCall(), 5000);
 *
 *   // Circuit-breaker (auto-opens after N failures):
 *   const cb = R.createCircuitBreaker('membership-fetch', { threshold: 3 });
 *   const data = await cb.call(() => supabaseCall());
 *
 * =============================================================================
 */

'use strict';

(function (root) {
  if (root.StudyriaMembershipResilience) return;

  // ── Constants ─────────────────────────────────────────────────────────────
  const DEFAULTS = Object.freeze({
    RETRY_MAX_ATTEMPTS:   3,
    RETRY_BASE_DELAY_MS:  300,   // ms before first retry
    RETRY_MAX_DELAY_MS:   5000,  // cap on exponential backoff
    RETRY_JITTER_MS:      100,   // random jitter to avoid thundering herd
    TIMEOUT_MS:           8000,  // default Supabase query timeout
    CB_THRESHOLD:         3,     // failures before circuit opens
    CB_HALF_OPEN_DELAY:   30000, // ms before circuit tries half-open
    CB_SUCCESS_THRESHOLD: 2,     // successes in half-open before closing
  });

  // ── Error classification ──────────────────────────────────────────────────
  const ErrorClass = Object.freeze({
    RETRYABLE:     'RETRYABLE',      // network glitch, 503, timeout
    NON_RETRYABLE: 'NON_RETRYABLE',  // 4xx, auth errors, invalid query
    TIMEOUT:       'TIMEOUT',
    CIRCUIT_OPEN:  'CIRCUIT_OPEN',
    UNKNOWN:       'UNKNOWN',
  });

  /**
   * Classify a caught error to decide whether to retry.
   * @param {Error|object} err
   * @returns {string} ErrorClass constant
   */
  function classifyError(err) {
    if (!err) return ErrorClass.UNKNOWN;

    // Explicit timeout
    if (err.name === 'AbortError' || err.code === 'TIMEOUT' || err.message?.includes('timeout')) {
      return ErrorClass.TIMEOUT;
    }

    // Supabase / PostgREST error codes
    const pgCode = err.code || err.hint || '';
    const status  = err.status || err.statusCode || 0;

    // 4xx → non-retryable (bad query, auth, not found)
    if (status >= 400 && status < 500) return ErrorClass.NON_RETRYABLE;

    // RLS / auth violations (PostgREST PGRST codes)
    if (String(pgCode).startsWith('PGRST3') || String(pgCode).startsWith('42')) {
      return ErrorClass.NON_RETRYABLE;
    }

    // 5xx / network → retryable
    if (status >= 500) return ErrorClass.RETRYABLE;

    // Network errors
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch') ||
        msg.includes('connection') || msg.includes('econnreset') || msg.includes('etimedout')) {
      return ErrorClass.RETRYABLE;
    }

    return ErrorClass.UNKNOWN;
  }

  // ── Delay helper with exponential backoff + jitter ────────────────────────
  function _backoffDelay(attempt, base, maxDelay, jitter) {
    const exp  = Math.min(base * Math.pow(2, attempt), maxDelay);
    const rand = Math.random() * jitter;
    return Math.floor(exp + rand);
  }

  function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Logging ───────────────────────────────────────────────────────────────
  function _log(fn, msg, data) {
    data !== undefined
      ? console.debug('[MembershipResilience:' + fn + ']', msg, data)
      : console.debug('[MembershipResilience:' + fn + ']', msg);
  }
  function _warn(fn, msg, err) {
    console.warn('[MembershipResilience:' + fn + ']', msg, err || '');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // withTimeout — wrap an async fn with an AbortController timeout
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run an async function with a timeout.
   * The fn receives an AbortSignal it can pass to fetch/supabase.
   *
   * @param {function}      fn        — async (signal?) => result
   * @param {number}        [timeoutMs]
   * @returns {Promise<*>}
   * @throws {Error} with code='TIMEOUT' if timed out
   */
  async function withTimeout(fn, timeoutMs) {
    const ms = typeof timeoutMs === 'number' && timeoutMs > 0
      ? timeoutMs
      : DEFAULTS.TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, ms);

    try {
      const result = await fn(controller.signal);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        const te = new Error('Membership query timed out after ' + ms + 'ms');
        te.code = 'TIMEOUT';
        te.originalError = err;
        throw te;
      }
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // withRetry — exponential-backoff retry with error classification
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run an async function with retry on retryable errors.
   *
   * @param {function} fn          — async () => result (no signal; wrap with withTimeout if needed)
   * @param {object}   [opts]
   * @param {number}   [opts.maxAttempts=3]
   * @param {number}   [opts.baseDelayMs=300]
   * @param {number}   [opts.maxDelayMs=5000]
   * @param {number}   [opts.jitterMs=100]
   * @param {string}   [opts.label='']     — for logging
   * @returns {Promise<*>}
   */
  async function withRetry(fn, opts) {
    const max      = opts?.maxAttempts  ?? DEFAULTS.RETRY_MAX_ATTEMPTS;
    const base     = opts?.baseDelayMs  ?? DEFAULTS.RETRY_BASE_DELAY_MS;
    const maxDelay = opts?.maxDelayMs   ?? DEFAULTS.RETRY_MAX_DELAY_MS;
    const jitter   = opts?.jitterMs     ?? DEFAULTS.RETRY_JITTER_MS;
    const label    = opts?.label        || 'call';

    let lastErr;
    for (let attempt = 0; attempt < max; attempt++) {
      try {
        if (attempt > 0) {
          const delay = _backoffDelay(attempt - 1, base, maxDelay, jitter);
          _log('withRetry', label + ' retry ' + attempt + '/' + (max - 1) + ' in ' + delay + 'ms');
          await _sleep(delay);
        }
        const result = await fn();
        if (attempt > 0) _log('withRetry', label + ' succeeded on attempt ' + (attempt + 1));
        return result;
      } catch (err) {
        lastErr = err;
        const cls = classifyError(err);
        _warn('withRetry', label + ' attempt ' + (attempt + 1) + ' failed [' + cls + ']', err?.message);

        if (cls === ErrorClass.NON_RETRYABLE || cls === ErrorClass.CIRCUIT_OPEN) {
          _log('withRetry', label + ' — non-retryable, aborting');
          throw err;
        }
        // RETRYABLE, TIMEOUT, UNKNOWN → continue loop
      }
    }

    _warn('withRetry', label + ' — all ' + max + ' attempts failed');
    throw lastErr;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // withSafe — swallow all errors, return fallback
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run an async function and return fallback on ANY error.
   * Use for non-critical reads (e.g. feature registry) where failure = graceful degrade.
   *
   * @param {function} fn
   * @param {*}        fallback
   * @param {string}   [label]
   * @returns {Promise<*>}
   */
  async function withSafe(fn, fallback, label) {
    try {
      return await fn();
    } catch (err) {
      _warn('withSafe', (label || 'call') + ' failed — returning fallback', err?.message);
      return fallback;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Circuit Breaker
  // ═══════════════════════════════════════════════════════════════════════════

  // Circuit breaker state
  const CB_STATE = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });

  /**
   * Create a named circuit breaker instance.
   * Each Supabase call family (membership, plans, features) should have its own CB.
   *
   * States:
   *   CLOSED    → normal operation, calls pass through
   *   OPEN      → all calls rejected immediately (fast-fail)
   *   HALF_OPEN → one probe call allowed; success → CLOSED, fail → OPEN again
   *
   * @param {string} name
   * @param {object} [opts]
   * @param {number} [opts.threshold=3]          — failures to open
   * @param {number} [opts.halfOpenDelay=30000]  — ms before half-open probe
   * @param {number} [opts.successThreshold=2]   — successes to close from half-open
   * @returns {CircuitBreaker}
   */
  function createCircuitBreaker(name, opts) {
    let state         = CB_STATE.CLOSED;
    let failureCount  = 0;
    let successCount  = 0;
    let openedAt      = null;

    const threshold        = opts?.threshold        ?? DEFAULTS.CB_THRESHOLD;
    const halfOpenDelay    = opts?.halfOpenDelay    ?? DEFAULTS.CB_HALF_OPEN_DELAY;
    const successThreshold = opts?.successThreshold ?? DEFAULTS.CB_SUCCESS_THRESHOLD;

    function _open() {
      state        = CB_STATE.OPEN;
      openedAt     = Date.now();
      failureCount = 0;
      successCount = 0;
      _warn('CircuitBreaker', name + ' OPENED — fast-failing for ' + (halfOpenDelay / 1000) + 's');
    }
    function _close() {
      state        = CB_STATE.CLOSED;
      failureCount = 0;
      successCount = 0;
      openedAt     = null;
      _log('CircuitBreaker', name + ' CLOSED — normal operation');
    }
    function _halfOpen() {
      state        = CB_STATE.HALF_OPEN;
      successCount = 0;
      _log('CircuitBreaker', name + ' HALF_OPEN — probing');
    }

    return Object.freeze({
      /**
       * Run fn through the circuit breaker.
       * @param {function} fn
       * @returns {Promise<*>}
       */
      async call(fn) {
        // Check if OPEN → maybe transition to HALF_OPEN
        if (state === CB_STATE.OPEN) {
          if (Date.now() - openedAt >= halfOpenDelay) {
            _halfOpen();
          } else {
            const err = new Error('[CB:' + name + '] Circuit OPEN — call rejected');
            err.code = 'CIRCUIT_OPEN';
            throw err;
          }
        }

        try {
          const result = await fn();
          // Success path
          if (state === CB_STATE.HALF_OPEN) {
            successCount++;
            if (successCount >= successThreshold) _close();
          } else {
            failureCount = 0; // reset on success in CLOSED
          }
          return result;
        } catch (err) {
          failureCount++;
          _warn('CircuitBreaker', name + ' failure ' + failureCount + '/' + threshold, err?.message);

          if (state === CB_STATE.HALF_OPEN || failureCount >= threshold) {
            _open();
          }
          throw err;
        }
      },

      get state()        { return state; },
      get failureCount() { return failureCount; },
      get isOpen()       { return state === CB_STATE.OPEN; },
      get isClosed()     { return state === CB_STATE.CLOSED; },
      reset() { _close(); },
      _debug() { return { name, state, failureCount, successCount, openedAt }; },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Deduplication — prevent concurrent identical requests
  // ═══════════════════════════════════════════════════════════════════════════

  const _inFlight = new Map();  // key → Promise

  /**
   * Deduplicate concurrent calls to the same resource.
   * If a call for `key` is already in-flight, returns the same Promise.
   * Automatically cleans up after the Promise resolves/rejects.
   *
   * @param {string}   key
   * @param {function} fn  — async () => result
   * @returns {Promise<*>}
   */
  function withDedup(key, fn) {
    if (_inFlight.has(key)) {
      _log('withDedup', 'Dedup hit for key', key);
      return _inFlight.get(key);
    }
    const promise = fn().finally(() => _inFlight.delete(key));
    _inFlight.set(key, promise);
    return promise;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Combined helper: safe + retry + timeout + dedup
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * All-in-one resilient wrapper for Supabase membership reads.
   * Order: dedup → timeout → retry (with classification) → safe fallback.
   *
   * @param {string}   key        — dedup key (e.g. 'membership:uid')
   * @param {function} fn         — async (signal?) => result
   * @param {*}        fallback   — returned on all-failure
   * @param {object}   [opts]
   * @param {number}   [opts.timeoutMs]
   * @param {number}   [opts.maxAttempts]
   * @returns {Promise<*>}
   */
  async function resilientFetch(key, fn, fallback, opts) {
    return withDedup(key, () =>
      withSafe(
        () => withRetry(
          () => withTimeout(fn, opts?.timeoutMs ?? DEFAULTS.TIMEOUT_MS),
          { maxAttempts: opts?.maxAttempts ?? DEFAULTS.RETRY_MAX_ATTEMPTS, label: key }
        ),
        fallback,
        key
      )
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────
  root.StudyriaMembershipResilience = Object.freeze({
    // Core wrappers
    withTimeout,
    withRetry,
    withSafe,
    withDedup,
    resilientFetch,
    // Circuit breaker factory
    createCircuitBreaker,
    // Error classification
    classifyError,
    // Constants
    ErrorClass,
    CB_STATE,
    DEFAULTS,
  });

  _log('module', 'Registered — Phase 4D');

}(typeof self !== 'undefined' ? self : this));
