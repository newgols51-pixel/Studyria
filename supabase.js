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
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('❌ Supabase SDK not found. Check CDN script load order.');
    return;
  }

  // Create the client once and expose it.
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      // persistSession: true is the default — keeps the user logged in
      // across page refreshes and browser restarts via localStorage.
      persistSession: true,
      // autoRefreshToken: true silently refreshes the JWT before it expires.
      autoRefreshToken: true,
      // detectSessionInUrl: true handles the OAuth / magic-link / password-
      // reset tokens that Supabase appends to the URL hash (#access_token=…).
      // This is essential for GitHub Pages where there is no server-side
      // redirect handler.
      detectSessionInUrl: true,
    }
  });

  // Convenience accessor — always reads from window so the alias
  // in index.html (`var supabase`) can be re-pointed after load.
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
  // The nav HTML in index.html uses id="navUserArea" which contains
  // a static Sign In button. We replace its content dynamically.
  window.syncNavToAuth = function (user) {
    const area = document.getElementById('navUserArea');
    if (!area) return;

    // If an admin session is active, don't touch the nav — admin panel
    // manages its own topbar and we don't want to render a regular-user
    // avatar/sign-out button that would call authLogout() and navigate home.
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
      // syncNavToAuth will fire via onAuthStateChange — no need to call it here.
      // Track via Pipedream (analytics only, no auth logic).
      if (typeof window.pipedream_onLogin === 'function') {
        window.pipedream_onLogin(email, data.user?.user_metadata?.full_name || '');
      }
      if (typeof window.navigate === 'function')   window.navigate('home');
      if (typeof window.showToast === 'function')  window.showToast('Welcome back! 👋', 'success');
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
      // Populate the verify-email panel with the user's email before showing it.
      const verifyEl = document.getElementById('verifyEmail');
      if (verifyEl) verifyEl.textContent = email;

      // Track signup via Pipedream (analytics only).
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
    // onAuthStateChange fires with SIGNED_OUT and calls syncNavToAuth(null).
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

  // ── RESET PASSWORD (called after user clicks email link) ─────────
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

    // Read email from the populated verifyEmail span (set during signup).
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

  // ── ADMIN AUTH ───────────────────────────────────────────────────
  // NOTE: adminDoLogin and adminLogout are defined in index.html and
  // own the local `adminSession` variable scoped there.
  // supabase.js must NOT redefine them via window.adminDoLogin /
  // window.adminLogout — doing so creates a shadow copy that sets
  // window.adminSession (a separate reference) while index.html's
  // renderAdmin() still reads the local `adminSession` variable
  // (always null), causing the login page to persist.
  //
  // The only admin helper supabase.js provides is the internal error
  // display used by other auth flows below.

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

  // ── BOOT: single DOMContentLoaded ───────────────────────────────
  // Everything that needs the DOM or auth state goes here.
  document.addEventListener('DOMContentLoaded', function () {

    // Point the `supabase` alias used by downloadPDF / buyPDF in
    // index.html to the now-initialized client.
    window.supabase = window.supabaseClient;

    const client = sb();
    if (!client) return;

    // ── onAuthStateChange — central auth event bus ──────────────
    // This fires:
    //   INITIAL_SESSION  — on every page load (user may already be logged in)
    //   SIGNED_IN        — after login or token refresh
    //   SIGNED_OUT       — after signOut()
    //   PASSWORD_RECOVERY — after user clicks a password-reset email link
    //   TOKEN_REFRESHED  — silently on auto-refresh (no UI action needed)
    client.auth.onAuthStateChange(function (event, session) {
      const user = session?.user ?? null;

      // Always sync the nav bar.
      window.syncNavToAuth(user);

      // If the dashboard is currently visible, re-render it with the
      // updated user state so it never shows stale "sign in" message.
      if (typeof window.currentPage !== 'undefined' && window.currentPage === 'dashboard') {
        if (typeof window.renderDashboard === 'function') window.renderDashboard();
      }

      // PASSWORD_RECOVERY: user clicked the reset link in their email.
      // Navigate to the login page and show the reset-password sub-panel.
      if (event === 'PASSWORD_RECOVERY') {
        if (typeof window.navigate     === 'function') window.navigate('login');
        if (typeof window.showAuthPage === 'function') window.showAuthPage('reset-password');
      }
    });

    // Start realtime sync for PDF library updates.
    window.initRealtimeSync();
  });

})();