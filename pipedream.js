// ══════════════════════════════════════════════════════════════════
// pipedream.js — Studyria
// Standalone Pipedream webhook helpers (loaded AFTER supabase.js)
// NOTE: index.html already defines these functions inline.
// This file is kept as a thin override/extension layer.
// If you want to manage Pipedream logic in one place, move the
// inline block from index.html here and remove it from index.html.
// ══════════════════════════════════════════════════════════════════

(function () {
  const WEBHOOK = "https://eod16l3iacfjwl6.m.pipedream.net";

  // Only define if not already defined by index.html inline script
  if (typeof window.sendToPipedream !== 'function') {
    window.sendToPipedream = async function (data) {
      try {
        const res = await fetch(WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        return { success: true, data: await res.text() };
      } catch (err) {
        console.error('❌ Pipedream Error:', err);
        return { success: false, error: err };
      }
    };
  }

  window.pipedream_onLogin = async function(email) {
  try {

    await window.sendToPipedream({
      event: 'user_login',
      email: email,
      created_at: new Date().toISOString()
    });

    console.log("Login tracked");

  } catch (err) {
    console.error(err);
  }
};

  if (typeof window.pipedream_onSignup !== 'function') {
    window.pipedream_onSignup = function (email, name) {
      window.sendToPipedream({ event: 'user_signup', email, name: name || '', created_at: new Date().toISOString() });
    };
  }

  if (typeof window.pipedream_onForgotPassword !== 'function') {
    window.pipedream_onForgotPassword = function (email) {
      window.sendToPipedream({ event: 'forgot_password', email, created_at: new Date().toISOString() });
    };
  }

  if (typeof window.pipedream_onBuy !== 'function') {
    window.pipedream_onBuy = function (pdf, userEmail) {
      window.sendToPipedream({
        event: pdf.free ? 'pdf_download' : 'pdf_purchase',
        pdf_id: pdf.id,
        pdf_title: pdf.title,
        pdf_category: pdf.category,
        price: pdf.price,
        user_email: userEmail || (window.currentUser ? window.currentUser.email : 'guest'),
        created_at: new Date().toISOString()
      });
    };
  }
})();
