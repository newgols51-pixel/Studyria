
(function patchEmailVerificationFlow() {

  // ══════════════════════════════════════════════════════════════
  // INTERNAL STATE
  // ══════════════════════════════════════════════════════════════
  window._pendingVerifyEmail  = window._pendingVerifyEmail  || '';
  window._verifyPolling       = false;   // true while interval is running
  window._verifyPollInterval  = null;    // setInterval handle
  window._verifyAuthListener  = null;    // Supabase subscription handle
  window._verifyCompleted     = false;   // flipped to true once verified

  const POLL_INTERVAL_MS = 5000; // poll every 5 seconds

  // ══════════════════════════════════════════════════════════════
  // UI HELPERS
  // ══════════════════════════════════════════════════════════════
  function _setVerifyStatus(msg, type) {
    const badge = document.getElementById('verifyStatusBadge');
    if (!badge) return;
    const colors = {
      info:    { bg:'rgba(61,142,248,0.08)',  border:'rgba(61,142,248,0.2)',  icon:'#3d8ef8' },
      success: { bg:'rgba(16,217,142,0.10)',  border:'rgba(16,217,142,0.3)',  icon:'#10d98e' },
      error:   { bg:'rgba(255,77,109,0.08)',  border:'rgba(255,77,109,0.2)',  icon:'#ff4d6d' },
      waiting: { bg:'rgba(245,158,11,0.08)',  border:'rgba(245,158,11,0.2)',  icon:'#f59e0b' },
    };
    const c = colors[type] || colors.info;
    badge.style.background = c.bg;
    badge.style.border     = `1px solid ${c.border}`;
    const icons = {
      info:    `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`,
      success: `<polyline points="20 6 9 17 4 12"/>`,
      error:   `<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`,
      waiting: `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
    };
    badge.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${c.icon}" stroke-width="2">${icons[type] || icons.info}</svg>
      <span id="verifyStatusText">${msg}</span>
    `;
  }

  function _isVerifyScreenVisible() {
    const el = document.getElementById('auth-verify-email');
    return el && el.style.display !== 'none';
  }

  function _showVerifyScreen(email) {
    const emailEl = document.getElementById('verifyEmail');
    if (emailEl) emailEl.textContent = email || '';
    _setVerifyStatus('Waiting for you to verify your email…', 'waiting');
    if (typeof showAuthPage === 'function') showAuthPage('verify-email');
    if (typeof navigate    === 'function') navigate('login');
  }

  // ══════════════════════════════════════════════════════════════
  // VERIFIED → AUTO LOGIN + REDIRECT
  // Called from both the listener and the poll when verified.
  // ══════════════════════════════════════════════════════════════
  async function _handleVerified(user) {
    if (window._verifyCompleted) return; // fire once only
    window._verifyCompleted = true;

    _stopPolling();

    _setVerifyStatus('✅ Email verified! Signing you in…', 'success');
    if (typeof showToast === 'function') showToast('Email verified! Welcome to Studyria 🎉', 'success');

    // Make sure supabase.js auth state listeners fire so the nav bar updates
    if (typeof syncNavToAuth === 'function') syncNavToAuth(user);

    // Give the success message 1.5 s to show, then navigate home
    setTimeout(() => {
      if (typeof navigate === 'function') navigate('home');
    }, 1500);
  }

  // ══════════════════════════════════════════════════════════════
  // AUTO-POLLING (5 s interval, stops when verified or screen hidden)
  // ══════════════════════════════════════════════════════════════
  function _startPolling() {
    if (window._verifyPolling || window._verifyCompleted) return;
    window._verifyPolling = true;
    console.log('🔄 Studyria: email verification polling started (5 s)');

    window._verifyPollInterval = setInterval(async () => {
      // Stop automatically if screen is no longer visible
      if (!_isVerifyScreenVisible() && !window._verifyCompleted) {
        _stopPolling();
        return;
      }
      if (window._verifyCompleted) { _stopPolling(); return; }

      const sb = window.supabaseClient;
      if (!sb) return;

      try {
        // refreshSession() fetches the freshest token from Supabase
        const { data } = await sb.auth.refreshSession();
        const user = data?.user;
        if (user && user.email_confirmed_at) {
          await _handleVerified(user);
        }
      } catch (e) {
        // Network hiccup — silently skip this tick
        console.warn('Studyria verify poll error (will retry):', e.message);
      }
    }, POLL_INTERVAL_MS);
  }

  function _stopPolling() {
    if (window._verifyPollInterval) {
      clearInterval(window._verifyPollInterval);
      window._verifyPollInterval = null;
    }
    window._verifyPolling = false;
    console.log('⏹ Studyria: email verification polling stopped');
  }

  // ══════════════════════════════════════════════════════════════
  // SUPABASE onAuthStateChange LISTENER
  // Catches the instant the token arrives in this tab after the
  // user clicks the verification link (works even in same tab).
  // ══════════════════════════════════════════════════════════════
  function _attachAuthListener() {
    if (window._verifyAuthListener) return; // already attached

    function _tryAttach() {
      const sb = window.supabaseClient;
      if (!sb) return false;

      const { data: listenerData } = sb.auth.onAuthStateChange(async (event, session) => {
        // Only act while the verify screen is relevant
        if (window._verifyCompleted) return;

        const relevantEvents = ['SIGNED_IN', 'USER_UPDATED', 'TOKEN_REFRESHED'];
        if (!relevantEvents.includes(event)) return;

        const user = session?.user;
        if (user && user.email_confirmed_at) {
          console.log('✅ Studyria: verification detected via onAuthStateChange:', event);
          await _handleVerified(user);
        }
      });

      window._verifyAuthListener = listenerData?.subscription || listenerData;
      console.log('👂 Studyria: auth state listener attached for email verification');

      // Unsubscribe when page unloads to prevent memory leaks
      window.addEventListener('beforeunload', () => {
        if (window._verifyAuthListener?.unsubscribe) {
          window._verifyAuthListener.unsubscribe();
        }
      }, { once: true });

      return true;
    }

    // Retry until supabaseClient is ready
    let attempts = 0;
    function _retry() {
      if (_tryAttach()) return;
      if (++attempts < 30) setTimeout(_retry, 200);
    }
    _retry();
  }

  // ══════════════════════════════════════════════════════════════
  // START VERIFICATION DETECTION
  // Called when the verify screen is shown.
  // ══════════════════════════════════════════════════════════════
  function _startVerificationDetection(email) {
    window._verifyCompleted = false; // reset for this verification session
    window._pendingVerifyEmail = email;
    _attachAuthListener();
    _startPolling();
  }

  // ══════════════════════════════════════════════════════════════
  // authSignup PATCH
  // ══════════════════════════════════════════════════════════════
  function _patchSignup() {
    if (typeof window.authSignup !== 'function') return false;
    if (window._authSignupPatched) return true;

    const _origSignup = window.authSignup;

    window.authSignup = async function() {
      const sb = window.supabaseClient;
      if (!sb) { _origSignup.apply(this, arguments); return; }

      const name    = document.getElementById('regName')?.value?.trim()  || '';
      const email   = document.getElementById('regEmail')?.value?.trim() || '';
      const pass    = document.getElementById('regPass')?.value          || '';
      const confirm = document.getElementById('regConfirm')?.value       || '';

      const errEl  = document.getElementById('signupError');
      const errMsg = document.getElementById('signupErrorMsg');
      const showErr = (m) => { if(errEl && errMsg){ errMsg.textContent=m; errEl.style.display='flex'; } };
      const hideErr = ()  => { if(errEl) errEl.style.display='none'; };
      hideErr();

      if (!name  || name.length < 2)                                    return showErr('Please enter your full name.');
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))         return showErr('Enter a valid email address.');
      if (!pass  || pass.length < 8)                                    return showErr('Password must be at least 8 characters.');
      if (pass !== confirm)                                             return showErr('Passwords do not match.');

      const btn = document.getElementById('signupBtn');
      const origBtnHtml = btn?.innerHTML || '';
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span>Creating account…'; }

      try {
        const { data, error } = await sb.auth.signUp({
          email,
          password: pass,
          options: {
            data: { full_name: name },
            emailRedirectTo: window.location.origin + window.location.pathname,
          }
        });

        if (error) throw new Error(error.message);

        const user    = data?.user;
        const session = data?.session;

        if (!session || (user && !user.email_confirmed_at)) {
          // Confirmation required → show verify screen and start detection
          if (typeof showToast === 'function') showToast('Account created! Check your email to verify.', 'success');
          _showVerifyScreen(email);
          _startVerificationDetection(email);
        } else {
          // Confirmation not required by Supabase settings → go straight to home
          if (typeof showToast === 'function') showToast('Account created! Welcome to Studyria 🎉', 'success');
          if (typeof navigate === 'function') navigate('home');
        }

      } catch (err) {
        showErr(err.message || 'Registration failed. Please try again.');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
      }
    };

    window._authSignupPatched = true;
    return true;
  }

  // ══════════════════════════════════════════════════════════════
  // authLogin PATCH
  // Blocks unverified users and redirects to verify screen.
  // ══════════════════════════════════════════════════════════════
  function _patchLogin() {
    if (typeof window.authLogin !== 'function') return false;
    if (window._authLoginPatched) return true;

    const _origLogin = window.authLogin;

    window.authLogin = async function() {
      const sb = window.supabaseClient;
      if (!sb) { _origLogin.apply(this, arguments); return; }

      const email = document.getElementById('loginEmail')?.value?.trim() || '';
      const pass  = document.getElementById('loginPass')?.value          || '';

      if (!email || !pass) { _origLogin.apply(this, arguments); return; }

      const errEl  = document.getElementById('loginError');
      const errMsg = document.getElementById('loginErrorMsg');
      const showErr = (m) => { if(errEl && errMsg){ errMsg.textContent=m; errEl.style.display='flex'; } };
      const hideErr = ()  => { if(errEl) errEl.style.display='none'; };
      const btn = document.getElementById('loginBtn');
      const origBtnHtml = btn?.innerHTML || '';

      hideErr();
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span>Signing in…'; }

      try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });

        if (error) {
          if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
          showErr(error.message || 'Invalid email or password.');
          return;
        }

        const user = data?.user;

        if (user && !user.email_confirmed_at) {
          // Unverified — kick them out and send to verify screen with auto-detection
          await sb.auth.signOut();
          _showVerifyScreen(email);
          _setVerifyStatus('Your email is not yet verified. Please check your inbox.', 'error');
          _startVerificationDetection(email);
          if (typeof showToast === 'function') showToast('Please verify your email first.', 'error');
          if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
          return;
        }

        // Verified — hand off to original for nav update, dashboard, etc.
        if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
        _origLogin.apply(this, arguments);

      } catch (err) {
        if (btn) { btn.disabled = false; btn.innerHTML = origBtnHtml; }
        showErr(err.message || 'Sign-in failed. Please try again.');
      }
    };

    window._authLoginPatched = true;
    return true;
  }

  // ══════════════════════════════════════════════════════════════
  // authResendVerification — unchanged from v1
  // ══════════════════════════════════════════════════════════════
  window.authResendVerification = async function() {
    const sb    = window.supabaseClient;
    const email = window._pendingVerifyEmail
      || document.getElementById('verifyEmail')?.textContent?.trim()
      || '';

    if (!email) {
      if (typeof showToast === 'function') showToast('No email address found. Please register again.', 'error');
      return;
    }

    const btn = document.getElementById('resendVerifyBtn');
    const origHtml = btn?.innerHTML || '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span>Sending…'; }

    try {
      const { error } = await sb.auth.resend({ type: 'signup', email });
      if (error) throw new Error(error.message);
      if (typeof showToast === 'function') showToast('Verification email resent! Check your inbox.', 'success');
      _setVerifyStatus('Verification email resent. Watching for verification…', 'waiting');
    } catch (err) {
      if (typeof showToast === 'function') showToast('Failed to resend: ' + err.message, 'error');
      _setVerifyStatus('Failed to resend. Please try again shortly.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
    }
  };

  // ══════════════════════════════════════════════════════════════
  // authCheckVerification — manual fallback button (still works)
  // ══════════════════════════════════════════════════════════════
  window.authCheckVerification = async function() {
    const sb = window.supabaseClient;
    if (!sb) {
      if (typeof showToast === 'function') showToast('Not connected. Please refresh.', 'error');
      return;
    }

    const btn = document.getElementById('checkVerifyBtn');
    const origHtml = btn?.innerHTML || '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="auth-spinner"></span>Checking…'; }

    try {
      const { data: refreshData } = await sb.auth.refreshSession();
      const user = refreshData?.user || (await sb.auth.getUser())?.data?.user;

      if (user && user.email_confirmed_at) {
        await _handleVerified(user);
      } else {
        _setVerifyStatus('Not verified yet — still watching your inbox…', 'waiting');
        if (typeof showToast === 'function') showToast('Not verified yet. Check your inbox.', 'info');
      }
    } catch (err) {
      _setVerifyStatus('Could not check status. Will keep trying automatically.', 'error');
      if (typeof showToast === 'function') showToast('Error: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
    }
  };

  // ══════════════════════════════════════════════════════════════
  // BOOT — patch as soon as supabase.js functions are available
  // ══════════════════════════════════════════════════════════════
  let _patchAttempts = 0;
  function _tryPatch() {
    _patchAttempts++;
    const signupDone = _patchSignup();
    const loginDone  = _patchLogin();
    if (signupDone && loginDone) {
      console.log('✅ Studyria: email verification flow v2 patched.');
      // Attach the auth listener immediately so it's ready for any event
      _attachAuthListener();
      return;
    }
    if (_patchAttempts < 40) {
      setTimeout(_tryPatch, 200);
    } else {
      console.warn('⚠️ Studyria verify patch: authSignup/authLogin not found after 8 s.');
    }
  }
  _tryPatch();

})();
