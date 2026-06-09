// ══════════════════════════════════════════════════════════════════
// pipedream.js — Studyria
// Analytics / event-tracking webhook helpers ONLY.
//
// IMPORTANT: This file contains NO authentication logic.
// Authentication is handled exclusively by supabase.js.
// ══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const WEBHOOK = 'https://eod16l3iacfjwl6.m.pipedream.net';

  // ── Core webhook sender ─────────────────────────────────────────
  // Defined once. If already defined (e.g. from a previous hot-reload
  // in dev), keep the existing version.
  if (typeof window.sendToPipedream !== 'function') {
    window.sendToPipedream = async function (data) {
      try {
        const res = await fetch(WEBHOOK, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(data)
        });
        return { success: true, data: await res.text() };
      } catch (err) {
        console.error('❌ Pipedream error:', err);
        return { success: false, error: err };
      }
    };
  }

  // ── Event helpers ───────────────────────────────────────────────
  // Each helper is defined unconditionally so pipedream.js is always
  // the authoritative source. The inline block in index.html
  // previously duplicated these — that block has been removed from
  // index.html.

  window.pipedream_onLogin = function (email, name) {
    window.sendToPipedream({
      event:      'user_login',
      email:      email || '',
      name:       name  || '',
      created_at: new Date().toISOString()
    });
  };

  window.pipedream_onSignup = function (email, name) {
    window.sendToPipedream({
      event:      'user_signup',
      email:      email || '',
      name:       name  || '',
      created_at: new Date().toISOString()
    });
  };

  window.pipedream_onForgotPassword = function (email) {
    window.sendToPipedream({
      event:      'forgot_password',
      email:      email || '',
      created_at: new Date().toISOString()
    });
  };

  window.pipedream_onBuy = function (pdf, userEmail) {
    window.sendToPipedream({
      event:         pdf.free ? 'pdf_download' : 'pdf_purchase',
      pdf_id:        pdf.id,
      pdf_title:     pdf.title,
      pdf_category:  pdf.category,
      price:         pdf.price,
      user_email:    userEmail || (window.currentUser ? window.currentUser.email : 'guest'),
      created_at:    new Date().toISOString()
    });
  };

})();
