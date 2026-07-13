/**
 * =============================================================================
 * FILE: js/membership/membership-health.js
 * PROJECT: Studyria Premium Membership — Phase 4D
 * PURPOSE: Backend health checks and readiness probes for the membership
 *          system. Verifies Supabase connectivity, table accessibility,
 *          auth session validity, and engine module readiness.
 *          Read-only. Zero writes. Zero UI changes.
 * BRANCH:  feat/premium-membership-phase-4d
 * SAFE:    Read-only probes only. No mutations.
 * =============================================================================
 *
 * USAGE:
 *   const health = window.StudyriaMembershipHealth;
 *   const report = await health.runAll();
 *   // report.overall: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY'
 *   // report.checks[]: individual check results
 *
 *   // Quick ready check:
 *   const ready = await health.isReady();  // → boolean
 *
 * =============================================================================
 */

'use strict';

(function (root) {
  if (root.StudyriaMembershipHealth) return;

  // ── Constants ─────────────────────────────────────────────────────────────
  const STATUS = Object.freeze({
    PASS:      'PASS',
    WARN:      'WARN',
    FAIL:      'FAIL',
    SKIP:      'SKIP',     // skipped (e.g. user not logged in)
    UNKNOWN:   'UNKNOWN',
  });

  const OVERALL = Object.freeze({
    HEALTHY:   'HEALTHY',    // all PASS or SKIP
    DEGRADED:  'DEGRADED',   // some WARN
    UNHEALTHY: 'UNHEALTHY',  // any FAIL
  });

  const PROBE_TIMEOUT_MS = 5000;  // 5s per probe

  // ── Dependency accessors ─────────────────────────────────────────────────
  const _sb         = () => root.supabaseClient;
  const _engine     = () => root.StudyriaMembershipEngine;
  const _service    = () => root.StudyriaMembershipService;
  const _cache      = () => root.StudyriaMembershipCache;
  const _resilience = () => root.StudyriaMembershipResilience;
  const _security   = () => root.StudyriaMembershipSecurity;

  // ── Logging ───────────────────────────────────────────────────────────────
  function _log(fn, msg, data) {
    data !== undefined
      ? console.debug('[MembershipHealth:' + fn + ']', msg, data)
      : console.debug('[MembershipHealth:' + fn + ']', msg);
  }

  // ── Result builder ────────────────────────────────────────────────────────
  function _check(name, status, message, detail) {
    return Object.freeze({
      name, status, message,
      detail:    detail || null,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Safe probe wrapper ────────────────────────────────────────────────────
  async function _probe(fn, timeoutMs) {
    const ms = timeoutMs || PROBE_TIMEOUT_MS;
    
    // Create AbortController if available in environment (null safety / backward compatibility)
    let controller = null;
    let signal = null;
    if (typeof AbortController !== 'undefined') {
      try {
        controller = new AbortController();
        signal = controller.signal;
      } catch (e) {
        _log('_probe', 'Failed to initialize AbortController', e);
      }
    }

    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        if (controller) {
          try {
            controller.abort();
          } catch (e) {
            _log('_probe', 'Failed to call abort() on controller', e);
          }
        }
        reject(new Error('probe_timeout'));
      }, ms);
    });

    try {
      const result = await Promise.race([
        fn(signal),
        timeoutPromise
      ]);
      return result;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INDIVIDUAL CHECKS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * CHECK 1: Supabase client available.
   */
  async function checkSupabaseClient() {
    const client = _sb();
    if (!client) {
      return _check('supabase_client', STATUS.FAIL, 'supabaseClient not initialised — check supabase.js load order');
    }
    if (typeof client.from !== 'function') {
      return _check('supabase_client', STATUS.FAIL, 'supabaseClient missing .from() — unexpected client shape');
    }
    return _check('supabase_client', STATUS.PASS, 'Supabase client ready');
  }

  /**
   * CHECK 2: membership_plans table reachable (lightweight SELECT 1 row).
   */
  async function checkPlansTable() {
    const client = _sb();
    if (!client) return _check('plans_table', STATUS.SKIP, 'Skipped — no Supabase client');
    try {
      const { data, error } = await _probe(async (signal) => {
        let query = client.from('membership_plans').select('id, slug, active').limit(1);
        if (signal && typeof query.abortSignal === 'function') {
          query = query.abortSignal(signal);
        }
        return query;
      });
      if (error) {
        return _check('plans_table', STATUS.FAIL,
          'membership_plans query error: ' + error.message, { code: error.code });
      }
      const count = data?.length ?? 0;
      return _check('plans_table', STATUS.PASS,
        'membership_plans accessible (' + count + ' row(s) visible)', { rowCount: count });
    } catch (e) {
      return _check('plans_table', STATUS.FAIL, 'membership_plans probe failed: ' + e.message);
    }
  }

  /**
   * CHECK 3: user_memberships table reachable (RLS-scoped SELECT).
   */
  async function checkMembershipsTable() {
    const client = _sb();
    if (!client) return _check('memberships_table', STATUS.SKIP, 'Skipped — no Supabase client');
    if (!root.currentUser?.uid) {
      return _check('memberships_table', STATUS.SKIP, 'Skipped — user not logged in (RLS would block anyway)');
    }
    try {
      const { error } = await _probe(async (signal) => {
        let query = client.from('user_memberships').select('id').limit(1);
        if (signal && typeof query.abortSignal === 'function') {
          query = query.abortSignal(signal);
        }
        return query;
      });
      if (error) {
        return _check('memberships_table', STATUS.FAIL,
          'user_memberships query error: ' + error.message, { code: error.code });
      }
      return _check('memberships_table', STATUS.PASS, 'user_memberships accessible (RLS active)');
    } catch (e) {
      return _check('memberships_table', STATUS.FAIL, 'user_memberships probe failed: ' + e.message);
    }
  }

  /**
   * CHECK 4: membership_features table reachable.
   */
  async function checkFeaturesTable() {
    const client = _sb();
    if (!client) return _check('features_table', STATUS.SKIP, 'Skipped — no Supabase client');
    try {
      const { data, error } = await _probe(async (signal) => {
        let query = client.from('membership_features').select('feature_key, enabled').limit(5);
        if (signal && typeof query.abortSignal === 'function') {
          query = query.abortSignal(signal);
        }
        return query;
      });
      if (error) {
        // Non-fatal — feature kill-switch table may not exist yet in this environment
        return _check('features_table', STATUS.WARN,
          'membership_features query failed (table may not exist yet): ' + error.message);
      }
      const count = data?.length ?? 0;
      return _check('features_table', STATUS.PASS,
        'membership_features accessible (' + count + ' feature(s))', { featureCount: count });
    } catch (e) {
      return _check('features_table', STATUS.WARN, 'membership_features probe timeout/error: ' + e.message);
    }
  }

  /**
   * CHECK 5: Supabase Auth session validity (async getSession call).
   */
  async function checkSessionValidity() {
    const client = _sb();
    if (!client) return _check('auth_session', STATUS.SKIP, 'Skipped — no Supabase client');
    if (!root.currentUser?.uid) {
      return _check('auth_session', STATUS.SKIP, 'Skipped — guest user (no session expected)');
    }
    try {
      const { data, error } = await _probe(async (signal) => {
        // Note: Supabase auth.getSession() reads synchronously from storage / memory in most cases
        // and its asynchronous interface does not support/need abortSignal as there is no network
        // query builder chain to abort.
        return client.auth.getSession();
      });
      if (error) {
        return _check('auth_session', STATUS.FAIL, 'getSession error: ' + error.message);
      }
      const session = data?.session;
      if (!session) {
        return _check('auth_session', STATUS.WARN,
          'No active session returned — user may need to re-authenticate');
      }
      // Check expiry
      const expiresAt = session.expires_at; // Unix timestamp (seconds)
      if (expiresAt && expiresAt * 1000 < Date.now()) {
        return _check('auth_session', STATUS.WARN,
          'Session token expired — auto-refresh pending', { expiresAt });
      }
      const remaining = expiresAt ? Math.floor((expiresAt * 1000 - Date.now()) / 60000) : null;
      return _check('auth_session', STATUS.PASS,
        'Auth session valid' + (remaining !== null ? ' (' + remaining + 'min remaining)' : ''),
        { expiresAt, remainingMinutes: remaining }
      );
    } catch (e) {
      return _check('auth_session', STATUS.FAIL, 'Session check probe failed: ' + e.message);
    }
  }

  /**
   * CHECK 6: Engine modules loaded (verify all 4A-4D modules are on window).
   */
  async function checkModulesLoaded() {
    const required = {
      'STUDYRIA_MEMBERSHIP':              'Phase 4A config',
      'StudyriaMembershipUtils':          'Phase 4A utils',
      'StudyriaMembershipService':        'Phase 4B service',
      'StudyriaMembershipCache':          'Phase 4C cache',
      'StudyriaMembershipStatusResolver': 'Phase 4C resolver',
      'StudyriaMembershipFeatureResolver':'Phase 4C feature resolver',
      'StudyriaMembershipValidator':      'Phase 4C validator',
      'StudyriaMembershipAudit':          'Phase 4C audit',
      'StudyriaMembershipEngine':         'Phase 4C engine',
      'StudyriaMembershipResilience':     'Phase 4D resilience',
      'StudyriaMembershipSecurity':       'Phase 4D security',
      'StudyriaMembershipHealth':         'Phase 4D health',
    };

    const missing = [];
    const present = [];

    for (const [key, label] of Object.entries(required)) {
      if (!root[key]) {
        missing.push(label + ' (' + key + ')');
      } else {
        present.push(key);
      }
    }

    if (missing.length > 0) {
      return _check('modules_loaded', STATUS.FAIL,
        missing.length + ' module(s) missing: ' + missing.join(', '),
        { missing, present: present.length });
    }

    // Check phase tags
    const svcPhase    = root.StudyriaMembershipService?._phase;
    const enginePhase = root.StudyriaMembershipEngine?._phase;
    const phaseOk = svcPhase === '4B' && enginePhase === '4C';

    return _check('modules_loaded',
      phaseOk ? STATUS.PASS : STATUS.WARN,
      'All ' + present.length + ' modules loaded' + (phaseOk ? '' : ' (phase mismatch)'),
      { svcPhase, enginePhase, totalModules: present.length }
    );
  }

  /**
   * CHECK 7: Engine boot state.
   */
  async function checkEngineReady() {
    const engine = _engine();
    if (!engine) {
      return _check('engine_ready', STATUS.FAIL, 'StudyriaMembershipEngine not loaded');
    }
    const dbg = engine._debug?.();
    if (!dbg?.booted) {
      return _check('engine_ready', STATUS.WARN,
        'Engine not yet booted — call engine.boot() on page load');
    }
    return _check('engine_ready', STATUS.PASS,
      'Engine booted — state: ' + (dbg.currentState || 'unknown'),
      dbg
    );
  }

  /**
   * CHECK 8: Cache health (not over capacity, eviction working).
   */
  async function checkCacheHealth() {
    const cache = _cache();
    if (!cache) return _check('cache_health', STATUS.WARN, 'StudyriaMembershipCache not loaded');
    const dbg = cache._debug?.();
    const size = dbg?.size ?? cache.size;
    const MAX_WARN = 500;
    if (size > MAX_WARN) {
      return _check('cache_health', STATUS.WARN,
        'Cache has ' + size + ' entries — consider calling evict()',
        { size, threshold: MAX_WARN });
    }
    return _check('cache_health', STATUS.PASS,
      'Cache healthy (' + size + ' entries)', { size });
  }

  /**
   * CHECK 9: Security module self-test (sanitisation smoke test).
   */
  async function checkSecurityModule() {
    const sec = _security();
    if (!sec) return _check('security_module', STATUS.FAIL, 'StudyriaMembershipSecurity not loaded');
    try {
      // Quick smoke test — no network needed
      const ok1 = sec.sanitizeFeatureKey('ad_free') === 'ad_free';      // valid
      const ok2 = sec.sanitizeFeatureKey('../../evil') === null;          // rejected
      const ok3 = sec.sanitizeUserId('not-a-uuid') === null;             // rejected
      const ok4 = sec.sanitizeUserId('00000000-0000-0000-0000-000000000001') !== null; // valid

      if (!ok1 || !ok2 || !ok3 || !ok4) {
        return _check('security_module', STATUS.FAIL,
          'Security module self-test failed', { ok1, ok2, ok3, ok4 });
      }
      return _check('security_module', STATUS.PASS, 'Security module self-test passed');
    } catch (e) {
      return _check('security_module', STATUS.FAIL, 'Security module error: ' + e.message);
    }
  }

  /**
   * CHECK 10: Resilience module self-test.
   */
  async function checkResilienceModule() {
    const R = _resilience();
    if (!R) return _check('resilience_module', STATUS.FAIL, 'StudyriaMembershipResilience not loaded');
    try {
      // withSafe should swallow errors
      const r1 = await R.withSafe(async () => { throw new Error('test'); }, 'fallback');
      const r2 = R.classifyError({ status: 503 });
      const r3 = R.classifyError({ status: 403 });
      const ok1 = r1 === 'fallback';
      const ok2 = r2 === R.ErrorClass.RETRYABLE;
      const ok3 = r3 === R.ErrorClass.NON_RETRYABLE;

      if (!ok1 || !ok2 || !ok3) {
        return _check('resilience_module', STATUS.FAIL,
          'Resilience self-test failed', { ok1, ok2, ok3 });
      }

      // Circuit breaker creates without error
      const cb = R.createCircuitBreaker('health-test', { threshold: 2 });
      const cbOk = cb && cb.isClosed;
      if (!cbOk) {
        return _check('resilience_module', STATUS.WARN, 'Circuit breaker init issue');
      }

      return _check('resilience_module', STATUS.PASS, 'Resilience module self-test passed');
    } catch (e) {
      return _check('resilience_module', STATUS.FAIL, 'Resilience module error: ' + e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ORCHESTRATOR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Run all health checks and return a full report.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.skipDbChecks=false] — skip Supabase table probes (offline mode)
   * @returns {Promise<HealthReport>}
   */
  async function runAll(opts) {
    const skipDb = opts?.skipDbChecks === true;
    _log('runAll', 'Running health checks' + (skipDb ? ' (skipDbChecks)' : ''));
    const start = Date.now();

    const checks = await Promise.allSettled([
      skipDb ? Promise.resolve(_check('supabase_client',    STATUS.SKIP, 'Skipped by skipDbChecks'))
             : checkSupabaseClient(),
      skipDb ? Promise.resolve(_check('plans_table',        STATUS.SKIP, 'Skipped by skipDbChecks'))
             : checkPlansTable(),
      skipDb ? Promise.resolve(_check('memberships_table',  STATUS.SKIP, 'Skipped by skipDbChecks'))
             : checkMembershipsTable(),
      skipDb ? Promise.resolve(_check('features_table',     STATUS.SKIP, 'Skipped by skipDbChecks'))
             : checkFeaturesTable(),
      skipDb ? Promise.resolve(_check('auth_session',       STATUS.SKIP, 'Skipped by skipDbChecks'))
             : checkSessionValidity(),
      checkModulesLoaded(),
      checkEngineReady(),
      checkCacheHealth(),
      checkSecurityModule(),
      checkResilienceModule(),
    ]);

    // Unwrap allSettled results
    const results = checks.map(r =>
      r.status === 'fulfilled'
        ? r.value
        : _check('unknown', STATUS.FAIL, 'Check threw unexpectedly: ' + (r.reason?.message || r.reason))
    );

    // Compute overall
    const hasFail = results.some(c => c.status === STATUS.FAIL);
    const hasWarn = results.some(c => c.status === STATUS.WARN);
    const overall = hasFail ? OVERALL.UNHEALTHY : hasWarn ? OVERALL.DEGRADED : OVERALL.HEALTHY;

    const elapsed = Date.now() - start;
    const summary = {
      total:   results.length,
      pass:    results.filter(c => c.status === STATUS.PASS).length,
      warn:    results.filter(c => c.status === STATUS.WARN).length,
      fail:    results.filter(c => c.status === STATUS.FAIL).length,
      skip:    results.filter(c => c.status === STATUS.SKIP).length,
    };

    const icon = overall === OVERALL.HEALTHY ? '✅' : overall === OVERALL.DEGRADED ? '⚠️' : '❌';
    _log('runAll', icon + ' Overall: ' + overall + ' (' + elapsed + 'ms)', summary);

    return Object.freeze({
      overall,
      checks:    Object.freeze(results),
      summary,
      elapsedMs: elapsed,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Quick readiness check — returns true only if all critical checks PASS.
   * Skips DB checks (uses cached module-load + engine state only).
   *
   * @returns {Promise<boolean>}
   */
  async function isReady() {
    const report = await runAll({ skipDbChecks: true });
    return report.overall !== OVERALL.UNHEALTHY;
  }

  /**
   * Get a simple summary string for logging/telemetry.
   * @returns {Promise<string>}
   */
  async function getStatusLine() {
    const report = await runAll({ skipDbChecks: true });
    const s = report.summary;
    return report.overall + ' | ' + s.pass + ' pass / ' + s.warn + ' warn / ' + s.fail + ' fail / ' + s.skip + ' skip';
  }

  // ── Public API ────────────────────────────────────────────────────────────
  root.StudyriaMembershipHealth = Object.freeze({
    // Orchestrator
    runAll,
    isReady,
    getStatusLine,
    // Individual checks (for targeted use)
    checkSupabaseClient,
    checkPlansTable,
    checkMembershipsTable,
    checkFeaturesTable,
    checkSessionValidity,
    checkModulesLoaded,
    checkEngineReady,
    checkCacheHealth,
    checkSecurityModule,
    checkResilienceModule,
    // Constants
    STATUS,
    OVERALL,
  });

  _log('module', 'Registered — Phase 4D');

}(typeof self !== 'undefined' ? self : this));
