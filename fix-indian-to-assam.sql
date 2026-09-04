-- ══════════════════════════════════════════════════════════════════
-- Studyria copy fix — "Indian students" → "Assam students"
-- Run once in Supabase → SQL Editor. Safe to re-run (idempotent).
--
-- Scope: ONLY the PDF marketing boilerplate phrase
--   "Best study material for Indian students on Studyria."
-- It deliberately does NOT touch jobs descriptions — those contain
-- legitimate organization names (Indian Army, Indian Oil Corporation,
-- ISRO, IIT) that must never be rewritten.
--
-- Expected result (verified 2026-09-04): 5 description rows + 8
-- seo_description rows updated in the pdfs table.
-- ══════════════════════════════════════════════════════════════════

UPDATE pdfs
SET    description = replace(description, 'for Indian students', 'for Assam students')
WHERE  description ILIKE '%for Indian students%';

UPDATE pdfs
SET    seo_description = replace(seo_description, 'for Indian students', 'for Assam students')
WHERE  seo_description ILIKE '%for Indian students%';

-- Post-check (should return 0 rows after the fix):
SELECT id, description, seo_description
FROM   pdfs
WHERE  description ILIKE '%for Indian students%'
   OR  seo_description ILIKE '%for Indian students%';
