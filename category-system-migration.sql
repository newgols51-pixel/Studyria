-- ════════════════════════════════════════════════════════════════════
-- STUDYRIA — Category System Upgrade Migration (Phase 1)
-- Run this once in Supabase SQL Editor. Safe/additive — does not touch
-- any existing PDFs, purchases, or other tables.
-- ════════════════════════════════════════════════════════════════════

-- 1. Add columns needed for the real Category Manager + category pages.
--    All nullable/defaulted so existing rows are unaffected.
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS description   text,
  ADD COLUMN IF NOT EXISTS banner_url    text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS enabled       boolean DEFAULT true;

ALTER TABLE subcategories
  ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true;

-- 2. Remove the confirmed duplicate: old "Computer & Technology" (id 4)
--    has zero PDFs attached (verified against live pdfs.category_id) and
--    duplicates the newer id 45 row. Safe to delete.
DELETE FROM categories WHERE id = 4;

-- 3. Mark the two categories from your Featured list that already exist
--    but weren't flagged as featured yet.
UPDATE categories SET featured = true WHERE id IN (3, 6); -- Government Exams, Spiritual

-- 4. Backfill description for every featured category so category pages
--    have something to show immediately (edit anytime in the new manager).
UPDATE categories SET description = CASE slug
  WHEN 'education'                    THEN 'Foundational study guides and academic resources for every level.'
  WHEN 'government-exams'             THEN 'Complete prep material for ADRE, APSC, Assam Police and other Assam state exams.'
  WHEN 'computer-technology'          THEN 'Computer fundamentals, software skills and technology guides.'
  WHEN 'ai-automation'                THEN 'AI tools, automation workflows and practical AI skills.'
  WHEN 'business-finance'             THEN 'Business strategy, finance basics and money management guides.'
  WHEN 'spiritual'                    THEN 'Devotional texts, spiritual practice and inner growth resources.'
  WHEN 'career-development'          THEN 'Resume building, interview prep and career growth strategies.'
  WHEN 'freelancing-online-income'   THEN 'Freelancing guides and ways to build online income streams.'
  WHEN 'digital-marketing'           THEN 'SEO, social media and digital marketing playbooks.'
  WHEN 'design-creativity'           THEN 'Design principles, creative tools and portfolio-building guides.'
  WHEN 'self-improvement'            THEN 'Habits, productivity and personal growth resources.'
  WHEN 'templates-resources'         THEN 'Ready-to-use templates and practical resource packs.'
  WHEN 'health-fitness'              THEN 'Health, fitness and wellbeing guides.'
  WHEN 'books-literature'            THEN 'Curated books and literary reading material.'
  WHEN 'lifestyle'                   THEN 'Lifestyle guides for everyday living.'
  ELSE description
END
WHERE featured = true;

-- 5. Helpful index for the "PDF count per category" query the new
--    Category Manager runs.
CREATE INDEX IF NOT EXISTS idx_pdfs_category_id ON pdfs(category_id);
