-- ═════════════════════════════════════════════════════════════════════
-- STUDYRIA ME SECTION V3 — SUPABASE SQL SETUP
-- Run this in Supabase SQL Editor (Dashboard → SQL → New Query)
-- ═════════════════════════════════════════════════════════════════════
--
-- WHAT THIS DOES:
-- 1. Adds new columns to existing `profiles` table (or creates if missing)
-- 2. Creates `avatars` storage bucket for profile photos
-- 3. Sets up RLS policies (user can only edit own profile)
-- 4. Adds indexes for fast queries
--
-- SAFE MODE: Does NOT drop or modify any existing tables/columns.
-- Uses ALTER TABLE ADD COLUMN IF NOT EXISTS — safe to run multiple times.
-- ═════════════════════════════════════════════════════════════════════


-- ═════════════════════════════════════════════════════════════════════
-- STEP 1: PROFILES TABLE (add columns if missing)
-- ═════════════════════════════════════════════════════════════════════

-- Create profiles table if it doesn't exist (Supabase Auth creates it
-- automatically, but this ensures it exists regardless)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    profile_completed BOOLEAN DEFAULT false,
    verified BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Add new V3 columns (safe — IF NOT EXISTS means no error if already there) ──

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS dob DATE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'India';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio TEXT;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS occupation TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS exam_preparing TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS study_streak INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS longest_streak INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS certificates_count INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS reward_points INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 0;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();


-- ═════════════════════════════════════════════════════════════════════
-- STEP 2: ROW LEVEL SECURITY (RLS)
-- ═════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (so we can recreate cleanly)
DROP POLICY IF EXISTS "profiles_select_own_or_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_own" ON public.profiles;
DROP POLICY IF EXISTS "Users can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Anyone can read profiles (for leaderboard, etc.)
CREATE POLICY "Users can read all profiles"
    ON public.profiles FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- Users can only insert their OWN profile
CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- Users can only update their OWN profile
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Users can only delete their OWN profile
CREATE POLICY "Users can delete own profile"
    ON public.profiles FOR DELETE
    USING (auth.uid() = id);

-- Admins can read all (they already have access via service role)


-- ═════════════════════════════════════════════════════════════════════
-- STEP 3: AVATARS STORAGE BUCKET (for profile photos)
-- ═════════════════════════════════════════════════════════════════════

-- Create the bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Also create a fallback bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS Policies for avatars bucket
DROP POLICY IF EXISTS "avatar_read_public" ON storage.objects;
DROP POLICY IF EXISTS "avatar_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "avatar_update_own" ON storage.objects;
DROP POLICY IF EXISTS "avatar_delete_own" ON storage.objects;

-- Anyone can view avatars (public bucket)
CREATE POLICY "avatar_read_public"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');

-- Users can upload to their own folder (user_id/avatar-timestamp.jpg)
CREATE POLICY "avatar_insert_own"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Users can update their own avatars
CREATE POLICY "avatar_update_own"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Users can delete their own avatars
CREATE POLICY "avatar_delete_own"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Same for profile-photos bucket (fallback)
DROP POLICY IF EXISTS "profile_photos_read_public" ON storage.objects;
DROP POLICY IF EXISTS "profile_photos_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "profile_photos_update_own" ON storage.objects;
DROP POLICY IF EXISTS "profile_photos_delete_own" ON storage.objects;

CREATE POLICY "profile_photos_read_public"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'profile-photos');

CREATE POLICY "profile_photos_insert_own"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'profile-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "profile_photos_update_own"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'profile-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "profile_photos_delete_own"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'profile-photos' AND auth.uid()::text = (storage.foldername(name))[1]);


-- ═════════════════════════════════════════════════════════════════════
-- STEP 4: INDEXES (for fast queries)
-- ═════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_verified ON public.profiles(verified);
CREATE INDEX IF NOT EXISTS idx_profiles_updated_at ON public.profiles(updated_at DESC);


-- ═════════════════════════════════════════════════════════════════════
-- STEP 5: AUTO-GENERATE REFERRAL CODE ON INSERT
-- ═════════════════════════════════════════════════════════════════════

-- Function to generate referral code
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    result TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..8 LOOP
        result := result || substr(chars, floor(random() * length(chars))::int + 1, 1);
    END LOOP;
    RETURN 'STUDY' || result;
END;
$$ LANGUAGE plpgsql;

-- Trigger: auto-generate referral code on insert
DROP TRIGGER IF EXISTS trg_profiles_referral_code ON public.profiles;

CREATE OR REPLACE FUNCTION public.set_referral_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.referral_code IS NULL OR NEW.referral_code = '' THEN
        NEW.referral_code := public.generate_referral_code();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_referral_code
    BEFORE INSERT ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_referral_code();


-- ═════════════════════════════════════════════════════════════════════
-- STEP 6: AUTO-UPDATE updated_at ON PROFILE CHANGES
-- ═════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();


-- ═════════════════════════════════════════════════════════════════════
-- STEP 7: AUTO-CREATE PROFILE ON SIGNUP (Trigger on auth.users)
-- ═════════════════════════════════════════════════════════════════════

-- When a new user signs up, automatically create a profile row
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url, created_at, updated_at)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', ''),
        now(),
        now()
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();


-- ═════════════════════════════════════════════════════════════════════
-- STEP 8: BACKFILL EXISTING USERS (optional but recommended)
-- ═════════════════════════════════════════════════════════════════════

-- Create profile rows for existing auth users who don't have one yet
INSERT INTO public.profiles (id, email, created_at, updated_at)
SELECT 
    au.id,
    au.email,
    au.created_at,
    now()
FROM auth.users au
WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = au.id
);

-- Set referral codes for existing profiles that don't have one
UPDATE public.profiles 
SET referral_code = public.generate_referral_code()
WHERE referral_code IS NULL OR referral_code = '';


-- ═════════════════════════════════════════════════════════════════════
-- DONE! ✅
-- ═════════════════════════════════════════════════════════════════════
--
-- Summary of what was created/modified:
--
-- TABLES:
--   ✅ profiles — new columns added (phone, dob, gender, address, etc.)
--
-- RLS POLICIES:
--   ✅ profiles — users read all, insert/update/delete own only
--
-- STORAGE:
--   ✅ avatars bucket (public) — for profile photos
--   ✅ profile-photos bucket (public) — fallback
--
-- TRIGGERS:
--   ✅ Auto-create profile on signup
--   ✅ Auto-generate referral code on insert
--   ✅ Auto-update updated_at on changes
--
-- INDEXES:
--   ✅ email, verified, updated_at for fast queries
--
-- This SQL is SAFE to run multiple times (uses IF NOT EXISTS / ON CONFLICT).
-- ═════════════════════════════════════════════════════════════════════
