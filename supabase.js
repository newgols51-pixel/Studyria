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
// -- Career Hub tables → see supabase-setup.sql (generated separately)
// ─────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── CONFIG ──────────────────────────────────────────────────────
  const SUPABASE_URL  = 'https://qsdfmgcekdpjdcyqhuhi.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzZGZtZ2Nla2RwamRjeXFodWhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NTE2NDcsImV4cCI6MjA5NjIyNzY0N30.kDOEYxUQyLTp1blasuX2kVSIy2olGLhdqqtOMTlEX5g';

  // ── INIT CLIENT ─────────────────────────────────────────────────
  const _supabaseSDK = window.supabase;
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
    const name     = user.user_metadata?.full_name || user.email || '';
    const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'U';
    return {
      uid:        user.id,
      name,
      email:      user.email,
      avatar:     initials,
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
        const { name, avatar } = window.currentUser;
        area.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="avatar-btn" id="navAvatarBtn"
              title="${name}"
              style="width:38px;height:38px;font-size:.9rem;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:700;font-family:var(--font-body);"
              onclick="navigate('dashboard')"
            ><span id="navAvatarText">${avatar}</span></button>
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
    if (pg === 'dashboard' && typeof window.renderDashboard === 'function') {
      window.renderDashboard();
    }

    // ── NEW: if Career Hub is open and auth state just changed, resync saves ──
    if (pg === 'career-hub' && typeof window._chLoadSavedFromSupabase === 'function') {
      window._chLoadSavedFromSupabase();
    }
  };

  // ── WISHLIST — LOAD FROM SUPABASE ────────────────────────────────
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
      console.log('loadWishlistFromSupabase: no authenticated user — clearing wishlist');
      if (typeof window.wishlist !== 'undefined') window.wishlist = [];
      _wishlistLoading = false;
      return;
    }

    try { localStorage.removeItem('studyria_wishlist'); } catch (_) {}

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

      const loaded = (data || []).map(r => {
        const n = Number(r.pdf_id);
        return isNaN(n) ? r.pdf_id : n;
      });

      if (typeof window.wishlist !== 'undefined') window.wishlist = loaded;
      try { wishlist = loaded; } catch (_) {}

      console.log('✅ Wishlist loaded:', loaded.length, 'items');

      if (typeof window._refreshAllWishButtons === 'function') window._refreshAllWishButtons();
      window._dashCache = null;

    } catch (e) {
      console.error('❌ loadWishlistFromSupabase exception:', e);
    } finally {
      _wishlistLoading = false;
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

    if (!userId) {
      if (typeof showToast === 'function') showToast('Please sign in to save to wishlist.', 'info');
      if (typeof navigate === 'function') navigate('login');
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

    const newWishlist = inWish
      ? currentWishlist.filter(x => Number(x) !== numId && String(x) !== pdfId)
      : [...currentWishlist, numId];

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

      window._dashCache = null;
      const pg = window.currentPage || (typeof currentPage !== 'undefined' ? currentPage : '');
      if (pg === 'dashboard' && typeof window._refreshDashStats === 'function') window._refreshDashStats();
      if (pg === 'wishlist') {
        await window.loadWishlistFromSupabase();
        if (typeof window.renderWishlist === 'function') window.renderWishlist();
      }

    } catch (e) {
      console.error('❌ toggleWishlistItem exception:', e);
      try { wishlist = currentWishlist; } catch (_) {}
      if (typeof window.wishlist !== 'undefined') window.wishlist = currentWishlist;
      if (typeof window._refreshAllWishButtons === 'function') window._refreshAllWishButtons();
    }
  };

  window.toggleWish = window.toggleWishlistItem;

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

  // ── REALTIME — PDF SYNC ──────────────────────────────────────────
  window.initRealtimeSync = function () {
    const client = sb();
    if (!client) return;

    client
      .channel('pdfs_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pdfs' }, () => {
        if (typeof window.renderTrendingShelf    === 'function') window.renderTrendingShelf();
        if (typeof window.renderNewArrivalsShelf === 'function') window.renderNewArrivalsShelf();
        if (typeof window.renderLibGrid          === 'function') window.renderLibGrid();
        if (typeof window.showToast              === 'function') window.showToast('📚 Library updated in real-time!', 'info');
      })
      .subscribe();

    // ── NEW: Career Hub Realtime ─────────────────────────────────
    // Ensures career-hub.js's own subscription is started as soon as
    // the client is available, even if the Career Hub tab hasn't been
    // opened yet (so realtime events accumulate from boot).
    if (typeof window._chSubscribeRealtime === 'function') {
      window._chSubscribeRealtime();
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
        await window.loadWishlistFromSupabase();

        // ── NEW: sync Career Hub saved jobs on sign-in ────────────
        if (typeof window._chLoadSavedFromSupabase === 'function') {
          window._chLoadSavedFromSupabase();
        }

        if (typeof window.showToast === 'function') {
          const name  = user?.user_metadata?.full_name || user?.email || '';
          const first = name.split(/[\s@]/)[0];
          window.showToast('Welcome back' + (first ? ', ' + first : '') + '! 👋', 'success');
        }
        return;
      }

      if (event === 'SIGNED_OUT') {
        window.syncNavToAuth(null);
        try { wishlist = []; } catch (_) {}
        if (typeof window.wishlist !== 'undefined') window.wishlist = [];
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
  });

})();
