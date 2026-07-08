
(function(){
  var _pendingNav = null;
  // Stub all onclick functions used in the static HTML.
  // Real versions override these once the main <script> block runs.
  var _noop = function(){};
  ['toggleTheme','toggleHamburger','showAuthPage','authLogin','authSignup',
   'authLogout','authForgotPassword','authResetPassword','authResendVerification',
   'authLoginWithGoogle','closeAnnouncementBar'
  ].forEach(function(fn){ if(typeof window[fn] !== 'function') window[fn] = _noop; });

  if (typeof window.navigate !== 'function') {
    window.navigate = function(page) { _pendingNav = page; };
  }
  // Flush queued navigation once real navigate is registered
  document.addEventListener('DOMContentLoaded', function() {
    if (_pendingNav && typeof window._realNavigate === 'function') {
      window._realNavigate(_pendingNav);
    }
  });
})();
