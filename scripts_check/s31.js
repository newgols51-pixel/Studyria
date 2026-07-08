
// ── POST-LOAD GUARD ───────────────────────────────────────────────────────────
// Verify supabase.js registered the real authLoginWithGoogle.
// If the IIFE exited early (e.g. SDK detection failed), define a direct fallback
// so the Google button always works.
(function ensureGoogleAuth() {
  // If supabase.js set a real async function, we're done.
  if (typeof window.authLoginWithGoogle === 'function' &&
      window.authLoginWithGoogle.constructor.name === 'AsyncFunction') {
    console.log('✅ authLoginWithGoogle registered by supabase.js');
    return;
  }

  console.warn('⚠️ authLoginWithGoogle not set by supabase.js — installing fallback');

  window.authLoginWithGoogle = async function authLoginWithGoogle(btnId) {
    var client = window.supabaseClient;
    if (!client) {
      // Last-ditch: try to create the client from the captured SDK
      var sdk = window.supabaseLib || window.supabase;
      if (sdk && typeof sdk.createClient === 'function') {
        client = sdk.createClient(
          'https://qsdfmgcekdpjdcyqhuhi.supabase.co',
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzZGZtZ2Nla2RwamRjeXFodWhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NTE2NDcsImV4cCI6MjA5NjIyNzY0N30.kDOEYxUQyLTp1blasuX2kVSIy2olGLhdqqtOMTlEX5g',
          { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
        );
        window.supabaseClient = client;
      }
    }
    if (!client) { alert('Supabase is not ready. Please refresh the page.'); return; }

    var btn = (btnId && document.getElementById(btnId))
           || document.getElementById('googleLoginBtn')
           || document.getElementById('googleSignupBtn');
    var original = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span>Redirecting to Google…'; }

    try {
      try { sessionStorage.setItem('studyria_oauth_pending', '1'); } catch (_) {}
      var result = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'https://studyria.qzz.io',
          queryParams: { access_type: 'offline', prompt: 'select_account' },
        },
      });
      if (result.error) {
        try { sessionStorage.removeItem('studyria_oauth_pending'); } catch (_) {}
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
        alert('Google sign-in failed: ' + result.error.message);
      }
    } catch (e) {
      try { sessionStorage.removeItem('studyria_oauth_pending'); } catch (_) {}
      if (btn) { btn.disabled = false; btn.innerHTML = original; }
      alert('Google sign-in failed: ' + (e.message || 'unknown error'));
    }
  };
})();
