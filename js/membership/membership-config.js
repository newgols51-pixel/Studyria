/**
 * =============================================================================
 * FILE: js/membership/membership-config.js
 * PROJECT: Studyria Premium Membership — Phase 4A (Foundation)
 * PURPOSE: Membership constants, plan IDs, status codes, feature keys.
 *          Pure configuration — zero business logic, zero side effects.
 * STATUS: PLACEHOLDER ONLY — not connected to Supabase yet
 * SAFE: Does NOT modify any existing functionality.
 * =============================================================================
 *
 * USAGE (Phase 4B+):
 *   import { MEMBERSHIP } from './js/membership/membership-config.js';
 *   // or via <script> tag (sets window.STUDYRIA_MEMBERSHIP):
 *   const { PLANS, STATUS, FEATURES } = window.STUDYRIA_MEMBERSHIP;
 *
 * =============================================================================
 */

'use strict';

(function (root, factory) {
  // UMD-lite: works as ES module, CommonJS, or browser global
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.STUDYRIA_MEMBERSHIP = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // ===========================================================================
  // PLAN SLUGS
  // Must match `slug` column in membership_plans table.
  // ===========================================================================
  const PLANS = Object.freeze({
    TRIAL_1DAY:  'trial_1day',
    TRIAL_15DAY: 'trial_15day',
    MONTHLY:     'monthly',
    QUARTERLY:   'quarterly',
    HALF_YEAR:   'half_year',
  });

  // ===========================================================================
  // MEMBERSHIP STATUS
  // Must match `status` CHECK constraint in user_memberships table.
  // ===========================================================================
  const STATUS = Object.freeze({
    ACTIVE:     'active',
    EXPIRED:    'expired',
    CANCELLED:  'cancelled',
    PENDING:    'pending',
    SUSPENDED:  'suspended',
    // Client-only virtual status (not in DB):
    NONE:       'none',      // user has no membership row
    LOADING:    'loading',   // membership state not yet fetched
    ERROR:      'error',     // failed to fetch membership state
  });

  // ===========================================================================
  // FEATURE KEYS
  // Must match `feature_key` values in membership_features table
  // AND keys inside membership_plans.features JSONB column.
  // ===========================================================================
  const FEATURES = Object.freeze({
    AD_FREE:            'ad_free',
    OFFLINE_DOWNLOADS:  'offline_downloads',
    MCQ_UNLIMITED:      'mcq_unlimited',
    PRIORITY_SUPPORT:   'priority_support',
    EARLY_ACCESS:       'early_access',
    PREMIUM_BADGE:      'premium_badge',
    READING_ROOM:       'reading_room',
    CREATOR_ACCESS:     'creator_access',
    AI_SUMMARY:         'ai_summary',
    ANALYTICS:          'analytics',
  });

  // ===========================================================================
  // LIFECYCLE EVENTS
  // Must match `event` CHECK constraint in membership_logs table.
  // ===========================================================================
  const EVENTS = Object.freeze({
    ACTIVATED:        'activated',
    EXPIRED:          'expired',
    CANCELLED:        'cancelled',
    SUSPENDED:        'suspended',
    RENEWED:          'renewed',
    RESTORED:         'restored',
    ADMIN_OVERRIDE:   'admin_override',
    PAYMENT_RECEIVED: 'payment_received',
    REFUND_ISSUED:    'refund_issued',
  });

  // ===========================================================================
  // PAYMENT PROVIDERS
  // Must match `payment_provider` values in membership_transactions table.
  // ===========================================================================
  const PROVIDERS = Object.freeze({
    RAZORPAY:     'razorpay',
    MANUAL:       'manual',
    PROMO:        'promo',
    ADMIN_GRANT:  'admin_grant',
  });

  // ===========================================================================
  // TRANSACTION STATUS
  // Must match `status` CHECK constraint in membership_transactions table.
  // ===========================================================================
  const TX_STATUS = Object.freeze({
    PENDING:  'pending',
    SUCCESS:  'success',
    FAILED:   'failed',
    REFUNDED: 'refunded',
  });

  // ===========================================================================
  // TABLE NAMES
  // Centralised to prevent typos in service files.
  // ===========================================================================
  const TABLES = Object.freeze({
    PLANS:        'membership_plans',
    MEMBERSHIPS:  'user_memberships',
    TRANSACTIONS: 'membership_transactions',
    LOGS:         'membership_logs',
    FEATURES:     'membership_features',
  });

  // ===========================================================================
  // PLAN DISPLAY CONFIG — DEPRECATED
  // Prices are now sourced from `membership_plans` DB via pass-sync.js.
  // This object is kept for backward compat only — priceLabel values are
  // emptied. Use window.PassSync.getPlans() for live plan data.
  // ===========================================================================
  const PLAN_UI = Object.freeze({
    trial_1day:  { label: '1 Day Trial',  priceLabel: '', savings: null, color: '#10d98e', icon: '⚡' },
    trial_15day: { label: '15 Day Trial', priceLabel: '', savings: null, color: '#f59e0b', icon: '🟢' },
    monthly:     { label: 'Monthly',      priceLabel: '', savings: null, color: '#930205', icon: '📅' },
    quarterly:   { label: 'Quarterly',    priceLabel: '', savings: 'Save 16%', color: '#8b5cf6', icon: '📆' },
    half_year:   { label: 'Half Year',    priceLabel: '', savings: 'Best Value', color: '#8b5cf6', icon: '👑' },
  });

  // ===========================================================================
  // DEFAULTS
  // ===========================================================================
  const DEFAULTS = Object.freeze({
    CURRENCY:           'INR',
    CURRENCY_SYMBOL:    '₹',
    GRACE_PERIOD_DAYS:  3,    // days after expiry before hard revocation
    CACHE_TTL_MS:       5 * 60 * 1000, // 5 minutes client-side membership cache
  });

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================
  return Object.freeze({
    PLANS,
    STATUS,
    FEATURES,
    EVENTS,
    PROVIDERS,
    TX_STATUS,
    TABLES,
    PLAN_UI,
    DEFAULTS,
    // Version for debugging
    VERSION: '4A.0.1',
    PHASE:   'phase-4a-foundation',
  });

}));
