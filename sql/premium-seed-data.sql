-- =============================================================================
-- FILE: sql/premium-seed-data.sql
-- PROJECT: Studyria Premium Membership — Phase 4A (Foundation)
-- PURPOSE: Seed default plans and feature registry
-- STATUS: GENERATED ONLY — DO NOT EXECUTE — Awaiting Phase 4B review
-- NOTE: Run LAST, after all table/index/RLS SQL files.
-- SAFE: Uses INSERT ... ON CONFLICT DO NOTHING — idempotent.
-- =============================================================================

-- =============================================================================
-- SEED: membership_features
-- Canonical registry of all features used in Studyria Premium.
-- feature_key MUST match keys used in membership_plans.features JSONB.
-- =============================================================================

INSERT INTO public.membership_features
    (feature_key,         feature_name,               description,                                                        enabled)
VALUES
    ('ad_free',           'Ad-Free Experience',        'Remove all promotional banners and interstitials',                 TRUE),
    ('offline_downloads', 'Offline Downloads',          'Download PDFs for offline reading in the app',                    TRUE),
    ('mcq_unlimited',     'Unlimited MCQ Practice',     'Access all MCQ practice sets without daily limits',               TRUE),
    ('priority_support',  'Priority Support',           'Dedicated support queue with faster response times',              TRUE),
    ('early_access',      'Early Access',               'Get new PDFs and features before public release',                 TRUE),
    ('premium_badge',     'Premium Badge',              'Verified Premium member badge on profile',                        TRUE),
    ('reading_room',      'Full Reading Room Access',   'Unlock all content in the Reading Room (currently free preview)', FALSE),
    ('creator_access',    'Creator Program Access',     'Access to the PDF Creator Program dashboard',                     FALSE),
    ('ai_summary',        'AI Summaries',               'AI-generated chapter summaries for PDFs (future feature)',        FALSE),
    ('analytics',         'Study Analytics',            'Personal study time tracking and progress analytics',             FALSE)
ON CONFLICT (feature_key) DO NOTHING;


-- =============================================================================
-- SEED: membership_plans
-- Three-tier model: Monthly / Quarterly / Yearly
-- Prices in paise (INR): 1 rupee = 100 paise
-- =============================================================================

INSERT INTO public.membership_plans
    (slug,         name,                   description,
     duration_days, price,   currency, badge,         sort_order,
     features,
     active)
VALUES

-- ── MONTHLY ─────────────────────────────────────────────────────────────────
(
    'monthly',
    'Monthly Premium',
    'Full premium access for 30 days. Best for short-term exam sprints.',
    30,
    9900,   -- Rs.99/month
    'INR',
    'Starter',
    1,
    jsonb_build_object(
        'ad_free',           true,
        'offline_downloads', true,
        'mcq_unlimited',     true,
        'priority_support',  false,
        'early_access',      false,
        'premium_badge',     true,
        'reading_room',      false,
        'creator_access',    false,
        'ai_summary',        false,
        'analytics',         false
    ),
    TRUE
),

-- ── QUARTERLY ───────────────────────────────────────────────────────────────
(
    'quarterly',
    'Quarterly Premium',
    'Premium access for 90 days. Ideal for semester-long exam preparation.',
    90,
    24900,  -- Rs.249/quarter (~Rs.83/mo, save 16%)
    'INR',
    'Popular',
    2,
    jsonb_build_object(
        'ad_free',           true,
        'offline_downloads', true,
        'mcq_unlimited',     true,
        'priority_support',  true,
        'early_access',      true,
        'premium_badge',     true,
        'reading_room',      false,
        'creator_access',    false,
        'ai_summary',        false,
        'analytics',         true
    ),
    TRUE
),

-- ── YEARLY ──────────────────────────────────────────────────────────────────
(
    'yearly',
    'Yearly Premium',
    'Full premium access for 365 days. Best value for serious APSC/ADRE aspirants.',
    365,
    79900,  -- Rs.799/year (~Rs.67/mo, save 32%)
    'INR',
    'Best Value',
    3,
    jsonb_build_object(
        'ad_free',           true,
        'offline_downloads', true,
        'mcq_unlimited',     true,
        'priority_support',  true,
        'early_access',      true,
        'premium_badge',     true,
        'reading_room',      true,
        'creator_access',    false,
        'ai_summary',        true,
        'analytics',         true
    ),
    TRUE
)

ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- VERIFICATION QUERIES (run manually to confirm seed data)
-- Uncomment to verify after execution:
-- =============================================================================
-- SELECT slug, name, price, badge, active FROM public.membership_plans ORDER BY sort_order;
-- SELECT feature_key, feature_name, enabled FROM public.membership_features ORDER BY feature_key;
