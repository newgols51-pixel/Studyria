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
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    }
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
    if (box)  { if (msgEl) msgEl.textContent = msg; box.style.display = 'flex'; }
  }
  function clearAuthErr(elId) {
    const box = document.getElementById(elId);
    if (box) box.style.display = 'none';
  }

  // ── BUILD currentUser OBJECT ─────────────────────────────────────
  // Centralised so both syncNavToAuth and the Phase-1 fallback
  // always produce an identical object shape.
  function _buildCurrentUser(user) {
    const name     = user.user_metadata?.full_name || user.email || '';
    const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'U';
    return {
      uid:        user.id,   // ← uuid string — used for all user_wishlist queries
      name:       name,
      email:      user.email,
      avatar:     initials,
      plan:       'Pro',
      joined:     new Date(user.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      purchased:  0,
      totalSpent: 0,
      wishlist:   0
    };
  }

  // ── SYNC NAV TO AUTH STATE ───────────────────────────────────────
  window.syncNavToAuth = function (user) {
    const area = document.getElementById('navUserArea');

    // If an admin session is active, don't touch the nav.
    if (window.adminSession) return;

    if (user) {
      // Always (re-)populate window.currentUser — even if area is missing
      // (e.g. called before DOM is ready during Phase-1 restore).
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

    // If dashboard is open, re-render it to reflect auth state change.
    const pg = window.currentPage || (typeof currentPage !== 'undefined' ? currentPage : '');
    if (pg === 'dashboard') {
      if (typeof window.renderDashboard === 'function') window.renderDashboard();
    }
  };

  // ── WISHLIST — LOAD FROM SUPABASE ────────────────────────────────
  // FIX: Guard flag prevents the loadWishlistFromSupabase → renderWishlist
  // → loadWishlistFromSupabase infinite loop that was silently aborting
  // mid-load and leaving the wishlist array empty after refresh.
  let _wishlistLoading = false;

  window.loadWishlistFromSupabase = async function loadWishlistFromSupabase() {
    if (_wishlistLoading) {
      console.log('⏳ loadWishlistFromSupabase: already in-flight, skipping duplicate call');
      return;
    }
    _wishlistLoading = true;

    const client = window.supabaseClient;
    if (!client) { _wishlistLoading = false; return; }

    // Always resolve user from the live Supabase session — not just window.currentUser —
    // so that a page refresh that hasn't yet run syncNavToAuth still gets the right uid.
    let userId = window.currentUser?.uid ?? null;
    if (!userId) {
      try {
        const { data: { session } } = await client.auth.getSession();
        if (session?.user) {
          // Populate window.currentUser if not yet set
          if (!window.currentUser) {
            window.syncNavToAuth(session.user);
          }
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

    // Remove any stale localStorage wishlist data
    try { localStorage.removeItem('studyria_wishlist'); } catch(e) {}

    try {
      console.log('📋 Loading wishlist for user:', userId);

      const { data, error } = await client
        .from('user_wishlist')
        .select('pdf_id')
        .eq('user_id', userId);

      console.log('Wishlist Load Result:', { data, error });

      if (error) {
        console.error('❌ loadWishlistFromSupabase error:', {
          message: error.message,
          code:    error.code,
          hint:    error.hint,
          details: error.details
        });
        _wishlistLoading = false;
        return;
      }

      // Normalise to both Number and String for fast includes() checks
      const loaded = (data || []).map(r => {
        const n = Number(r.pdf_id);
        return isNaN(n) ? r.pdf_id : n;
      });

      // Write to the global wishlist array (declared as `let wishlist = []` in index.html)
      if (typeof window.wishlist !== 'undefined') {
        window.wishlist = loaded;
      }
      // Also try the script-scope variable via assignment trick
      try { wishlist = loaded; } catch(e) {}

      console.log('✅ Wishlist loaded:', loaded.length, 'items', loaded);

      // Refresh heart buttons across the page
      if (typeof window._refreshAllWishButtons === 'function') {
        window._refreshAllWishButtons();
      }

      // Bust dashboard cache so Me-section count reflects reality
      window._dashCache = null;

    } catch (e) {
      console.error('❌ loadWishlistFromSupabase exception:', e);
    } finally {
      _wishlistLoading = false;
    }
  };

  // ── WISHLIST — TOGGLE (ADD / REMOVE) ────────────────────────────
  // Replaces toggleWish in index.html.  Exposed on window so onclick
  // attributes can reach it even if the script-scope version is stale.
  window.toggleWishlistItem = async function toggleWishlistItem(id) {
    const client = window.supabaseClient;
    if (!client) { console.error('❌ toggleWishlistItem: no supabaseClient'); return; }

    // Always get a fresh confirmed user id from Supabase — never trust
    // window.currentUser alone because it may not be set yet on refresh.
    let userId = null;
    try {
      const { data: { user: authUser } } = await client.auth.getUser();
      userId = authUser?.id ?? null;
    } catch(e) {
      console.error('❌ toggleWishlistItem: getUser failed', e);
    }

    console.log('Current User:', userId);
    console.log('Saving Wishlist:', id);

    if (!userId) {
      if (typeof showToast === 'function') showToast('Please sign in to save to wishlist.', 'info');
      if (typeof navigate === 'function') navigate('login');
      return;
    }

    // Ensure window.currentUser is in sync
    if (!window.currentUser?.uid) {
      try {
        const { data: { user: u } } = await client.auth.getUser();
        if (u) window.syncNavToAuth(u);
      } catch(e) {}
    }

    const pdfId  = String(id);
    const numId  = Number(id);

    // Read current wishlist state
    const currentWishlist = (() => {
      try { return wishlist; } catch(e) { return window.wishlist || []; }
    })();

    const inWish = currentWishlist.includes(numId) || currentWishlist.includes(pdfId);

    // ── Optimistic UI update (visual only — NO toast yet) ────────
    // Toast fires ONLY after the DB operation confirms success or failure.
    const newWishlist = inWish
      ? currentWishlist.filter(x => Number(x) !== numId && String(x) !== pdfId)
      : [...currentWishlist, numId];

    try { wishlist = newWishlist; } catch(e) {}
    if (typeof window.wishlist !== 'undefined') window.wishlist = newWishlist;

    // Update the specific heart button immediately (visual feedback only)
    const btn = document.getElementById(`wish-${id}`);
    if (btn) {
      const nowIn = !inWish;
      btn.classList.toggle('active', nowIn);
      btn.title = nowIn ? 'Remove from wishlist' : 'Save to wishlist';
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${nowIn ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`;
    }
    // ── NO toast here — wait for DB result below ─────────────────

    // ── Persist to Supabase ──────────────────────────────────────
    try {
      if (inWish) {
        // DELETE
        const { data: delData, error: delError } = await client
          .from('user_wishlist')
          .delete()
          .eq('user_id', userId)
          .eq('pdf_id', pdfId);

        console.log('Wishlist Delete Result:', { delData, delError });

        if (delError) {
          console.error('❌ Wishlist delete failed:', {
            message: delError.message,
            code:    delError.code,
            hint:    delError.hint,
            details: delError.details
          });
          // Revert optimistic UI update
          try { wishlist = currentWishlist; } catch(e) {}
          if (typeof window.wishlist !== 'undefined') window.wishlist = currentWishlist;
          if (typeof window._refreshAllWishButtons === 'function') window._refreshAllWishButtons();
          if (typeof showToast === 'function') showToast(
            `Failed to remove — ${delError.message || 'please try again.'} (code: ${delError.code ?? 'n/a'})`,
            'error'
          );
        } else {
          // ✅ DB confirmed delete — now show success toast
          if (typeof showToast === 'function') showToast('Removed from wishlist', 'info');
        }
      } else {
        // UPSERT
        console.log('Wishlist upsert attempt:', { user_id: userId, pdf_id: pdfId });

        const { data: upsertData, error: upsertError } = await client
          .from('user_wishlist')
          .upsert(
            { user_id: userId, pdf_id: pdfId },
            { onConflict: 'user_id,pdf_id' }
          );

        console.log('Wishlist Insert Result:', { upsertData, upsertError });

        if (upsertError) {
          console.error('❌ Wishlist upsert failed — FULL ERROR:', {
            message: upsertError.message,
            code:    upsertError.code,
            hint:    upsertError.hint,
            details: upsertError.details
          });
          console.error('❌ Failing query payload:', { user_id: userId, pdf_id: pdfId });
          // Revert optimistic UI update
          try { wishlist = currentWishlist; } catch(e) {}
          if (typeof window.wishlist !== 'undefined') window.wishlist = currentWishlist;
          if (typeof window._refreshAllWishButtons === 'function') window._refreshAllWishButtons();
          // Show the REAL error reason, not a generic message
          const reason = upsertError.message || 'unknown error';
          if (typeof showToast === 'function') showToast(
            `Failed to save — ${reason} (code: ${upsertError.code ?? 'n/a'})`,
            'error'
          );
        } else {
          // ── Verification: confirm row actually exists after upsert ──
          const { data: verifyData, error: verifyErr } = await client
            .from('user_wishlist')
            .select('pdf_id')
            .eq('user_id', userId)
            .eq('pdf_id', pdfId);

          if (verifyErr || !verifyData || verifyData.length === 0) {
            // Upsert returned no error but row isn't readable — RLS SELECT gap
            console.error(
              '❌ WISHLIST VERIFICATION FAILED — upsert reported success but row unreadable!',
              '\n  user_id:', userId,
              '\n  pdf_id:', pdfId,
              '\n  verifyErr:', verifyErr ? { message: verifyErr.message, code: verifyErr.code, hint: verifyErr.hint, details: verifyErr.details } : 'none',
              '\n  rows returned:', verifyData?.length ?? 0,
              '\n  LIKELY CAUSE: RLS policy is missing a SELECT grant, or pdf_id column type mismatch (text vs int)'
            );
            // Revert — the row is unconfirmed
            try { wishlist = currentWishlist; } catch(e) {}
            if (typeof window.wishlist !== 'undefined') window.wishlist = currentWishlist;
            if (typeof window._refreshAllWishButtons === 'function') window._refreshAllWishButtons();
            if (typeof showToast === 'function') showToast(
              'Save may have failed — could not verify. Check RLS SELECT policy on user_wishlist.',
              'error'
            );
          } else {
            console.log('✅ Wishlist verification PASSED — row confirmed in DB for user', userId, 'pdf_id', pdfId);
            // ✅ DB confirmed insert AND verified — NOW show success toast
            const pdf = (window.PDFS || []).find(p => Number(p.id) === numId);
            if (typeof showToast === 'function')
              showToast((pdf ? pdf.title + ' ' : '') + 'saved! ❤️', 'success');
          }
        }
      }

      // Bust dashboard cache
      window._dashCache = null;

      // FIX: window.currentPage is now set by navigate() in index.html.
      // Also try script-scope currentPage as fallback.
      const pg = window.currentPage || (typeof currentPage !== 'undefined' ? currentPage : '');
      console.log('toggleWishlistItem: post-save page check — currentPage:', pg);

      if (pg === 'dashboard' && typeof window._refreshDashStats === 'function') {
        window._refreshDashStats();
      }
      // Wishlist page: reload from DB then re-render (not just re-render from stale array)
      if (pg === 'wishlist') {
        await window.loadWishlistFromSupabase();
        if (typeof window.renderWishlist === 'function') {
          window.renderWishlist();
        }
      }

    } catch (e) {
      console.error('❌ toggleWishlistItem Supabase exception:', e);
      // Revert
      try { wishlist = currentWishlist; } catch(ee) {}
      if (typeof window.wishlist !== 'undefined') window.wishlist = currentWishlist;
      if (typeof window._refreshAllWishButtons === 'function') window._refreshAllWishButtons();
    }
  };

  // Back-compat alias — index.html calls toggleWish(id)
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
        window.pipedream_onLogin(email, data.user?.user_metadata?.full_name || '');
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

    const { data, error } = await client.auth.signUp({
      email,
      password: pass,
      options: { data: { full_name: name } }
    });

    if (btn) { btn.disabled = false; btn.innerHTML = 'Create Account'; }

    if (error) {
      showAuthErr('signupError', error.message);
    } else {
      // Show verification notice
      const emailEl = document.getElementById('verifyEmail');
      if (emailEl) emailEl.textContent = email;
      if (typeof window.showAuthPage === 'function') window.showAuthPage('verify');
    }
  };

  // ── LOGOUT ───────────────────────────────────────────────────────
  window.authLogout = async function () {
    const client = sb();
    if (client) await client.auth.signOut();
    // onAuthStateChange SIGNED_OUT will handle the rest
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
      redirectTo: window.location.origin + window.location.pathname + '?reset=1'
    });

    if (error) {
      showAuthErr('forgotError', error.message);
    } else {
      if (typeof window.showToast   === 'function') window.showToast('Reset link sent! Check your inbox.', 'success');
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
      if (typeof window.showToast   === 'function') window.showToast('Password updated! Please sign in.', 'success');
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

  // ── REALTIME PDF SYNC ────────────────────────────────────────────
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
  };

  // ── BOOT ─────────────────────────────────────────────────────────
  // Phase 1 — restore session synchronously before DOMContentLoaded.
  window._supabaseSessionReady = (async function _restoreSession() {
    const client = sb();
    if (!client) return null;

    try {
      const { data: { session }, error } = await client.auth.getSession();
      console.log('🔐 _restoreSession: session=', session?.user?.id ?? null, 'error=', error?.message ?? null);

      if (!error && session?.user) {
        // syncNavToAuth now safely sets window.currentUser even if the
        // DOM isn't ready yet (area will be null, but currentUser is still set).
        window.syncNavToAuth(session.user);
        return session.user;
      }
    } catch (e) {
      console.warn('⚠️ getSession error:', e);
    }
    return null;
  })();

  // Phase 2 — ongoing auth listener (set up after DOM ready).
  document.addEventListener('DOMContentLoaded', function () {
    // Expose the live client as window.supabase for bare supabase.auth.* calls
    window.supabase = window.supabaseClient;

    const client = sb();
    if (!client) return;

    client.auth.onAuthStateChange(async function (event, session) {
      const user = session?.user ?? null;
      console.log('🔄 onAuthStateChange:', event, user?.id ?? null);

      if (event === 'INITIAL_SESSION') {
        window.syncNavToAuth(user);
        // Load wishlist now that DOM is ready and currentUser is confirmed
        if (user) {
          await window.loadWishlistFromSupabase();
        }
        return;
      }

      if (event === 'SIGNED_IN') {
        window.syncNavToAuth(user);
        window._dashCache = null;
        // Load wishlist for newly signed-in user
        await window.loadWishlistFromSupabase();
        if (typeof window.showToast === 'function') {
          const name  = user?.user_metadata?.full_name || user?.email || '';
          const first = name.split(/[\s@]/)[0];
          window.showToast('Welcome back' + (first ? ', ' + first : '') + '! 👋', 'success');
        }
        return;
      }

      if (event === 'SIGNED_OUT') {
        window.syncNavToAuth(null);
        // Clear local wishlist on logout
        try { wishlist = []; } catch(e) {}
        if (typeof window.wishlist !== 'undefined') window.wishlist = [];
        window._dashCache = null;
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
