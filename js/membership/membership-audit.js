/**
 * =============================================================================
 * FILE: js/membership/membership-audit.js
 * PROJECT: Studyria Premium Membership — Phase 4C
 * PURPOSE: Audit log helper — client-side event tracking layer.
 *          Phase 4C: ALL Supabase writes are STUBBED (no actual DB writes).
 *          Only console logging and in-memory event buffer.
 *          Phase 5+ will wire real inserts via service_role backend function.
 * BRANCH:  feat/premium-membership-phase-4c
 * SAFE:    ZERO database writes. All inserts are stubbed.
 * =============================================================================
 *
 * USAGE:
 *   const audit = window.StudyriaMembershipAudit;
 *   audit.log('activated', membershipId, { actor: 'webhook' });
 *   // → console debug only in Phase 4C (no DB write)
 *
 *   audit.getBuffer(); // → all events logged this session
 *
 * =============================================================================
 */

'use strict';

(function (root) {
  if (root.StudyriaMembershipAudit) return;

  // ── Dependency accessors ─────────────────────────────────────────────────
  const _cfg       = () => root.STUDYRIA_MEMBERSHIP;
  const _validator = () => root.StudyriaMembershipValidator;

  // ── In-memory event buffer (session only, not persisted) ─────────────────
  const _buffer = [];
  const MAX_BUFFER = 200;

  // ── Valid event types (mirrors DB CHECK constraint) ───────────────────────
  const VALID_EVENTS = Object.freeze([
    'activated',
    'expired',
    'cancelled',
    'suspended',
    'renewed',
    'restored',
    'admin_override',
    'payment_received',
    'refund_issued',
    // Client-side-only events (NOT written to DB)
    'client_status_check',   // user checked their status
    'client_feature_check',  // user tried to access a feature gate
    'client_cache_miss',     // cache miss (diagnostic)
    'client_error',          // client-side error during membership check
  ]);

  // ── DB-writable events (subset of VALID_EVENTS) ──────────────────────────
  // Only these would be written to membership_logs in Phase 5+
  const DB_EVENTS = new Set([
    'activated',
    'expired',
    'cancelled',
    'suspended',
    'renewed',
    'restored',
    'admin_override',
    'payment_received',
    'refund_issued',
  ]);

  // ── Logging ───────────────────────────────────────────────────────────────
  function _log(msg, data) {
    data !== undefined
      ? console.debug('[MembershipAudit]', msg, data)
      : console.debug('[MembershipAudit]', msg);
  }
  function _warn(msg, err) {
    console.warn('[MembershipAudit]', msg, err || '');
  }

  // ── Build a structured log entry ──────────────────────────────────────────
  function _buildEntry(event, membershipId, metadata, source) {
    return {
      event,
      membership_id: membershipId || null,
      metadata:      metadata     || {},
      source:        source       || 'client',
      timestamp:     new Date().toISOString(),
      phase:         '4C',
      written_to_db: false,   // always false in Phase 4C
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE LOG FUNCTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Log a membership lifecycle event.
   *
   * Phase 4C: console.debug only — ZERO DB writes.
   * Phase 5+: DB-writable events will call a backend function (service_role).
   *
   * @param {string} event        — from VALID_EVENTS
   * @param {string} membershipId — UUID of the membership row
   * @param {object} [metadata]   — extra context
   * @param {string} [source]     — 'client' | 'webhook' | 'admin'
   * @returns {object} the log entry (for chaining / testing)
   */
  function log(event, membershipId, metadata, source) {
    // Validate event type
    if (!VALID_EVENTS.includes(event)) {
      _warn('Unknown event type — skipping', event);
      return null;
    }

    // Validate via validator if available
    if (DB_EVENTS.has(event) && membershipId) {
      const v = _validator();
      if (v) {
        const result = v.validateLogEntry({ membership_id: membershipId, event, metadata: metadata || {} });
        if (!result.valid) {
          _warn('Log entry validation failed', result.errors);
          // Still log to buffer (don't block diagnostics), but warn
        }
      }
    }

    const entry = _buildEntry(event, membershipId, metadata, source);

    // Add to in-memory buffer (capped)
    if (_buffer.length >= MAX_BUFFER) _buffer.shift();
    _buffer.push(entry);

    // Console output
    const icon = DB_EVENTS.has(event) ? '📋' : '🔍';
    _log(icon + ' EVENT [' + event + ']' + (DB_EVENTS.has(event) ? ' (stub — no DB write in 4C)' : ''), {
      membership_id: membershipId || '—',
      metadata:      metadata || {},
    });

    // ── Phase 5 stub ──────────────────────────────────────────────────────
    // When Phase 5 is ready, replace this comment block with:
    //
    //   if (DB_EVENTS.has(event) && membershipId) {
    //     _writeToDb(entry).catch(err => _warn('DB write failed', err));
    //   }
    //
    // Where _writeToDb calls a Supabase Edge Function / backend function
    // that uses service_role to INSERT INTO membership_logs.
    // ─────────────────────────────────────────────────────────────────────

    return entry;
  }

  // ── Convenience event loggers ─────────────────────────────────────────────

  /** Log a status check event (client-side diagnostic). */
  function logStatusCheck(membershipId, resolvedState) {
    return log('client_status_check', membershipId, { state: resolvedState }, 'client');
  }

  /** Log a feature gate check (client-side diagnostic). */
  function logFeatureCheck(membershipId, featureKey, granted) {
    return log('client_feature_check', membershipId, { feature: featureKey, granted }, 'client');
  }

  /** Log a client-side error during membership resolution. */
  function logError(membershipId, errorMessage, context) {
    return log('client_error', membershipId, {
      error:   errorMessage,
      context: context || {},
    }, 'client');
  }

  // ── Buffer management ─────────────────────────────────────────────────────

  /**
   * Get all events logged this session (in-memory only).
   * @param {string} [filterEvent] — optional event type filter
   * @returns {object[]}
   */
  function getBuffer(filterEvent) {
    if (filterEvent) return _buffer.filter(e => e.event === filterEvent);
    return [..._buffer];
  }

  /**
   * Get the count of DB-writable events pending (not yet written in Phase 4C).
   * @returns {number}
   */
  function getPendingDbCount() {
    return _buffer.filter(e => DB_EVENTS.has(e.event) && !e.written_to_db).length;
  }

  /** Clear the in-memory buffer. */
  function clearBuffer() {
    _buffer.length = 0;
    _log('Buffer cleared');
  }

  /**
   * Get a summary of the buffer for debugging.
   * @returns {object}
   */
  function getSummary() {
    const counts = {};
    for (const e of _buffer) counts[e.event] = (counts[e.event] || 0) + 1;
    return {
      total:          _buffer.length,
      pendingDbWrites: getPendingDbCount(),
      byEvent:        counts,
      phase:          '4C',
      dbWritesActive: false,  // Phase 4C: always false
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────
  root.StudyriaMembershipAudit = Object.freeze({
    // Core
    log,
    logStatusCheck,
    logFeatureCheck,
    logError,
    // Buffer
    getBuffer,
    getPendingDbCount,
    clearBuffer,
    getSummary,
    // Constants
    VALID_EVENTS,
    DB_EVENTS: Array.from(DB_EVENTS),
  });

  _log('Registered — Phase 4C (writes stubbed)');

}(typeof self !== 'undefined' ? self : this));
