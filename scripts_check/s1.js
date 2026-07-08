
(function() {
  var SPA_PATHS = {
    '/library':   'library',
    '/dashboard': 'dashboard',
    '/privacy':   'privacy',
    '/terms':     'terms',
    '/refund':    'refund',
    '/about':     'about',
    '/contact':   'contact',
    '/wishlist':  'wishlist',
    '/login':     'login',
    '/register':  'register',
    '/career-hub':'career-hub',
    '/upload':    'upload',
    '/creator-register': 'creator-register',
    '/creator-dashboard':'creator-dashboard'
  };
  var p = window.location.pathname.replace(/\/+$/, '') || '/';
  var route = SPA_PATHS[p];
  if (route) {
    // Replace the current history entry so the back-button still works.
    history.replaceState({ page: route }, '', '/#' + route);
  }
})();
