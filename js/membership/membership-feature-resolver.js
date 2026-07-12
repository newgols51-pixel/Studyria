/**
 * =============================================================================
 * FILE: js/membership/membership-feature-resolver.js
 * PROJECT: Studyria Premium Membership — Phase 4C
 * PURPOSE: Resolve which features a user has access to based on their
 *          resolved membership status + plan features JSONB +
 *          global feature kill-switch registry.
 *          Zero network calls (uses data already fetched by service).
 *          Zero side effects. Zero writes.
 * BRANCH:  feat/premium-membership-phase-4c
 * SAFE:    Pure functions only.
 * =============================================================================
 *
 * USAGE:
 *   const fr = window.StudyriaMembershipFeatureResolver;
 *
 *   // From a resolved status object (output of StatusResolver.resolve()):
 *   fr.hasFeature(resolvedStatus, 'offline_downloads');  // → boolean
 *   fr.getGrantedFeatures(resolvedStatus);               // → string[]
 *   fr.getFeatureMap(resolvedStatus, featureRegistry);   // → Map<key, boolean>
 *
 * =============================================================================
 */

'use strict';

(function (root) {
  if (root.StudyriaMembershipFeatureResolver) return;

  // ── Dependency accessors ─────────────────────────────────────────────────
  const _cfg = () => root.STUDYRIA_MEMBERSHIP;

  // ── Feature access tiers ─────────────────────────────────────────────────
  // All features available to FREE users (regardless of membership)
  const FREE_FEATURES = Object.freeze(new Set([
    // None currently — all premium features require active membership
  ]));

  // Features that remain accessible during the GRACE period
  const GRACE_FEATURES = Object.freeze(new Set([
    'ad_free',            // stays on during grace (good UX)
    'premium_badge',      // stays on during grace
    'mcq_unlimited',      // stays on during grace
    'offline_downloads',  // stays on (already downloaded content)
    'analytics',          // stays on during grace
    'early_access',       // stays on during grace
    'priority_support',   // stays on during grace
    'reading_room',       // stays on during grace
    'ai_summary',         // stays on during grace
    'creator_access',     // stays on during grace
  ]));

  // ── Core: check single feature ─────────────────────────────────────────────

  /**
   * Resolve whether a user has access to a specific feature.
   *
   * Resolution order:
   *   1. FREE_FEATURES set — always granted regardless of membership
   *   2. resolved.isPremium must be true (ACTIVE or GRACE state)
   *   3. For GRACE state: feature must be in GRACE_FEATURES set
   *   4. plan.features[featureKey] must be === true
   *   5. featureRegistry kill-switch: feature must not be globally disabled
   *
   * @param {object}         resolvedStatus  — output of StatusResolver.resolve()
   * @param {string}         featureKey      — e.g. 'offline_downloads'
   * @param {object[]|null}  [featureRegistry] — rows from membership_features table
   * @returns {boolean}
   */
  function hasFeature(resolvedStatus, featureKey, featureRegistry) {
    if (!featureKey || typeof featureKey !== 'string') return false;

    // Step 1: FREE_FEATURES — always granted
    if (FREE_FEATURES.has(featureKey)) return true;

    // Step 2: Must be premium (ACTIVE or GRACE)
    if (!resolvedStatus?.isPremium) return false;

    // Step 3: GRACE state — only GRACE_FEATURES are accessible
    if (resolvedStatus.state === 'GRACE' && !GRACE_FEATURES.has(featureKey)) {
      return false;
    }

    // Step 4: Plan features JSONB must include this key as true
    const planFeatures = resolvedStatus.planFeatures || {};
    if (planFeatures[featureKey] !== true) return false;

    // Step 5: Global kill-switch check (if registry provided)
    if (featureRegistry && Array.isArray(featureRegistry)) {
      const entry = featureRegistry.find(f => f.feature_key === featureKey);
      if (entry && entry.enabled === false) return false;
    }

    return true;
  }

  /**
   * Get all feature keys granted to the user.
   *
   * @param {object}        resolvedStatus
   * @param {object[]|null} [featureRegistry]
   * @returns {string[]} array of granted feature keys
   */
  function getGrantedFeatures(resolvedStatus, featureRegistry) {
    const cfg = _cfg();
    const allKeys = cfg
      ? Object.values(cfg.FEATURES)
      : Object.keys(resolvedStatus?.planFeatures || {});

    return allKeys.filter(key => hasFeature(resolvedStatus, key, featureRegistry));
  }

  /**
   * Get a complete feature map: all known features → access boolean.
   * Useful for dashboard / settings display.
   *
   * @param {object}        resolvedStatus
   * @param {object[]|null} [featureRegistry]
   * @returns {Object.<string, boolean>}
   */
  function getFeatureMap(resolvedStatus, featureRegistry) {
    const cfg = _cfg();
    const allKeys = cfg
      ? Object.values(cfg.FEATURES)
      : Object.keys(resolvedStatus?.planFeatures || {});

    const map = {};
    for (const key of allKeys) {
      map[key] = hasFeature(resolvedStatus, key, featureRegistry);
    }
    return Object.freeze(map);
  }

  /**
   * Get denied features (user's plan includes them but access is blocked).
   * Blocked by: wrong tier (GRACE), kill-switch, or plan doesn't include them.
   *
   * @param {object}        resolvedStatus
   * @param {object[]|null} [featureRegistry]
   * @returns {string[]}
   */
  function getDeniedFeatures(resolvedStatus, featureRegistry) {
    const planFeatures = resolvedStatus?.planFeatures || {};
    const planKeys = Object.keys(planFeatures).filter(k => planFeatures[k] === true);
    return planKeys.filter(key => !hasFeature(resolvedStatus, key, featureRegistry));
  }

  /**
   * Compare two feature maps to find what changed.
   * Returns { gained: string[], lost: string[] }
   *
   * @param {Object.<string,boolean>} prev
   * @param {Object.<string,boolean>} next
   * @returns {{ gained: string[], lost: string[] }}
   */
  function diffFeatureMaps(prev, next) {
    const prevMap = prev || {};
    const nextMap = next || {};
    const allKeys = new Set([...Object.keys(prevMap), ...Object.keys(nextMap)]);
    const gained = [];
    const lost   = [];
    for (const key of allKeys) {
      if (!prevMap[key] && nextMap[key]) gained.push(key);
      if  (prevMap[key] && !nextMap[key]) lost.push(key);
    }
    return { gained, lost };
  }

  /**
   * Get the upgrade plan suggestion for a denied feature.
   * Returns the minimum plan slug that includes this feature.
   * Read-only: uses the plan configs provided, no network call.
   *
   * @param {string}    featureKey
   * @param {object[]}  plans — rows from membership_plans (all active plans)
   * @returns {string|null} plan slug or null if no plan provides it
   */
  function getMinPlanForFeature(featureKey, plans) {
    if (!plans?.length || !featureKey) return null;
    const sorted = [...plans].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const match = sorted.find(p => p.features?.[featureKey] === true);
    return match?.slug ?? null;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  root.StudyriaMembershipFeatureResolver = Object.freeze({
    hasFeature,
    getGrantedFeatures,
    getFeatureMap,
    getDeniedFeatures,
    diffFeatureMaps,
    getMinPlanForFeature,
    FREE_FEATURES:  Array.from(FREE_FEATURES),
    GRACE_FEATURES: Array.from(GRACE_FEATURES),
  });

  console.debug('[MembershipFeatureResolver] Registered — Phase 4C');

}(typeof self !== 'undefined' ? self : this));
