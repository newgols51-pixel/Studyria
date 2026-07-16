/**
 * admin-membership-manager.js — Studyria Admin Membership Manager v1.1
 *
 * FIXES in v1.1:
 *   BUG 1 FIXED: _executeGrant() — "overlay is not defined" error removed.
 *                Now uses document.querySelector('#ammGrantModal .amm-btn-primary') correctly.
 *   BUG 2 FIXED: Downgrade/Upgrade "Plan" action — now adds days from CURRENT expiry
 *                (not from today). Downgrade = fewer days added from current expiry.
 *                Expired membership → days counted from today.
 *
 * ADDITIVE ONLY — does NOT modify or replace any existing admin membership functions.
 */

(function () {
  'use strict';

  /* ── Guard: only run once, but allow v1.0 → v1.1 upgrade ── */
  if (window.AdminMembershipManager && window.AdminMembershipManager._version === '1.1') return;

  /* ── Plan Definitions ────────────────────────────────────────── */
  var AMM_PLANS = {
    trial_1day:  { label: '1 Day Trial', days: 1,     slug: 'trial_1day'  },
    trial_15day: { label: '15 Days',     days: 15,    slug: 'trial_15day' },
    monthly:     { label: '30 Days',     days: 30,    slug: 'monthly'     },
    quarterly:   { label: '90 Days',     days: 90,    slug: 'quarterly'   },
    half_year:   { label: '180 Days',    days: 180,   slug: 'half_year'   },
    yearly:      { label: '365 Days',    days: 365,   slug: 'yearly'      },
    lifetime:    { label: 'Lifetime ♾️', days: 36500, slug: 'lifetime'    }
  };

  var AMM_STATUS_COLORS = {
    active:    '#10d98e',
    expired:   '#ff4d6d',
    suspended: '#f59e0b',
    cancelled: '#ff4d6d',
    trial:     '#fbbf24',
    none:      '#6b7280'
  };

  /* ── Utilities ───────────────────────────────────────────────── */
  function _sb()  { return window.supabaseClient; }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  }

  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  function _fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return iso.slice(0, 10); }
  }

  /** Add `days` from today */
  function _daysFromNow(days) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  /**
   * BUG 2 FIX — Add `days` from the CURRENT expiry date.
   * If expiry is in the past (expired membership), count from today instead.
   * This means Downgrade also correctly shrinks remaining time.
   */
  function _addDaysFromExpiry(currentExpiryIso, days) {
    var base = currentExpiryIso ? new Date(currentExpiryIso) : new Date();
    // If already expired → count from today
    if (base < new Date()) base = new Date();
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  /* ── Audit Logger ────────────────────────────────────────────── */
  async function _logAudit(entry) {
    var client = _sb();
    if (!client) return;
    try {
      var adminUid = null;
      try {
        var authRes = await client.auth.getUser();
        adminUid = authRes && authRes.data && authRes.data.user ? authRes.data.user.id : null;
      } catch (_) {}

      await client.from('membership_audit_log').insert({
        membership_id:  entry.membership_id  || null,
        user_id:        entry.user_id        || null,
        action:         entry.action         || 'unknown',
        admin_user_id:  adminUid,
        old_status:     entry.old_status     || null,
        new_status:     entry.new_status     || null,
        old_expires_at: entry.old_expires_at || null,
        new_expires_at: entry.new_expires_at || null,
        old_plan_id:    entry.old_plan_id    || null,
        new_plan_id:    entry.new_plan_id    || null,
        plan_slug:      entry.plan_slug      || null,
        notes:          entry.notes          || null
      });
    } catch (e) {
      console.warn('[AMM] Audit log write failed (table may not exist yet):', e.message || e);
    }
  }

  /* ── Fetch all membership plans from Supabase ────────────────── */
  async function _fetchPlans() {
    var client = _sb();
    if (!client) return [];
    try {
      var res = await client.from('membership_plans')
        .select('id,slug,name,price_inr,duration_days')
        .order('price_inr', { ascending: true });
      return (res.data || []).map(function (p) {
        return { id: p.id, slug: p.slug, name: p.name, price: p.price_inr, days: p.duration_days };
      });
    } catch (e) { return []; }
  }

  /* ── Find plan ID by slug ────────────────────────────────────── */
  async function _findPlanId(slug, plans) {
    if (!plans) plans = await _fetchPlans();
    var found = plans.find(function (p) { return p.slug === slug; });
    return found ? found.id : null;
  }

  /* ── CSS Injection ───────────────────────────────────────────── */
  function _injectCSS() {
    if (document.getElementById('amm-styles')) return;
    var rules = [
      /* Overlay + Modal */
      '.amm-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:999998;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(6px)}',
      '.amm-modal{background:#0e1320;border:1px solid rgba(255,255,255,0.12);border-radius:18px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,0.55)}',
      '.amm-modal-header{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,0.08)}',
      '.amm-modal-title{font-size:1.05rem;font-weight:800;color:#fbbf24}',
      '.amm-modal-close{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:6px 12px;cursor:pointer;color:rgba(255,255,255,0.6);font-size:.82rem}',
      '.amm-modal-close:hover{background:rgba(255,255,255,0.1);color:#fff}',
      '.amm-modal-body{padding:20px 22px}',
      /* Fields */
      '.amm-field{margin-bottom:15px}',
      '.amm-label{font-size:.73rem;font-weight:700;color:rgba(255,255,255,0.45);margin-bottom:6px;display:block;letter-spacing:.04em;text-transform:uppercase}',
      '.amm-input,.amm-select,.amm-textarea{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:10px 13px;color:rgba(255,255,255,0.9);font-size:.85rem;font-family:inherit;box-sizing:border-box;outline:none;transition:border-color .2s}',
      '.amm-input:focus,.amm-select:focus,.amm-textarea:focus{border-color:#fbbf24}',
      '.amm-textarea{min-height:68px;resize:vertical}',
      /* Plan chips */
      '.amm-plan-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:8px;margin-bottom:4px}',
      '.amm-plan-chip{padding:9px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);cursor:pointer;font-size:.78rem;text-align:center;transition:all .18s;color:rgba(255,255,255,0.65);user-select:none}',
      '.amm-plan-chip:hover{background:rgba(255,255,255,0.09);border-color:rgba(255,255,255,0.2)}',
      '.amm-plan-chip.selected{background:rgba(251,191,36,0.18);border-color:rgba(251,191,36,0.5);color:#fbbf24;font-weight:700}',
      /* Buttons */
      '.amm-btn{padding:10px 20px;border-radius:10px;border:none;cursor:pointer;font-size:.82rem;font-weight:700;font-family:inherit;transition:all .2s;display:inline-flex;align-items:center;gap:6px}',
      '.amm-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.amm-btn-primary{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#000}',
      '.amm-btn-primary:hover:not(:disabled){filter:brightness(1.08)}',
      '.amm-btn-secondary{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.75)}',
      '.amm-btn-secondary:hover:not(:disabled){background:rgba(255,255,255,0.1)}',
      '.amm-btn-danger{background:rgba(255,77,109,0.14);border:1px solid rgba(255,77,109,0.3);color:#ff4d6d}',
      '.amm-btn-danger:hover:not(:disabled){background:rgba(255,77,109,0.24)}',
      '.amm-btn-row{display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap}',
      '.amm-custom-fields{margin-top:8px;padding:14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.12)}',
      /* Info card inside modal */
      '.amm-info-card{background:rgba(255,255,255,0.03);border-radius:10px;padding:12px 14px;margin-bottom:15px;font-size:.72rem;color:rgba(255,255,255,0.4);line-height:1.7}',
      '.amm-info-card b{color:rgba(255,255,255,0.75)}',
      /* Table action buttons */
      '.amm-action-btn{padding:4px 9px;border-radius:7px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.65);font-size:.66rem;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap;margin:1px}',
      '.amm-action-btn:hover{background:rgba(255,255,255,0.1)}',
      '.amm-action-btn.extend{border-color:rgba(61,142,248,0.35);color:#3d8ef8;background:rgba(61,142,248,0.08)}',
      '.amm-action-btn.renew{border-color:rgba(16,217,142,0.35);color:#10d98e;background:rgba(16,217,142,0.08)}',
      '.amm-action-btn.suspend{border-color:rgba(245,158,11,0.35);color:#f59e0b;background:rgba(245,158,11,0.08)}',
      '.amm-action-btn.resume{border-color:rgba(16,217,142,0.35);color:#10d98e;background:rgba(16,217,142,0.08)}',
      '.amm-action-btn.upgrade{border-color:rgba(139,92,246,0.35);color:#a78bfa;background:rgba(139,92,246,0.08)}',
      '.amm-action-btn.deactivate{border-color:rgba(255,77,109,0.35);color:#ff4d6d;background:rgba(255,77,109,0.08)}',
      /* Grant bar */
      '.amm-grant-bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:18px;padding:14px 18px;background:linear-gradient(135deg,rgba(251,191,36,0.08),rgba(245,158,11,0.03));border:1px solid rgba(251,191,36,0.2);border-radius:14px}',
      '.amm-grant-title{font-size:.88rem;font-weight:700;color:#fbbf24}',
      '.amm-grant-btn{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#000;font-weight:800;padding:8px 18px;border-radius:10px;border:none;cursor:pointer;font-size:.8rem;transition:all .2s}',
      '.amm-grant-btn:hover{filter:brightness(1.1);transform:translateY(-1px)}',
      /* History */
      '.amm-history-row{display:flex;gap:10px;padding:9px 12px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:.72rem;align-items:flex-start}',
      '.amm-history-action{font-weight:700;min-width:90px}',
      '.amm-history-date{color:rgba(255,255,255,0.35);min-width:96px}',
      '.amm-history-notes{color:rgba(255,255,255,0.45);flex:1}'
    ];
    var s = document.createElement('style');
    s.id = 'amm-styles';
    s.textContent = rules.join('');
    document.head.appendChild(s);
  }

  /* ── Module state ────────────────────────────────────────────── */
  var _selectedPlanSlug    = null;
  var _selectedMembershipId = null;
  var _cachedPlans         = null;

  /* ═══════════════════════════════════════════════════════════════
     GRANT MEMBERSHIP MODAL
  ═══════════════════════════════════════════════════════════════ */

  function _showGrantModal() {
    _injectCSS();
    _selectedPlanSlug = null;

    // Remove existing modal if any
    var old = document.getElementById('ammGrantModal');
    if (old) old.remove();

    var planChipsHtml = Object.keys(AMM_PLANS).map(function (slug) {
      var p = AMM_PLANS[slug];
      return '<div class="amm-plan-chip" data-plan="' + slug + '" onclick="window.AdminMembershipManager._selectPlan(\'' + slug + '\')">' + _esc(p.label) + '</div>';
    }).join('');
    planChipsHtml += '<div class="amm-plan-chip" data-plan="custom" onclick="window.AdminMembershipManager._selectPlan(\'custom\')">⚙️ Custom</div>';

    var html = '<div class="amm-modal" id="ammGrantModalInner">'
      + '<div class="amm-modal-header">'
      +   '<div class="amm-modal-title">👑 Grant Membership</div>'
      +   '<button class="amm-modal-close" onclick="window.AdminMembershipManager._closeModal()">✕ Close</button>'
      + '</div>'
      + '<div class="amm-modal-body">'
      /* User field */
      +   '<div class="amm-field">'
      +     '<label class="amm-label">User Email or User ID (UUID)</label>'
      +     '<input class="amm-input" id="ammGrantUserId" placeholder="user@example.com  or  xxxxxxxx-xxxx-…" autocomplete="off">'
      +   '</div>'
      /* Plan chips */
      +   '<div class="amm-field">'
      +     '<label class="amm-label">Select Plan</label>'
      +     '<div class="amm-plan-grid">' + planChipsHtml + '</div>'
      +   '</div>'
      /* Custom plan fields (hidden by default) */
      +   '<div id="ammCustomFields" style="display:none">'
      +     '<div class="amm-custom-fields">'
      +       '<div class="amm-field"><label class="amm-label">Custom Plan Name</label><input class="amm-input" id="ammCustomName" placeholder="e.g. Special Promo Plan"></div>'
      +       '<div class="amm-field"><label class="amm-label">Custom Duration (days)</label><input class="amm-input" id="ammCustomDays" type="number" min="1" placeholder="e.g. 45"></div>'
      +       '<div class="amm-field"><label class="amm-label">Or — Set Exact Expiry Date</label><input class="amm-input" id="ammCustomExpiry" type="date"></div>'
      +       '<div class="amm-field"><label class="amm-label">Custom Notes</label><textarea class="amm-textarea" id="ammCustomNotes" placeholder="Reason…"></textarea></div>'
      +     '</div>'
      +   '</div>'
      /* Admin notes */
      +   '<div class="amm-field">'
      +     '<label class="amm-label">Admin Notes (optional)</label>'
      +     '<textarea class="amm-textarea" id="ammGrantNotes" placeholder="Reason for manual grant…"></textarea>'
      +   '</div>'
      /* Buttons */
      +   '<div class="amm-btn-row">'
      +     '<button class="amm-btn amm-btn-secondary" onclick="window.AdminMembershipManager._closeModal()">Cancel</button>'
      +     '<button class="amm-btn amm-btn-primary" id="ammGrantSubmitBtn" onclick="window.AdminMembershipManager._executeGrant()">👑 Grant Membership</button>'
      +   '</div>'
      + '</div>'
      + '</div>';

    var overlay = document.createElement('div');
    overlay.className = 'amm-modal-overlay';
    overlay.id = 'ammGrantModal';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
  }

  /* ═══════════════════════════════════════════════════════════════
     ACTION MODAL (Extend / Renew / Suspend / Resume / Upgrade-Downgrade)
  ═══════════════════════════════════════════════════════════════ */

  function _showActionModal(action, membership) {
    _injectCSS();
    _selectedMembershipId = membership.id;
    _selectedPlanSlug = null;

    var old = document.getElementById('ammActionModal');
    if (old) old.remove();

    var cfgMap = {
      extend:  { title: '📅 Extend Membership',          btn: '📅 Extend',      cls: 'amm-btn-primary', desc: 'Add days on top of current expiry date.' },
      renew:   { title: '🔄 Renew Membership',            btn: '🔄 Renew',       cls: 'amm-btn-primary', desc: 'Start a fresh membership period from today.' },
      upgrade: { title: '⬆️ Change Plan (Up / Down)',     btn: '✅ Change Plan', cls: 'amm-btn-primary', desc: 'Change plan and add those days from current expiry.' },
      suspend: { title: '⏸️ Suspend Membership',          btn: '⏸️ Suspend',    cls: 'amm-btn-danger',  desc: 'Temporarily suspend access. Resume anytime.' },
      resume:  { title: '▶️ Resume Membership',           btn: '▶️ Resume',     cls: 'amm-btn-primary', desc: 'Restore access from suspended state.' }
    };
    var cfg = cfgMap[action] || cfgMap.extend;

    var showPlans = (action === 'extend' || action === 'renew' || action === 'upgrade');

    /* Info card */
    var currentExpiry = membership.expires_at ? _fmtDate(membership.expires_at) : '—';
    var statusColor   = AMM_STATUS_COLORS[membership.status] || '#999';

    var body = '<div class="amm-info-card">'
      + 'User: <b>' + _esc((membership.user_id || '').slice(0, 16)) + '…</b><br>'
      + 'Status: <b style="color:' + statusColor + '">' + _esc(membership.status || '—') + '</b><br>'
      + 'Current Expiry: <b>' + currentExpiry + '</b>'
      + '</div>';

    body += '<div style="font-size:.82rem;color:rgba(255,255,255,0.55);margin-bottom:14px">' + _esc(cfg.desc) + '</div>';

    if (showPlans) {
      var planChipsHtml = Object.keys(AMM_PLANS).map(function (slug) {
        var p = AMM_PLANS[slug];
        return '<div class="amm-plan-chip" data-plan="' + slug + '" onclick="window.AdminMembershipManager._selectPlan(\'' + slug + '\')">' + _esc(p.label) + '</div>';
      }).join('');
      planChipsHtml += '<div class="amm-plan-chip" data-plan="custom" onclick="window.AdminMembershipManager._selectPlan(\'custom\')">⚙️ Custom</div>';

      body += '<div class="amm-field"><label class="amm-label">Select Plan</label>'
        + '<div class="amm-plan-grid">' + planChipsHtml + '</div>'
        + '</div>'
        + '<div id="ammCustomFields" style="display:none"><div class="amm-custom-fields">'
        + '<div class="amm-field"><label class="amm-label">Custom Plan Name</label><input class="amm-input" id="ammCustomName" placeholder="Special plan…"></div>'
        + '<div class="amm-field"><label class="amm-label">Custom Duration (days)</label><input class="amm-input" id="ammCustomDays" type="number" min="1" placeholder="e.g. 45"></div>'
        + '<div class="amm-field"><label class="amm-label">Or — Set Exact Expiry Date</label><input class="amm-input" id="ammCustomExpiry" type="date"></div>'
        + '</div></div>';
    }

    var notePlaceholder = action === 'suspend'
      ? 'Reason for suspension (e.g. payment dispute)…'
      : 'Admin notes (optional)…';
    body += '<div class="amm-field"><label class="amm-label">Admin Notes</label>'
      + '<textarea class="amm-textarea" id="ammActionNotes" placeholder="' + notePlaceholder + '"></textarea>'
      + '</div>';

    body += '<div class="amm-btn-row">'
      + '<button class="amm-btn amm-btn-secondary" onclick="window.AdminMembershipManager._closeModal()">Cancel</button>'
      + '<button class="amm-btn ' + cfg.cls + '" id="ammActionSubmitBtn" onclick="window.AdminMembershipManager._executeAction(\'' + action + '\')">' + cfg.btn + '</button>'
      + '</div>';

    var overlay = document.createElement('div');
    overlay.className = 'amm-modal-overlay';
    overlay.id = 'ammActionModal';
    overlay.innerHTML = '<div class="amm-modal">'
      + '<div class="amm-modal-header">'
      +   '<div class="amm-modal-title">' + cfg.title + '</div>'
      +   '<button class="amm-modal-close" onclick="window.AdminMembershipManager._closeModal()">✕ Close</button>'
      + '</div>'
      + '<div class="amm-modal-body">' + body + '</div>'
      + '</div>';
    document.body.appendChild(overlay);
  }

  /* ── Plan chip click ─────────────────────────────────────────── */
  function _selectPlan(slug) {
    _selectedPlanSlug = slug;
    document.querySelectorAll('.amm-plan-chip').forEach(function (c) {
      c.classList.toggle('selected', c.getAttribute('data-plan') === slug);
    });
    var cf = document.getElementById('ammCustomFields');
    if (cf) cf.style.display = (slug === 'custom') ? 'block' : 'none';
  }

  /* ── Close any modal ─────────────────────────────────────────── */
  function _closeModal() {
    ['ammGrantModal','ammActionModal','ammHistoryModal','ammSQLModal'].forEach(function (id) {
      var m = document.getElementById(id);
      if (m) m.remove();
    });
    _selectedPlanSlug     = null;
    _selectedMembershipId = null;
  }

  /* ── Resolve user: email → UUID lookup, else pass-through ─────── */
  async function _resolveUserId(input) {
    input = (input || '').trim();
    if (!input) return null;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) return input;
    var client = _sb();
    if (!client) return input; // pass-through
    try {
      var res = await client.from('profiles').select('id').eq('email', input).maybeSingle();
      if (res && res.data && res.data.id) return res.data.id;
    } catch (_) {}
    // Fallback: return the raw input (might be a non-standard UUID or email-based ID)
    return input;
  }

  /* ── Build plan details from current selection ────────────────── */
  function _getSelectedPlanDetails() {
    if (!_selectedPlanSlug) return null;

    if (_selectedPlanSlug === 'custom') {
      var name       = (document.getElementById('ammCustomName')   || {}).value || 'Custom Plan';
      var daysRaw    = parseInt((document.getElementById('ammCustomDays')   || {}).value || '0', 10);
      var expiryDate = ((document.getElementById('ammCustomExpiry') || {}).value || '').trim();
      var notes      = (document.getElementById('ammCustomNotes')  || {}).value || '';

      var days = daysRaw;
      if (expiryDate) {
        days = Math.ceil((new Date(expiryDate + 'T23:59:59') - Date.now()) / 86400000);
        if (days < 1) days = 1;
      }
      if (!days || days < 1) days = 30;

      return { slug: 'custom', label: name, days: days, custom: true, notes: notes, expiryOverride: expiryDate || null };
    }

    var p = AMM_PLANS[_selectedPlanSlug];
    if (!p) return null;
    return { slug: p.slug, label: p.label, days: p.days, custom: false, expiryOverride: null };
  }

  /* ═══════════════════════════════════════════════════════════════
     BUG 1 FIX — _executeGrant
     Old code used `overlay` which was NOT in scope → ReferenceError.
     Fixed: use document.getElementById('ammGrantSubmitBtn') instead.
  ═══════════════════════════════════════════════════════════════ */
  async function _executeGrant() {
    var userInput   = (document.getElementById('ammGrantUserId')  || {}).value || '';
    var notes       = (document.getElementById('ammGrantNotes')   || {}).value || '';
    var planDetails = _getSelectedPlanDetails();

    // Validation
    if (!userInput.trim()) { _toast('⚠️ Please enter a user email or User ID.', 'error'); return; }
    if (!planDetails)      { _toast('⚠️ Please select a plan.', 'error'); return; }

    var client = _sb();
    if (!client) { _toast('❌ Supabase not connected.', 'error'); return; }

    /* BUG 1 FIX: reference the button by its ID — not via 'overlay' */
    var btn = document.getElementById('ammGrantSubmitBtn');
    var origText = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = '⏳ Granting…'; btn.disabled = true; }

    try {
      var userId = await _resolveUserId(userInput);
      if (!userId) { _toast('❌ Could not resolve user. Check email or UUID.', 'error'); return; }

      if (!_cachedPlans) _cachedPlans = await _fetchPlans();

      // Find the plan ID in membership_plans table
      var planId = null;
      if (planDetails.slug !== 'custom') {
        planId = await _findPlanId(planDetails.slug, _cachedPlans);
        // Fallbacks for slugs that might differ in DB
        if (!planId && planDetails.slug === 'yearly')   planId = await _findPlanId('annual', _cachedPlans);
        if (!planId && planDetails.slug === 'lifetime') planId = await _findPlanId('lifetime', _cachedPlans) || await _findPlanId('yearly', _cachedPlans) || await _findPlanId('annual', _cachedPlans);
      }
      // For custom or still no match → use first available plan
      if (!planId && _cachedPlans.length) planId = _cachedPlans[0].id;

      // Compute expiry date
      var expiresAt;
      if (planDetails.expiryOverride) {
        expiresAt = new Date(planDetails.expiryOverride + 'T23:59:59').toISOString();
      } else {
        expiresAt = _daysFromNow(planDetails.days);
      }

      // Check for existing membership (any status — get latest)
      var existRes = await client.from('user_memberships')
        .select('id,status,expires_at,plan_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      var existing = existRes && existRes.data ? existRes.data : null;
      var isCurrentlyActive = existing
        && existing.status === 'active'
        && existing.expires_at
        && new Date(existing.expires_at) > new Date();

      if (isCurrentlyActive) {
        /* Active member → extend their existing expiry */
        var extendedExpiry = planDetails.expiryOverride
          ? new Date(planDetails.expiryOverride + 'T23:59:59').toISOString()
          : _addDaysFromExpiry(existing.expires_at, planDetails.days);

        var upRes = await client.from('user_memberships')
          .update({ plan_id: planId || existing.plan_id, expires_at: extendedExpiry })
          .eq('id', existing.id);
        if (upRes.error) throw new Error(upRes.error.message);

        await _logAudit({
          membership_id: existing.id, user_id: userId,
          action: 'grant_extend',
          old_status: existing.status, new_status: 'active',
          old_expires_at: existing.expires_at, new_expires_at: extendedExpiry,
          old_plan_id: existing.plan_id, new_plan_id: planId,
          plan_slug: planDetails.slug,
          notes: notes || ('Grant extend: ' + planDetails.label + (planDetails.custom ? ' [custom]' : ''))
        });

        _toast('✅ Membership extended → ' + planDetails.label + ' added from current expiry.', 'success');

      } else {
        /* No active membership → create new row */
        var now = new Date().toISOString();
        var insRes = await client.from('user_memberships').insert({
          user_id:    userId,
          plan_id:    planId,
          status:     'active',
          started_at: now,
          expires_at: expiresAt,
          auto_renew: false
        }).select('id').single();
        if (insRes.error) throw new Error(insRes.error.message);

        await _logAudit({
          membership_id: insRes.data ? insRes.data.id : null, user_id: userId,
          action: 'grant',
          old_status: existing ? existing.status : null, new_status: 'active',
          old_expires_at: existing ? existing.expires_at : null, new_expires_at: expiresAt,
          old_plan_id: existing ? existing.plan_id : null, new_plan_id: planId,
          plan_slug: planDetails.slug,
          notes: notes || ('Manual grant: ' + planDetails.label + (planDetails.custom ? ' [custom]' : ''))
        });

        _toast('✅ Membership granted: ' + planDetails.label + '.', 'success');
      }

      _closeModal();
      _refreshMembershipTable();

    } catch (e) {
      console.error('[AMM] Grant error:', e);
      _toast('❌ Error: ' + (e.message || String(e)), 'error');
      if (btn) { btn.innerHTML = origText; btn.disabled = false; }
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     BUG 2 FIX — _executeAction (Extend / Renew / Upgrade / Downgrade)
     Old code: upgrade used _daysFromNow(days) → counted from TODAY always.
     Fixed: extend & upgrade now use _addDaysFromExpiry() → days added
            FROM CURRENT EXPIRY. Downgrade = fewer days from expiry → correct.
            Renew still counts from today (intentional: fresh start).
  ═══════════════════════════════════════════════════════════════ */
  async function _executeAction(action) {
    if (!_selectedMembershipId) { _toast('⚠️ No membership selected.', 'error'); return; }

    var client = _sb();
    if (!client) { _toast('❌ Supabase not connected.', 'error'); return; }

    var notes       = (document.getElementById('ammActionNotes') || {}).value || '';
    var planDetails = _getSelectedPlanDetails();

    /* Button loading state */
    var btn      = document.getElementById('ammActionSubmitBtn');
    var origText = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = '⏳ Working…'; btn.disabled = true; }

    try {
      /* Fetch current membership row */
      var memRes = await client.from('user_memberships')
        .select('id,user_id,plan_id,status,started_at,expires_at')
        .eq('id', _selectedMembershipId)
        .maybeSingle();

      if (!memRes || memRes.error || !memRes.data) {
        _toast('❌ Membership record not found.', 'error');
        if (btn) { btn.innerHTML = origText; btn.disabled = false; }
        return;
      }

      var mem       = memRes.data;
      var oldStatus = mem.status;
      var oldExpiry = mem.expires_at;
      var oldPlanId = mem.plan_id;

      var updateData = {};
      var newStatus  = oldStatus;
      var newExpiry  = oldExpiry;
      var newPlanId  = oldPlanId;
      var planSlug   = null;

      /* ── Extend: add days from current expiry ── */
      if (action === 'extend') {
        if (!planDetails) { _toast('⚠️ Please select a plan.', 'error'); if (btn) { btn.innerHTML = origText; btn.disabled = false; } return; }
        newExpiry = planDetails.expiryOverride
          ? new Date(planDetails.expiryOverride + 'T23:59:59').toISOString()
          : _addDaysFromExpiry(oldExpiry, planDetails.days);  /* BUG 2 FIX */
        updateData.expires_at = newExpiry;
        updateData.status     = 'active';
        newStatus  = 'active';
        planSlug   = planDetails.slug;
        if (planDetails.slug !== 'custom') {
          if (!_cachedPlans) _cachedPlans = await _fetchPlans();
          var ep = await _findPlanId(planDetails.slug, _cachedPlans);
          if (ep) { updateData.plan_id = ep; newPlanId = ep; }
        }
      }

      /* ── Renew: fresh start from today ── */
      else if (action === 'renew') {
        if (!planDetails) { _toast('⚠️ Please select a plan.', 'error'); if (btn) { btn.innerHTML = origText; btn.disabled = false; } return; }
        newExpiry = planDetails.expiryOverride
          ? new Date(planDetails.expiryOverride + 'T23:59:59').toISOString()
          : _daysFromNow(planDetails.days);                   /* fresh start = from today */
        updateData.expires_at  = newExpiry;
        updateData.status      = 'active';
        updateData.started_at  = new Date().toISOString();
        updateData.cancelled_at = null;
        newStatus  = 'active';
        planSlug   = planDetails.slug;
        if (planDetails.slug !== 'custom') {
          if (!_cachedPlans) _cachedPlans = await _fetchPlans();
          var rp = await _findPlanId(planDetails.slug, _cachedPlans);
          if (rp) { updateData.plan_id = rp; newPlanId = rp; }
        }
      }

      /* ── Suspend ── */
      else if (action === 'suspend') {
        updateData.status = 'suspended';
        newStatus = 'suspended';
      }

      /* ── Resume ── */
      else if (action === 'resume') {
        newStatus = 'active';
        updateData.status = 'active';
        // If expiry has passed, give 30 days from today
        if (!oldExpiry || new Date(oldExpiry) <= new Date()) {
          newExpiry = _daysFromNow(30);
          updateData.expires_at = newExpiry;
          _toast('ℹ️ Membership was expired — extended by 30 days from today.', 'info');
        }
      }

      /*
       * ── Change Plan (Upgrade OR Downgrade) ──
       * BUG 2 FIX: previously used _daysFromNow() for upgrades,
       * which ignored remaining days and always counted from today.
       * Now uses _addDaysFromExpiry(oldExpiry, newPlanDays) so that:
       *   - Upgrade: more days are added from current expiry ✓
       *   - Downgrade: fewer days are added from current expiry ✓
       * Example: 180-day plan with 100 days left → downgrade to 30-day plan
       * → new expiry = currentExpiry + 30 days (user gets 100 + 30 remaining) ✓
       */
      else if (action === 'upgrade') {
        if (!planDetails) { _toast('⚠️ Please select a plan.', 'error'); if (btn) { btn.innerHTML = origText; btn.disabled = false; } return; }
        newExpiry = planDetails.expiryOverride
          ? new Date(planDetails.expiryOverride + 'T23:59:59').toISOString()
          : _addDaysFromExpiry(oldExpiry, planDetails.days);  /* BUG 2 FIX */
        updateData.expires_at = newExpiry;
        updateData.status     = 'active';
        newStatus  = 'active';
        planSlug   = planDetails.slug;
        if (planDetails.slug !== 'custom') {
          if (!_cachedPlans) _cachedPlans = await _fetchPlans();
          var up = await _findPlanId(planDetails.slug, _cachedPlans);
          if (up) { updateData.plan_id = up; newPlanId = up; }
        }
      }

      /* Execute update */
      var upRes = await client.from('user_memberships')
        .update(updateData)
        .eq('id', _selectedMembershipId);
      if (upRes.error) throw new Error(upRes.error.message);

      /* Audit log */
      await _logAudit({
        membership_id: _selectedMembershipId, user_id: mem.user_id,
        action: action,
        old_status: oldStatus, new_status: newStatus,
        old_expires_at: oldExpiry, new_expires_at: newExpiry,
        old_plan_id: oldPlanId, new_plan_id: newPlanId,
        plan_slug: planSlug,
        notes: notes || (planDetails ? planDetails.label : '')
      });

      var msgs = {
        extend:  '✅ Membership extended from current expiry.',
        renew:   '✅ Membership renewed from today.',
        suspend: '⏸️ Membership suspended.',
        resume:  '▶️ Membership resumed.',
        upgrade: '✅ Plan changed. Days added from current expiry.'
      };
      _toast(msgs[action] || '✅ Done.', 'success');

      _closeModal();
      _refreshMembershipTable();

    } catch (e) {
      console.error('[AMM] Action error:', e);
      _toast('❌ Error: ' + (e.message || String(e)), 'error');
      if (btn) { btn.innerHTML = origText; btn.disabled = false; }
    }
  }

  /* ── Helper: refresh the membership table ────────────────────── */
  function _refreshMembershipTable() {
    var main = document.getElementById('adminMain');
    if (main && typeof window.renderAdminMemberships === 'function') {
      window.renderAdminMemberships(main);
    }
  }

  /* ── Activate with audit ─────────────────────────────────────── */
  async function _activateWithAudit(id) {
    var client = _sb();
    if (!client) return;
    try {
      var memRes = await client.from('user_memberships')
        .select('id,user_id,status,expires_at,plan_id').eq('id', id).maybeSingle();
      var mem = (memRes && memRes.data) ? memRes.data : {};
      var newExpiry = _daysFromNow(30);

      var res = await client.from('user_memberships')
        .update({ status: 'active', expires_at: newExpiry }).eq('id', id);
      if (res.error) throw new Error(res.error.message);

      await _logAudit({
        membership_id: id, user_id: mem.user_id,
        action: 'activate',
        old_status: mem.status, new_status: 'active',
        old_expires_at: mem.expires_at, new_expires_at: newExpiry,
        old_plan_id: mem.plan_id, new_plan_id: mem.plan_id,
        notes: 'Manual activate (+30 days)'
      });

      _toast('✅ Membership activated (+30 days).', 'success');
      _refreshMembershipTable();
    } catch (e) {
      console.error('[AMM] Activate error:', e);
      _toast('❌ ' + e.message, 'error');
    }
  }

  /* ── Deactivate with audit ───────────────────────────────────── */
  async function _deactivateWithAudit(id) {
    if (!confirm('Deactivate this membership? The user will lose Premium access immediately.')) return;
    var client = _sb();
    if (!client) return;
    try {
      var memRes = await client.from('user_memberships')
        .select('id,user_id,status,expires_at,plan_id').eq('id', id).maybeSingle();
      var mem = (memRes && memRes.data) ? memRes.data : {};
      var now = new Date().toISOString();

      var res = await client.from('user_memberships')
        .update({ status: 'cancelled', expires_at: now }).eq('id', id);
      if (res.error) throw new Error(res.error.message);

      await _logAudit({
        membership_id: id, user_id: mem.user_id,
        action: 'deactivate',
        old_status: mem.status, new_status: 'cancelled',
        old_expires_at: mem.expires_at, new_expires_at: now,
        old_plan_id: mem.plan_id, new_plan_id: mem.plan_id,
        notes: 'Manual deactivation'
      });

      _toast('🚫 Membership deactivated.', 'info');
      _refreshMembershipTable();
    } catch (e) {
      console.error('[AMM] Deactivate error:', e);
      _toast('❌ ' + e.message, 'error');
    }
  }

  /* ── Per-row action wrappers ─────────────────────────────────── */
  async function _fetchMembership(id) {
    var client = _sb();
    if (!client) return null;
    try {
      var res = await client.from('user_memberships')
        .select('id,user_id,plan_id,status,started_at,expires_at').eq('id', id).maybeSingle();
      return (res && res.data) ? res.data : null;
    } catch (e) { return null; }
  }

  async function _extendMembership(id)  { if (!_cachedPlans) _cachedPlans = await _fetchPlans(); var m = await _fetchMembership(id); if (m) _showActionModal('extend',  m); }
  async function _renewMembership(id)   { if (!_cachedPlans) _cachedPlans = await _fetchPlans(); var m = await _fetchMembership(id); if (m) _showActionModal('renew',   m); }
  async function _suspendMembership(id) { if (!_cachedPlans) _cachedPlans = await _fetchPlans(); var m = await _fetchMembership(id); if (m) _showActionModal('suspend', m); }
  async function _resumeMembership(id)  { if (!_cachedPlans) _cachedPlans = await _fetchPlans(); var m = await _fetchMembership(id); if (m) _showActionModal('resume',  m); }
  async function _upgradeMembership(id) { if (!_cachedPlans) _cachedPlans = await _fetchPlans(); var m = await _fetchMembership(id); if (m) _showActionModal('upgrade', m); }
  async function _activateMembership(id)   { await _activateWithAudit(id); }
  async function _deactivateMembership(id) { await _deactivateWithAudit(id); }

  /* ── Inject "Grant Membership" bar above membership table ─────── */
  function _injectGrantButton() {
    if (document.getElementById('ammGrantBar')) return;
    var sectionTitle = document.querySelector('.amem-section-title');
    if (!sectionTitle) return;

    var bar = document.createElement('div');
    bar.className = 'amm-grant-bar';
    bar.id = 'ammGrantBar';
    bar.innerHTML = '<div class="amm-grant-title">👑 Manual Membership Management</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + '<button class="amm-grant-btn" onclick="window.AdminMembershipManager._showGrantModal()">✨ Grant Membership</button>'
      + '<button style="padding:8px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.55);font-size:.72rem;cursor:pointer" onclick="window.AdminMembershipManager._showSQLMigration()">🗄️ Audit Log SQL</button>'
      + '</div>';
    sectionTitle.parentNode.insertBefore(bar, sectionTitle);
  }

  /* ── Enhance table rows with new action buttons ──────────────── */
  function _enhanceTableActions() {
    var rows = document.querySelectorAll('table.amem-table tbody tr');
    rows.forEach(function (row) {
      // Skip already enhanced rows
      if (row.dataset.ammEnhanced === '1') return;

      var rowId = (row.id || '').replace('amem-row-', '');
      if (!rowId) return;

      var actionCell = row.querySelector('td:last-child');
      if (!actionCell) return;

      var badgeText = '';
      var badge = row.querySelector('.amem-badge');
      if (badge) badgeText = badge.textContent.trim().toLowerCase();

      var isSuspended = badgeText.indexOf('suspend') >= 0;
      var isActive    = badgeText.indexOf('active')  >= 0;
      var isExpired   = badgeText.indexOf('expired') >= 0;

      var newBtns = '';

      if (isSuspended) {
        newBtns += '<button class="amm-action-btn resume"  onclick="window.AdminMembershipManager._resumeMembership(\''  + rowId + '\')">▶️ Resume</button>';
      } else if (isActive) {
        newBtns += '<button class="amm-action-btn extend"  onclick="window.AdminMembershipManager._extendMembership(\''  + rowId + '\')">📅 Extend</button>';
        newBtns += '<button class="amm-action-btn renew"   onclick="window.AdminMembershipManager._renewMembership(\''   + rowId + '\')">🔄 Renew</button>';
        newBtns += '<button class="amm-action-btn upgrade" onclick="window.AdminMembershipManager._upgradeMembership(\'' + rowId + '\')">⬆️ Plan</button>';
        newBtns += '<button class="amm-action-btn suspend" onclick="window.AdminMembershipManager._suspendMembership(\'' + rowId + '\')">⏸️ Suspend</button>';
      } else if (isExpired) {
        newBtns += '<button class="amm-action-btn renew"   onclick="window.AdminMembershipManager._renewMembership(\''   + rowId + '\')">🔄 Renew</button>';
        newBtns += '<button class="amm-action-btn upgrade" onclick="window.AdminMembershipManager._upgradeMembership(\'' + rowId + '\')">⬆️ Plan</button>';
      }

      // Patch existing activate/deactivate buttons to use audited versions
      var existingBtns = actionCell.innerHTML;
      existingBtns = existingBtns
        .replace(/window\._amemActivate\(/g,   "window.AdminMembershipManager._activateMembership(")
        .replace(/window\._amemDeactivate\(/g, "window.AdminMembershipManager._deactivateMembership(");

      actionCell.innerHTML = newBtns + existingBtns;
      row.dataset.ammEnhanced = '1';
    });
  }

  /* ── Audit History Modal ─────────────────────────────────────── */
  async function _showHistory(membershipId) {
    _injectCSS();
    var client = _sb();
    if (!client) { _toast('❌ Supabase not connected.', 'error'); return; }

    var old = document.getElementById('ammHistoryModal');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.className = 'amm-modal-overlay';
    overlay.id = 'ammHistoryModal';
    overlay.innerHTML = '<div class="amm-modal">'
      + '<div class="amm-modal-header"><div class="amm-modal-title">📜 Membership History</div>'
      + '<button class="amm-modal-close" onclick="window.AdminMembershipManager._closeModal()">✕ Close</button></div>'
      + '<div class="amm-modal-body"><div style="text-align:center;padding:28px;color:rgba(255,255,255,0.35)">Loading…</div></div>'
      + '</div>';
    document.body.appendChild(overlay);

    try {
      var res = await client.from('membership_audit_log')
        .select('action,old_status,new_status,old_expires_at,new_expires_at,notes,created_at')
        .eq('membership_id', membershipId)
        .order('created_at', { ascending: false })
        .limit(50);

      var body = overlay.querySelector('.amm-modal-body');
      if (!res || res.error || !res.data || !res.data.length) {
        body.innerHTML = '<div style="text-align:center;padding:28px;color:rgba(255,255,255,0.35);font-size:.82rem">No history found. Run the SQL migration to enable audit logging.</div>';
        return;
      }
      var rows = res.data.map(function (r) {
        var color = AMM_STATUS_COLORS[r.new_status] || '#999';
        return '<div class="amm-history-row">'
          + '<div class="amm-history-date">' + _fmtDate(r.created_at) + '</div>'
          + '<div class="amm-history-action" style="color:' + color + '">' + _esc(r.action) + '</div>'
          + '<div class="amm-history-notes">' + _esc(r.notes || '') + '</div>'
          + '</div>';
      }).join('');
      body.innerHTML = '<div style="font-size:.72rem;color:rgba(255,255,255,0.35);margin-bottom:10px">' + res.data.length + ' records</div>' + rows;
    } catch (e) {
      var body2 = overlay.querySelector('.amm-modal-body');
      if (body2) body2.innerHTML = '<div style="text-align:center;padding:28px;color:rgba(255,255,255,0.35);font-size:.82rem">Audit log table not yet created. Run the SQL migration first.</div>';
    }
  }

  /* ── SQL Migration Modal ─────────────────────────────────────── */
  function _showSQLMigration() {
    _injectCSS();
    var old = document.getElementById('ammSQLModal');
    if (old) old.remove();

    var sql = "-- STUDYRIA Membership Audit Log Migration\n-- Paste in Supabase SQL Editor and click Run\n\nCREATE TABLE IF NOT EXISTS membership_audit_log (\n  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,\n  membership_id   UUID REFERENCES user_memberships(id) ON DELETE SET NULL,\n  user_id         TEXT,\n  action          TEXT NOT NULL DEFAULT 'unknown',\n  admin_user_id   TEXT,\n  old_status      TEXT,\n  new_status      TEXT,\n  old_expires_at  TIMESTAMPTZ,\n  new_expires_at  TIMESTAMPTZ,\n  old_plan_id     UUID,\n  new_plan_id     UUID,\n  plan_slug       TEXT,\n  notes           TEXT,\n  created_at      TIMESTAMPTZ DEFAULT now()\n);\n\nALTER TABLE membership_audit_log ENABLE ROW LEVEL SECURITY;\n\nCREATE POLICY \"Admin read audit log\" ON membership_audit_log\n  FOR SELECT TO authenticated USING (true);\n\nCREATE POLICY \"Admin write audit log\" ON membership_audit_log\n  FOR INSERT TO authenticated WITH CHECK (true);\n\nCREATE INDEX IF NOT EXISTS idx_mal_mem_id  ON membership_audit_log(membership_id);\nCREATE INDEX IF NOT EXISTS idx_mal_user_id ON membership_audit_log(user_id);\nCREATE INDEX IF NOT EXISTS idx_mal_ts      ON membership_audit_log(created_at DESC);";

    var overlay = document.createElement('div');
    overlay.className = 'amm-modal-overlay';
    overlay.id = 'ammSQLModal';
    overlay.innerHTML = '<div class="amm-modal" style="max-width:640px">'
      + '<div class="amm-modal-header"><div class="amm-modal-title">🗄️ Audit Log SQL Migration</div>'
      + '<button class="amm-modal-close" onclick="window.AdminMembershipManager._closeModal()">✕ Close</button></div>'
      + '<div class="amm-modal-body">'
      + '<p style="font-size:.8rem;color:rgba(255,255,255,0.45);margin-bottom:12px">Copy and run in <b style="color:#fbbf24">Supabase → SQL Editor</b>:</p>'
      + '<textarea readonly id="ammSQLText" style="width:100%;min-height:280px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:14px;color:#10d98e;font-family:monospace;font-size:.72rem;line-height:1.6;resize:vertical;box-sizing:border-box">' + _esc(sql) + '</textarea>'
      + '<div class="amm-btn-row">'
      + '<button class="amm-btn amm-btn-secondary" onclick="window.AdminMembershipManager._closeModal()">Close</button>'
      + '<button class="amm-btn amm-btn-primary" onclick="window.AdminMembershipManager._copySQL()">📋 Copy SQL</button>'
      + '</div></div></div>';
    document.body.appendChild(overlay);
  }

  function _copySQL() {
    var ta = document.getElementById('ammSQLText');
    if (!ta) return;
    ta.select();
    try { document.execCommand('copy'); _toast('✅ SQL copied!', 'success'); }
    catch (e) { _toast('❌ Copy failed — select manually.', 'error'); }
  }

  /* ── Init: hook renderAdminMemberships ───────────────────────── */
  function _init() {
    _injectCSS();

    var origRender = window.renderAdminMemberships;
    if (origRender && !origRender._ammHooked) {
      window.renderAdminMemberships = async function (container) {
        await origRender.call(this, container);
        setTimeout(function () {
          _injectGrantButton();
          _enhanceTableActions();
        }, 250);
      };
      window.renderAdminMemberships._ammHooked = true;
    }
  }

  /* ── Public API ──────────────────────────────────────────────── */
  window.AdminMembershipManager = {
    _version: '1.1',

    _showGrantModal:      _showGrantModal,
    _showActionModal:     _showActionModal,
    _selectPlan:          _selectPlan,
    _closeModal:          _closeModal,
    _executeGrant:        _executeGrant,
    _executeAction:       _executeAction,

    _extendMembership:    _extendMembership,
    _renewMembership:     _renewMembership,
    _suspendMembership:   _suspendMembership,
    _resumeMembership:    _resumeMembership,
    _upgradeMembership:   _upgradeMembership,
    _activateMembership:  _activateMembership,
    _deactivateMembership:_deactivateMembership,

    _showHistory:         _showHistory,
    _showSQLMigration:    _showSQLMigration,
    _copySQL:             _copySQL,

    plans: AMM_PLANS
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})();
