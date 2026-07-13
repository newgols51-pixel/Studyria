/**
 * =============================================================================
 * FILE: js/membership/membership-security.js
 * PROJECT: Studyria Premium Membership — Phase 4D
 * PURPOSE: Security validation layer — input sanitisation, session token
 *          integrity checks, client-side rate limiting, and tamper detection.
 *          Zero network calls. Zero side effects. Zero writes.
 * BRANCH:  feat/premium-membership-phase-4d
 * SAFE:    Pure validation / guard layer.
 * =============================================================================
 *
 * USAGE:
 *   const sec = window.StudyriaMembershipSecurity;
 *
 *   sec.sanitizeFeatureKey('ad_free__evil');  // → null (rejected)
 *   sec.assertSessionFresh(user);             // → { ok, reason }
 *   sec.checkRateLimit('feature-check', 30); // → { allowed, retryAfter }
 *   sec.detectTamper(resolvedStatus);         // → { suspicious, flags }
 *
 * =============================================================================
 */

'use strict';

(function (root) {
  if (root.StudyriaMembershipSecurity) return;

  // ── Dependency accessors ─────────────────────────────────────────────────
  const _cfg = () => root.STUDYRIA_MEMBERSHIP;

  // ── Constants ─────────────────────────────────────────────────────────────
  const MAX_SESSION_AGE_MS   = 24 * 60 * 60 * 1000;  // 24h — re-auth if older
  const SESSION_WARN_AGE_MS  =  4 * 60 * 60 * 1000;  // 4h  — soft warning
  const RATE_WINDOW_MS       = 60 * 1000;             // 1-min sliding window
  const SLUG_RE              = /^[a-z0-9_-]{2,32}$/;
  const UUID_RE              = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const FEATURE_KEY_MAX_LEN  = 64;
  const SAFE_STRING_RE       = /^[a-z0-9_:-]{1,128}$/;  // allowed chars for internal keys

  // ── In-memory rate limit buckets: Map<action, { count, windowStart }> ────
  const _rateBuckets = new Map();

  // ── Logging ───────────────────────────────────────────────────────────────
  function _log(fn, msg, data) {
    data !== undefined
      ? console.debug('[MembershipSecurity:' + fn + ']', msg, data)
      : console.debug('[MembershipSecurity:' + fn + ']', msg);
  }
  function _warn(fn, msg, data) {
    console.warn('[MembershipSecurity:' + fn + ']', msg, data || '');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INPUT SANITISATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sanitize and validate a feature key string.
   * Returns the key if valid, null if rejected.
   * @param {*} key
   * @returns {string|null}
   */
  function sanitizeFeatureKey(key) {
    if (typeof key !== 'string') { _warn('sanitizeFeatureKey', 'Non-string input rejected'); return null; }
    const trimmed = key.trim().toLowerCase();
    if (trimmed.length === 0 || trimmed.length > FEATURE_KEY_MAX_LEN) {
      _warn('sanitizeFeatureKey', 'Length out of bounds', trimmed.length); return null;
    }
    if (!SLUG_RE.test(trimmed)) {
      _warn('sanitizeFeatureKey', 'Invalid chars in feature key', trimmed); return null;
    }
    // Check against known feature list if config available
    const cfg = _cfg();
    if (cfg?.FEATURES) {
      const known = Object.values(cfg.FEATURES);
      if (!known.includes(trimmed)) {
        _warn('sanitizeFeatureKey', 'Unknown feature key', trimmed);
        return null;  // strict — reject unknowns
      }
    }
    return trimmed;
  }

  /**
   * Sanitize a plan slug.
   * @param {*} slug
   * @returns {string|null}
   */
  function sanitizePlanSlug(slug) {
    if (typeof slug !== 'string') return null;
    const trimmed = slug.trim().toLowerCase();
    if (!SLUG_RE.test(trimmed)) { _warn('sanitizePlanSlug', 'Invalid slug', trimmed); return null; }
    const cfg = _cfg();
    if (cfg?.PLANS) {
      const known = Object.values(cfg.PLANS).map(p => p.slug || p);
      // Only validate if PLANS has slugs populated
      if (known.length > 0 && !known.includes(trimmed)) {
        _warn('sanitizePlanSlug', 'Unknown plan slug', trimmed); return null;
      }
    }
    return trimmed;
  }

  /**
   * Sanitize a user ID (must be a UUID v4).
   * @param {*} uid
   * @returns {string|null}
   */
  function sanitizeUserId(uid) {
    if (typeof uid !== 'string') return null;
    const trimmed = uid.trim();
    if (!UUID_RE.test(trimmed)) { _warn('sanitizeUserId', 'Invalid UUID format'); return null; }
    return trimmed;
  }

  /**
   * Sanitize a generic internal key (cache key, audit label, etc.).
   * Only allows safe alphanumeric + _:- characters.
   * @param {*} key
   * @returns {string|null}
   */
  function sanitizeInternalKey(key) {
    if (typeof key !== 'string') return null;
    const trimmed = key.trim();
    if (!SAFE_STRING_RE.test(trimmed)) {
      _warn('sanitizeInternalKey', 'Unsafe internal key rejected', trimmed); return null;
    }
    return trimmed;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION INTEGRITY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Assert that the current Supabase session is fresh enough.
   * Reads window.currentUser (set by supabase.js syncNavToAuth).
   * Does NOT make any network call.
   *
   * @param {object|null} [userOverride] — pass explicitly for testability
   * @returns {{ ok: boolean, reason: string, age: number|null, stale: boolean }}
   */
  function assertSessionFresh(userOverride) {
    const user = userOverride !== undefined ? userOverride : root.currentUser;

    if (!user) {
      return { ok: false, reason: 'no_session', age: null, stale: false };
    }

    // Check user object shape
    if (!user.uid || typeof user.uid !== 'string') {
      _warn('assertSessionFresh', 'Malformed user object — missing uid');
      return { ok: false, reason: 'malformed_user', age: null, stale: false };
    }
    if (!UUID_RE.test(user.uid)) {
      _warn('assertSessionFresh', 'User uid is not a valid UUID');
      return { ok: false, reason: 'invalid_uid', age: null, stale: false };
    }

    // Synchronous best-effort check — definitive async check is in health.js checkSessionValidity()
    let session = null;
    const client = root.supabaseClient;

    // 1. Try to read from client.auth synchronously if cached by supabase-js
    if (client && client.auth) {
      try {
        if (typeof client.auth.getSession === 'function') {
          // In some versions of supabase-js, synchronous or internal access might be available,
          // or we can probe the current active session object if stored under an internal key.
          const currentSession = client.auth.session ? client.auth.session() : null;
          if (currentSession) {
            session = currentSession;
          }
        }
      } catch (e) {
        _warn('assertSessionFresh', 'Error probing synchronous client auth session', e);
      }
    }

    // 2. Try to read from localStorage synchronous cache if supabaseClient or project ref is known
    if (!session && typeof window !== 'undefined' && window.localStorage) {
      try {
        // Find keys matching sb-<project-ref>-auth-token
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
            const raw = window.localStorage.getItem(key);
            if (raw) {
              const parsed = JSON.parse(raw);
              // supabase-js v2 stores the token payload with an inner/outer object containing expires_at
              if (parsed && typeof parsed === 'object') {
                session = parsed.currentSession || parsed;
                break;
              }
            }
          }
        }
      } catch (e) {
        _warn('assertSessionFresh', 'Error reading session from localStorage', e);
      }
    }

    // 3. If session information is retrieved, perform expiration and age assertions
    if (session) {
      const nowMs = Date.now();
      
      // Calculate age comparing against created_at or issued_at if available
      // session.created_at is typically stored, or we check issued_at (iat) in JWT if available
      let createdAtMs = null;
      if (session.created_at) {
        createdAtMs = new Date(session.created_at).getTime();
      } else if (session.user && session.user.last_sign_in_at) {
        createdAtMs = new Date(session.user.last_sign_in_at).getTime();
      }

      if (createdAtMs && !isNaN(createdAtMs)) {
        const ageMs = nowMs - createdAtMs;
        if (ageMs > MAX_SESSION_AGE_MS) {
          _warn('assertSessionFresh', 'Session exceeded MAX_SESSION_AGE_MS', { ageMs, max: MAX_SESSION_AGE_MS });
          return { ok: false, reason: 'session_too_old', age: ageMs, stale: true };
        }
      }

      // Check expires_at (typically Unix timestamp in seconds)
      const expiresAt = session.expires_at;
      if (expiresAt) {
        const expiresAtMs = expiresAt * 1000;
        const diffMs = expiresAtMs - nowMs;

        // If expires_at is in the past by > 5 minutes
        if (diffMs < -5 * 60 * 1000) {
          _warn('assertSessionFresh', 'Session expired by > 5 minutes', { diffMs });
          return { ok: false, reason: 'session_expired', stale: true, age: null };
        }
        // If within 5 minutes of expiry (or expired by <= 5 minutes)
        if (diffMs <= 5 * 60 * 1000) {
          _log('assertSessionFresh', 'Session expiring soon or in grace window', { diffMs });
          return { ok: true, reason: 'expiring_soon', stale: true, age: null };
        }
      }
    }

    _log('assertSessionFresh', 'Session OK (or fell back to existing behavior)', { uid: user.uid.slice(0, 8) + '...' });
    return { ok: true, reason: 'ok', age: null, stale: false };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RATE LIMITING (client-side sliding window)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if an action is within rate limits.
   * Uses a per-action sliding window counter stored in memory.
   *
   * @param {string} action    — e.g. 'feature-check', 'status-refresh'
   * @param {number} maxCount  — max calls per window
   * @param {number} [windowMs=60000] — window size in ms
   * @returns {{ allowed: boolean, count: number, retryAfter: number }}
   */
  function checkRateLimit(action, maxCount, windowMs) {
    const window = typeof windowMs === 'number' ? windowMs : RATE_WINDOW_MS;
    const now    = Date.now();

    let bucket = _rateBuckets.get(action);
    if (!bucket || now - bucket.windowStart >= window) {
      // New window
      bucket = { count: 0, windowStart: now };
      _rateBuckets.set(action, bucket);
    }

    bucket.count++;
    const allowed    = bucket.count <= maxCount;
    const retryAfter = allowed ? 0 : Math.ceil((bucket.windowStart + window - now) / 1000);

    if (!allowed) {
      _warn('checkRateLimit', 'Rate limit exceeded for action', {
        action, count: bucket.count, maxCount, retryAfterSec: retryAfter,
      });
    }

    return { allowed, count: bucket.count, maxCount, retryAfter };
  }

  /**
   * Reset the rate limit bucket for a specific action.
   * @param {string} action
   */
  function resetRateLimit(action) {
    _rateBuckets.delete(action);
  }

  /**
   * Reset all rate limit buckets.
   */
  function resetAllRateLimits() {
    _rateBuckets.clear();
    _log('resetAllRateLimits', 'All buckets cleared');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAMPER DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Detect suspicious patterns in a resolved membership status object.
   * This is a client-side sanity check — NOT a security boundary.
   * Real enforcement is always server-side (RLS + Supabase policies).
   *
   * @param {object} resolvedStatus — output of StatusResolver.resolve()
   * @returns {{ suspicious: boolean, flags: string[] }}
   */
  function detectTamper(resolvedStatus) {
    const flags = [];
    if (!resolvedStatus) return { suspicious: false, flags };

    // Frozen objects can't be tampered with (we freeze all outputs)
    if (!Object.isFrozen(resolvedStatus)) {
      flags.push('resolved_status_not_frozen');
    }

    // isPremium must match state
    const premiumStates = new Set(['ACTIVE', 'GRACE']);
    if (resolvedStatus.isPremium && !premiumStates.has(resolvedStatus.state)) {
      flags.push('isPremium_state_mismatch');
      _warn('detectTamper', 'isPremium=true but state is not ACTIVE/GRACE', resolvedStatus.state);
    }
    if (!resolvedStatus.isPremium && premiumStates.has(resolvedStatus.state)) {
      flags.push('isPremium_false_but_premium_state');
    }

    // daysLeft must be 0 for non-premium
    if (!resolvedStatus.isPremium && resolvedStatus.daysLeft > 0) {
      flags.push('daysLeft_nonzero_for_non_premium');
    }

    // planSlug must be valid if premium
    if (resolvedStatus.isPremium && resolvedStatus.planSlug) {
      if (!SLUG_RE.test(resolvedStatus.planSlug)) {
        flags.push('invalid_planSlug');
        _warn('detectTamper', 'Invalid plan slug in resolved status', resolvedStatus.planSlug);
      }
    }

    // membershipId must be UUID if present
    if (resolvedStatus.membershipId && !UUID_RE.test(resolvedStatus.membershipId)) {
      flags.push('invalid_membershipId_format');
    }

    // expiresAt must be a valid ISO string if present
    if (resolvedStatus.expiresAt) {
      const d = new Date(resolvedStatus.expiresAt);
      if (isNaN(d.getTime())) {
        flags.push('invalid_expiresAt');
      }
      // Premium status with past expiry is suspicious
      if (resolvedStatus.isPremium && resolvedStatus.state === 'ACTIVE' && d.getTime() < Date.now()) {
        flags.push('active_but_expiry_in_past');
        _warn('detectTamper', 'ACTIVE status with past expiresAt — possible resolver bug');
      }
    }

    const suspicious = flags.length > 0;
    if (suspicious) {
      _warn('detectTamper', 'Suspicious status detected', { flags, state: resolvedStatus.state });
    }

    return { suspicious, flags };
  }

  /**
   * Validate that a context object came from the engine (has required shape).
   * @param {object} ctx — output of engine.getContext()
   * @returns {{ valid: boolean, issues: string[] }}
   */
  function validateContextShape(ctx) {
    const issues = [];
    if (!ctx || typeof ctx !== 'object') { return { valid: false, issues: ['ctx_not_object'] }; }
    if (!ctx.resolved || typeof ctx.resolved !== 'object') issues.push('missing_resolved');
    if (!ctx.features || typeof ctx.features !== 'object') issues.push('missing_features');
    if (!ctx.fetchedAt || typeof ctx.fetchedAt !== 'string') issues.push('missing_fetchedAt');
    if (ctx.error !== null && ctx.error !== undefined && typeof ctx.error !== 'string') {
      issues.push('invalid_error_field');
    }
    return { valid: issues.length === 0, issues };
  }

  // ── Public API ────────────────────────────────────────────────────────────
  root.StudyriaMembershipSecurity = Object.freeze({
    // Input sanitisation
    sanitizeFeatureKey,
    sanitizePlanSlug,
    sanitizeUserId,
    sanitizeInternalKey,
    // Session integrity
    assertSessionFresh,
    // Rate limiting
    checkRateLimit,
    resetRateLimit,
    resetAllRateLimits,
    // Tamper detection
    detectTamper,
    validateContextShape,
    // Constants
    MAX_SESSION_AGE_MS,
    SESSION_WARN_AGE_MS,
    RATE_WINDOW_MS,
  });

  _log('module', 'Registered — Phase 4D');

}(typeof self !== 'undefined' ? self : this));
