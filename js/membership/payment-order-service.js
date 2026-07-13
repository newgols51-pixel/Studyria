/**
 * ══════════════════════════════════════════════════════════════════════════
 * payment-order-service.js — Studyria Phase 5B
 * ══════════════════════════════════════════════════════════════════════════
 *
 * CLIENT-SIDE order orchestrator.
 *
 * Responsibilities:
 *   1. Validate the user session (must be authenticated).
 *   2. POST to the Supabase Edge Function `create-membership-order` with
 *      only the plan slug — never the price (server fetches that from DB).
 *   3. Store the returned order in IndexedDB (idempotency / resume support).
 *   4. Surface the order to the caller so the checkout UI can open the
 *      Razorpay modal (Phase 5C).
 *
 * SAFETY CONTRACT
 * ───────────────
 * • Reads plan slug from the local MEMBERSHIP_PLANS catalogue only.
 * • NEVER sends a price or amount to the server — the server fetches the
 *   authoritative price from membership_plans table.
 * • NEVER opens the Razorpay modal (Phase 5C responsibility).
 * • NEVER writes membership status or activates Premium.
 * • NEVER calls Razorpay API directly.
 * • Depends on window.supabaseClient (set by supabase.js).
 * • Reads Edge Function URL from environment variable via
 *   window.STUDYRIA_CONFIG.edgeFunctionBaseUrl (set in index.html).
 *
 * @module payment-order-service
 */

'use strict';

(function (root) {
  'use strict';

  // Guard against double-load
  if (root.StudyriaPaymentOrderService &&
      root.StudyriaPaymentOrderService._phase === '5B') return;

  // ── Dependency accessors ───────────────────────────────────────────────────
  const _sb  = () => root.supabaseClient;
  const _cfg = () => root.STUDYRIA_CONFIG || {};

  // ── Constants ──────────────────────────────────────────────────────────────
  const EDGE_FUNCTION_NAME = 'create-membership-order';
  const IDB_DB_NAME        = 'studyria-payment';
  const IDB_STORE_NAME     = 'pending-orders';
  const IDB_VERSION        = 1;
  const ORDER_TIMEOUT_MS   = 15_000; // 15 s — matches Edge Function timeout
  const MAX_RETRIES        = 1;      // one retry on network error

  // ── Logging ────────────────────────────────────────────────────────────────
  function _log(fn, msg, data) {
    const tag = '[PaymentOrderService:' + fn + ']';
    data !== undefined
      ? console.debug(tag, msg, data)
      : console.debug(tag, msg);
  }

  function _warn(fn, msg, data) {
    console.warn('[PaymentOrderService:' + fn + ']', msg, data || '');
  }

  function _error(fn, msg, err) {
    console.error('[PaymentOrderService:' + fn + ']', msg, err || '');
  }

  // ── IndexedDB helpers (idempotency store) ─────────────────────────────────

  /**
   * Opens (or creates) the payment IDB database.
   * @returns {Promise<IDBDatabase>}
   */
  function _openIDB() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('IndexedDB not available')); return; }
      const req = root.indexedDB.open(IDB_DB_NAME, IDB_VERSION);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME, { keyPath: 'idempotencyKey' });
        }
      };
      req.onsuccess = (ev) => resolve(ev.target.result);
      req.onerror   = (ev) => reject(ev.target.error);
    });
  }

  /**
   * Stores a pending order in IDB for resume on reload.
   * @param {object} order - The order object returned by the Edge Function.
   * @returns {Promise<void>}
   */
  async function _cacheOrder(order) {
    try {
      const db = await _openIDB();
      await new Promise((resolve, reject) => {
        const tx    = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        // Store with a 15-minute TTL
        const record = { ...order, cachedAt: Date.now(), ttl: ORDER_TIMEOUT_MS };
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror   = (e) => reject(e.target.error);
      });
      _log('_cacheOrder', 'Order cached in IDB', { key: order.idempotencyKey });
    } catch (e) {
      // Non-fatal — IDB is best-effort for UX resilience only
      _warn('_cacheOrder', 'Could not cache order in IDB:', e);
    }
  }

  /**
   * Retrieves a pending order from IDB by idempotency key.
   * Returns null if not found or expired.
   * @param {string} key
   * @returns {Promise<object|null>}
   */
  async function getCachedOrder(key) {
    try {
      const db = await _openIDB();
      return await new Promise((resolve, reject) => {
        const tx    = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req   = store.get(key);
        req.onsuccess = (e) => {
          const record = e.target.result;
          if (!record) { resolve(null); return; }
          // Check TTL
          if (Date.now() - record.cachedAt > record.ttl) {
            resolve(null); return;
          }
          resolve(record);
        };
        req.onerror = (e) => reject(e.target.error);
      });
    } catch (e) {
      _warn('getCachedOrder', 'IDB read failed:', e);
      return null;
    }
  }

  /**
   * Removes a cached order (after success or explicit cancel).
   * @param {string} key
   * @returns {Promise<void>}
   */
  async function clearCachedOrder(key) {
    try {
      const db = await _openIDB();
      await new Promise((resolve, reject) => {
        const tx    = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req   = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror   = (e) => reject(e.target.error);
      });
    } catch (e) {
      _warn('clearCachedOrder', 'IDB delete failed:', e);
    }
  }

  // ── Input validation ───────────────────────────────────────────────────────

  /**
   * Validates the plan slug against the local catalogue.
   * We only send the slug to the server — the server fetches the price.
   *
   * @param {string} planSlug
   * @returns {{ valid: true } | { valid: false, reason: string }}
   */
  function _validatePlanSlug(planSlug) {
    if (typeof planSlug !== 'string' || !planSlug.trim()) {
      return { valid: false, reason: 'Plan slug must be a non-empty string.' };
    }

    // Cross-reference against the Phase 5A catalogue
    // membership_plans DB is the authoritative source (server checks too)
    const VALID_SLUGS = new Set(['starter', 'monthly', 'quarterly', 'biannual']);
    if (!VALID_SLUGS.has(planSlug.trim().toLowerCase())) {
      return { valid: false, reason: `Unknown plan slug: "${planSlug}".` };
    }

    return { valid: true };
  }

  // ── Edge Function URL resolver ─────────────────────────────────────────────

  /**
   * Resolves the Edge Function endpoint URL.
   * Priority: window.STUDYRIA_CONFIG.edgeFunctionBaseUrl → Supabase client URL.
   *
   * @returns {string} Full URL to the create-membership-order Edge Function.
   * @throws {Error} If no base URL can be determined.
   */
  function _resolveEdgeFunctionUrl() {
    // Option 1: explicit config
    const configBase = _cfg().edgeFunctionBaseUrl;
    if (configBase && typeof configBase === 'string') {
      return configBase.replace(/\/$/, '') + '/functions/v1/' + EDGE_FUNCTION_NAME;
    }

    // Option 2: derive from supabaseClient.supabaseUrl
    const sb = _sb();
    if (sb && sb.supabaseUrl) {
      return sb.supabaseUrl.replace(/\/$/, '') + '/functions/v1/' + EDGE_FUNCTION_NAME;
    }

    // Option 3: environment variable pattern via window.SUPABASE_URL
    if (root.SUPABASE_URL && typeof root.SUPABASE_URL === 'string') {
      return root.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/' + EDGE_FUNCTION_NAME;
    }

    throw new Error(
      'Cannot determine Supabase Edge Function URL. ' +
      'Set window.STUDYRIA_CONFIG.edgeFunctionBaseUrl.'
    );
  }

  // ── Session helper ─────────────────────────────────────────────────────────

  /**
   * Returns the current Supabase access token, or null if not authenticated.
   * @returns {Promise<string|null>}
   */
  async function _getAccessToken() {
    try {
      const sb = _sb();
      if (!sb) return null;
      const { data: { session }, error } = await sb.auth.getSession();
      if (error || !session) return null;
      return session.access_token || null;
    } catch {
      return null;
    }
  }

  /**
   * Returns the authenticated user object, or null.
   * @returns {Promise<object|null>}
   */
  async function _getUser() {
    try {
      const sb = _sb();
      if (!sb) return null;
      const { data: { user }, error } = await sb.auth.getUser();
      if (error || !user) return null;
      return user;
    } catch {
      return null;
    }
  }

  // ── Idempotency key generation ─────────────────────────────────────────────

  /**
   * Generates a deterministic idempotency key for a (user, plan, date-window).
   * Same user + same plan within the same 15-minute window = same key.
   * This prevents duplicate order creation on network retries.
   *
   * Format: sha256(userId + ':' + planSlug + ':' + Math.floor(epoch/900000))
   * Falls back to random UUID if SubtleCrypto unavailable.
   *
   * @param {string} userId
   * @param {string} planSlug
   * @returns {Promise<string>} Hex or UUID string.
   */
  async function _generateIdempotencyKey(userId, planSlug) {
    const window15 = Math.floor(Date.now() / 900_000); // 15-minute window
    const raw      = `${userId}:${planSlug}:${window15}`;

    try {
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const enc  = new TextEncoder();
        const buf  = await crypto.subtle.digest('SHA-256', enc.encode(raw));
        return Array.from(new Uint8Array(buf))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
      }
    } catch (_) { /* fall through */ }

    // Fallback — still unique enough for single-session use
    return 'idem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  }

  // ── Core order creation ────────────────────────────────────────────────────

  /**
   * Creates a Razorpay order by calling the Supabase Edge Function.
   *
   * Sends only: { planSlug, idempotencyKey }
   * The Edge Function fetches the authoritative price from membership_plans.
   *
   * @param {object} options
   * @param {string} options.planSlug     - Membership plan slug.
   * @param {string} [options.idempotencyKey] - Optional pre-computed key.
   * @param {string} token                - Supabase access token.
   * @param {string} edgeFunctionUrl      - Resolved Edge Function URL.
   * @param {number} [attempt=0]          - Internal retry counter.
   * @returns {Promise<object>} Order result from Edge Function.
   * @throws {Error} On validation failure, auth failure, or API error.
   * @private
   */
  async function _callCreateOrder({ planSlug, idempotencyKey }, token, edgeFunctionUrl, attempt = 0) {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), ORDER_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(edgeFunctionUrl, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + token,
          // Idempotency header (standard practice)
          'Idempotency-Key': idempotencyKey,
        },
        // Only send non-sensitive fields — server fetches price from DB
        body: JSON.stringify({
          planSlug,
          idempotencyKey,
          source: 'studyria-webapp',
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timer);
      // Retry once on network error
      if (attempt < MAX_RETRIES && fetchErr.name !== 'AbortError') {
        _warn('_callCreateOrder', 'Network error — retrying', fetchErr.message);
        await new Promise(r => setTimeout(r, 1200));
        return _callCreateOrder({ planSlug, idempotencyKey }, token, edgeFunctionUrl, attempt + 1);
      }
      throw Object.assign(new Error(
        fetchErr.name === 'AbortError'
          ? 'Order request timed out. Please try again.'
          : 'Network error creating order. Please check your connection.'
      ), { code: 'NETWORK_ERROR', cause: fetchErr });
    } finally {
      clearTimeout(timer);
    }

    // ── Parse response ────────────────────────────────────────────────────
    let body;
    try {
      body = await response.json();
    } catch {
      throw Object.assign(
        new Error('Invalid response from payment server. Please try again.'),
        { code: 'INVALID_RESPONSE', status: response.status }
      );
    }

    // ── Handle error statuses ─────────────────────────────────────────────
    if (!response.ok) {
      const serverCode = body?.error?.code || body?.code || 'SERVER_ERROR';
      const serverMsg  = body?.error?.message || body?.message || `Server error ${response.status}`;

      // Idempotent replay — order already created for this key
      if (response.status === 409 && body?.order) {
        _log('_callCreateOrder', 'Idempotent replay — returning existing order', body.order.razorpayOrderId);
        return body.order;
      }

      throw Object.assign(new Error(serverMsg), {
        code:       serverCode,
        httpStatus: response.status,
      });
    }

    // ── Validate response shape ───────────────────────────────────────────
    if (!body?.order?.razorpayOrderId || !body?.order?.amountPaise) {
      throw Object.assign(
        new Error('Incomplete order response from server.'),
        { code: 'INCOMPLETE_RESPONSE', body }
      );
    }

    return body.order;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Creates a Razorpay membership order.
   *
   * This is the single entry point for Phase 5B order creation.
   * It handles: session check → slug validation → idempotency →
   *   Edge Function call → IDB cache → return order to caller.
   *
   * Phase 5C will use the returned order to open the Razorpay modal.
   *
   * @param {string} planSlug - One of: 'starter' | 'monthly' | 'quarterly' | 'biannual'
   * @returns {Promise<{
   *   razorpayOrderId: string,
   *   amountPaise:     number,
   *   currency:        string,
   *   planSlug:        string,
   *   planName:        string,
   *   receiptId:       string,
   *   idempotencyKey:  string,
   *   expiresAt:       string,
   *   keyId:           string,  // Razorpay public key_id (safe to expose)
   *   prefill: {
   *     name:  string,
   *     email: string,
   *   }
   * }>}
   * @throws {Error} On auth failure, validation failure, or server error.
   *
   * @example
   * const svc = window.StudyriaPaymentOrderService;
   * const order = await svc.createOrder('monthly');
   * // Phase 5C: use order to open Razorpay modal
   * console.log(order.razorpayOrderId); // 'order_xxx'
   * console.log(order.amountPaise);     // 9900
   */
  async function createOrder(planSlug) {
    _log('createOrder', 'Initiating order', { planSlug });

    // ── 1. Validate plan slug (client-side fast-fail) ─────────────────────
    const slugResult = _validatePlanSlug(planSlug);
    if (!slugResult.valid) {
      throw Object.assign(new Error(slugResult.reason), { code: 'INVALID_PLAN' });
    }

    // ── 2. Verify authentication ──────────────────────────────────────────
    const user = await _getUser();
    if (!user) {
      throw Object.assign(
        new Error('You must be logged in to purchase a membership.'),
        { code: 'UNAUTHENTICATED' }
      );
    }
    _log('createOrder', 'User verified', { userId: user.id });

    const token = await _getAccessToken();
    if (!token) {
      throw Object.assign(
        new Error('Session expired. Please log in again.'),
        { code: 'SESSION_EXPIRED' }
      );
    }

    // ── 3. Generate idempotency key ───────────────────────────────────────
    const idempotencyKey = await _generateIdempotencyKey(user.id, planSlug);
    _log('createOrder', 'Idempotency key', { idempotencyKey: idempotencyKey.slice(0, 12) + '…' });

    // ── 4. Check IDB cache for a live order with the same key ─────────────
    const cached = await getCachedOrder(idempotencyKey);
    if (cached) {
      _log('createOrder', 'Returning cached order from IDB', { key: idempotencyKey.slice(0, 12) });
      return cached;
    }

    // ── 5. Resolve Edge Function URL ──────────────────────────────────────
    let edgeFunctionUrl;
    try {
      edgeFunctionUrl = _resolveEdgeFunctionUrl();
    } catch (e) {
      throw Object.assign(
        new Error('Payment system configuration error. Please contact support.'),
        { code: 'CONFIG_ERROR', cause: e }
      );
    }
    _log('createOrder', 'Edge Function URL resolved', { url: edgeFunctionUrl });

    // ── 6. Call Edge Function (server creates Razorpay order) ────────────
    let order;
    try {
      order = await _callCreateOrder({ planSlug, idempotencyKey }, token, edgeFunctionUrl);
    } catch (e) {
      _error('createOrder', 'Edge Function call failed', e);
      throw e; // preserve original code/message
    }

    // ── 7. Attach idempotency key + cache in IDB ──────────────────────────
    const fullOrder = { ...order, idempotencyKey };
    await _cacheOrder(fullOrder);

    _log('createOrder', 'Order created successfully', {
      orderId:   order.razorpayOrderId,
      planSlug:  order.planSlug,
      amount:    order.amountPaise,
    });

    return fullOrder;
  }

  /**
   * Cancels a pending order in the local IDB cache.
   * Called when the user dismisses the Razorpay modal (Phase 5C).
   * Does NOT call any server API — the order remains in Supabase as 'created'
   * and will be expired by the DB cleanup function after 15 minutes.
   *
   * @param {string} idempotencyKey
   * @returns {Promise<void>}
   */
  async function cancelCachedOrder(idempotencyKey) {
    await clearCachedOrder(idempotencyKey);
    _log('cancelCachedOrder', 'Local order cache cleared', { key: idempotencyKey?.slice(0, 12) });
  }

  /**
   * Validates the plan catalogue loaded from the Phase 5A config.
   * Returns all active plans for display in the premium UI.
   *
   * @returns {Array<{id: string, priceINR: number, durationDays: number, label: string}>}
   */
  function getLocalPlanCatalogue() {
    // Read from window.STUDYRIA_PAYMENT_CONFIG if available (set by payment-config.js)
    const plans = root.STUDYRIA_PAYMENT_CONFIG?.MEMBERSHIP_PLANS;
    if (Array.isArray(plans)) return plans;

    // Fallback hardcoded (must match DB) — display only, server verifies price
    return [
      { id: 'starter',  label: '🟢 Starter',     durationDays: 15,  priceINR: 49  },
      { id: 'monthly',  label: '🔵 Monthly',      durationDays: 30,  priceINR: 99  },
      { id: 'quarterly',label: '🟣 Most Popular', durationDays: 90,  priceINR: 249 },
      { id: 'biannual', label: '👑 Best Value',   durationDays: 180, priceINR: 449 },
    ];
  }

  // ── Module export ──────────────────────────────────────────────────────────
  root.StudyriaPaymentOrderService = Object.freeze({
    _phase: '5B',

    // Core order flow
    createOrder,
    cancelCachedOrder,
    getCachedOrder,

    // Utility
    getLocalPlanCatalogue,

    // Exposed for testing
    _validatePlanSlug,
    _generateIdempotencyKey,
  });

  _log('init', 'StudyriaPaymentOrderService Phase 5B ready.');

}(typeof self !== 'undefined' ? self : this));
