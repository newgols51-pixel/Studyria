// ══════════════════════════════════════════════════════════════════
// supabase.js — Studyria
// Single source of truth for Supabase client + ALL auth logic.
// Loaded AFTER the @supabase/supabase-js CDN script.
// ══════════════════════════════════════════════════════════════════
//
// ── REQUIRED SUPABASE TABLES ────────────────────────────────────
// Run these in Supabase → SQL Editor if they don't exist yet:
//
// -- 1. Wishlist (one row per user+pdf combo)
// CREATE TABLE IF NOT EXISTS public.user_wishlist (
//   id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
//   pdf_id      text NOT NULL,
//   created_at  timestamptz DEFAULT now(),
//   UNIQUE (user_id, pdf_id)
// );
// ALTER TABLE public.user_wishlist ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "Users manage own wishlist" ON public.user_wishlist
//   USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
//
// -- 2. Reading sessions (one row per open event)
// CREATE TABLE IF NOT EXISTS public.reading_sessions (
//   id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
//   pdf_id         text NOT NULL,
//   total_seconds  integer NOT NULL DEFAULT 900,
//   opened_at      timestamptz DEFAULT now()
// );
// ALTER TABLE public.reading_sessions ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "Users manage own reading sessions" ON public.reading_sessions
//   USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
//
// -- purchased_pdfs already exists.
// -- ⚠️  CRITICAL: RLS must allow authenticated users to INSERT and SELECT their own rows.
// -- Run this in Supabase → SQL Editor if purchases are not saving:
//
// ALTER TABLE public.purchased_pdfs ENABLE ROW LEVEL SECURITY;
//
// -- Allow users to insert their own purchase records:
// CREATE POLICY "Users insert own purchases" ON public.purchased_pdfs
//   FOR INSERT TO authenticated
//   WITH CHECK (auth.uid() = user_id);
//
// -- Allow users to read their own purchase records:
// CREATE POLICY "Users read own purchases" ON public.purchased_pdfs
//   FOR SELECT TO authenticated
//   USING (auth.uid() = user_id);
//
// -- Index for fast lookup:
// CREATE INDEX IF NOT EXISTS idx_purchased_pdfs_user_id  ON public.purchased_pdfs(user_id);
// CREATE INDEX IF NOT EXISTS idx_purchased_pdfs_pdf_uuid ON public.purchased_pdfs(pdf_uuid);
// CREATE INDEX IF NOT EXISTS idx_purchased_pdfs_email    ON public.purchased_pdfs(email);
//
// -- 3. Creators (one row per creator applicant / approved creator)
// CREATE TABLE IF NOT EXISTS public.creators (
//   user_id                 uuid         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
//   full_name               text         NOT NULL,
//   author_name             text         NOT NULL,
//   gender                  text,
//   dob                     date,
//   mobile                  text,
//   creator_type            text,
//   qualification           text,
//   experience              text,
//   occupation              text,
//   bio                     text,
//   expertise               text,
//   languages               text,
//   social_link             text,
//   photo_url               text,
//   verification_doc_path   text,
//   verification_doc_name   text,
//   verification_doc_size   bigint,
//   verification_doc_type   text,
//   verification_status     text         NOT NULL DEFAULT 'not_submitted'
//                             CHECK (verification_status IN ('not_submitted','submitted','verified')),
//   status                  text         NOT NULL DEFAULT 'pending'
//                             CHECK (status IN ('pending','approved','rejected','suspended')),
//   rejection_reason        text,
//   admin_notes             text,
//   applied_at              timestamptz  NOT NULL DEFAULT now(),
//   approved_at             timestamptz,
//   suspended_at            timestamptz,
//   level                   text         NOT NULL DEFAULT 'starter'
//                             CHECK (level IN ('starter','rising','pro','elite')),
//   revenue_share           integer      NOT NULL DEFAULT 60
//                             CHECK (revenue_share BETWEEN 0 AND 100),
//   quality_score           numeric(5,2) DEFAULT 0,
//   originality_score       numeric(5,2) DEFAULT 0,
//   creator_score           numeric(5,2) DEFAULT 0,
//   total_earnings          numeric(12,2) NOT NULL DEFAULT 0,
//   available_balance       numeric(12,2) NOT NULL DEFAULT 0,
//   total_downloads         integer      NOT NULL DEFAULT 0,
//   total_sales             integer      NOT NULL DEFAULT 0,
//   pdf_count               integer      NOT NULL DEFAULT 0,
//   created_at              timestamptz  NOT NULL DEFAULT now(),
//   updated_at              timestamptz  NOT NULL DEFAULT now()
// );
// ALTER TABLE public.creators ENABLE ROW LEVEL SECURITY;
// -- Users manage their own creator row:
// CREATE POLICY "Creators: users manage own row" ON public.creators
//   FOR ALL TO authenticated
//   USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
// -- Admins read all rows:
// CREATE POLICY "Creators: admin read all" ON public.creators
//   FOR SELECT TO authenticated
//   USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()
//     AND raw_user_meta_data->>'role' = 'admin'));
// -- Admins write all rows:
// CREATE POLICY "Creators: admin write all" ON public.creators
//   FOR UPDATE TO authenticated
//   USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()
//     AND raw_user_meta_data->>'role' = 'admin'));
// -- Indexes:
// CREATE INDEX IF NOT EXISTS idx_creators_status        ON public.creators(status);
// CREATE INDEX IF NOT EXISTS idx_creators_level         ON public.creators(level);
// CREATE INDEX IF NOT EXISTS idx_creators_applied_at    ON public.creators(applied_at DESC);
// CREATE INDEX IF NOT EXISTS idx_creators_total_earnings ON public.creators(total_earnings DESC);
//
// -- 4. Product Reviews (one row per user+pdf rating/comment)
// CREATE TABLE IF NOT EXISTS public.pdf_reviews (
//   id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   pdf_id      uuid NOT NULL REFERENCES public.pdfs(id) ON DELETE CASCADE,
//   user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
//   rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
//   comment     text,
//   verified    boolean NOT NULL DEFAULT false,  -- true when user has purchased
//   created_at  timestamptz DEFAULT now(),
//   updated_at  timestamptz DEFAULT now(),
//   UNIQUE (user_id, pdf_id)
// );
// ALTER TABLE public.pdf_reviews ENABLE ROW LEVEL SECURITY;
// -- Anyone can read reviews:
// CREATE POLICY "Reviews: public read" ON public.pdf_reviews
//   FOR SELECT USING (true);
// -- Authenticated users can insert their own review:
// CREATE POLICY "Reviews: users insert own" ON public.pdf_reviews
//   FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
// -- Users can update their own review:
// CREATE POLICY "Reviews: users update own" ON public.pdf_reviews
//   FOR UPDATE TO authenticated USING (auth.uid() = user_id);
// -- Users can delete their own review:
// CREATE POLICY "Reviews: users delete own" ON public.pdf_reviews
//   FOR DELETE TO authenticated USING (auth.uid() = user_id);
// -- Indexes for fast lookup:
// CREATE INDEX IF NOT EXISTS idx_pdf_reviews_pdf_id  ON public.pdf_reviews(pdf_id);
// CREATE INDEX IF NOT EXISTS idx_pdf_reviews_user_id ON public.pdf_reviews(user_id);
// CREATE INDEX IF NOT EXISTS idx_pdf_reviews_verified ON public.pdf_reviews(verified);
//
// -- 0. Users profile table (Google OAuth + email/password profile sync)
// CREATE TABLE IF NOT EXISTS public.users (
//   id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
//   email       text,
//   full_name   text,
//   avatar_url  text,
//   provider    text,
//   last_login  timestamptz,
//   created_at  timestamptz DEFAULT now(),
//   updated_at  timestamptz DEFAULT now()
// );
// ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "Users manage own profile" ON public.users
//   FOR ALL TO authenticated
//   USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
// CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
//
// -- Career Hub tables → see supabase-setup.sql (generated separately)
//
// -- 5b. PDF Subscribers (opt-in for new PDF email + WhatsApp notifications)
// CREATE TABLE IF NOT EXISTS public.pdf_subscribers (
//   id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   email        text NOT NULL,
//   whatsapp     text,                    -- optional WhatsApp number (with country code)
//   notify_email boolean NOT NULL DEFAULT true,
//   notify_wa    boolean NOT NULL DEFAULT false,
//   confirmed    boolean NOT NULL DEFAULT false,
//   token        text UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
//   created_at   timestamptz DEFAULT now(),
//   UNIQUE (email)
// );
// ALTER TABLE public.pdf_subscribers ENABLE ROW LEVEL SECURITY;
// -- Anyone can insert their own subscription (opt-in):
// CREATE POLICY "Subscribers: public insert" ON public.pdf_subscribers
//   FOR INSERT WITH CHECK (true);
// -- Admins can read all subscribers:
// CREATE POLICY "Subscribers: admin read" ON public.pdf_subscribers
//   FOR SELECT TO authenticated
//   USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()
//     AND raw_user_meta_data->>'role' = 'admin'));
// -- Admins can update (e.g. confirm) subscribers:
// CREATE POLICY "Subscribers: admin update" ON public.pdf_subscribers
//   FOR UPDATE TO authenticated
//   USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()
//     AND raw_user_meta_data->>'role' = 'admin'));
// CREATE INDEX IF NOT EXISTS idx_pdf_subscribers_email ON public.pdf_subscribers(email);
// CREATE INDEX IF NOT EXISTS idx_pdf_subscribers_token ON public.pdf_subscribers(token);
//
// -- 5. Testimonials (student testimonials shown on homepage)
// CREATE TABLE IF NOT EXISTS public.testimonials (
//   id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   name        text NOT NULL,
//   role        text,                  -- e.g. "JEE 2024 — AIR 12"
//   text        text NOT NULL,         -- review body
//   stars       smallint NOT NULL DEFAULT 5 CHECK (stars BETWEEN 1 AND 5),
//   image_url   text,                  -- optional photo URL (null = initials avatar)
//   verified    boolean NOT NULL DEFAULT false,   -- admin-verified testimonial
//   active      boolean NOT NULL DEFAULT true,    -- toggle visibility
//   sort_order  integer NOT NULL DEFAULT 0,
//   created_at  timestamptz DEFAULT now()
// );
// ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;
// -- Public read (only active rows):
// CREATE POLICY "Testimonials: public read active" ON public.testimonials
//   FOR SELECT USING (active = true);
// -- Admin full access:
// CREATE POLICY "Testimonials: admin all" ON public.testimonials
//   FOR ALL TO authenticated
//   USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()
//     AND raw_user_meta_data->>'role' = 'admin'));
// CREATE INDEX IF NOT EXISTS idx_testimonials_active      ON public.testimonials(active);
// CREATE INDEX IF NOT EXISTS idx_testimonials_sort_order  ON public.testimonials(sort_order);
//
// -- 6. Push Notifications (OneSignal) — history + scheduling
// CREATE TABLE IF NOT EXISTS public.push_notifications (
//   id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   title         text NOT NULL,
//   message       text NOT NULL,
//   image_url     text,
//   click_url     text,
//   audience      text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','premium','free')),
//   status        text NOT NULL DEFAULT 'pending'
//                   CHECK (status IN ('pending','scheduled','sent','cancelled','failed','test')),
//   scheduled_at  timestamptz,              -- null = send now
//   sent_at       timestamptz,
//   onesignal_id  text,                     -- OneSignal notification id (for delivery lookup)
//   recipients    integer DEFAULT 0,
//   delivered     integer DEFAULT 0,
//   clicked       integer DEFAULT 0,
//   created_by    text,
//   created_at    timestamptz NOT NULL DEFAULT now()
// );
// ALTER TABLE public.push_notifications ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "Push notif: admin all" ON public.push_notifications
//   FOR ALL TO authenticated
//   USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()
//     AND raw_user_meta_data->>'role' = 'admin'));
// CREATE INDEX IF NOT EXISTS idx_push_notif_status       ON public.push_notifications(status);
// CREATE INDEX IF NOT EXISTS idx_push_notif_scheduled_at ON public.push_notifications(scheduled_at);
// CREATE INDEX IF NOT EXISTS idx_push_notif_created_at   ON public.push_notifications(created_at DESC);
//
// -- 6b. Classification Tables (Categories, Subcategories, Academic Levels, Streams, Semester/Classes, Subjects)
//
// -- 6b-1. Categories
// CREATE TABLE IF NOT EXISTS public.categories (
//   id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   name        text NOT NULL UNIQUE,
//   slug        text NOT NULL UNIQUE,
//   sort_order  integer NOT NULL DEFAULT 0,
//   created_at  timestamptz DEFAULT now()
// );
// ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
// -- Public read:
// CREATE POLICY "Categories: public read" ON public.categories FOR SELECT USING (true);
// -- Admin full access:
// CREATE POLICY "Categories: admin all" ON public.categories
//   FOR ALL TO authenticated
//   USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin'));
// CREATE INDEX IF NOT EXISTS idx_categories_slug       ON public.categories(slug);
// CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON public.categories(sort_order);
//
// -- 6b-2. Subcategories
// CREATE TABLE IF NOT EXISTS public.subcategories (
//   id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   category_id  uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
//   name         text NOT NULL,
//   slug         text NOT NULL,
//   sort_order   integer NOT NULL DEFAULT 0,
//   created_at   timestamptz DEFAULT now(),
//   UNIQUE (category_id, slug)
// );
// ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "Subcategories: public read" ON public.subcategories FOR SELECT USING (true);
// CREATE POLICY "Subcategories: admin all" ON public.subcategories
//   FOR ALL TO authenticated
//   USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin'));
// CREATE INDEX IF NOT EXISTS idx_subcategories_category_id ON public.subcategories(category_id);
// CREATE INDEX IF NOT EXISTS idx_subcategories_sort_order  ON public.subcategories(sort_order);
//
// -- 6b-3. Academic Levels
// CREATE TABLE IF NOT EXISTS public.academic_levels (
//   id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   subcategory_id  uuid NOT NULL REFERENCES public.subcategories(id) ON DELETE CASCADE,
//   name            text NOT NULL,
//   slug            text NOT NULL,
//   sort_order      integer NOT NULL DEFAULT 0,
//   created_at      timestamptz DEFAULT now(),
//   UNIQUE (subcategory_id, slug)
// );
// ALTER TABLE public.academic_levels ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "AcademicLevels: public read" ON public.academic_levels FOR SELECT USING (true);
// CREATE POLICY "AcademicLevels: admin all" ON public.academic_levels
//   FOR ALL TO authenticated
//   USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin'));
// CREATE INDEX IF NOT EXISTS idx_academic_levels_subcategory_id ON public.academic_levels(subcategory_id);
//
// -- 6b-4. Streams
// CREATE TABLE IF NOT EXISTS public.streams (
//   id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   academic_level_id uuid NOT NULL REFERENCES public.academic_levels(id) ON DELETE CASCADE,
//   name              text NOT NULL,
//   slug              text NOT NULL,
//   sort_order        integer NOT NULL DEFAULT 0,
//   created_at        timestamptz DEFAULT now(),
//   UNIQUE (academic_level_id, slug)
// );
// ALTER TABLE public.streams ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "Streams: public read" ON public.streams FOR SELECT USING (true);
// CREATE POLICY "Streams: admin all" ON public.streams
//   FOR ALL TO authenticated
//   USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin'));
// CREATE INDEX IF NOT EXISTS idx_streams_academic_level_id ON public.streams(academic_level_id);
//
// -- 6b-5. Semester / Classes
// CREATE TABLE IF NOT EXISTS public.semester_classes (
//   id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   stream_id   uuid NOT NULL REFERENCES public.streams(id) ON DELETE CASCADE,
//   name        text NOT NULL,
//   slug        text NOT NULL,
//   sort_order  integer NOT NULL DEFAULT 0,
//   created_at  timestamptz DEFAULT now(),
//   UNIQUE (stream_id, slug)
// );
// ALTER TABLE public.semester_classes ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "SemesterClasses: public read" ON public.semester_classes FOR SELECT USING (true);
// CREATE POLICY "SemesterClasses: admin all" ON public.semester_classes
//   FOR ALL TO authenticated
//   USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin'));
// CREATE INDEX IF NOT EXISTS idx_semester_classes_stream_id ON public.semester_classes(stream_id);
//
// -- 6b-6. Subjects
// CREATE TABLE IF NOT EXISTS public.subjects (
//   id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   semester_class_id   uuid NOT NULL REFERENCES public.semester_classes(id) ON DELETE CASCADE,
//   name                text NOT NULL,
//   slug                text NOT NULL,
//   sort_order          integer NOT NULL DEFAULT 0,
//   created_at          timestamptz DEFAULT now(),
//   UNIQUE (semester_class_id, slug)
// );
// ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "Subjects: public read" ON public.subjects FOR SELECT USING (true);
// CREATE POLICY "Subjects: admin all" ON public.subjects
//   FOR ALL TO authenticated
//   USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin'));
// CREATE INDEX IF NOT EXISTS idx_subjects_semester_class_id ON public.subjects(semester_class_id);
//
// -- 6b-7. pdfs table — classification FK columns (add if missing)
// ALTER TABLE public.pdfs ADD COLUMN IF NOT EXISTS category_id       uuid REFERENCES public.categories(id)       ON DELETE SET NULL;
// ALTER TABLE public.pdfs ADD COLUMN IF NOT EXISTS subcategory_id    uuid REFERENCES public.subcategories(id)    ON DELETE SET NULL;
// ALTER TABLE public.pdfs ADD COLUMN IF NOT EXISTS academic_level_id uuid REFERENCES public.academic_levels(id)  ON DELETE SET NULL;
// ALTER TABLE public.pdfs ADD COLUMN IF NOT EXISTS stream_id         uuid REFERENCES public.streams(id)          ON DELETE SET NULL;
// ALTER TABLE public.pdfs ADD COLUMN IF NOT EXISTS semester_class_id uuid REFERENCES public.semester_classes(id) ON DELETE SET NULL;
// ALTER TABLE public.pdfs ADD COLUMN IF NOT EXISTS subject_id        uuid REFERENCES public.subjects(id)         ON DELETE SET NULL;
// CREATE INDEX IF NOT EXISTS idx_pdfs_category_id       ON public.pdfs(category_id);
// CREATE INDEX IF NOT EXISTS idx_pdfs_subcategory_id    ON public.pdfs(subcategory_id);
// CREATE INDEX IF NOT EXISTS idx_pdfs_academic_level_id ON public.pdfs(academic_level_id);
// CREATE INDEX IF NOT EXISTS idx_pdfs_stream_id         ON public.pdfs(stream_id);
// CREATE INDEX IF NOT EXISTS idx_pdfs_semester_class_id ON public.pdfs(semester_class_id);
// CREATE INDEX IF NOT EXISTS idx_pdfs_subject_id        ON public.pdfs(subject_id);
//
// -- 7. WhatsApp Community broadcast log
// CREATE TABLE IF NOT EXISTS public.whatsapp_broadcasts (
//   id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   invite_link   text,
//   title         text NOT NULL,
//   message       text NOT NULL,
//   image_url     text,
//   status        text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','test','failed')),
//   created_by    text,
//   created_at    timestamptz NOT NULL DEFAULT now()
// );
// ALTER TABLE public.whatsapp_broadcasts ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "WA broadcasts: admin all" ON public.whatsapp_broadcasts
//   FOR ALL TO authenticated
//   USING (EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid()
//     AND raw_user_meta_data->>'role' = 'admin'));
// CREATE INDEX IF NOT EXISTS idx_wa_broadcasts_created_at ON public.whatsapp_broadcasts(created_at DESC);
//
// -- NOTE on sending: this app is client-only (no custom backend), so actual
// -- OneSignal REST sends and WhatsApp dispatch happen via the same Pipedream
// -- webhook already used for email/WhatsApp (see stgPipedream / webhookUrl
// -- below). Configure the Pipedream workflow to:
// --   1. Receive { event:'push_send', title, message, image_url, click_url,
// --      audience, onesignal_app_id } and call OneSignal's REST API
// --      (POST https://onesignal.com/api/v1/notifications) using your
// --      OneSignal REST API key — NEVER put that key in this client code.
// --   2. Receive { event:'wa_broadcast', invite_link, title, message,
// --      image_url } and forward to your WhatsApp Business API / Cloud API
// --      integration of choice.
// -- ─────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── CONFIG ──────────────────────────────────────────────────────
  const SUPABASE_URL  = 'https://qsdfmgcekdpjdcyqhuhi.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzZGZtZ2Nla2RwamRjeXFodWhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NTE2NDcsImV4cCI6MjA5NjIyNzY0N30.kDOEYxUQyLTp1blasuX2kVSIy2olGLhdqqtOMTlEX5g';

  // ── INIT CLIENT ─────────────────────────────────────────────────
  // Prefer window.supabaseLib (set by index.html right after the CDN script loads)
  // to avoid colliding with window.supabase being re-assigned later to the client.
  const _supabaseSDK = window.supabaseLib || window.supabase;
  if (!_supabaseSDK || typeof _supabaseSDK.createClient !== 'function') {
    console.error('❌ Supabase SDK not found. Check CDN script load order.');
    return;
  }

  window.supabaseClient = _supabaseSDK.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  const sb = () => window.supabaseClient;

  // ── PASSWORD STRENGTH ────────────────────────────────────────────
  window.checkPasswordStrength = function (pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8)          score++;
    if (pw.length >= 12)         score++;
    if (/[A-Z]/.test(pw))        score++;
    if (/[0-9]/.test(pw))        score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 5);
  };

  // ── AUTH ERROR HELPERS ───────────────────────────────────────────
  function showAuthErr(elId, msg) {
    const box   = document.getElementById(elId);
    const msgEl = document.getElementById(elId + 'Msg');
    if (box) { if (msgEl) msgEl.textContent = msg; box.style.display = 'flex'; }
  }
  function clearAuthErr(elId) {
    const box = document.getElementById(elId);
    if (box) box.style.display = 'none';
  }

  // ── BUILD currentUser OBJECT ─────────────────────────────────────
  function _buildCurrentUser(user) {
    const name     = user.user_metadata?.full_name || user.user_metadata?.name || user.email || '';
    const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'U';
    const provider = user.app_metadata?.provider || (user.identities && user.identities[0]?.provider) || 'email';
    return {
      uid:        user.id,
      name,
      email:      user.email,
      avatar:     initials,
      avatarUrl:  user.user_metadata?.avatar_url || user.user_metadata?.picture || '',
      provider,
      plan:       'Pro',
      joined:     new Date(user.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      purchased:  0,
      totalSpent: 0,
      wishlist:   0,
    };
  }

  // ── SYNC NAV TO AUTH STATE ───────────────────────────────────────
  window.syncNavToAuth = function (user) {
    const area = document.getElementById('navUserArea');
    if (window.adminSession) return;

    if (user) {
      window.currentUser = _buildCurrentUser(user);

      if (area) {
        const { name, avatar, avatarUrl } = window.currentUser;
        const avatarInner = avatarUrl
          ? `<img src="${avatarUrl}" alt="${name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" referrerpolicy="no-referrer" onerror="this.style.display='none';this.parentElement.innerHTML='<span id=&quot;navAvatarText&quot;>${avatar}</span>';" />`
          : `<span id="navAvatarText">${avatar}</span>`;
        area.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="avatar-btn" id="navAvatarBtn"
              title="${name}"
              style="width:38px;height:38px;font-size:.9rem;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:700;font-family:var(--font-body);overflow:hidden;"
              onclick="navigate('dashboard')"
            >${avatarInner}</button>
            <button class="btn btn-ghost btn-sm" onclick="authLogout()" title="Sign out" style="font-size:.78rem;">Sign Out</button>
          </div>`;
      }
    } else {
      window.currentUser = null;
      if (area) {
        area.innerHTML = `<button class="btn btn-primary btn-sm" id="navLoginBtn" onclick="navigate('login')">Sign In</button>`;
      }
    }

    const pg = window.currentPage || (typeof currentPage !== 'undefined' ? currentPage : '');

    // ── Already logged in? Bounce away from the login/register screen ──
    if (user && (pg === 'login' || pg === 'register') && typeof window.navigate === 'function') {
      window.navigate('dashboard');
      return;
    }

    if (pg === 'dashboard' && typeof window.renderDashboard === 'function') {
      window.renderDashboard();
    }

    // ── NEW: if Career Hub is open and auth state just changed, resync saves ──
    if (pg === 'career-hub' && typeof window._chLoadSavedFromSupabase === 'function') {
      window._chLoadSavedFromSupabase();
    }
  };

  // ── WISHLIST — GUEST (LOGGED-OUT) LOCAL STORAGE SUPPORT ───────────
  // Guests get a fully working wishlist stored in localStorage. When
  // they log in, _mergeGuestWishlistIntoSupabase() pushes everything
  // into user_wishlist and the local copy is cleared.
  const GUEST_WISH_KEY = 'studyria_wishlist';

  function _readGuestWishlist() {
    try {
      const raw = localStorage.getItem(GUEST_WISH_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  function _writeGuestWishlist(arr) {
    try {
      // Dedupe (prevents duplicate wishlist items)
      const deduped = [...new Set(arr.map(String))].map(x => {
        const n = Number(x);
        return isNaN(n) ? x : n;
      });
      localStorage.setItem(GUEST_WISH_KEY, JSON.stringify(deduped));
      return deduped;
    } catch (_) { return arr; }
  }

  // ── WISHLIST — BROADCAST CHANGES TO EVERY PAGE / COMPONENT ────────
  // Called after every load, toggle, or guest merge. Refreshes heart
  // icons + counters on whatever page happens to be mounted right now
  // and notifies any other listener (career-hub.js, etc.) via a
  // CustomEvent, so nothing needs a manual page refresh.
  window._syncWishlistUI = function _syncWishlistUI() {
    const current = (() => { try { return wishlist; } catch (_) { return window.wishlist || []; } })();

    if (typeof window._refreshAllWishButtons === 'function') window._refreshAllWishButtons();
    window._dashCache = null;

    const pg = window.currentPage || (typeof currentPage !== 'undefined' ? currentPage : '');
    if (pg === 'dashboard' && typeof window._refreshDashStats === 'function') window._refreshDashStats();
    if (pg === 'wishlist' && typeof window.renderWishlist === 'function') window.renderWishlist();

    try {
      window.dispatchEvent(new CustomEvent('studyria:wishlistChanged', { detail: { wishlist: [...current] } }));
    } catch (_) {}
  };

  // ── WISHLIST — LOAD (Supabase for logged-in users, local for guests) ──
  let _wishlistLoading = false;

  window.loadWishlistFromSupabase = async function loadWishlistFromSupabase() {
    if (_wishlistLoading) {
      console.log('⏳ loadWishlistFromSupabase: already in-flight, skipping duplicate call');
      return;
    }
    _wishlistLoading = true;

    const client = window.supabaseClient;
    if (!client) { _wishlistLoading = false; return; }

    let userId = window.currentUser?.uid ?? null;
    if (!userId) {
      try {
        const { data: { session } } = await client.auth.getSession();
        if (session?.user) {
          if (!window.currentUser) window.syncNavToAuth(session.user);
          userId = session.user.id;
        }
      } catch (e) {
        console.error('❌ loadWishlistFromSupabase: getSession failed', e);
      }
    }

    if (!userId) {
      // Logged out — show the guest wishlist stored locally, instead
      // of wiping it. It auto-syncs to Supabase on next login.
      const guest = _readGuestWishlist();
      if (typeof window.wishlist !== 'undefined') window.wishlist = guest;
      try { wishlist = guest; } catch (_) {}
      console.log('👤 loadWishlistFromSupabase: guest mode —', guest.length, 'local item(s)');
      _wishlistLoading = false;
      window._syncWishlistUI();
      return;
    }

    try {
      console.log('📋 Loading wishlist for user:', userId);

      const { data, error } = await client
        .from('user_wishlist')
        .select('pdf_id')
        .eq('user_id', userId);

      console.log('Wishlist Load Result:', { data, error });

      if (error) {
        console.error('❌ loadWishlistFromSupabase error:', error);
        _wishlistLoading = false;
        return;
      }

      // Dedupe defensively — prevents duplicate items even if the DB
      // ever ends up with stray duplicate rows.
      const loaded = [...new Set((data || []).map(r => String(r.pdf_id)))].map(id => {
        const n = Number(id);
        return isNaN(n) ? id : n;
      });

      if (typeof window.wishlist !== 'undefined') window.wishlist = loaded;
      try { wishlist = loaded; } catch (_) {}

      console.log('✅ Wishlist loaded:', loaded.length, 'items');

      window._syncWishlistUI();

    } catch (e) {
      console.error('❌ loadWishlistFromSupabase exception:', e);
    } finally {
      _wishlistLoading = false;
    }
  };

  // ── WISHLIST — MERGE GUEST ITEMS INTO SUPABASE ON LOGIN ───────────
  window._mergeGuestWishlistIntoSupabase = async function _mergeGuestWishlistIntoSupabase(userId) {
    const client = window.supabaseClient;
    const guest = _readGuestWishlist();
    if (!client || !userId || guest.length === 0) return;

    console.log('🔄 Merging', guest.length, 'guest wishlist item(s) into Supabase for', userId);
    try {
      const rows = guest.map(id => ({ user_id: userId, pdf_id: String(id) }));
      const { error } = await client
        .from('user_wishlist')
        .upsert(rows, { onConflict: 'user_id,pdf_id' });
      if (error) {
        console.error('❌ Guest wishlist merge failed:', error);
        return; // keep local copy so we can retry next login
      }
      try { localStorage.removeItem(GUEST_WISH_KEY); } catch (_) {}
      console.log('✅ Guest wishlist merged and cleared.');
    } catch (e) {
      console.error('❌ Guest wishlist merge exception:', e);
    }
  };

  // ── WISHLIST — TOGGLE (ADD / REMOVE) ────────────────────────────
  window.toggleWishlistItem = async function toggleWishlistItem(id) {
    const client = window.supabaseClient;
    if (!client) { console.error('❌ toggleWishlistItem: no supabaseClient'); return; }

    let userId = null;
    try {
      const { data: { user: authUser } } = await client.auth.getUser();
      userId = authUser?.id ?? null;
    } catch (e) {
      console.error('❌ toggleWishlistItem: getUser failed', e);
    }

    // ── GUEST MODE: no forced redirect to login. Toggle locally in
    // localStorage; it auto-merges into Supabase on next login. ──
    if (!userId) {
      const pdfId = String(id);
      const numId = Number(id);
      const guest = _readGuestWishlist();
      const inWish = guest.some(x => String(x) === pdfId);
      const nextGuest = inWish
        ? guest.filter(x => String(x) !== pdfId)
        : [...guest, isNaN(numId) ? pdfId : numId];
      const saved = _writeGuestWishlist(nextGuest);

      if (typeof window.wishlist !== 'undefined') window.wishlist = saved;
      try { wishlist = saved; } catch (_) {}

      if (typeof showToast === 'function') {
        showToast(inWish ? 'Removed from wishlist' : 'Saved! Sign in to keep it forever ❤️', inWish ? 'info' : 'success');
      }
      window._syncWishlistUI();
      return;
    }

    if (!window.currentUser?.uid) {
      try {
        const { data: { user: u } } = await client.auth.getUser();
        if (u) window.syncNavToAuth(u);
      } catch (_) {}
    }

    const pdfId = String(id);
    const numId = Number(id);

    const currentWishlist = (() => {
      try { return wishlist; } catch (_) { return window.wishlist || []; }
    })();

    const inWish = currentWishlist.includes(numId) || currentWishlist.includes(pdfId);

    // Dedupe on add — never push a duplicate entry.
    const newWishlist = inWish
      ? currentWishlist.filter(x => Number(x) !== numId && String(x) !== pdfId)
      : [...new Set([...currentWishlist, numId])];

    try { wishlist = newWishlist; } catch (_) {}
    if (typeof window.wishlist !== 'undefined') window.wishlist = newWishlist;

    const btn = document.getElementById(`wish-${id}`);
    if (btn) {
      const nowIn = !inWish;
      btn.classList.toggle('active', nowIn);
      btn.title = nowIn ? 'Remove from wishlist' : 'Save to wishlist';
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${nowIn ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`;
    }

    try {
      if (inWish) {
        const { error: delError } = await client
          .from('user_wishlist')
          .delete()
          .eq('user_id', userId)
          .eq('pdf_id', pdfId);

        if (delError) {
          console.error('❌ Wishlist delete failed:', delError);
          try { wishlist = currentWishlist; } catch (_) {}
          if (typeof window.wishlist !== 'undefined') window.wishlist = currentWishlist;
          if (typeof window._refreshAllWishButtons === 'function') window._refreshAllWishButtons();
          if (typeof showToast === 'function')
            showToast(`Failed to remove — ${delError.message || 'please try again.'}`, 'error');
        } else {
          if (typeof showToast === 'function') showToast('Removed from wishlist', 'info');
        }
      } else {
        const { error: upsertError } = await client
          .from('user_wishlist')
          .upsert({ user_id: userId, pdf_id: pdfId }, { onConflict: 'user_id,pdf_id' });

        if (upsertError) {
          console.error('❌ Wishlist upsert failed:', upsertError);
          try { wishlist = currentWishlist; } catch (_) {}
          if (typeof window.wishlist !== 'undefined') window.wishlist = currentWishlist;
          if (typeof window._refreshAllWishButtons === 'function') window._refreshAllWishButtons();
          if (typeof showToast === 'function')
            showToast(`Failed to save — ${upsertError.message || 'unknown error'}`, 'error');
        } else {
          // Verify the row is readable (guards against RLS SELECT gap)
          const { data: verifyData, error: verifyErr } = await client
            .from('user_wishlist')
            .select('pdf_id')
            .eq('user_id', userId)
            .eq('pdf_id', pdfId);

          if (verifyErr || !verifyData?.length) {
            console.error('❌ Wishlist verification failed — row unreadable after upsert.', verifyErr);
            try { wishlist = currentWishlist; } catch (_) {}
            if (typeof window.wishlist !== 'undefined') window.wishlist = currentWishlist;
            if (typeof window._refreshAllWishButtons === 'function') window._refreshAllWishButtons();
            if (typeof showToast === 'function')
              showToast('Save may have failed — check RLS SELECT policy on user_wishlist.', 'error');
          } else {
            const pdf = (window.PDFS || []).find(p => Number(p.id) === numId);
            if (typeof showToast === 'function')
              showToast((pdf ? pdf.title + ' ' : '') + 'saved! ❤️', 'success');
          }
        }
      }

      window._syncWishlistUI();

    } catch (e) {
      console.error('❌ toggleWishlistItem exception:', e);
      try { wishlist = currentWishlist; } catch (_) {}
      if (typeof window.wishlist !== 'undefined') window.wishlist = currentWishlist;
      window._syncWishlistUI();
    }
  };

  // Aliases — several places in the UI (Library cards, PDF-of-the-day
  // carousel, PDP page, Career Hub) call the wishlist toggle under
  // different historical names. All of them must resolve to the same
  // authoritative function so state never drifts between pages.
  window.toggleWish = window.toggleWishlistItem;
  window.toggleWishlist = window.toggleWishlistItem;

  // ── LOGIN ────────────────────────────────────────────────────────
  window.authLogin = async function () {
    const client = sb();
    if (!client) { alert('Supabase not configured.'); return; }

    const email = document.getElementById('loginEmail')?.value?.trim();
    const pass  = document.getElementById('loginPass')?.value;
    const btn   = document.getElementById('loginBtn');

    clearAuthErr('loginError');
    if (!email || !pass) return showAuthErr('loginError', 'Please enter email and password.');

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span>Signing in…'; }

    const { data, error } = await client.auth.signInWithPassword({ email, password: pass });

    if (btn) { btn.disabled = false; btn.innerHTML = 'Sign In'; }

    if (error) {
      showAuthErr('loginError', error.message);
    } else {
      if (typeof window.pipedream_onLogin === 'function') {
        window.pipedream_onLogin(data.user);
      }
      if (typeof window.navigate === 'function') window.navigate('home');
    }
  };

  // ── SIGNUP ───────────────────────────────────────────────────────
  window.authSignup = async function () {
    const client = sb();
    if (!client) { alert('Supabase not configured.'); return; }

    const name    = document.getElementById('regName')?.value?.trim();
    const email   = document.getElementById('regEmail')?.value?.trim();
    const pass    = document.getElementById('regPass')?.value;
    const confirm = document.getElementById('regConfirm')?.value;
    const btn     = document.getElementById('signupBtn');

    clearAuthErr('signupError');
    if (!name  || name.length < 2)
      return showAuthErr('signupError', 'Enter your full name (at least 2 characters).');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return showAuthErr('signupError', 'Enter a valid email address.');
    if (!pass  || pass.length < 8)
      return showAuthErr('signupError', 'Password must be at least 8 characters.');
    if (pass !== confirm)
      return showAuthErr('signupError', 'Passwords do not match.');

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span>Creating account…'; }

    const { error } = await client.auth.signUp({
      email,
      password: pass,
      options: { data: { full_name: name } },
    });

    if (btn) { btn.disabled = false; btn.innerHTML = 'Create Account'; }

    if (error) {
      showAuthErr('signupError', error.message);
    } else {
      const emailEl = document.getElementById('verifyEmail');
      if (emailEl) emailEl.textContent = email;
      if (typeof window.showAuthPage === 'function') window.showAuthPage('verify');
    }
  };

  // ── PROFILE SYNC — users table ───────────────────────────────────
  // Creates/updates the row in public.users with avatar, name, email,
  // provider and last_login. Safe no-op if the table doesn't exist yet
  // (logs a warning instead of breaking the login flow).
  window.syncUserProfile = async function syncUserProfile(user) {
    if (!user) return;
    const client = sb();
    if (!client) return;
    try {
      const meta     = user.user_metadata || {};
      const provider = user.app_metadata?.provider || (user.identities && user.identities[0]?.provider) || 'email';
      const payload  = {
        id:         user.id,
        email:      user.email,
        full_name:  meta.full_name || meta.name || '',
        avatar_url: meta.avatar_url || meta.picture || '',
        provider,
        last_login: new Date().toISOString(),
      };
      const { error } = await client.from('users').upsert(payload, { onConflict: 'id' });
      if (error) console.warn('⚠️ syncUserProfile: upsert failed (create the public.users table — see SQL at top of supabase.js):', error.message);
    } catch (e) {
      console.warn('⚠️ syncUserProfile exception:', e);
    }
  };

  // ── GOOGLE SIGN-IN (OAuth) ───────────────────────────────────────
  window.authLoginWithGoogle = async function authLoginWithGoogle(btnId) {
    const client = sb();
    if (!client) { alert('Supabase not configured.'); return; }

    clearAuthErr('loginError');
    clearAuthErr('signupError');

    const btn = (btnId && document.getElementById(btnId))
      || document.getElementById('googleLoginBtn')
      || document.getElementById('googleSignupBtn');
    const original = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="auth-spinner"></span>Redirecting to Google…';
    }

    try {
      // Flag so we know to land on the Dashboard (not Home) once Google
      // redirects back and the SIGNED_IN event fires on page load.
      try { sessionStorage.setItem('studyria_oauth_pending', '1'); } catch (_) {}

      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'https://studyria.qzz.io',
          queryParams: { access_type: 'offline', prompt: 'select_account' },
        },
      });

      if (error) {
        try { sessionStorage.removeItem('studyria_oauth_pending'); } catch (_) {}
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
        showAuthErr('loginError', error.message || 'Google sign-in failed. Please try again.');
        showAuthErr('signupError', error.message || 'Google sign-in failed. Please try again.');
      }
      // On success the browser is redirected to Google — nothing more to do here.
    } catch (e) {
      try { sessionStorage.removeItem('studyria_oauth_pending'); } catch (_) {}
      if (btn) { btn.disabled = false; btn.innerHTML = original; }
      const msg = 'Google sign-in failed: ' + (e?.message || 'unknown error');
      showAuthErr('loginError', msg);
      showAuthErr('signupError', msg);
    }
  };

  // ── LOGOUT ───────────────────────────────────────────────────────
  window.authLogout = async function () {
    const client = sb();
    if (client) await client.auth.signOut();
    if (typeof window.navigate === 'function') window.navigate('home');
  };

  // ── FORGOT PASSWORD ──────────────────────────────────────────────
  window.authForgotPassword = async function () {
    const client = sb();
    if (!client) return;

    const email = document.getElementById('forgotEmail')?.value?.trim();
    clearAuthErr('forgotError');
    if (!email) return showAuthErr('forgotError', 'Enter your email address.');

    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname + '?reset=1',
    });

    if (error) {
      showAuthErr('forgotError', error.message);
    } else {
      if (typeof window.showToast    === 'function') window.showToast('Reset link sent! Check your inbox.', 'success');
      if (typeof window.showAuthPage === 'function') window.showAuthPage('login');
    }
  };

  // ── RESET PASSWORD ───────────────────────────────────────────────
  window.authResetPassword = async function () {
    const client = sb();
    if (!client) return;

    const pass    = document.getElementById('newPass')?.value;
    const confirm = document.getElementById('newPassConfirm')?.value;
    clearAuthErr('resetError');

    if (!pass || pass.length < 8)
      return showAuthErr('resetError', 'Password must be at least 8 characters.');
    if (pass !== confirm)
      return showAuthErr('resetError', 'Passwords do not match.');

    const { error } = await client.auth.updateUser({ password: pass });

    if (error) {
      showAuthErr('resetError', error.message);
    } else {
      if (typeof window.showToast    === 'function') window.showToast('Password updated! Please sign in.', 'success');
      if (typeof window.showAuthPage === 'function') window.showAuthPage('login');
    }
  };

  // ── RESEND VERIFICATION EMAIL ────────────────────────────────────
  window.authResendVerification = async function () {
    const client = sb();
    if (!client) return;

    const email = document.getElementById('verifyEmail')?.textContent?.trim();
    if (!email) {
      if (typeof window.showToast === 'function')
        window.showToast('Could not determine email. Please try signing up again.', 'info');
      return;
    }

    const { error } = await client.auth.resend({ type: 'signup', email });
    if (error) {
      if (typeof window.showToast === 'function') window.showToast(error.message, 'info');
    } else {
      if (typeof window.showToast === 'function') window.showToast('Verification email resent! Check your inbox.', 'success');
    }
  };

  // ── LIVE STATS — Supabase counts for homepage pstat cards ───────
  window.loadSupabaseHomeStats = async function () {
    const client = sb();
    if (!client) return null;
    try {
      const [pdfsRes, dlRes, usersRes] = await Promise.all([
        client.from('pdfs').select('id', { count: 'exact', head: true }).eq('status', 'published'),
        client.from('pdfs').select('download_count').eq('status', 'published'),
        client.from('purchased_pdfs').select('user_id', { count: 'exact', head: true }),
      ]);
      const pdfCount  = pdfsRes.count  || 0;
      const totalDl   = (dlRes.data || []).reduce((s, r) => s + (r.download_count || 0), 0);
      const userCount = usersRes.count || 0;
      return { pdfCount, totalDl, userCount };
    } catch (e) {
      console.warn('⚠️ loadSupabaseHomeStats:', e);
      return null;
    }
  };

  // ── ACTIVITY BAR — real purchase + latest PDF data ────────────
  window.loadActivityBarStats = async function () {
    const client = sb();
    // Reading counter — cosmetic random
    const readingEl = document.getElementById('habReading');
    if (readingEl) readingEl.textContent = (18 + Math.floor(Math.random() * 24)) + ' students';

    if (!client) {
      const el = document.getElementById('habPurchased');
      if (el) el.textContent = Math.floor(Math.random() * 12 + 5) + ' PDFs';
      return;
    }
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [purchaseRes, latestRes] = await Promise.all([
        client.from('purchased_pdfs')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', today.toISOString()),
        client.from('pdfs')
          .select('title,created_at')
          .eq('status', 'published')
          .order('created_at', { ascending: false })
          .limit(1),
      ]);
      const purchasedEl = document.getElementById('habPurchased');
      if (purchasedEl) {
        const cnt = purchaseRes.count || Math.floor(Math.random() * 12 + 4);
        purchasedEl.textContent = cnt + ' PDF' + (cnt !== 1 ? 's' : '');
      }
      const latestEl = document.getElementById('habLatest');
      if (latestEl && latestRes.data?.[0]) {
        const ageMs = Date.now() - new Date(latestRes.data[0].created_at).getTime();
        const ageH  = Math.floor(ageMs / 3600000);
        const ageD  = Math.floor(ageMs / 86400000);
        const label = ageH < 1 ? 'just now'
          : ageH < 24 ? ageH + ' hour' + (ageH > 1 ? 's' : '') + ' ago'
          : ageD + ' day'  + (ageD > 1 ? 's' : '') + ' ago';
        latestEl.innerHTML = 'New PDF uploaded <strong>' + label + '</strong>';
      }
    } catch (e) {
      console.warn('⚠️ loadActivityBarStats:', e);
    }
  };

  // ── REALTIME — PDF SYNC ──────────────────────────────────────────
  window.initRealtimeSync = function () {
    const client = sb();
    if (!client) return;

    // Throttle realtime PDF changes — max once per 5 s to avoid render storm
    let _realtimeTimer = null;
    client
      .channel('pdfs_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pdfs' }, () => {
        clearTimeout(_realtimeTimer);
        _realtimeTimer = setTimeout(() => {
          if (typeof window.renderTrendingShelf    === 'function') window.renderTrendingShelf();
          if (typeof window.renderNewArrivalsShelf === 'function') window.renderNewArrivalsShelf();
          if (typeof window.renderLibGrid          === 'function') window.renderLibGrid();
          if (typeof window.loadSupabaseHomeStats  === 'function') window.loadSupabaseHomeStats();
          if (typeof window.showToast              === 'function') window.showToast('📚 Library updated!', 'info');
        }, 5000);
      })
      .subscribe();

    // ── NEW: Career Hub Realtime ─────────────────────────────────
    // Ensures career-hub.js's own subscription is started as soon as
    // the client is available, even if the Career Hub tab hasn't been
    // opened yet (so realtime events accumulate from boot).
    if (typeof window._chSubscribeRealtime === 'function') {
      window._chSubscribeRealtime();
    }

    // ── Classification Realtime ───────────────────────────────────
    window.initClassifRealtime();
  };

  // ── PRODUCT REVIEWS & RATINGS ────────────────────────────────────

  /**
   * fetchReviewStats(pdfId)
   * Returns { avgRating, reviewCount, verified } for a PDF.
   * Cached for 60 s to avoid hammering Supabase on card renders.
   */
  window.fetchReviewStats = async function fetchReviewStats(pdfId) {
    const cacheKey = 'review_stats:' + pdfId;
    return window.cachedSupabaseQuery(cacheKey, async () => {
      const client = sb();
      if (!client) return null;
      const { data, error, count } = await client
        .from('pdf_reviews')
        .select('rating,verified', { count: 'exact' })
        .eq('pdf_id', pdfId);
      if (error || !data || data.length === 0) return { avgRating: null, reviewCount: 0, verifiedCount: 0 };
      const ratings = data.map(r => Number(r.rating)).filter(r => r >= 1 && r <= 5);
      const avgRating = ratings.length
        ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10
        : null;
      const verifiedCount = data.filter(r => r.verified).length;
      return { avgRating, reviewCount: count || data.length, verifiedCount };
    }, 60000);
  };

  /**
   * loadProductReviews(pdfId, limit?)
   * Returns an array of review rows (most recent first) for display.
   * Each row: { id, rating, comment, verified, created_at, user_display_name }
   */
  window.loadProductReviews = async function loadProductReviews(pdfId, limit) {
    const client = sb();
    if (!client || !pdfId) return [];
    try {
      const { data, error } = await client
        .from('pdf_reviews')
        .select('id,rating,comment,verified,created_at,user_id')
        .eq('pdf_id', pdfId)
        .order('created_at', { ascending: false })
        .limit(limit || 20);
      if (error) { console.warn('loadProductReviews error:', error); return []; }
      return (data || []).map(r => ({
        ...r,
        user_display_name: r.verified ? 'Verified Buyer' : 'Student',
      }));
    } catch (e) {
      console.warn('loadProductReviews exception:', e);
      return [];
    }
  };

  /**
   * submitProductReview(pdfId, rating, comment)
   * Inserts or updates the current user's review for a PDF.
   * Automatically marks `verified = true` if the user has purchased the PDF.
   * Returns { success, error, verified }
   */
  window.submitProductReview = async function submitProductReview(pdfId, rating, comment) {
    const client = sb();
    if (!client) return { success: false, error: 'Not connected' };

    // Require auth
    let userId = null;
    try {
      const { data: { user } } = await client.auth.getUser();
      userId = user?.id ?? null;
    } catch (e) { /* ignore */ }

    if (!userId) {
      return { success: false, error: 'Please sign in to leave a review.' };
    }

    // Validate rating
    const numRating = Number(rating);
    if (!numRating || numRating < 1 || numRating > 5) {
      return { success: false, error: 'Please select a star rating (1–5).' };
    }

    // Check if user purchased this PDF (verified review)
    let verified = false;
    try {
      const { count } = await client
        .from('purchased_pdfs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('pdf_uuid', String(pdfId))
        .eq('status', 'paid');
      verified = (count || 0) > 0;
    } catch (_) { /* non-fatal — just mark unverified */ }

    try {
      const { error } = await client
        .from('pdf_reviews')
        .upsert(
          {
            pdf_id:  pdfId,
            user_id: userId,
            rating:  numRating,
            comment: (comment || '').trim() || null,
            verified,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,pdf_id' }
        );

      if (error) return { success: false, error: error.message };

      // Bust the cache for this PDF so card re-fetches fresh stats
      const cacheKey = 'review_stats:' + pdfId;
      if (window._supabaseCache) window._supabaseCache.delete(cacheKey);

      return { success: true, verified };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };

  /**
   * checkUserReview(pdfId)
   * Returns the current user's existing review for a PDF, or null.
   */
  window.checkUserReview = async function checkUserReview(pdfId) {
    const client = sb();
    if (!client || !pdfId) return null;
    try {
      const { data: { user } } = await client.auth.getUser();
      if (!user) return null;
      const { data } = await client
        .from('pdf_reviews')
        .select('id,rating,comment,verified')
        .eq('pdf_id', pdfId)
        .eq('user_id', user.id)
        .maybeSingle();
      return data || null;
    } catch (_) { return null; }
  };

  // ── TESTIMONIALS ─────────────────────────────────────────────────

  /**
   * loadTestimonials(limit?)
   * Fetches active testimonials ordered by sort_order for homepage display.
   * Returns an array of { id, name, role, text, stars, image_url, verified }.
   * Falls back to empty array on error — caller uses static fallback content.
   * Cached for 5 minutes to avoid repeated loads on tab switches.
   */
  window.loadTestimonials = async function loadTestimonials(limit) {
    const cacheKey = 'testimonials:home';
    return window.cachedSupabaseQuery(cacheKey, async () => {
      const client = window.supabaseClient;
      if (!client) return [];
      const { data, error } = await client
        .from('testimonials')
        .select('id,name,role,text,stars,image_url,verified')
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .limit(limit || 20);
      if (error) { console.warn('loadTestimonials:', error.message); return []; }
      return data || [];
    }, 5 * 60 * 1000);
  };

  // ── PDF SUBSCRIBER NOTIFICATIONS ────────────────────────────────

  /**
   * subscribeForPdfNotifications({ email, whatsapp, notifyEmail, notifyWa })
   * Upserts a subscriber row. Returns { success, error, alreadyExists }.
   * This is the opt-in entry point called from the footer newsletter strip.
   */
  window.subscribeForPdfNotifications = async function subscribeForPdfNotifications({ email, whatsapp, notifyEmail, notifyWa } = {}) {
    const client = window.supabaseClient;
    if (!client) return { success: false, error: 'Not connected' };

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, error: 'Enter a valid email address.' };
    }

    // Normalise WhatsApp — strip non-digits, ensure leading +
    const waNorm = whatsapp
      ? ('+' + whatsapp.replace(/\D/g, ''))
      : null;

    try {
      const { data: existing } = await client
        .from('pdf_subscribers')
        .select('id, notify_email, notify_wa')
        .eq('email', email.toLowerCase())
        .maybeSingle();

      if (existing) {
        // Update preferences silently — don't error on duplicate
        await client
          .from('pdf_subscribers')
          .update({
            whatsapp:     waNorm || existing.whatsapp || null,
            notify_email: notifyEmail !== false,
            notify_wa:    !!(notifyWa && waNorm),
          })
          .eq('email', email.toLowerCase());
        return { success: true, alreadyExists: true };
      }

      const { error } = await client
        .from('pdf_subscribers')
        .insert({
          email:        email.toLowerCase(),
          whatsapp:     waNorm,
          notify_email: notifyEmail !== false,
          notify_wa:    !!(notifyWa && waNorm),
          confirmed:    true, // opt-in from the site form = confirmed
        });

      if (error) return { success: false, error: error.message };
      return { success: true, alreadyExists: false };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };

  /**
   * notifyPdfSubscribers({ pdfId, title, category, coverUrl, pdfUrl })
   * Called immediately after a PDF is published.
   * Reads all confirmed subscribers and dispatches:
   *   - Email via Pipedream webhook (each subscriber with notify_email = true)
   *   - WhatsApp via Pipedream webhook (each subscriber with notify_wa = true)
   * The Pipedream workflow is responsible for the actual sending.
   * Returns { emailSent, waSent, errors }.
   */
  window.notifyPdfSubscribers = async function notifyPdfSubscribers({ pdfId, title, category, coverUrl, pdfUrl } = {}) {
    const client = window.supabaseClient;
    if (!client) { console.warn('notifyPdfSubscribers: no supabaseClient'); return; }

    // Admin-only: fetch confirmed subscribers
    let subscribers = [];
    try {
      const { data, error } = await client
        .from('pdf_subscribers')
        .select('email, whatsapp, notify_email, notify_wa')
        .eq('confirmed', true);
      if (error) { console.error('notifyPdfSubscribers: fetch error', error); return; }
      subscribers = data || [];
    } catch (e) {
      console.error('notifyPdfSubscribers: exception', e);
      return;
    }

    if (!subscribers.length) {
      console.log('notifyPdfSubscribers: no confirmed subscribers');
      return;
    }

    const webhookUrl = document.getElementById('stgPipedream')?.value?.trim()
      || 'https://eod16l3iacfjwl6.m.pipedream.net';

    const pdfLink  = pdfUrl  || `https://studyria.qzz.io/#library`;
    const catLabel = category || 'Study Material';
    const coverImg = coverUrl || '';

    let emailSent = 0, waSent = 0, errors = 0;

    const emailSubscribers = subscribers.filter(s => s.notify_email && s.email);
    const waSubscribers    = subscribers.filter(s => s.notify_wa    && s.whatsapp);

    // Batch email notification payload
    if (emailSubscribers.length) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event:       'new_pdf_email_batch',
            pdf_id:      pdfId,
            title,
            category:    catLabel,
            cover_url:   coverImg,
            pdf_link:    pdfLink,
            subscribers: emailSubscribers.map(s => ({ email: s.email })),
            sent_at:     new Date().toISOString(),
          }),
        });
        emailSent = emailSubscribers.length;
        console.log(`[Notify] Email batch dispatched to ${emailSent} subscribers`);
      } catch (e) {
        console.error('[Notify] Email batch failed:', e);
        errors++;
      }
    }

    // Batch WhatsApp notification payload
    if (waSubscribers.length) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event:       'new_pdf_whatsapp_batch',
            pdf_id:      pdfId,
            title,
            category:    catLabel,
            cover_url:   coverImg,
            pdf_link:    pdfLink,
            subscribers: waSubscribers.map(s => ({ whatsapp: s.whatsapp })),
            sent_at:     new Date().toISOString(),
          }),
        });
        waSent = waSubscribers.length;
        console.log(`[Notify] WhatsApp batch dispatched to ${waSent} subscribers`);
      } catch (e) {
        console.error('[Notify] WhatsApp batch failed:', e);
        errors++;
      }
    }

    return { emailSent, waSent, errors };
  };

  // ══════════════════════════════════════════════════════════════════
  // 🔔 PUSH NOTIFICATIONS (OneSignal) — admin send / schedule / history
  // ══════════════════════════════════════════════════════════════════
  //
  // This app has no custom server, so the actual OneSignal REST call is
  // delegated to the same Pipedream webhook already used for email/WA
  // (see _pushWebhookUrl below). These functions only manage Supabase
  // history rows + trigger the webhook; they never touch a REST API key.

  function _pushWebhookUrl() {
    return document.getElementById('stgPipedream')?.value?.trim()
      || 'https://eod16l3iacfjwl6.m.pipedream.net';
  }

  /**
   * sendPushNotification({ title, message, imageUrl, clickUrl, audience, scheduleAt, isTest })
   * - isTest=true   → fires only to the admin's own device, never logged as a real send.
   * - scheduleAt    → ISO datetime string; if provided and in the future, stores as 'scheduled'
   *                    instead of dispatching immediately.
   * Returns the created/updated push_notifications row, or null on failure.
   */
  window.sendPushNotification = async function sendPushNotification({
    title, message, imageUrl = null, clickUrl = null, audience = 'all', scheduleAt = null, isTest = false,
  } = {}) {
    const client = window.supabaseClient;
    if (!client) { console.warn('sendPushNotification: no supabaseClient'); return null; }
    if (!title || !message) { console.warn('sendPushNotification: title and message are required'); return null; }

    const isFuture = scheduleAt && new Date(scheduleAt).getTime() > Date.now();
    const status = isTest ? 'test' : (isFuture ? 'scheduled' : 'pending');

    let row = null;
    try {
      const { data, error } = await client
        .from('push_notifications')
        .insert({
          title, message, image_url: imageUrl, click_url: clickUrl,
          audience, status,
          scheduled_at: isFuture ? scheduleAt : null,
          created_by: window.currentUser?.email || window.adminSession?.email || 'admin',
        })
        .select()
        .single();
      if (error) throw error;
      row = data;
    } catch (e) {
      console.error('sendPushNotification: insert failed', e);
      return null;
    }

    // If scheduled for later, stop here — a scheduled job / cron on the
    // Pipedream side (or a periodic admin check) should pick this up at
    // scheduled_at and call dispatchPushNotification(row.id).
    if (isFuture && !isTest) return row;

    return window.dispatchPushNotification(row.id, isTest);
  };

  /**
   * dispatchPushNotification(id, isTest)
   * Actually fires the webhook for a given push_notifications row id.
   * Marks the row 'sent' / 'failed' based on the webhook response.
   */
  window.dispatchPushNotification = async function dispatchPushNotification(id, isTest = false) {
    const client = window.supabaseClient;
    if (!client) return null;

    const { data: row, error: fetchErr } = await client
      .from('push_notifications').select('*').eq('id', id).single();
    if (fetchErr || !row) { console.error('dispatchPushNotification: row not found', fetchErr); return null; }

    try {
      const resp = await fetch(_pushWebhookUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event:        'push_send',
          notification_id: row.id,
          title:        row.title,
          message:      row.message,
          image_url:    row.image_url,
          click_url:    row.click_url,
          audience:     row.audience,     // 'all' | 'premium' | 'free' — map to OneSignal segments/tags server-side
          test:         !!isTest,
          sent_at:      new Date().toISOString(),
        }),
      });
      const ok = resp.ok;
      const { data: updated } = await client
        .from('push_notifications')
        .update({
          status:  isTest ? 'test' : (ok ? 'sent' : 'failed'),
          sent_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();
      return updated || row;
    } catch (e) {
      console.error('dispatchPushNotification: webhook failed', e);
      await client.from('push_notifications').update({ status: 'failed' }).eq('id', id);
      return null;
    }
  };

  /**
   * cancelScheduledNotification(id) — only works while status === 'scheduled'.
   */
  window.cancelScheduledNotification = async function cancelScheduledNotification(id) {
    const client = window.supabaseClient;
    if (!client) return false;
    try {
      const { error } = await client
        .from('push_notifications')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .eq('status', 'scheduled');
      return !error;
    } catch (e) { console.error('cancelScheduledNotification:', e); return false; }
  };

  /**
   * loadPushNotificationHistory(limit) — most recent notifications first.
   */
  window.loadPushNotificationHistory = async function loadPushNotificationHistory(limit = 50) {
    const client = window.supabaseClient;
    if (!client) return [];
    try {
      const { data, error } = await client
        .from('push_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    } catch (e) { console.error('loadPushNotificationHistory:', e); return []; }
  };

  /**
   * checkDueScheduledNotifications() — call periodically (e.g. on admin tab
   * open) to dispatch any 'scheduled' rows whose time has arrived. Since
   * there's no server cron, this is a best-effort client-side trigger.
   */
  window.checkDueScheduledNotifications = async function checkDueScheduledNotifications() {
    const client = window.supabaseClient;
    if (!client) return;
    try {
      const { data } = await client
        .from('push_notifications')
        .select('id,scheduled_at')
        .eq('status', 'scheduled')
        .lte('scheduled_at', new Date().toISOString());
      for (const row of (data || [])) {
        await window.dispatchPushNotification(row.id, false);
      }
    } catch (e) { console.warn('checkDueScheduledNotifications:', e); }
  };

  // ══════════════════════════════════════════════════════════════════
  // 📱 WHATSAPP COMMUNITY BROADCASTS
  // ══════════════════════════════════════════════════════════════════

  /**
   * sendWhatsAppCommunityMessage({ inviteLink, title, message, imageUrl, isTest })
   * Logs the broadcast in Supabase and forwards it to the Pipedream webhook,
   * which is expected to relay it to your WhatsApp Business/Cloud API setup.
   */
  window.sendWhatsAppCommunityMessage = async function sendWhatsAppCommunityMessage({
    inviteLink = null, title, message, imageUrl = null, isTest = false,
  } = {}) {
    const client = window.supabaseClient;
    if (!client) { console.warn('sendWhatsAppCommunityMessage: no supabaseClient'); return null; }
    if (!title || !message) { console.warn('sendWhatsAppCommunityMessage: title and message are required'); return null; }

    let ok = false;
    try {
      const resp = await fetch(_pushWebhookUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event:       'wa_broadcast',
          invite_link: inviteLink,
          title, message, image_url: imageUrl,
          test:        !!isTest,
          sent_at:     new Date().toISOString(),
        }),
      });
      ok = resp.ok;
    } catch (e) {
      console.error('sendWhatsAppCommunityMessage: webhook failed', e);
    }

    try {
      const { data, error } = await client
        .from('whatsapp_broadcasts')
        .insert({
          invite_link: inviteLink, title, message, image_url: imageUrl,
          status: isTest ? 'test' : (ok ? 'sent' : 'failed'),
          created_by: window.currentUser?.email || window.adminSession?.email || 'admin',
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (e) {
      console.error('sendWhatsAppCommunityMessage: history insert failed', e);
      return null;
    }
  };

  /**
   * loadWhatsAppBroadcastHistory(limit)
   */
  window.loadWhatsAppBroadcastHistory = async function loadWhatsAppBroadcastHistory(limit = 50) {
    const client = window.supabaseClient;
    if (!client) return [];
    try {
      const { data, error } = await client
        .from('whatsapp_broadcasts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    } catch (e) { console.error('loadWhatsAppBroadcastHistory:', e); return []; }
  };

  /**
   * loadPdfSubscriberCount()
   * Returns total confirmed subscriber count (for admin display).
   */
  window.loadPdfSubscriberCount = async function loadPdfSubscriberCount() {
    const client = window.supabaseClient;
    if (!client) return 0;
    try {
      const { count } = await client
        .from('pdf_subscribers')
        .select('id', { count: 'exact', head: true })
        .eq('confirmed', true);
      return count || 0;
    } catch (_) { return 0; }
  };


  // ══════════════════════════════════════════════════════════════════
  // 📚 CLASSIFICATION CRUD — Categories, Subcategories, Academic Levels,
  //    Streams, Semester/Classes, Subjects
  // ══════════════════════════════════════════════════════════════════

  /**
   * classifFetch(table, filters?)
   * Generic fetch for any classification table. Ordered by sort_order, name.
   * Returns array of { id, name, slug, sort_order }. Cached 5 min.
   */
  window.classifFetch = async function classifFetch(table, filters) {
    const cacheKey = 'classif:' + table + ':' + JSON.stringify(filters || {});
    return window.cachedSupabaseQuery(cacheKey, async () => {
      const client = window.supabaseClient;
      if (!client) return [];
      let q = client.from(table).select('id,name,slug,sort_order').order('sort_order').order('name');
      if (filters) { Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v); }); }
      const { data, error } = await q;
      if (error) { console.warn('classifFetch', table, error.message); return []; }
      return data || [];
    }, 5 * 60 * 1000);
  };

  /**
   * classifCreate(table, name, extraFields?)
   * Inserts a new classification row. Busts cache. Returns row or null.
   */
  window.classifCreate = async function classifCreate(table, name, extraFields) {
    const client = window.supabaseClient;
    if (!client) return null;
    const payload = {
      name: name.trim(),
      slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      sort_order: 0,
      ...(extraFields || {}),
    };
    try {
      const { data, error } = await client.from(table).insert(payload).select().single();
      if (error) throw error;
      if (window._supabaseCache) {
        window._supabaseCache.forEach((_, k) => { if (k.startsWith('classif:' + table)) window._supabaseCache.delete(k); });
      }
      return data;
    } catch (e) { console.error('classifCreate', table, e.message); return null; }
  };

  /**
   * classifUpdate(table, id, name)
   * Updates name+slug. Busts cache. Returns true on success.
   */
  window.classifUpdate = async function classifUpdate(table, id, name) {
    const client = window.supabaseClient;
    if (!client) return false;
    try {
      const { error } = await client.from(table).update({
        name: name.trim(),
        slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      }).eq('id', id);
      if (error) throw error;
      if (window._supabaseCache) {
        window._supabaseCache.forEach((_, k) => { if (k.startsWith('classif:' + table)) window._supabaseCache.delete(k); });
      }
      return true;
    } catch (e) { console.error('classifUpdate', table, e.message); return false; }
  };

  /**
   * classifDelete(table, id)
   * Deletes row. Child rows cascade via FK. Busts full classif cache.
   */
  window.classifDelete = async function classifDelete(table, id) {
    const client = window.supabaseClient;
    if (!client) return false;
    try {
      const { error } = await client.from(table).delete().eq('id', id);
      if (error) throw error;
      if (window._supabaseCache) {
        window._supabaseCache.forEach((_, k) => { if (k.startsWith('classif:')) window._supabaseCache.delete(k); });
      }
      return true;
    } catch (e) { console.error('classifDelete', table, e.message); return false; }
  };

  /**
   * initClassifRealtime()
   * Subscribes to realtime on all 6 classification tables.
   * Busts classif cache on any change + refreshes open dropdowns.
   */
  window.initClassifRealtime = function initClassifRealtime() {
    const client = window.supabaseClient;
    if (!client) return;
    ['categories','subcategories','academic_levels','streams','semester_classes','subjects'].forEach(t => {
      client
        .channel('classif_' + t)
        .on('postgres_changes', { event: '*', schema: 'public', table: t }, () => {
          if (window._supabaseCache) {
            window._supabaseCache.forEach((_, k) => { if (k.startsWith('classif:' + t)) window._supabaseCache.delete(k); });
          }
          if (typeof window.apRefreshCategories === 'function') {
            try { window.apRefreshCategories(); } catch (_) {}
          }
        })
        .subscribe();
    });
  };



  // ── SPM PUBLISH HOOK ─────────────────────────────────────────────
  // Called by smart-publish-manager.js after each successful publish.
  // Triggers subscriber notifications and refreshes the live PDFS array.
  window.spmOnPublishSuccess = async function spmOnPublishSuccess(publishedRows) {
    if (!publishedRows || !publishedRows.length) return;
    const client = sb();
    if (!client) return;

    // Refresh the public PDFS array to include newly published PDFs
    try {
      const ids = publishedRows.map(r => r.id);
      const { data: freshRows } = await client
        .from('pdfs')
        .select('*')
        .in('id', ids)
        .eq('status', 'published');
      if (freshRows?.length) {
        if (Array.isArray(window.PDFS)) {
          freshRows.forEach(row => {
            const idx = window.PDFS.findIndex(p => String(p.id) === String(row.id));
            if (idx >= 0) Object.assign(window.PDFS[idx], row);
            else window.PDFS.push(row);
          });
        }
      }
    } catch(e) { console.warn('spmOnPublishSuccess: PDFS refresh failed', e); }

    // Notify subscribers for each newly published PDF (non-blocking)
    for (const row of publishedRows) {
      try {
        await window.notifyPdfSubscribers({
          pdfId:    row.id,
          title:    row.title,
          category: row.category,
          coverUrl: row.cover_url || row.cover_image,
          pdfUrl:   row.pdf_url  || row.file_url,
        });
      } catch(e) { console.warn('spmOnPublishSuccess: notify failed for', row.id, e); }
    }
  };

  // ── BOOT ─────────────────────────────────────────────────────────
  // Phase 1 — restore session before DOMContentLoaded
  window._supabaseSessionReady = (async function _restoreSession() {
    const client = sb();
    if (!client) return null;

    try {
      const { data: { session }, error } = await client.auth.getSession();
      console.log('🔐 _restoreSession: session=', session?.user?.id ?? null, 'error=', error?.message ?? null);

      if (!error && session?.user) {
        window.syncNavToAuth(session.user);

        // Pre-warm purchased PDFs list so library buttons reflect ownership instantly
        try {
          const { data: purchases } = await client
            .from('purchased_pdfs')
            .select('pdf_uuid,pdf_id,title')
            .eq('user_id', session.user.id);
          if (purchases?.length) {
            window._purchasedPdfIds = new Set(
              purchases.map(r => String(r.pdf_uuid || r.pdf_id)).filter(Boolean)
            );
          }
        } catch (_) {}

        // ── NEW: pre-warm Career Hub saved jobs from the restored session ──
        if (typeof window._chLoadSavedFromSupabase === 'function') {
          window._chLoadSavedFromSupabase();
        }

        return session.user;
      }
    } catch (e) {
      console.warn('⚠️ getSession error:', e);
    }
    return null;
  })();

  // Phase 2 — ongoing auth listener (after DOM ready)
  document.addEventListener('DOMContentLoaded', function () {
    window.supabase = window.supabaseClient;

    const client = sb();
    if (!client) return;

    client.auth.onAuthStateChange(async function (event, session) {
      const user = session?.user ?? null;
      console.log('🔄 onAuthStateChange:', event, user?.id ?? null);

      if (event === 'INITIAL_SESSION') {
        window.syncNavToAuth(user);
        if (user) await window.loadWishlistFromSupabase();
        return;
      }

      if (event === 'SIGNED_IN') {
        window.syncNavToAuth(user);
        window._dashCache = null;

        // ── Auto-sync: push any guest (logged-out) wishlist items into
        // Supabase before loading, so nothing saved while logged out
        // is ever lost. ──
        if (user) await window._mergeGuestWishlistIntoSupabase(user.id);
        await window.loadWishlistFromSupabase();

        // Create/update public.users profile (avatar, name, email, provider, last_login)
        if (user) window.syncUserProfile(user);

        // Pre-warm purchased PDF IDs for ownership-aware buttons
        try {
          const { data: purchases } = await sb()
            .from('purchased_pdfs')
            .select('pdf_uuid,pdf_id')
            .eq('user_id', user.id);
          if (purchases?.length) {
            window._purchasedPdfIds = new Set(
              purchases.map(r => String(r.pdf_uuid || r.pdf_id)).filter(Boolean)
            );
            if (typeof window._refreshFreeButtonLabels === 'function') window._refreshFreeButtonLabels();
          }
        } catch (_) {}

        // ── NEW: sync Career Hub saved jobs on sign-in ────────────
        if (typeof window._chLoadSavedFromSupabase === 'function') {
          window._chLoadSavedFromSupabase();
        }

        // ── Google OAuth redirect-back: land on Dashboard, not Home ──
        let cameFromOAuthRedirect = false;
        try {
          if (sessionStorage.getItem('studyria_oauth_pending') === '1') {
            cameFromOAuthRedirect = true;
            sessionStorage.removeItem('studyria_oauth_pending');
          }
        } catch (_) {}

        if (typeof window.showToast === 'function') {
          const name  = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || '';
          const first = name.split(/[\s@]/)[0];
          window.showToast('Welcome back' + (first ? ', ' + first : '') + '! 👋', 'success');
        }

        if (cameFromOAuthRedirect && typeof window.navigate === 'function') {
          window.navigate('dashboard');
        }
        return;
      }

      if (event === 'SIGNED_OUT') {
        window.syncNavToAuth(null);
        window._purchasedPdfIds = new Set();
        await window.loadWishlistFromSupabase(); // falls back to guest-local (empty) wishlist
        window._dashCache = null;

        // ── NEW: clear Career Hub saved jobs on logout ────────────
        if (window._chState) {
          window._chState.savedJobs = [];
          localStorage.removeItem('ch_saved_jobs');
          if (typeof window._chUpdateSavedCount === 'function') window._chUpdateSavedCount();
          const pg = window.currentPage || '';
          if (pg === 'career-hub' && typeof chFilterJobs === 'function') chFilterJobs();
        }
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        window.syncNavToAuth(user);
        return;
      }

      if (event === 'PASSWORD_RECOVERY') {
        if (typeof window.navigate     === 'function') window.navigate('login');
        if (typeof window.showAuthPage === 'function') window.showAuthPage('reset-password');
        return;
      }
    });

    window.initRealtimeSync();

    // ── Kick off homepage live stats + activity bar ──────────────
    // Run after a short delay so page render is already done
    setTimeout(function () {
      if (typeof window.initPlatformStats   === 'function') window.initPlatformStats();
      if (typeof window.loadActivityBarStats === 'function') window.loadActivityBarStats();
    }, 500);
  });

})();
