// ══════════════════════════════════════════════════════════════════
// supabase.js — Studyria
// Single source of truth for Supabase client + auth helpers
// ══════════════════════════════════════════════════════════════════

(function () {
  // ── CONFIG ──────────────────────────────────────────────────────
  // Supabase project URL and anon key
  const SUPABASE_URL  =  https://qsdfmgcekdpjdcyqhuhi.supabase.co";
  const SUPABASE_ANON = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzZGZtZ2Nla2RwamRjeXFodWhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NTE2NDcsImV4cCI6MjA5NjIyNzY0N30.kDOEYxUQyLTp1blasuX2kVSIy2olGLhdqqtOMTlEX5g ";

  // ── INIT CLIENT (once, exposed on window) ───────────────────────
  // The @supabase/supabase-js v2 CDN sets window.supabase = { createClient }
  if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  } else {
    console.warn("⚠️ Supabase SDK not loaded yet — supabase.js loaded too early?");
  }

  const sb = () => window.supabaseClient;

  // ── PASSWORD STRENGTH ────────────────────────────────────────────
  window.checkPasswordStrength = function (pw) {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8)  score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(score, 5);
  };

  // ── SHOW / CLEAR AUTH ERRORS ────────────────────────────────────
  function showAuthErr(elId, msg) {
    const box  = document.getElementById(elId);
    const msgEl = document.getElementById(elId + 'Msg');
    if (box)  { if (msgEl) msgEl.textContent = msg; box.style.display = 'flex'; }
  }
  function clearAuthErr(elId) {
    const box = document.getElementById(elId);
    if (box) box.style.display = 'none';
  }

  // ── SYNC NAV TO AUTH STATE ───────────────────────────────────────
  window.syncNavToAuth = function () {
    const client = sb();
    if (!client) return;
    client.auth.getUser().then(({ data: { user } }) => {
      const loginBtn  = document.getElementById('navLoginBtn');
      const avatarBtn = document.getElementById('navAvatarBtn');
      const avatarTxt = document.getElementById('navAvatarText');

      if (user) {
        const name = user.user_metadata?.full_name || user.email || '';
        const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'U';
        window.currentUser = {
          name,
          email: user.email,
          avatar: initials,
          plan: 'Pro',
          purchased: 0,
          totalSpent: 0,
          wishlist: 0
        };
        if (loginBtn)  loginBtn.style.display  = 'none';
        if (avatarBtn) { avatarBtn.style.display = 'flex'; }
        if (avatarTxt) avatarTxt.textContent = initials;
      } else {
        window.currentUser = null;
        if (loginBtn)  loginBtn.style.display  = 'flex';
        if (avatarBtn) avatarBtn.style.display  = 'none';
      }
    });
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
      window.syncNavToAuth();
      if (typeof window.pipedream_onLogin === 'function') {
        window.pipedream_onLogin(email, data.user?.user_metadata?.full_name || '');
      }
      if (typeof window.navigate === 'function') window.navigate('home');
      if (typeof window.showToast === 'function') window.showToast('Welcome back! 👋', 'success');
    }
  };

  // ── SIGNUP ───────────────────────────────────────────────────────
  window.authSignup = async function () {
    const client = sb();
    if (!client) { alert('Supabase not configured.'); return; }

    const name  = document.getElementById('regName')?.value?.trim();
    const email = document.getElementById('regEmail')?.value?.trim();
    const pass  = document.getElementById('regPass')?.value;
    const btn   = document.getElementById('signupBtn');

    clearAuthErr('signupError');
    if (!name || name.length < 2) return showAuthErr('signupError', 'Enter your full name.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAuthErr('signupError', 'Enter a valid email.');
    if (!pass  || pass.length < 8) return showAuthErr('signupError', 'Password must be ≥ 8 characters.');

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
      if (typeof window.pipedream_onSignup === 'function') {
        window.pipedream_onSignup(email, name);
      }
      // Show verify-email screen
      if (typeof window.showAuthPage === 'function') window.showAuthPage('verify-email');
    }
  };

  // ── LOGOUT ───────────────────────────────────────────────────────
  window.authLogout = async function () {
    const client = sb();
    if (client) await client.auth.signOut();
    window.currentUser = null;
    window.syncNavToAuth();
    if (typeof window.navigate   === 'function') window.navigate('home');
    if (typeof window.showToast  === 'function') window.showToast('Signed out.', 'info');
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
      redirectTo: window.location.origin + '/?reset=true'
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

  // ── RESET PASSWORD (after clicking email link) ───────────────────
  window.authResetPassword = async function () {
    const client = sb();
    if (!client) return;

    const pass    = document.getElementById('resetPass')?.value;
    const confirm = document.getElementById('resetPassConfirm')?.value;
    const btn     = document.getElementById('resetBtn');

    clearAuthErr('resetError');
    if (!pass || pass.length < 8) return showAuthErr('resetError', 'Password must be ≥ 8 characters.');
    if (pass !== confirm)          return showAuthErr('resetError', 'Passwords do not match.');

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span>Updating…'; }

    const { error } = await client.auth.updateUser({ password: pass });

    if (btn) { btn.disabled = false; btn.innerHTML = 'Update Password'; }

    if (error) {
      showAuthErr('resetError', error.message);
    } else {
      if (typeof window.showToast === 'function') window.showToast('Password updated! Please sign in.', 'success');
      if (typeof window.showAuthPage === 'function') window.showAuthPage('login');
    }
  };

  // ── ADMIN AUTH ───────────────────────────────────────────────────
  const ADMIN_EMAILS = ['admin@studyria.com']; // ← add your real admin emails here

  window.adminDoLogin = async function () {
    const client = sb();
    const email  = document.getElementById('adminLoginEmail')?.value?.trim();
    const pass   = document.getElementById('adminLoginPass')?.value;
    const errEl  = document.getElementById('adminLoginError');
    const errMsg = document.getElementById('adminLoginErrorMsg');
    const btn    = document.getElementById('adminLoginBtn');

    if (errEl) errEl.style.display = 'none';
    if (!email || !pass) {
      if (errMsg) errMsg.textContent = 'Enter email and password.';
      if (errEl)  errEl.style.display = 'flex';
      return;
    }

    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span>Verifying…'; }

    if (client) {
      const { data, error } = await client.auth.signInWithPassword({ email, password: pass });
      if (btn) { btn.disabled = false; btn.innerHTML = 'Access Admin Panel'; }

      if (error || !ADMIN_EMAILS.includes(email)) {
        if (errMsg) errMsg.textContent = error?.message || 'Not authorized as admin.';
        if (errEl)  errEl.style.display = 'flex';
        if (data?.session) await client.auth.signOut(); // sign out non-admin
        return;
      }

      // Update admin topbar
      const name = data.user?.user_metadata?.full_name || email;
      const initials = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) || 'A';
      const el = id => document.getElementById(id);
      if (el('adminTopbarName'))   el('adminTopbarName').textContent   = name;
      if (el('adminTopbarEmail'))  el('adminTopbarEmail').textContent  = email;
      if (el('adminTopbarAvatar')) el('adminTopbarAvatar').textContent = initials;

      if (typeof window.navigate === 'function') window.navigate('admin');
    } else {
      // Fallback: simple hardcoded check (remove in production)
      if (btn) { btn.disabled = false; btn.innerHTML = 'Access Admin Panel'; }
      if (email === 'admin@studyria.com' && pass === 'admin123') {
        if (typeof window.navigate === 'function') window.navigate('admin');
      } else {
        if (errMsg) errMsg.textContent = 'Invalid credentials.';
        if (errEl)  errEl.style.display = 'flex';
      }
    }
  };

  window.adminLogout = async function () {
    const client = sb();
    if (client) await client.auth.signOut();
    if (typeof window.navigate === 'function') window.navigate('home');
    if (typeof window.showToast === 'function') window.showToast('Admin logged out.', 'info');
  };

  // ── REALTIME SUBSCRIPTION ─────────────────────────────────────────
  // Keeps the PDF library in sync when admin adds/updates PDFs
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

  // ── BOOT ──────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    // Re-resolve supabase alias in index.html (in case it ran before supabase.js)
    if (window.supabaseClient) {
      window.supabase_alias_resolved = true; // flag for debugging
    }

    window.syncNavToAuth();
    window.initRealtimeSync();

    // Auth state change listener
    const client = sb();
    if (client) {
      client.auth.onAuthStateChange((_event, session) => {
        window.syncNavToAuth();
        // Handle password reset redirect
        if (_event === 'PASSWORD_RECOVERY') {
          if (typeof window.navigate       === 'function') window.navigate('login');
          if (typeof window.showAuthPage   === 'function') window.showAuthPage('reset-password');
        }
      });
    }
  });

})();
