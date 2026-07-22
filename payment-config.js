/**
 * ══════════════════════════════════════════════════════════════════════════
 * payment-config.js — Studyria Payment Foundation
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Centralised Razorpay configuration constants.
 *
 * SAFETY CONTRACT
 * ───────────────
 * • This file contains ONLY configuration data. No API calls. No DOM writes.
 * • Key_id is a PUBLIC key (safe to ship in frontend). Secret key must NEVER
 *   appear here — it lives exclusively on the server / Supabase Edge Function.
 * • No Premium Membership is activated by importing this file.
 * • No payment is processed by importing this file.
 *
 * @module payment-config
 */

'use strict';

// ── Razorpay SDK CDN (loaded on-demand, never pre-loaded globally) ──────────
export const RAZORPAY_SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js';

// ── Gateway identifiers ──────────────────────────────────────────────────────
/** Razorpay live key_id prefix (set at runtime from environment / admin config) */
export const RAZORPAY_KEY_PREFIX_LIVE = 'rzp_live_';

/** Razorpay test key_id prefix */
export const RAZORPAY_KEY_PREFIX_TEST = 'rzp_test_';

// ── Currency ─────────────────────────────────────────────────────────────────
/** ISO 4217 currency code used across all Studyria transactions */
export const DEFAULT_CURRENCY = 'INR';

/** Smallest unit multiplier for INR (paise per rupee) */
export const PAISE_PER_RUPEE = 100;

/** Minimum chargeable amount in paise (Razorpay min = ₹1 = 100 paise) */
export const MIN_AMOUNT_PAISE = 100;

/** Maximum single-order amount in paise (₹5,00,000 = Razorpay default limit) */
export const MAX_AMOUNT_PAISE = 50_000_000;

// ── Merchant display details (shown inside Razorpay checkout modal) ──────────
export const MERCHANT_NAME        = 'Studyria';
export const MERCHANT_DESCRIPTION = 'Premium Membership — Unlimited Handwritten Notes';
export const MERCHANT_LOGO_URL    = 'https://studyria.qzz.io/manifest.json'; // CDN icon

// ── Retry / timeout ──────────────────────────────────────────────────────────
/** How many times the SDK is allowed to auto-retry a failed network attempt */
export const RAZORPAY_RETRY_MAX = 2;

/** Timeout (ms) for order-creation fetch calls made from Edge Functions */
export const ORDER_FETCH_TIMEOUT_MS = 12_000;

// ── Membership plan catalogue (DEPRECATED — DO NOT USE FOR NEW CODE) ──────────
// FIX 6: This hardcoded plan catalogue is DEPRECATED. All plan data must come
//        from the database (membership_plans table) or site_config (pass_management_config).
//        Kept only for backward compatibility with code that may still import it.
//        New code MUST fetch prices from Supabase — never from these constants.
export const MEMBERSHIP_PLANS = Object.freeze([]); // DEPRECATED — All plan data comes from database (site_config/membership_plans). Never use hardcoded prices.

// ── Payment status values (mirrored from DB enum) ────────────────────────────
// Kept here so payment-service.js and callers share a single source.
export const PAYMENT_STATUS = Object.freeze({
  CREATED:   'created',    // Razorpay order created, awaiting user payment
  ATTEMPTED: 'attempted',  // User opened checkout but hasn't completed
  AUTHORIZED:'authorized', // Card authorised, pending capture
  CAPTURED:  'captured',   // Payment fully captured — use for membership grant
  FAILED:    'failed',     // Payment failed or declined
  REFUNDED:  'refunded',   // Full or partial refund issued
  CANCELLED: 'cancelled',  // Order cancelled before payment
});

// ── Webhook event names ───────────────────────────────────────────────────────
export const WEBHOOK_EVENTS = Object.freeze({
  ORDER_PAID:          'order.paid',
  PAYMENT_CAPTURED:    'payment.captured',
  PAYMENT_FAILED:      'payment.failed',
  REFUND_PROCESSED:    'refund.processed',
  SUBSCRIPTION_CHARGED:'subscription.charged',
});
