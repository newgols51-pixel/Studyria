// ══════════════════════════════════════════════════════════════════
// supabase.js — Studyria
// Single source of truth for Supabase client + ALL auth logic.
// Loaded AFTER the @supabase/supabase-js CDN script.
// ══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── CONFIG ──────────────────────────────────────────────────────
  const SUPABASE_URL  = 'https://qsdfmgcekdpjdcyqhuhi.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzZGZtZ2Nla2RwamRjeXFodWhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NTE2NDcsImV4cCI6MjA5NjIyNzY0N30.kDOEYxUQyLTp1blasuX2kVSIy2olGLhdqqtOMTlEX5g';

  // ── INIT CLIENT ─────────────────────────────────────────────────
  // The CDN sets window.supabase = { createClient, ... } on the
  // global. This file is loaded right after the CDN script tag, so
  // window.supabase.createClient is guaranteed to exist here.
  const _supabaseSDK = window.supabase;
  if (!_supabaseSDK || typeof _supabaseSDK.createClient !== 'function') {
    console.error('❌ Supabase SDK not found. Check CDN script load order.');
    return;
  }

  // Create the client once and expose it.
  window.supabaseClient = _supabaseSDK.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    }
  });

  // Convenience accessor.
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

  // ── SYNC NAV TO AUTH STATE ───────────────────────────────────────
  // Updates the nav Sign-In button vs avatar display.
  window.syncNavToAuth = function (user) {
    const area = document.getElementById('navUserArea');
    if (!area) return;

    // If an admin session is active, don't touch the nav.
    if (window.adminSession) return;

    if (user) {
      const name     = user.user_metadata?.full_name || user.email || '';
      const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'U';

      // Populate window.currentUser so renderDashboard() can read it.
      window.currentUser = {
        uid:        user.id,
        name:       name,
        email:      user.email,
        avatar:     initials,
        plan:       'Pro',
        joined:     new Date(user.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
        purchased:  0,
        totalSpent: 0,
        wishlist:   0
      };

      area.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="avatar-btn" id="navAvatarBtn"
            title="${name}"
            style="width:38px;height:38px;font-size:.9rem;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:700;font-family:var(--font-body);"
            onclick="navigate('dashboard')"
          ><span id="navAvatarText">${initials}</span></button>
          <button class="btn btn-ghost btn-sm" onclick="authLogout()" title="Sign out" style="font-size:.78rem;">Sign Out</button>
        </div>`;
    } else {
      window.currentUser = null;
      area.innerHTML = `<button class="btn btn-primary btn-sm" id="navLoginBtn" onclick="navigate('login')">Sign In</button>`;
    }

    // If dashboard is open, re-render it to reflect auth state change.
    if (typeof window.currentPage !== 'undefined' && window.currentPage === 'dashboard') {
      if (typeof window.renderDashboard === 'function') window.renderDashboard();
    }
  };

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
      // onAuthStateChange will fire SIGNED_IN and handle syncNavToAuth + toast.
      // Navigate home now so the user sees the app.
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
    if (confirm !== undefined && confirm !== pass)
      return showAuthErr('signupError', 'Passwords do not match.');

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span>Creating account…'; }

    const { data, error } = await client.auth.signUp({
      email,
      password: pass,
      options: {
        data: { full_name: name },
        emailRedirectTo: 'https://newgols51-pixel.github.io/studyria/'
      }
    });

    if (btn) { btn.disabled = false; btn.innerHTML = 'Create Account'; }

    if (error) {
      showAuthErr('signupError', error.message);
    } else {
      const verifyEl = document.getElementById('verifyEmail');
      if (verifyEl) verifyEl.textContent = email;

      if (typeof window.pipedream_onSignup === 'function') {
        window.pipedream_onSignup(email, name);
      }
      if (typeof window.showAuthPage === 'function') window.showAuthPage('verify-email');
    }
  };

  // ── LOGOUT ───────────────────────────────────────────────────────
  window.authLogout = async function () {
    const client = sb();
    if (client) await client.auth.signOut();
    // onAuthStateChange fires SIGNED_OUT → syncNavToAuth(null).
    if (typeof window.navigate  === 'function') window.navigate('home');
    if (typeof window.showToast === 'function') window.showToast('You have been signed out.', 'info');
  };

  // ── FORGOT PASSWORD ──────────────────────────────────────────────
  window.authForgotPassword = async function () {
    const client = sb();
    if (!client) return;

    const email = document.getElementById('forgotEmail')?.value?.trim();
    const btn   = document.getElementById('forgotBtn');

    clearAuthErr('forgotError');
    if (!email) return showAuthErr('forgotError', 'Enter your email address.');

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span>Sending…'; }

    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://newgols51-pixel.github.io/studyria/?reset=true'
    });

    if (btn) { btn.disabled = false; btn.innerHTML = 'Send Reset Link'; }

    if (error) {
      showAuthErr('forgotError', error.message);
    } else {
      if (typeof window.pipedream_onForgotPassword === 'function') {
        window.pipedream_onForgotPassword(email);
      }
      if (typeof window.showAuthPage === 'function') window.showAuthPage('forgot-success');
    }
  };

  // ── RESET PASSWORD ───────────────────────────────────────────────
  window.authResetPassword = async function () {
    const client  = sb();
    if (!client) return;

    const pass    = document.getElementById('newPassword')?.value;
    const confirm = document.getElementById('confirmNewPassword')?.value;
    const btn     = document.getElementById('resetBtn');

    clearAuthErr('resetError');
    if (!pass || pass.length < 8) return showAuthErr('resetError', 'Password must be at least 8 characters.');
    if (pass !== confirm)         return showAuthErr('resetError', 'Passwords do not match.');

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span>Updating…'; }

    const { error } = await client.auth.updateUser({ password: pass });

    if (btn) { btn.disabled = false; btn.innerHTML = 'Update Password'; }

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

  // ── ADMIN AUTH (error helper only — adminDoLogin defined in index.html) ──
  function _showAdminErr(msg) {
    const box   = document.getElementById('adminLoginError');
    const msgEl = document.getElementById('adminLoginErrorMsg');
    if (box)  { box.style.display = 'flex'; if (msgEl) msgEl.textContent = msg; }
  }

  // ── REALTIME PDF SYNC ────────────────────────────────────────────
  window.initRealtimeSync = function () {
    const client = sb();
    if (!client) return;

    client
      .channel('pdf_books_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pdf_books' }, () => {
        if (typeof window.renderTrendingShelf    === 'function') window.renderTrendingShelf();
        if (typeof window.renderNewArrivalsShelf === 'function') window.renderNewArrivalsShelf();
        if (typeof window.renderLibGrid          === 'function') window.renderLibGrid();
        if (typeof window.showToast              === 'function') window.showToast('📚 Library updated in real-time!', 'info');
      })
      .subscribe();
  };

  // ── BOOT ─────────────────────────────────────────────────────────
  // Two-phase init:
  //   Phase 1 (sync, right now): getSession() to restore auth state
  //            immediately from localStorage before any render happens.
  //   Phase 2 (async): onAuthStateChange for ongoing state changes.
  //
  // This guarantees that by the time index.html's DOMContentLoaded
  // fires and calls renderHome() / navigate(), window.currentUser is
  // already populated if a valid session exists in localStorage.
  // ─────────────────────────────────────────────────────────────────

  // Phase 1 — kick off session restore immediately (before DOM ready).
  // We store a promise so index.html's DOMContentLoaded can await it.
  window._supabaseSessionReady = (async function _restoreSession() {
    const client = sb();
    if (!client) return null;

    try {
      const { data: { session }, error } = await client.auth.getSession();
      if (!error && session?.user) {
        // Eagerly populate window.currentUser so that any code that
        // runs synchronously after await _supabaseSessionReady can
        // read it without waiting for onAuthStateChange.
        if (typeof window.syncNavToAuth === 'function') {
          window.syncNavToAuth(session.user);
        } else {
          // syncNavToAuth not yet defined (DOM not ready) — pre-populate
          // window.currentUser directly so renderDashboard() works.
          const name     = session.user.user_metadata?.full_name || session.user.email || '';
          const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'U';
          window.currentUser = {
            uid:        session.user.id,
            name:       name,
            email:      session.user.email,
            avatar:     initials,
            plan:       'Pro',
            joined:     new Date(session.user.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
            purchased:  0,
            totalSpent: 0,
            wishlist:   0
          };
        }
        return session.user;
      }
    } catch (e) {
      console.warn('⚠️ getSession error:', e);
    }
    return null;
  })();

  // Phase 2 — set up ongoing auth listener after DOM is ready.
  document.addEventListener('DOMContentLoaded', function () {

    // Point window.supabase at the initialized client so bare
    // `supabase.auth.*` calls in index.html always reach the live client.
    window.supabase = window.supabaseClient;

    const client = sb();
    if (!client) return;

    // ── Single onAuthStateChange listener ──────────────────────────
    // Rules:
    //   INITIAL_SESSION  — silently sync nav/dashboard, NO toast.
    //   SIGNED_IN        — sync nav/dashboard + show "Welcome back!" toast.
    //   SIGNED_OUT       — sync nav/dashboard (nav reverts to Sign In).
    //   TOKEN_REFRESHED  — silently sync nav only (no toast, no redirect).
    //   PASSWORD_RECOVERY — navigate to reset-password panel.
    //
    // We track whether the INITIAL_SESSION has already been handled
    // so that a subsequent TOKEN_REFRESHED is not mistaken for a
    // fresh login.
    let _initialSessionHandled = false;

    client.auth.onAuthStateChange(function (event, session) {
      const user = session?.user ?? null;

      if (event === 'INITIAL_SESSION') {
        // Sync nav with session state restored from localStorage.
        // Don't show a toast — the user didn't actively log in.
        window.syncNavToAuth(user);
        _initialSessionHandled = true;
        return;
      }

      if (event === 'SIGNED_IN') {
        window.syncNavToAuth(user);
        // Only show the "Welcome back!" toast on an actual login action,
        // not on a silent TOKEN_REFRESHED or page reload.
        if (typeof window.showToast === 'function') {
          const name = user?.user_metadata?.full_name || user?.email || '';
          const first = name.split(/[\s@]/)[0];
          window.showToast('Welcome back' + (first ? ', ' + first : '') + '! 👋', 'success');
        }
        return;
      }

      if (event === 'SIGNED_OUT') {
        window.syncNavToAuth(null);
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        // Silent refresh — sync nav in case initials changed, no toast.
        window.syncNavToAuth(user);
        return;
      }

      if (event === 'PASSWORD_RECOVERY') {
        if (typeof window.navigate     === 'function') window.navigate('login');
        if (typeof window.showAuthPage === 'function') window.showAuthPage('reset-password');
        return;
      }
    });

    // Start realtime sync for PDF library updates.
    window.initRealtimeSync();
  });

})();
