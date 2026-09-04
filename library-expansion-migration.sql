-- ════════════════════════════════════════════════════════════════════
-- STUDYRIA — Library Expansion Schema Migration
-- Run this in Supabase SQL Editor. 100% ADDITIVE.
-- Does NOT touch existing PDFs, purchases, users, or any existing data.
-- ════════════════════════════════════════════════════════════════════

-- 1. Add new metadata columns to pdfs table (all nullable, all safe)
ALTER TABLE public.pdfs
  ADD COLUMN IF NOT EXISTS material_type        text DEFAULT 'study_notes',
  ADD COLUMN IF NOT EXISTS language             text DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS difficulty           text DEFAULT 'intermediate',
  ADD COLUMN IF NOT EXISTS target_audience      text,
  ADD COLUMN IF NOT EXISTS page_count           integer,
  ADD COLUMN IF NOT EXISTS file_size            text,
  ADD COLUMN IF NOT EXISTS content_source_type  text DEFAULT 'original',
  ADD COLUMN IF NOT EXISTS source_url           text,
  ADD COLUMN IF NOT EXISTS source_name          text,
  ADD COLUMN IF NOT EXISTS license_or_rights    text DEFAULT 'studyria_original',
  ADD COLUMN IF NOT EXISTS verification_status  text DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS last_verified_at     timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS version              text DEFAULT '1.0',
  ADD COLUMN IF NOT EXISTS valid_from            timestamptz,
  ADD COLUMN IF NOT EXISTS valid_until          timestamptz,
  ADD COLUMN IF NOT EXISTS edition              text,
  ADD COLUMN IF NOT EXISTS exam_tags            text,
  ADD COLUMN IF NOT EXISTS subject_tags         text,
  ADD COLUMN IF NOT EXISTS topic_tags           text,
  ADD COLUMN IF NOT EXISTS is_recurring         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_period    text,
  ADD COLUMN IF NOT EXISTS superseded_by        uuid;

-- 2. Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_pdfs_material_type   ON pdfs(material_type);
CREATE INDEX IF NOT EXISTS idx_pdfs_language        ON pdfs(language);
CREATE INDEX IF NOT EXISTS idx_pdfs_exam_tags       ON pdfs(exam_tags);
CREATE INDEX IF NOT EXISTS idx_pdfs_subject_tags    ON pdfs(subject_tags);
CREATE INDEX IF NOT EXISTS idx_pdfs_verification    ON pdfs(verification_status);

-- 3. Insert new Assam-focused categories (skip if slug exists)
INSERT INTO public.categories (name, slug, description, enabled, featured, sort_order)
SELECT * FROM (VALUES
  ('ADRE',           'adre',            'Assam Direct Recruitment Exam prep',      true, true, 1),
  ('APSC',           'apsc',            'Assam Public Service Commission exams',   true, true, 2),
  ('Assam Police',   'assam-police',    'SLPRB Assam Police recruitment',           true, true, 3),
  ('Assam TET',     'assam-tet',        'Teacher Eligibility Test — Assam',        true, true, 4),
  ('Current Affairs','current-affairs', 'Assam & national current affairs',       true, true, 5),
  ('Assam GK',      'assam-gk',         'Assam GK — history, geography, polity',   true, true, 6),
  ('Scholarship',    'scholarship',      'Scholarship guides for students',         true, false, 7),
  ('Admission',     'admission',        'Admission guides for Assam colleges',     true, false, 8),
  ('Student Schemes','student-schemes', 'Govt schemes for Assam students',         true, false, 9),
  ('Career Prep',   'career-prep',      'Career prep & employability skills',       true, false, 10),
  ('Digital Skills','digital-skills',  'Computer & digital employability skills', true, false, 11)
) AS v(name, slug, description, enabled, featured, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE slug = v.slug);

-- 4. Insert subcategories linked to new categories
INSERT INTO public.subcategories (name, slug, category_id, enabled)
SELECT v.name, v.slug, c.id, v.enabled
FROM (VALUES
  ('Paper I',        'adre-paper-i',       'adre',        true),
  ('Paper II',       'adre-paper-ii',      'adre',        true),
  ('Paper III',      'adre-paper-iii',     'adre',        true),
  ('Paper IV',       'adre-paper-iv',      'adre',        true),
  ('Paper V',        'adre-paper-v',       'adre',        true),
  ('Revision Notes', 'adre-revision',      'adre',        true),
  ('MCQ Practice',   'adre-mcq',           'adre',        true),
  ('Formula Sheets', 'adre-formula',       'adre',        true),
  ('Exam Strategy',  'adre-strategy',      'adre',        true),
  ('Model Papers',   'adre-model',         'adre',        true),
  ('Prelims',        'apsc-prelims',       'apsc',        true),
  ('Mains',          'apsc-mains',         'apsc',        true),
  ('Interview',      'apsc-interview',     'apsc',        true),
  ('Constable',      'police-constable',   'assam-police',true),
  ('Sub-Inspector', 'police-si',          'assam-police',true),
  ('Assam History',  'gk-history',         'assam-gk',    true),
  ('Assam Geography','gk-geography',      'assam-gk',    true),
  ('Assam Polity',   'gk-polity',         'assam-gk',    true),
  ('Assam Economy',  'gk-economy',        'assam-gk',    true),
  ('Assam Culture',  'gk-culture',        'assam-gk',    true),
  ('Daily CA',       'ca-daily',          'current-affairs', true),
  ('Weekly CA',      'ca-weekly',         'current-affairs', true),
  ('Monthly CA',     'ca-monthly',        'current-affairs', true)
) AS v(name, slug, cat_slug, enabled)
JOIN public.categories c ON c.slug = v.cat_slug
WHERE NOT EXISTS (
  SELECT 1 FROM public.subcategories s WHERE s.slug = v.slug AND s.category_id = c.id
);
