/**
 * =============================================================================
 * FILE: js/membership/membership-cache.js
 * PROJECT: Studyria Premium Membership — Phase 4D
 * PURPOSE: Shared multi-key cache helper for the membership engine.
 *          Replaces the single-slot cache in membership-service.js with a
 *          named-key store that all engine modules can share.
 * BRANCH:  feat/premium-membership-phase-4d
 * SAFE:    Pure in-memory. Zero side effects. Zero writes. Zero network calls.
 * =============================================================================
 *
 * USAGE:
 *   const cache = window.StudyriaMembershipCache;
 *   cache.set('membership:uid123', data, 5 * 60 * 1000);
 *   cache.get('membership:uid123'); // → data | null
 *   cache.del('membership:uid123');
 *   cache.clear();
 *
 * =============================================================================
 */

'use strict';

(function (root) {
  if (root.StudyriaMembershipCache) return;

  // ── Internal store: Map<key, { value, expiresAt }> ───────────────────────
  const _store = new Map();

  // ── Default TTLs (ms) ────────────────────────────────────────────────────
  // Keep only those actively referenced in this file. Removing SHORT constant since it was orphaned.
  const TTL = Object.freeze({
    MEMBERSHIP:     5 * 60 * 1000,   // 5 min — active membership row
    PLAN:          10 * 60 * 1000,   // 10 min — plan definitions (rarely change)
    FEATURE_LIST:  10 * 60 * 1000,   // 10 min — membership_features table
    STATUS:         5 * 60 * 1000,   // 5 min  — derived status object
  });

  // ── Cache key builders ────────────────────────────────────────────────────
  const KEYS = Object.freeze({
    membership:    (uid)  => 'mbr:' + uid,
    status:        (uid)  => 'stt:' + uid,
    plan:          (slug) => 'pln:' + slug,
    allPlans:      ()     => 'pln:all',
    featureList:   ()     => 'ftr:list',
    featureCheck:  (uid, key) => 'ftr:' + uid + ':' + key,
  });

  // ── Logging ───────────────────────────────────────────────────────────────
  function _log(op, key, hit) {
    const icon = hit ? '🟢' : '⚪';
    console.debug('[MembershipCache]', icon, op, key);
  }

  // ── Auto-evict expired entries (called on get) ────────────────────────────
  function _isAlive(entry) {
    return entry && Date.now() < entry.expiresAt;
  }

  // ── Cache Key Sanitizer / Validator ───────────────────────────────────────
  // Cache keys must be alphanumeric + ':_-' only to prevent cache poisoning or pollution.
  function _validateKey(key) {
    if (typeof key !== 'string') {
      throw new Error('[MembershipCache] Invalid key type: key must be a string');
    }
    const safeRegex = /^[a-zA-Z0-9:_-]+$/;
    if (!safeRegex.test(key)) {
      throw new Error('[MembershipCache] Malicious or invalid key format: ' + key);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  const Cache = {

    /**
     * Store a value under a key with a TTL.
     * @param {string} key
     * @param {*}      value
     * @param {number} [ttlMs] — defaults to TTL.MEMBERSHIP
     */
    set(key, value, ttlMs) {
      if (key === null || key === undefined) {
        throw new Error('[MembershipCache] Key cannot be null or undefined');
      }
      _validateKey(key);

      const ttl = (typeof ttlMs === 'number' && ttlMs > 0) ? ttlMs : TTL.MEMBERSHIP;
      const expiresAt = (typeof ttlMs === 'number' && ttlMs <= 0) ? 0 : Date.now() + ttl;
      _store.set(key, { value, expiresAt });
      _log('SET', key);
    },

    /**
     * Retrieve a value. Returns null if missing or expired.
     * @param {string} key
     * @returns {*|null}
     */
    get(key) {
      // Throws on null/undefined/invalid format — signals a bug in calling code
      _validateKey(key);

      const entry = _store.get(key);
      if (!_isAlive(entry)) {
        if (entry) _store.delete(key); // evict stale
        _log('MISS', key, false);
        return null;
      }
      _log('HIT', key, true);
      return entry.value;
    },

    /**
     * Check if a key has a live entry.
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
      if (key === null || key === undefined) return false;
      try {
        _validateKey(key);
      } catch (err) {
        return false;
      }
      const entry = _store.get(key);
      if (!_isAlive(entry)) { if (entry) _store.delete(key); return false; }
      return true;
    },

    /**
     * Delete a specific key.
     * @param {string} key
     */
    del(key) {
      if (key === null || key === undefined) return;
      try {
        _validateKey(key);
      } catch (err) {
        return;
      }
      _store.delete(key);
      _log('DEL', key);
    },

    /**
     * Alias for del(key) to satisfy invalidation standards.
     * @param {string} key
     */
    invalidate(key) {
      this.del(key);
    },

    /**
     * Delete all keys matching a prefix.
     * Useful for invalidating all keys for a specific user.
     * @param {string} prefix
     */
    delByPrefix(prefix) {
      if (typeof prefix !== 'string') return;
      let count = 0;
      for (const key of _store.keys()) {
        if (key.startsWith(prefix)) { _store.delete(key); count++; }
      }
      console.debug('[MembershipCache] CLEAR_PREFIX', prefix, '(' + count + ' keys)');
    },

    /**
     * Clear the entire cache (e.g. on sign-out).
     */
    clear() {
      const size = _store.size;
      _store.clear();
      console.debug('[MembershipCache] CLEARED', size, 'entries');
    },

    /**
     * Evict all expired entries (housekeeping).
     * @returns {number} number of entries evicted
     */
    evict() {
      let count = 0;
      for (const [key, entry] of _store.entries()) {
        if (!_isAlive(entry)) { _store.delete(key); count++; }
      }
      console.debug('[MembershipCache] EVICT', count, 'stale entries');
      return count;
    },

    /** Current number of live entries. */
    get size() {
      return _store.size;
    },

    /** Expose TTL constants and key builders. */
    TTL,
    KEYS,

    /** Debug dump (dev only). */
    _debug() {
      const entries = [];
      for (const [key, entry] of _store.entries()) {
        entries.push({
          key,
          alive:     _isAlive(entry),
          expiresIn: Math.max(0, Math.round((entry.expiresAt - Date.now()) / 1000)) + 's',
          type:      typeof entry.value,
        });
      }
      return { size: _store.size, entries };
    },
  };

  root.StudyriaMembershipCache = Object.freeze(Cache);
  console.debug('[MembershipCache] Registered — Phase 4D');

}(typeof self !== 'undefined' ? self : this));
