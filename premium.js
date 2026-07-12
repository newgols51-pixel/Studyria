/**
 * premium.js — Studyria Premium Membership Logic
 * Branch: feat/premium-membership  |  Version: 2.0
 *
 * SCOPE: Page init, FAQ accordion, testimonials carousel,
 *        Razorpay checkout for membership plans, Supabase membership write.
 *
 * RULES (enforced):
 *   - All functions namespaced under window.PRM.*
 *   - No writes to window.PDFS, window.currentUser, or shared routing state
 *   - Supabase writes go to `memberships` table (not profiles — that's via DB trigger)
 *   - navigate() is called only for login redirect
 */

(function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────── */
  /*  CONFIG                                                          */
  /* ──────────────────────────────────────────────────────────────── */
  var RZP_KEY     = 'rzp_live_SxcnO1cOS2HAJT';
  var PD_WEBHOOK  = 'https://eod16l3iacfjwl6.m.pipedream.net';

  var PLANS = {
    '15d': { label: '15 Days Starter',       days: 15,  amount: 49,  emoji: '🟢' },
    '1m':  { label: '1 Month Monthly',        days: 30,  amount: 99,  emoji: '🔵' },
    '3m':  { label: '3 Months Quarterly',     days: 90,  amount: 249, emoji: '🟣' },
    '6m':  { label: '6 Months Half Year',     days: 180, amount: 449, emoji: '👑' }
  };

  /* ──────────────────────────────────────────────────────────────── */
  /*  NAMESPACE                                                       */
  /* ──────────────────────────────────────────────────────────────── */
  var PRM = {};
  window.PRM = PRM;

  /* ──────────────────────────────────────────────────────────────── */
  /*  HELPERS                                                         */
  /* ──────────────────────────────────────────────────────────────── */
  function getSupabase () {
    return window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
  }

  function showToast (msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type || 'info');
    } else {
      console.log('[PRM Toast]', type, msg);
    }
  }

  function navTo (page) {
    if (typeof window.navigate === 'function') window.navigate(page);
  }

  function addDays (date, days) {
    var d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function fmtDate (d) {
    return new Date(d).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  }

  /* ──────────────────────────────────────────────────────────────── */
  /*  CHECK CURRENT USER PREMIUM STATUS                              */
  /* ──────────────────────────────────────────────────────────────── */
  PRM.checkStatus = async function () {
    var sb = getSupabase();
    if (!sb) return null;
    try {
      var authRes = await sb.auth.getUser();
      var user = authRes.data && authRes.data.user;
      if (!user) return null;

      // Check memberships table for any active membership
      var now = new Date().toISOString();
      var res = await sb
        .from('memberships')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .gt('expires_at', now)
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return res.data || null;
    } catch (e) {
      console.warn('[PRM] checkStatus error:', e);
      return null;
    }
  };

  /* ──────────────────────────────────────────────────────────────── */
  /*  UPDATE PAGE UI BASED ON MEMBERSHIP STATUS                      */
  /* ──────────────────────────────────────────────────────────────── */
  PRM.updatePageForStatus = async function () {
    var membership = await PRM.checkStatus();
    var sb = getSupabase();
    var authRes = sb ? await sb.auth.getUser() : null;
    var user = authRes && authRes.data && authRes.data.user;

    // Update plan buttons
    var planBtns = document.querySelectorAll('#page-premium .prm-plan-btn');
    planBtns.forEach(function (btn) {
      var card = btn.closest('.prm-plan-card');
      if (!card) return;
      var planKey = card.getAttribute('data-plan');
      if (!planKey) return;

      if (!user) {
        btn.textContent = 'Login to Subscribe';
        btn.setAttribute('data-action', 'login');
      } else if (membership) {
        btn.textContent = '✅ Active Member';
        btn.disabled = true;
        btn.style.opacity = '0.7';
      } else {
        // restore original labels from data-plan
        var plan = PLANS[planKey];
        if (plan) {
          var labels = {
            '15d': 'Get Started →',
            '1m':  'Subscribe →',
            '3m':  '⭐ Best Choice →',
            '6m':  '👑 Get Best Value →'
          };
          btn.textContent = labels[planKey] || 'Subscribe →';
          btn.setAttribute('data-action', 'pay');
        }
      }
    });

    // Update nav pill
    var pill = document.querySelector('.prm-nav-pill');
    if (pill && membership) {
      pill.textContent = '👑 Premium ✓';
      pill.style.color = '#10d98e';
      pill.style.borderColor = 'rgba(16,217,142,0.45)';
    }

    // Update dashboard widget
    PRM.updateDashWidget(membership, user);

    // If already premium — show status banner at top of page
    if (membership) {
      PRM.showMemberBanner(membership);
    }
  };

  /* ──────────────────────────────────────────────────────────────── */
  /*  ACTIVE MEMBER BANNER (shown at top of page-premium)            */
  /* ──────────────────────────────────────────────────────────────── */
  PRM.showMemberBanner = function (membership) {
    var existing = document.getElementById('prmActiveBanner');
    if (existing) return;
    var plan = PLANS[membership.plan] || {};
    var expDate = fmtDate(membership.expires_at);
    var banner = document.createElement('div');
    banner.id = 'prmActiveBanner';
    banner.style.cssText = [
      'margin:0 0 20px',
      'border-radius:18px',
      'padding:18px 20px',
      'background:linear-gradient(135deg,rgba(16,217,142,0.12),rgba(61,142,248,0.10))',
      'border:1.5px solid rgba(16,217,142,0.35)',
      'display:flex',
      'align-items:center',
      'gap:14px',
      'flex-wrap:wrap'
    ].join(';');
    banner.innerHTML = [
      '<div style="font-size:1.8rem">✅</div>',
      '<div style="flex:1;min-width:0">',
        '<div style="font-weight:800;color:var(--text);margin-bottom:4px">',
          (plan.emoji || '👑') + ' You are a Premium Member!',
        '</div>',
        '<div style="font-size:0.80rem;color:var(--text2)">',
          (plan.label || membership.plan) + ' · Expires ' + expDate,
        '</div>',
      '</div>'
    ].join('');
    var hero = document.querySelector('#page-premium .prm-hero');
    if (hero && hero.parentNode) {
      hero.parentNode.insertBefore(banner, hero.nextSibling);
    }
  };

  /* ──────────────────────────────────────────────────────────────── */
  /*  UPDATE DASHBOARD WIDGET                                         */
  /* ──────────────────────────────────────────────────────────────── */
  PRM.updateDashWidget = function (membership, user) {
    var widget = document.querySelector('.prm-dash-widget');
    if (!widget) return;

    if (!user) {
      // Not logged in — hide widget
      widget.style.display = 'none';
      return;
    }

    if (membership) {
      var plan = PLANS[membership.plan] || {};
      var expDate = fmtDate(membership.expires_at);
      widget.style.borderColor = 'rgba(16,217,142,0.35)';
      widget.style.background  = 'linear-gradient(135deg,rgba(16,217,142,0.10),rgba(61,142,248,0.08))';
      var badge  = widget.querySelector('.prm-dash-status-badge');
      var status = widget.querySelector('[data-prm-status]') ||
                   widget.querySelector('div[style*="Not Active"]');
      var btn    = widget.querySelector('.prm-dash-upgrade-btn');

      if (badge) {
        badge.className = 'prm-dash-status-badge active';
        badge.textContent = '👑 ' + (plan.label || membership.plan);
      }
      if (btn) {
        btn.textContent = '✅ Active — Expires ' + expDate;
        btn.disabled = true;
        btn.style.opacity = '0.75';
        btn.style.background = 'linear-gradient(135deg,#10d98e,#00c8e8)';
        btn.style.color = '#0a2a1a';
      }
    }
  };

  /* ──────────────────────────────────────────────────────────────── */
  /*  RAZORPAY CHECKOUT FOR MEMBERSHIP                               */
  /* ──────────────────────────────────────────────────────────────── */
  PRM.buyMembership = async function (planKey) {
    var plan = PLANS[planKey];
    if (!plan) {
      console.error('[PRM] Unknown plan:', planKey);
      return;
    }

    // ── Auth guard ──────────────────────────────────────────────
    var sb = getSupabase();
    if (!sb) { showToast('Service unavailable. Please refresh.', 'error'); return; }

    var authRes = await sb.auth.getUser();
    var user = authRes.data && authRes.data.user;
    if (!user) {
      showToast('Please login to subscribe.', 'info');
      navTo('login');
      return;
    }

    // ── Duplicate guard — no double-charge ──────────────────────
    var existingRes = await sb
      .from('memberships')
      .select('id, expires_at, plan')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (existingRes.data) {
      var exp = fmtDate(existingRes.data.expires_at);
      var existPlan = PLANS[existingRes.data.plan] || {};
      showToast(
        'You already have an active ' + (existPlan.label || existingRes.data.plan) +
        ' plan. It expires on ' + exp + '.', 'info'
      );
      return;
    }

    // ── Razorpay checkout ───────────────────────────────────────
    var amountPaise = plan.amount * 100;
    var startsAt    = new Date();
    var expiresAt   = addDays(startsAt, plan.days);

    var rzpOptions = {
      key:         RZP_KEY,
      amount:      amountPaise,
      currency:    'INR',
      name:        'Studyria',
      description: plan.label + ' Membership',
      prefill: {
        email: user.email,
        name:  user.user_metadata && user.user_metadata.full_name
               ? user.user_metadata.full_name : ''
      },
      theme: { color: '#fbbf24' },
      notes: {
        plan:    planKey,
        days:    String(plan.days),
        user_id: user.id,
        email:   user.email
      },

      handler: async function (response) {
        var paymentId = response.razorpay_payment_id;
        console.log('[PRM] Payment success. payment_id:', paymentId, '| plan:', planKey, '| user:', user.id);

        var client = getSupabase();

        // ── Insert membership record ────────────────────────────
        var insertPayload = {
          user_id:    user.id,
          email:      user.email,
          plan:       planKey,
          amount_inr: plan.amount,
          days:       plan.days,
          payment_id: paymentId,
          status:     'active',
          starts_at:  startsAt.toISOString(),
          expires_at: expiresAt.toISOString()
        };

        try {
          var res = await client
            .from('memberships')
            .insert(insertPayload)
            .select()
            .single();

          if (res.error) {
            console.error('[PRM] memberships INSERT error:', res.error);
            showToast(
              '⚠️ Payment received but membership record failed. ' +
              'Contact support with payment ID: ' + paymentId, 'error'
            );
          } else {
            console.log('[PRM] memberships INSERT success:', res.data);
            // DB trigger auto-syncs profiles.is_premium — no manual update needed
          }
        } catch (e) {
          console.error('[PRM] memberships INSERT exception:', e);
        }

        // ── Pipedream webhook (same URL as purchases) ───────────
        try {
          await fetch(PD_WEBHOOK, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type:       'membership_purchase',
              email:      user.email,
              user_id:    user.id,
              plan:       planKey,
              plan_label: plan.label,
              amount_inr: plan.amount,
              days:       plan.days,
              payment_id: paymentId,
              expires_at: expiresAt.toISOString()
            })
          });
        } catch (e) {
          console.warn('[PRM] Pipedream webhook error:', e);
        }

        // ── UI update ────────────────────────────────────────────
        showToast(
          '🎉 Welcome to Premium! Your ' + plan.label +
          ' membership is active until ' + fmtDate(expiresAt) + '.',
          'success'
        );
        // Refresh page UI to show member state
        await PRM.updatePageForStatus();
        // Bust dashboard cache so next dashboard visit reflects premium
        if (typeof window._dashCache !== 'undefined') window._dashCache = null;
      },

      modal: {
        ondismiss: function () {
          showToast('Membership checkout cancelled.', 'info');
        }
      }
    };

    if (typeof Razorpay === 'undefined') {
      showToast('Payment service not loaded. Please refresh and try again.', 'error');
      return;
    }
    var rzp = new Razorpay(rzpOptions);
    rzp.open();
  };

  /* ──────────────────────────────────────────────────────────────── */
  /*  SCROLL TO PLANS                                                 */
  /* ──────────────────────────────────────────────────────────────── */
  PRM.scrollToPlans = function () {
    var grid = document.querySelector('#page-premium .prm-plans-grid');
    if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ──────────────────────────────────────────────────────────────── */
  /*  FAQ ACCORDION                                                   */
  /* ──────────────────────────────────────────────────────────────── */
  PRM.toggleFaq = function (btn) {
    if (!btn) return;
    var item = btn.closest('.prm-faq-item');
    if (!item) return;
    var isOpen = item.classList.contains('open');
    var list = item.closest('.prm-faq-list');
    if (list) {
      list.querySelectorAll('.prm-faq-item.open').forEach(function (el) {
        el.classList.remove('open');
      });
    }
    if (!isOpen) item.classList.add('open');
  };

  /* ──────────────────────────────────────────────────────────────── */
  /*  TESTIMONIALS CAROUSEL                                           */
  /* ──────────────────────────────────────────────────────────────── */
  PRM.initTestiCarousel = function () {
    var track  = document.getElementById('prmTestiTrack');
    var dotsEl = document.getElementById('prmTestiDots');
    if (!track || !dotsEl) return;

    var cards = Array.from(track.querySelectorAll('.prm-testi-card'));
    var total = cards.length;
    if (total === 0) return;

    var current = 0;
    var timer   = null;

    dotsEl.innerHTML = '';
    cards.forEach(function (_, i) {
      var d = document.createElement('button');
      d.className = 'prm-testi-dot' + (i === 0 ? ' active' : '');
      d.setAttribute('aria-label', 'Go to slide ' + (i + 1));
      d.addEventListener('click', function () { goTo(i); });
      dotsEl.appendChild(d);
    });

    var dots = dotsEl.querySelectorAll('.prm-testi-dot');

    function getCardWidth () {
      if (!cards[0]) return 0;
      return cards[0].offsetWidth + 14;
    }

    function goTo (idx) {
      current = ((idx % total) + total) % total;
      track.style.transform = 'translateX(-' + (current * getCardWidth()) + 'px)';
      dots.forEach(function (d, i) {
        d.classList.toggle('active', i === current);
      });
    }

    function startTimer () {
      clearInterval(timer);
      timer = setInterval(function () { goTo(current + 1); }, 4000);
    }

    var startX = 0;
    track.addEventListener('touchstart', function (e) {
      startX = e.touches[0].clientX;
    }, { passive: true });
    track.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) {
        goTo(dx < 0 ? current + 1 : current - 1);
        startTimer();
      }
    }, { passive: true });

    track.addEventListener('mouseenter', function () { clearInterval(timer); });
    track.addEventListener('mouseleave', startTimer);
    window.addEventListener('resize', function () { goTo(current); }, { passive: true });

    goTo(0);
    startTimer();
  };

  /* ──────────────────────────────────────────────────────────────── */
  /*  PAGE INIT (called by navigate hook in index.html)               */
  /* ──────────────────────────────────────────────────────────────── */
  PRM.initPage = function () {
    requestAnimationFrame(function () {
      PRM.initTestiCarousel();
      PRM.updatePageForStatus();  // async — updates buttons/banner after auth check
    });
  };

  /* ──────────────────────────────────────────────────────────────── */
  /*  DASHBOARD WIDGET INIT (called by navigate('dashboard') hook)   */
  /* ──────────────────────────────────────────────────────────────── */
  PRM.initDashWidget = async function () {
    var membership = await PRM.checkStatus();
    var sb = getSupabase();
    var authRes = sb ? await sb.auth.getUser() : null;
    var user = authRes && authRes.data && authRes.data.user;
    PRM.updateDashWidget(membership, user);
  };

})();
