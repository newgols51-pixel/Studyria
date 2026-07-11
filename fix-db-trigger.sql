-- ════════════════════════════════════════════════════════════════════════════
-- STUDYRIA — PERMANENT FIX: "function lower(bigint) does not exist"
-- 
-- PASTE THIS ENTIRE SCRIPT INTO:
-- Supabase Dashboard → Project → SQL Editor → New Query → Paste → Run
--
-- Takes < 5 seconds to execute. Fixes PDF publishing permanently.
-- ════════════════════════════════════════════════════════════════════════════

-- ── STEP 1: See which trigger(s) are broken ──────────────────────────────
-- (Informational — shows trigger names and their source code)
SELECT
  t.trigger_name,
  t.event_manipulation AS event,
  p.proname            AS function_name,
  LEFT(p.prosrc, 300)  AS function_source_preview
FROM information_schema.triggers t
JOIN pg_catalog.pg_trigger pt ON pt.tgname = t.trigger_name
JOIN pg_catalog.pg_proc    p  ON p.oid     = pt.tgfoid
WHERE t.event_object_table = 'pdfs'
  AND t.trigger_schema     = 'public'
ORDER BY t.trigger_name;

-- ── STEP 2: Create a type-safe slug helper ───────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_pdf_slug(title text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_slug text;
BEGIN
  v_slug := LOWER(TRIM(COALESCE(title, '')));                     -- TEXT ✅
  v_slug := REGEXP_REPLACE(v_slug, '[^a-z0-9\s-]', '', 'g');
  v_slug := REGEXP_REPLACE(v_slug, '\s+', '-', 'g');
  v_slug := REGEXP_REPLACE(v_slug, '-+', '-', 'g');
  v_slug := TRIM(BOTH '-' FROM v_slug);
  RETURN LEFT(v_slug, 80);
END;
$$;

-- ── STEP 3: Create the corrected trigger function ────────────────────────
-- KEY RULES applied here:
--   ✅ LOWER() called ONLY on TEXT columns (title, category, slug, status)
--   🚫 NEVER call LOWER() on: academic_level, stream, semester_class,
--      subject, subcategory, *_id — these are BIGINT columns
CREATE OR REPLACE FUNCTION public.pdf_before_insert_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Slug: derive from TEXT column `title` only
  IF NEW.slug IS NULL OR TRIM(NEW.slug) = '' THEN
    NEW.slug := public.generate_pdf_slug(NEW.title::text);
  END IF;

  -- Category: default if blank (TEXT column only)
  IF NEW.category IS NULL OR TRIM(NEW.category) = '' THEN
    NEW.category := 'Education';
  END IF;

  -- Title: trim whitespace (TEXT column only)
  IF NEW.title IS NOT NULL THEN
    NEW.title := TRIM(NEW.title);
  END IF;

  -- Status: default (TEXT column only)
  IF NEW.status IS NULL OR TRIM(NEW.status) = '' THEN
    NEW.status := 'draft';
  END IF;

  -- Timestamps
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, NOW());
  END IF;
  NEW.updated_at := NOW();

  -- !! NEVER call LOWER/TRIM on bigint columns:
  --    NEW.academic_level, NEW.stream, NEW.semester_class,
  --    NEW.subject, NEW.subcategory, any *_id column
  RETURN NEW;
END;
$$;

-- ── STEP 4: Drop all existing triggers on pdfs (they may be broken) ──────
DROP TRIGGER IF EXISTS pdf_before_insert_update_trigger  ON public.pdfs;
DROP TRIGGER IF EXISTS trg_pdf_before_insert             ON public.pdfs;
DROP TRIGGER IF EXISTS trg_pdf_before_update             ON public.pdfs;
DROP TRIGGER IF EXISTS pdfs_before_insert                ON public.pdfs;
DROP TRIGGER IF EXISTS pdfs_normalize                    ON public.pdfs;
DROP TRIGGER IF EXISTS pdf_normalize_trigger             ON public.pdfs;
DROP TRIGGER IF EXISTS set_pdf_slug                      ON public.pdfs;
DROP TRIGGER IF EXISTS pdf_set_slug                      ON public.pdfs;
DROP TRIGGER IF EXISTS normalize_pdf_trigger             ON public.pdfs;
DROP TRIGGER IF EXISTS before_insert_pdf                 ON public.pdfs;
DROP TRIGGER IF EXISTS pdf_insert_trigger                ON public.pdfs;
DROP TRIGGER IF EXISTS pdf_upsert_trigger                ON public.pdfs;
DROP TRIGGER IF EXISTS generate_slug_trigger             ON public.pdfs;

-- ── STEP 5: Re-create the trigger with the safe function ─────────────────
CREATE TRIGGER pdf_before_insert_update_trigger
  BEFORE INSERT OR UPDATE ON public.pdfs
  FOR EACH ROW
  EXECUTE FUNCTION public.pdf_before_insert_update();

-- ── STEP 6: Verify the fix ───────────────────────────────────────────────
DO $$
DECLARE
  v_id uuid;
BEGIN
  -- Test A: minimal insert (all optional fields null)
  INSERT INTO public.pdfs (title, category, category_id, status, free, price)
  VALUES ('__TRIGGER_FIX_TEST_A__', 'Education', 3, 'draft', true, 0)
  RETURNING id INTO v_id;
  DELETE FROM public.pdfs WHERE id = v_id;
  RAISE NOTICE '✅ TEST A PASSED: minimal insert with null academic fields';

  -- Test B: insert with bigint academic fields populated
  INSERT INTO public.pdfs (
    title, category, category_id, status, free, price,
    academic_level, stream, semester_class, subject, subcategory,
    academic_level_id, stream_id, semester_class_id, subject_id, subcategory_id
  ) VALUES (
    '__TRIGGER_FIX_TEST_B__', 'Government Exams', 3, 'draft', false, 99,
    1, 2, 3, 4, 5,
    1, 2, 3, 4, 5
  )
  RETURNING id INTO v_id;
  DELETE FROM public.pdfs WHERE id = v_id;
  RAISE NOTICE '✅ TEST B PASSED: insert with bigint academic fields';

  RAISE NOTICE '🎉 ALL TESTS PASSED — Publishing is now fixed!';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '❌ TEST FAILED: %', SQLERRM;
END;
$$;
