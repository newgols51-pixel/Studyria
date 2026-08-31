-- ══════════════════════════════════════════════════════════════════════════
-- AI HANDWRITTEN NOTES STUDIO — Database Migration
-- ══════════════════════════════════════════════════════════════════════════
-- Run this in Supabase → SQL Editor
-- Safe to run multiple times (IF NOT EXISTS on all objects)
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Create ai_note_jobs table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_note_jobs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    original_filename   text NOT NULL,
    page_count          integer NOT NULL,
    free_pages          integer NOT NULL DEFAULT 5,
    paid_pages          integer NOT NULL DEFAULT 0,
    amount              numeric(10,2) NOT NULL DEFAULT 0,
    currency            text NOT NULL DEFAULT 'INR',
    status              text NOT NULL DEFAULT 'UPLOADED',
    payment_order_id    text,
    payment_id          text,
    payment_verified    timestamptz,
    conversion_mode     text NOT NULL DEFAULT 'premium',
    language            text NOT NULL DEFAULT 'auto',
    source_storage_path text,
    output_path         text,
    output_filename     text,
    source_pages_mapping jsonb,
    quality_checked     boolean DEFAULT false,
    cleanup_at          timestamptz,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now(),
    completed_at        timestamptz,
    expires_at          timestamptz,
    error_code          text,
    error_message_safe  text
);

-- ── 2. Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ai_note_jobs_user_id ON public.ai_note_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_note_jobs_status ON public.ai_note_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ai_note_jobs_payment_id ON public.ai_note_jobs(payment_id);
CREATE INDEX IF NOT EXISTS idx_ai_note_jobs_expires_at ON public.ai_note_jobs(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_note_jobs_cleanup_at ON public.ai_note_jobs(cleanup_at);

-- ── 3. Row Level Security ──────────────────────────────────────────────────
ALTER TABLE public.ai_note_jobs ENABLE ROW LEVEL SECURITY;

-- Users can SELECT only their own jobs
DROP POLICY IF EXISTS "Users select own AI note jobs" ON public.ai_note_jobs;
CREATE POLICY "Users select own AI note jobs" ON public.ai_note_jobs
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- Users can INSERT their own jobs
DROP POLICY IF EXISTS "Users insert own AI note jobs" ON public.ai_note_jobs;
CREATE POLICY "Users insert own AI note jobs" ON public.ai_note_jobs
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Users can UPDATE their own jobs (for status polling display)
-- NOTE: Payment verification should be done server-side via Edge Function.
-- This UPDATE policy allows the frontend to update job fields but the
-- status transitions are enforced by application logic.
DROP POLICY IF EXISTS "Users update own AI note jobs" ON public.ai_note_jobs;
CREATE POLICY "Users update own AI note jobs" ON public.ai_note_jobs
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Users can DELETE their own jobs
DROP POLICY IF EXISTS "Users delete own AI note jobs" ON public.ai_note_jobs;
CREATE POLICY "Users delete own AI note jobs" ON public.ai_note_jobs
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- Admin (service role bypasses RLS) can see all jobs

-- ── 4. Storage bucket for temp files ───────────────────────────────────────
-- Create this in Supabase → Storage → New Bucket:
--   Name: ai-notes-temp
--   Public: false (private)
--   File size limit: 50MB
--   Allowed MIME types: application/pdf
--
-- Storage RLS policies for ai-notes-temp:
-- INSERT: auth.uid() = owner (user uploads their own file)
-- SELECT: auth.uid() = owner (user downloads their own output)
-- DELETE: service_role only (cleanup worker)

-- Storage policies (run in SQL Editor):
INSERT INTO storage.buckets (id, name, public) 
VALUES ('ai-notes-temp', 'ai-notes-temp', false)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to ai-notes-temp
DROP POLICY IF EXISTS "Users upload to ai-notes-temp" ON storage.objects;
CREATE POLICY "Users upload to ai-notes-temp" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'ai-notes-temp');

-- Allow users to read their own files from ai-notes-temp
DROP POLICY IF EXISTS "Users read own ai-notes-temp files" ON storage.objects;
CREATE POLICY "Users read own ai-notes-temp files" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'ai-notes-temp' AND auth.uid() = owner);

-- Allow users to delete their own files (for client-side cleanup)
DROP POLICY IF EXISTS "Users delete own ai-notes-temp files" ON storage.objects;
CREATE POLICY "Users delete own ai-notes-temp files" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'ai-notes-temp' AND auth.uid() = owner);

-- ── 5. Updated_at trigger ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_ai_note_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_note_jobs_updated ON public.ai_note_jobs;
CREATE TRIGGER trg_ai_note_jobs_updated
    BEFORE UPDATE ON public.ai_note_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_ai_note_jobs_updated_at();

-- ── 6. Auto-cleanup function (call via scheduled job or Edge Function) ─────
CREATE OR REPLACE FUNCTION public.cleanup_expired_ai_note_jobs()
RETURNS TABLE (cleaned_count integer) AS $$
DECLARE
    job_record RECORD;
    count_cleaned integer := 0;
BEGIN
    -- Find expired jobs
    FOR job_record IN 
        SELECT id, source_storage_path, output_path 
        FROM public.ai_note_jobs 
        WHERE expires_at < now() 
          AND status NOT IN ('CLEANED', 'EXPIRED')
    LOOP
        -- Delete source file from storage
        IF job_record.source_storage_path IS NOT NULL THEN
            PERFORM lo_unlink(job_record.source_storage_path::oid);
        END IF;
        
        -- Delete output file from storage
        IF job_record.output_path IS NOT NULL THEN
            PERFORM lo_unlink(job_record.output_path::oid);
        END IF;
        
        -- Mark as cleaned
        UPDATE public.ai_note_jobs 
        SET status = 'CLEANED', 
            cleanup_at = now(),
            source_storage_path = NULL,
            output_path = NULL
        WHERE id = job_record.id;
        
        count_cleaned := count_cleaned + 1;
    END LOOP;
    
    RETURN QUERY SELECT count_cleaned;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════════════════════════════════════════════
-- NOTES:
-- 1. Payment verification requires a Supabase Edge Function that:
--    a. Creates Razorpay order server-side (amount from DB page count)
--    b. Verifies payment signature after checkout
--    c. Updates job status to PAYMENT_VERIFIED
-- 2. AI processing requires a backend function that:
--    a. Downloads uploaded PDF from Supabase storage
--    b. Extracts text (pdf.js / OCR if needed)
--    c. Structures content via LLM API
--    d. Generates handwritten-style PDF
--    e. Uploads output to Supabase storage
--    f. Deletes source PDF
--    g. Updates job status to COMPLETED
-- 3. Cleanup runs via Supabase scheduled function or external cron
-- ══════════════════════════════════════════════════════════════════════════
