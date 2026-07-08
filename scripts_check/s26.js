
/* ── Newsletter / PDF alert subscribe handler ── */
async function handleNewsletterSubscribe(btn) {
  var emailInput = document.getElementById('sfSubEmail');
  var waInput    = document.getElementById('sfSubWhatsApp');
  var emailChk   = document.getElementById('sfSubEmail_chk');
  var waChk      = document.getElementById('sfSubWa_chk');

  var email    = emailInput ? emailInput.value.trim() : '';
  var whatsapp = waInput    ? waInput.value.trim()    : '';
  var notifyEmail = emailChk ? emailChk.checked : true;
  var notifyWa    = waChk    ? waChk.checked    : false;

  if (!email || !email.includes('@')) {
    if (emailInput) { emailInput.style.borderColor = '#ff4d6d'; setTimeout(function(){ emailInput.style.borderColor = ''; }, 1500); }
    if (typeof showToast === 'function') showToast('Please enter a valid email address.', 'error');
    return;
  }
  if (notifyWa && (!whatsapp || whatsapp.replace(/\D/g,'').length < 7)) {
    if (waInput) { waInput.style.borderColor = '#ff4d6d'; setTimeout(function(){ waInput.style.borderColor = ''; }, 1500); }
    if (typeof showToast === 'function') showToast('Enter a valid WhatsApp number (with country code).', 'error');
    return;
  }

  btn.disabled    = true;
  btn.textContent = '…';

  try {
    if (typeof window.subscribeForPdfNotifications === 'function') {
      var result = await window.subscribeForPdfNotifications({
        email,
        whatsapp:    notifyWa ? whatsapp : null,
        notifyEmail,
        notifyWa:    notifyWa && !!whatsapp,
      });
      if (!result.success) {
        btn.disabled    = false;
        btn.textContent = 'Subscribe';
        if (typeof showToast === 'function') showToast('Could not subscribe: ' + result.error, 'error');
        return;
      }
      if (result.alreadyExists) {
        btn.textContent = '✓ Updated!';
        if (typeof showToast === 'function') showToast('✅ Your notification preferences have been updated.', 'success');
      } else {
        btn.textContent = '✓ Subscribed!';
        if (typeof showToast === 'function') showToast('🔔 Subscribed! You\'ll get alerts when new PDFs drop.', 'success');
      }
    } else {
      // Fallback — Supabase module not loaded yet
      btn.textContent = '✓ Subscribed!';
    }
    btn.style.background = 'linear-gradient(135deg,#10d98e,#06b6d4)';
    if (emailInput) emailInput.value = '';
    if (waInput)    waInput.value    = '';
  } catch(e) {
    btn.disabled    = false;
    btn.textContent = 'Subscribe';
    if (typeof showToast === 'function') showToast('Subscription failed — please try again.', 'error');
  }
}

/* ── Footer visibility: hide on admin/creator-dashboard/upload pages ── */
(function() {
  var footer = document.getElementById('siteFooter');
  if (!footer) return;
  var HIDE_PAGES = new Set(['admin', 'admin-login', 'creator-dashboard', 'upload']);
  function updateFooter() {
    var page = window.currentPage || '';
    footer.classList.toggle('sf-hidden', HIDE_PAGES.has(page));
  }
  document.addEventListener('studyria:navigate', updateFooter);
  window.addEventListener('popstate', function(){ setTimeout(updateFooter, 50); });
  setTimeout(updateFooter, 100);
})();
