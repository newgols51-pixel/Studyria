/**
 * admin-membership-manager.js — Studyria Admin Membership Manager v1.0
 * 
 * ADDITIVE ONLY — does NOT modify or replace any existing admin membership functions.
 * Adds: Manual Grant, Extend, Renew, Activate, Deactivate, Suspend, Resume, 
 *       Upgrade/Downgrade Plan, Custom Plan support, Audit Logging.
 *
 * All new data stored in Supabase:
 *   - user_memberships (existing table, new writes)
 *   - membership_audit_log (new table for audit trail)
 *
 * RLS Requirements:
 *   - membership_audit_log: admin-only writes, admin-only reads
 *   - user_memberships: admin-only writes (existing), user reads own row (existing)
 */

(function () {
  'use strict';

  if (window.AdminMembershipManager && window.AdminMembershipManager._version === '1.0') return;

  /* ── Plan Definitions ────────────────────────────────────────── */
  var AMM_PLANS = {
    trial_1day:  { label: '1 Day Trial',    days: 1,   slug: 'trial_1day' },
    trial_15day: { label: '15 Days',         days: 15,  slug: 'trial_15day' },
    monthly:     { label: '30 Days',         days: 30,  slug: 'monthly' },
    quarterly:   { label: '90 Days',         days: 90,  slug: 'quarterly' },
    half_year:   { label: '180 Days',        days: 180, slug: 'half_year' },
    yearly:      { label: '365 Days',        days: 365, slug: 'yearly' },
    lifetime:    { label: 'Lifetime',        days: 36500, slug: 'lifetime' }
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
  function _sb() { return window.supabaseClient; }
  function _esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;'); }
  function _toast(msg, type) { if (typeof window.showToast === 'function') window.showToast(msg, type || 'info'); }
  function _fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return iso.slice(0, 10); }
  }
  function _daysFromNow(days) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }
  function _addDaysToDate(dateStr, days) {
    var base = dateStr ? new Date(dateStr) : new Date();
    if (base < new Date()) base = new Date();
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  /* ── Audit Logger ────────────────────────────────────────────── */
  async function _logAudit(entry) {
    var client = _sb();
    if (!client) return;
    try {
      // Try to write to membership_audit_log table
      // If table doesn't exist yet, silently fail (graceful degradation)
      var adminUid = null;
      try {
        var authRes = await client.auth.getUser();
        adminUid = authRes && authRes.data && authRes.data.user ? authRes.data.user.id : null;
      } catch (_) {}

      await client.from('membership_audit_log').insert({
        membership_id: entry.membership_id || null,
        user_id: entry.user_id || null,
        action: entry.action || 'unknown',
        admin_user_id: adminUid,
        old_status: entry.old_status || null,
        new_status: entry.new_status || null,
        old_expires_at: entry.old_expires_at || null,
        new_expires_at: entry.new_expires_at || null,
        old_plan_id: entry.old_plan_id || null,
        new_plan_id: entry.new_plan_id || null,
        plan_slug: entry.plan_slug || null,
        notes: entry.notes || null
      });
    } catch (e) {
      console.warn('[AMM] Audit log write failed (table may not exist yet):', e.message || e);
    }
  }

  /* ── Get current admin UID ───────────────────────────────────── */
  async function _getAdminUid() {
    var client = _sb();
    if (!client) return null;
    try {
      var res = await client.auth.getUser();
      return res && res.data && res.data.user ? res.data.user.id : null;
    } catch (_) { return null; }
  }

  /* ── Fetch all membership plans from Supabase ────────────────── */
  async function _fetchPlans() {
    var client = _sb();
    if (!client) return [];
    try {
      var res = await client.from('membership_plans').select('id,slug,name,price_inr,duration_days').order('price_inr', { ascending: true });
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
    var css = [
      /* Grant Modal */
      '.amm-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:999998;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}',
      '.amm-modal{background:#0e1320;border:1px solid rgba(255,255,255,0.12);border-radius:18px;max-width:560px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5)}',
      '.amm-modal-header{display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid rgba(255,255,255,0.08)}',
      '.amm-modal-title{font-size:1.1rem;font-weight:800;color:#fbbf24;display:flex;align-items:center;gap:8px}',
      '.amm-modal-close{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:6px 12px;cursor:pointer;color:rgba(255,255,255,0.6);font-size:.85rem}',
      '.amm-modal-close:hover{background:rgba(255,255,255,0.1)}',
      '.amm-modal-body{padding:20px 24px}',
      '.amm-field{margin-bottom:16px}',
      '.amm-label{font-size:.75rem;font-weight:700;color:rgba(255,255,255,0.5);margin-bottom:6px;display:block;letter-spacing:.03em}',
      '.amm-input,.amm-select,.amm-textarea{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:10px 14px;color:rgba(255,255,255,0.9);font-size:.85rem;font-family:inherit;box-sizing:border-box;outline:none;transition:border-color .2s}',
      '.amm-input:focus,.amm-select:focus,.amm-textarea:focus{border-color:#3d8ef8}',
      '.amm-textarea{min-height:70px;resize:vertical}',
      '.amm-plan-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-bottom:12px}',
      '.amm-plan-chip{padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);cursor:pointer;font-size:.78rem;text-align:center;transition:all .2s;color:rgba(255,255,255,0.7)}',
      '.amm-plan-chip:hover{background:rgba(255,255,255,0.08)}',
      '.amm-plan-chip.selected{background:rgba(251,191,36,0.15);border-color:rgba(251,191,36,0.4);color:#fbbf24;font-weight:700}',
      '.amm-btn{padding:10px 20px;border-radius:10px;border:none;cursor:pointer;font-size:.82rem;font-weight:700;font-family:inherit;transition:all .2s}',
      '.amm-btn-primary{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#000}',
      '.amm-btn-primary:hover{filter:brightness(1.1)}',
      '.amm-btn-secondary{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.8)}',
      '.amm-btn-secondary:hover{background:rgba(255,255,255,0.1)}',
      '.amm-btn-danger{background:rgba(255,77,109,0.15);border:1px solid rgba(255,77,109,0.3);color:#ff4d6d}',
      '.amm-btn-danger:hover{background:rgba(255,77,109,0.25)}',
      '.amm-btn-row{display:flex;gap:10px;justify-content:flex-end;margin-top:20px}',
      '.amm-custom-fields{margin-top:8px;padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.1)}',
      /* Action buttons in table */
      '.amm-action-btn{padding:4px 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);font-size:.68rem;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}',
      '.amm-action-btn:hover{background:rgba(255,255,255,0.1)}',
      '.amm-action-btn.extend{border-color:rgba(61,142,248,0.3);color:#3d8ef8;background:rgba(61,142,248,0.08)}',
      '.amm-action-btn.renew{border-color:rgba(16,217,142,0.3);color:#10d98e;background:rgba(16,217,142,0.08)}',
      '.amm-action-btn.suspend{border-color:rgba(245,158,11,0.3);color:#f59e0b;background:rgba(245,158,11,0.08)}',
      '.amm-action-btn.resume{border-color:rgba(16,217,142,0.3);color:#10d98e;background:rgba(16,217,142,0.08)}',
      '.amm-action-btn.upgrade{border-color:rgba(139,92,246,0.3);color:#a78bfa;background:rgba(139,92,246,0.08)}',
      '.amm-action-btn.deactivate{border-color:rgba(255,77,109,0.3);color:#ff4d6d;background:rgba(255,77,109,0.08)}',
      /* Grant button */
      '.amm-grant-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding:14px 18px;background:linear-gradient(135deg,rgba(251,191,36,0.08),rgba(245,158,11,0.04));border:1px solid rgba(251,191,36,0.15);border-radius:14px}',
      '.amm-grant-title{font-size:.9rem;font-weight:700;color:#fbbf24;display:flex;align-items:center;gap:6px}',
      '.amm-grant-btn{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#000;font-weight:700;padding:8px 18px;border-radius:10px;border:none;cursor:pointer;font-size:.8rem;transition:all .2s}',
      '.amm-grant-btn:hover{filter:brightness(1.1);transform:translateY(-1px)}',
      /* History section */
      '.amm-history-row{display:flex;gap:10px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:.72rem}',
      '.amm-history-action{font-weight:700;min-width:80px}',
      '.amm-history-date{color:rgba(255,255,255,0.4);min-width:100px}',
      '.amm-history-notes{color:rgba(255,255,255,0.5);flex:1}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = 'amm-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ── Selected plan state ─────────────────────────────────────── */
  var _selectedPlanSlug = null;
  var _selectedMembershipId = null;
  var _cachedPlans = null;

  /* ── Show Grant Membership Modal ─────────────────────────────── */
  function _showGrantModal() {
    _injectCSS();
    _selectedPlanSlug = null;

    var overlay = document.createElement('div');
    overlay.className = 'amm-modal-overlay';
    overlay.id = 'ammGrantModal';

    var planChipsHtml = Object.keys(AMM_PLANS).map(function (slug) {
      var p = AMM_PLANS[slug];
      var extra = slug === 'lifetime' ? ' ♾️' : '';
      return '<div class="amm-plan-chip" data-plan="' + slug + '" onclick="window.AdminMembershipManager._selectPlan(\'' + slug + '\')">' + _esc(p.label) + extra + '</div>';
    }).join('');
    planChipsHtml += '<div class="amm-plan-chip" data-plan="custom" onclick="window.AdminMembershipManager._selectPlan(\'custom\')">⚙️ Custom Plan</div>';

    overlay.innerHTML = '<div class="amm-modal">'
      + '<div class="amm-modal-header">'
      + '<div class="amm-modal-title">👑 Grant Membership</div>'
      + '<button class="amm-modal-close" onclick="window.AdminMembershipManager._closeModal()">✕ Close</button>'
      + '</div>'
      + '<div class="amm-modal-body">'
      + '<div class="amm-field">'
      + '<label class="amm-label">User Email or User ID</label>'
      + '<input class="amm-input" id="ammGrantUserId" placeholder="e.g. user@example.com or UUID" autocomplete="off">'
      + '</div>'
      + '<div class="amm-field">'
      + '<label class="amm-label">Select Plan</label>'
      + '<div class="amm-plan-grid">' + planChipsHtml + '</div>'
      + '</div>'
      + '<div id="ammCustomFields" style="display:none">'
      + '<div class="amm-custom-fields">'
      + '<div class="amm-field">'
      + '<label class="amm-label">Custom Plan Name</label>'
      + '<input class="amm-input" id="ammCustomName" placeholder="e.g. Special Promo Plan">'
      + '</div>'
      + '<div class="amm-field">'
      + '<label class="amm-label">Custom Duration (days)</label>'
      + '<input class="amm-input" id="ammCustomDays" type="number" min="1" placeholder="e.g. 45">'
      + '</div>'
      + '<div class="amm-field">'
      + '<label class="amm-label">Custom Expiry Date (optional — overrides duration)</label>'
      + '<input class="amm-input" id="ammCustomExpiry" type="date">'
      + '</div>'
      + '<div class="amm-field">'
      + '<label class="amm-label">Custom Notes</label>'
      + '<textarea class="amm-textarea" id="ammCustomNotes" placeholder="Reason for custom plan..."></textarea>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="amm-field">'
      + '<label class="amm-label">Admin Notes (optional)</label>'
      + '<textarea class="amm-textarea" id="ammGrantNotes" placeholder="Reason for manual grant..."></textarea>'
      + '</div>'
      + '<div class="amm-btn-row">'
      + '<button class="amm-btn amm-btn-secondary" onclick="window.AdminMembershipManager._closeModal()">Cancel</button>'
      + '<button class="amm-btn amm-btn-primary" onclick="window.AdminMembershipManager._executeGrant()">👑 Grant Membership</button>'
      + '</div>'
      + '</div>'
      + '</div>';

    document.body.appendChild(overlay);
  }

  /* ── Show Action Modal (Extend, Renew, Upgrade, etc.) ────────── */
  function _showActionModal(action, membership) {
    _injectCSS();
    _selectedMembershipId = membership.id;
    _selectedPlanSlug = null;

    var actionLabels = {
      extend: { title: '📅 Extend Membership', btn: 'Extend', btnClass: 'amm-btn-primary', desc: 'Add days to the current expiry date.' },
      renew: { title: '🔄 Renew Membership', btn: 'Renew', btnClass: 'amm-btn-primary', desc: 'Reset and start a new membership period.' },
      upgrade: { title: '⬆️ Upgrade/Downgrade Plan', btn: 'Change Plan', btnClass: 'amm-btn-primary', desc: 'Change the membership plan for this user.' },
      suspend: { title: '⏸️ Suspend Membership', btn: 'Suspend', btnClass: 'amm-btn-danger', desc: 'Temporarily suspend access. Can be resumed later.' },
      resume: { title: '▶️ Resume Membership', btn: 'Resume', btnClass: 'amm-btn-primary', desc: 'Restore access from a suspended state.' }
    };

    var cfg = actionLabels[action] || actionLabels.extend;
    var isSuspend = action === 'suspend';
    var isResume = action === 'resume';
    var isUpgrade = action === 'upgrade';

    var planChipsHtml = '';
    if (action === 'extend' || action === 'renew' || action === 'upgrade') {
      planChipsHtml = Object.keys(AMM_PLANS).map(function (slug) {
        var p = AMM_PLANS[slug];
        var extra = slug === 'lifetime' ? ' ♾️' : '';
        return '<div class="amm-plan-chip" data-plan="' + slug + '" onclick="window.AdminMembershipManager._selectPlan(\'' + slug + '\')">' + _esc(p.label) + extra + '</div>';
      }).join('');
      planChipsHtml += '<div class="amm-plan-chip" data-plan="custom" onclick="window.AdminMembershipManager._selectPlan(\'custom\')">⚙️ Custom</div>';
    }

    var currentExpiry = membership.expires_at ? _fmtDate(membership.expires_at) : '—';
    var currentStatus = membership.status || '—';

    var bodyHtml = '';
    bodyHtml += '<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;margin-bottom:16px">'
      + '<div style="font-size:.72rem;color:rgba(255,255,255,0.4)">User ID: <span style="font-family:monospace">' + _esc((membership.user_id || '').slice(0, 12)) + '…</span></div>'
      + '<div style="font-size:.72rem;color:rgba(255,255,255,0.4);margin-top:4px">Current Status: <span style="font-weight:700;color:' + (AMM_STATUS_COLORS[currentStatus] || '#999') + '">' + _esc(currentStatus) + '</span></div>'
      + '<div style="font-size:.72rem;color:rgba(255,255,255,0.4);margin-top:4px">Current Expiry: ' + currentExpiry + '</div>'
      + '</div>';

    bodyHtml += '<div style="font-size:.82rem;color:rgba(255,255,255,0.6);margin-bottom:14px">' + _esc(cfg.desc) + '</div>';

    if (planChipsHtml) {
      bodyHtml += '<div class="amm-field"><label class="amm-label">Select Plan</label><div class="amm-plan-grid">' + planChipsHtml + '</div></div>';
      bodyHtml += '<div id="ammCustomFields" style="display:none"><div class="amm-custom-fields">'
        + '<div class="amm-field"><label class="amm-label">Custom Plan Name</label><input class="amm-input" id="ammCustomName" placeholder="e.g. Special Promo Plan"></div>'
        + '<div class="amm-field"><label class="amm-label">Custom Duration (days)</label><input class="amm-input" id="ammCustomDays" type="number" min="1" placeholder="e.g. 45"></div>'
        + '<div class="amm-field"><label class="amm-label">Custom Expiry Date (optional — overrides duration)</label><input class="amm-input" id="ammCustomExpiry" type="date"></div>'
        + '</div></div>';
    }

    if (isSuspend) {
      bodyHtml += '<div class="amm-field"><label class="amm-label">Reason for Suspension</label><textarea class="amm-textarea" id="ammActionNotes" placeholder="e.g. Payment dispute, abuse, etc."></textarea></div>';
    } else if (isResume) {
      bodyHtml += '<div class="amm-field"><label class="amm-label">Notes (optional)</label><textarea class="amm-textarea" id="ammActionNotes" placeholder="e.g. Issue resolved, payment received..."></textarea></div>';
    } else {
      bodyHtml += '<div class="amm-field"><label class="amm-label">Admin Notes (optional)</label><textarea class="amm-textarea" id="ammActionNotes" placeholder="Reason for this action..."></textarea></div>';
    }

    bodyHtml += '<div class="amm-btn-row">'
      + '<button class="amm-btn amm-btn-secondary" onclick="window.AdminMembershipManager._closeModal()">Cancel</button>'
      + '<button class="amm-btn ' + cfg.btnClass + '" onclick="window.AdminMembershipManager._executeAction(\'' + action + '\')">' + _esc(cfg.btn) + '</button>'
      + '</div>';

    var overlay = document.createElement('div');
    overlay.className = 'amm-modal-overlay';
    overlay.id = 'ammActionModal';
    overlay.innerHTML = '<div class="amm-modal">'
      + '<div class="amm-modal-header">'
      + '<div class="amm-modal-title">' + cfg.title + '</div>'
      + '<button class="amm-modal-close" onclick="window.AdminMembershipManager._closeModal()">✕ Close</button>'
      + '</div>'
      + '<div class="amm-modal-body">' + bodyHtml + '</div>'
      + '</div>';

    document.body.appendChild(overlay);
  }

  /* ── Select Plan (chip click handler) ────────────────────────── */
  function _selectPlan(slug) {
    _selectedPlanSlug = slug;
    document.querySelectorAll('.amm-plan-chip').forEach(function (chip) {
      chip.classList.toggle('selected', chip.getAttribute('data-plan') === slug);
    });
    var customFields = document.getElementById('ammCustomFields');
    if (customFields) customFields.style.display = (slug === 'custom') ? 'block' : 'none';
  }

  /* ── Close Modal ─────────────────────────────────────────────── */
  function _closeModal() {
    var m1 = document.getElementById('ammGrantModal');
    if (m1) m1.remove();
    var m2 = document.getElementById('ammActionModal');
    if (m2) m2.remove();
    _selectedPlanSlug = null;
    _selectedMembershipId = null;
  }

  /* ── Resolve user ID from email or UUID ──────────────────────── */
  async function _resolveUserId(input) {
    input = (input || '').trim();
    if (!input) return null;
    // If it looks like a UUID, return as-is
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) return input;
    // Try to look up by email in the profiles/users table
    var client = _sb();
    if (!client) return null;
    try {
      // Try profiles table first
      var res = await client.from('profiles').select('id').eq('email', input).maybeSingle();
      if (res && res.data) return res.data.id;
      // Try auth.users via admin API (may not work without service role)
      // Fallback: check user_memberships for this email as user_id
      return null;
    } catch (e) { return null; }
  }

  /* ── Get plan details from selection ──────────────────────────── */
  function _getSelectedPlanDetails() {
    if (!_selectedPlanSlug) return null;
    if (_selectedPlanSlug === 'custom') {
      var name = (document.getElementById('ammCustomName') || {}).value || 'Custom Plan';
      var days = parseInt((document.getElementById('ammCustomDays') || {}).value || '0', 10);
      var expiryDate = (document.getElementById('ammCustomExpiry') || {}).value || '';
      var notes = (document.getElementById('ammCustomNotes') || {}).value || '';
      if (expiryDate) {
        days = Math.ceil((new Date(expiryDate + 'T23:59:59') - Date.now()) / 86400000);
        if (days < 1) days = 1;
      }
      if (!days || days < 1) days = 30;
      return { slug: 'custom', label: name, days: days, custom: true, notes: notes, expiryOverride: expiryDate || null };
    }
    var p = AMM_PLANS[_selectedPlanSlug];
    if (!p) return null;
    return { slug: p.slug, label: p.label, days: p.days, custom: false };
  }

  /* ── Execute Grant Membership ────────────────────────────────── */
  async function _executeGrant() {
    var userInput = (document.getElementById('ammGrantUserId') || {}).value || '';
    var notes = (document.getElementById('ammGrantNotes') || {}).value || '';
    var planDetails = _getSelectedPlanDetails();

    if (!userInput.trim()) { _toast('Please enter a user email or ID.', 'error'); return; }
    if (!planDetails) { _toast('Please select a plan.', 'error'); return; }

    var client = _sb();
    if (!client) { _toast('Supabase not connected.', 'error'); return; }

    // Show loading state
    var btn = overlay.querySelector('.amm-btn-primary');
    if (btn) { btn.textContent = 'Granting…'; btn.disabled = true; }

    try {
      // Resolve user ID
      var userId = await _resolveUserId(userInput);
      if (!userId) userId = userInput.trim(); // assume it's a UUID

      // Find or create plan in membership_plans
      if (!_cachedPlans) _cachedPlans = await _fetchPlans();
      var planId = await _findPlanId(planDetails.slug, _cachedPlans);

      // For custom plans, try to find a 'custom' plan or use the first plan
      if (!planId && planDetails.slug === 'custom') {
        planId = await _findPlanId('custom', _cachedPlans) || (_cachedPlans[0] ? _cachedPlans[0].id : null);
      }
      // For lifetime, try to find existing lifetime plan
      if (!planId && planDetails.slug === 'lifetime') {
        planId = await _findPlanId('lifetime', _cachedPlans) || await _findPlanId('yearly', _cachedPlans);
      }
      // For yearly, try yearly then annual
      if (!planId && planDetails.slug === 'yearly') {
        planId = await _findPlanId('yearly', _cachedPlans) || await _findPlanId('annual', _cachedPlans);
      }

      // Compute expiry
      var expiresAt;
      if (planDetails.expiryOverride) {
        expiresAt = new Date(planDetails.expiryOverride + 'T23:59:59').toISOString();
      } else {
        expiresAt = _daysFromNow(planDetails.days);
      }

      // Check if user already has an active membership
      var existing = await client.from('user_memberships')
        .select('id,status,expires_at,plan_id')
        .eq('user_id', userId)
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      var newStatus = 'active';
      var startedAt = new Date().toISOString();

      if (existing && existing.data && existing.data.status === 'active' && existing.data.expires_at && new Date(existing.data.expires_at) > new Date()) {
        // Extend existing membership
        var oldExpiry = existing.data.expires_at;
        var baseDate = new Date(oldExpiry);
        expiresAt = new Date(baseDate.getTime() + planDetails.days * 24 * 60 * 60 * 1000).toISOString();
        if (planDetails.expiryOverride) expiresAt = new Date(planDetails.expiryOverride + 'T23:59:59').toISOString();

        await client.from('user_memberships')
          .update({ plan_id: planId || existing.data.plan_id, expires_at: expiresAt })
          .eq('id', existing.data.id);

        await _logAudit({
          membership_id: existing.data.id,
          user_id: userId,
          action: 'grant_extend',
          old_status: existing.data.status,
          new_status: newStatus,
          old_expires_at: oldExpiry,
          new_expires_at: expiresAt,
          old_plan_id: existing.data.plan_id,
          new_plan_id: planId,
          plan_slug: planDetails.slug,
          notes: notes || (planDetails.notes || '') + (planDetails.custom ? ' | Custom: ' + planDetails.label : '')
        });

        _toast('✅ Membership extended for ' + planDetails.label + '.', 'success');
      } else {
        // Create new membership
        var insertRes = await client.from('user_memberships').insert({
          user_id: userId,
          plan_id: planId,
          status: newStatus,
          started_at: startedAt,
          expires_at: expiresAt,
          auto_renew: false
        }).select('id').single();

        var newMemId = insertRes && insertRes.data ? insertRes.data.id : null;

        await _logAudit({
          membership_id: newMemId,
          user_id: userId,
          action: 'grant',
          old_status: existing && existing.data ? existing.data.status : null,
          new_status: newStatus,
          old_expires_at: existing && existing.data ? existing.data.expires_at : null,
          new_expires_at: expiresAt,
          old_plan_id: existing && existing.data ? existing.data.plan_id : null,
          new_plan_id: planId,
          plan_slug: planDetails.slug,
          notes: notes || (planDetails.notes || '') + (planDetails.custom ? ' | Custom: ' + planDetails.label : '')
        });

        _toast('✅ Membership granted: ' + planDetails.label + '.', 'success');
      }

      _closeModal();
      var main = document.getElementById('adminMain');
      if (main && typeof window.renderAdminMemberships === 'function') window.renderAdminMemberships(main);
    } catch (e) {
      console.error('[AMM] Grant error:', e);
      _toast('Error: ' + (e.message || String(e)), 'error');
      if (btn) { btn.textContent = '👑 Grant Membership'; btn.disabled = false; }
    }
  }

  /* ── Execute Action (Extend, Renew, Suspend, Resume, Upgrade) ─ */
  async function _executeAction(action) {
    if (!_selectedMembershipId) { _toast('No membership selected.', 'error'); return; }

    var client = _sb();
    if (!client) { _toast('Supabase not connected.', 'error'); return; }

    var notes = (document.getElementById('ammActionNotes') || {}).value || '';
    var planDetails = _getSelectedPlanDetails();

    // Show loading
    var buttons = document.querySelectorAll('#ammActionModal .amm-btn');
    var btn = buttons[buttons.length - 1];
    if (btn) { btn.textContent = 'Working…'; btn.disabled = true; }

    try {
      // Fetch current membership
      var memRes = await client.from('user_memberships')
        .select('id,user_id,plan_id,status,started_at,expires_at')
        .eq('id', _selectedMembershipId)
        .maybeSingle();

      if (!memRes || memRes.error || !memRes.data) {
        _toast('Membership not found.', 'error');
        return;
      }

      var mem = memRes.data;
      var oldStatus = mem.status;
      var oldExpiry = mem.expires_at;
      var oldPlanId = mem.plan_id;

      var updateData = {};
      var auditAction = action;
      var newStatus = oldStatus;
      var newExpiry = oldExpiry;
      var newPlanId = oldPlanId;
      var planSlug = null;

      if (action === 'extend') {
        if (!planDetails) { _toast('Please select a plan.', 'error'); return; }
        var baseDate = (oldExpiry && new Date(oldExpiry) > new Date()) ? new Date(oldExpiry) : new Date();
        newExpiry = new Date(baseDate.getTime() + planDetails.days * 24 * 60 * 60 * 1000).toISOString();
        if (planDetails.expiryOverride) newExpiry = new Date(planDetails.expiryOverride + 'T23:59:59').toISOString();
        updateData.expires_at = newExpiry;
        updateData.status = 'active';
        newStatus = 'active';
        planSlug = planDetails.slug;
        if (planDetails.slug !== 'custom') {
          var pid = await _findPlanId(planDetails.slug, _cachedPlans);
          if (pid) { updateData.plan_id = pid; newPlanId = pid; }
        }
      } else if (action === 'renew') {
        if (!planDetails) { _toast('Please select a plan.', 'error'); return; }
        newExpiry = _daysFromNow(planDetails.days);
        if (planDetails.expiryOverride) newExpiry = new Date(planDetails.expiryOverride + 'T23:59:59').toISOString();
        updateData.expires_at = newExpiry;
        updateData.status = 'active';
        updateData.started_at = new Date().toISOString();
        updateData.cancelled_at = null;
        newStatus = 'active';
        planSlug = planDetails.slug;
        if (planDetails.slug !== 'custom') {
          var rpid = await _findPlanId(planDetails.slug, _cachedPlans);
          if (rpid) { updateData.plan_id = rpid; newPlanId = rpid; }
        }
      } else if (action === 'suspend') {
        updateData.status = 'suspended';
        newStatus = 'suspended';
      } else if (action === 'resume') {
        updateData.status = 'active';
        newStatus = 'active';
        // If expiry has passed, extend by 30 days
        if (oldExpiry && new Date(oldExpiry) <= new Date()) {
          newExpiry = _daysFromNow(30);
          updateData.expires_at = newExpiry;
        }
      } else if (action === 'upgrade') {
        if (!planDetails) { _toast('Please select a new plan.', 'error'); return; }
        if (planDetails.slug !== 'custom') {
          var upid = await _findPlanId(planDetails.slug, _cachedPlans);
          if (upid) { updateData.plan_id = upid; newPlanId = upid; }
        }
        newExpiry = _daysFromNow(planDetails.days);
        if (planDetails.expiryOverride) newExpiry = new Date(planDetails.expiryOverride + 'T23:59:59').toISOString();
        updateData.expires_at = newExpiry;
        updateData.status = 'active';
        newStatus = 'active';
        planSlug = planDetails.slug;
      }

      // Execute update
      var updateRes = await client.from('user_memberships')
        .update(updateData)
        .eq('id', _selectedMembershipId);

      if (updateRes.error) throw new Error(updateRes.error.message);

      // Audit log
      await _logAudit({
        membership_id: _selectedMembershipId,
        user_id: mem.user_id,
        action: auditAction,
        old_status: oldStatus,
        new_status: newStatus,
        old_expires_at: oldExpiry,
        new_expires_at: newExpiry,
        old_plan_id: oldPlanId,
        new_plan_id: newPlanId,
        plan_slug: planSlug,
        notes: notes || (planDetails && planDetails.custom ? 'Custom: ' + planDetails.label : '')
      });

      var actionMsgs = {
        extend: '✅ Membership extended successfully.',
        renew: '✅ Membership renewed successfully.',
        suspend: '⏸️ Membership suspended.',
        resume: '▶️ Membership resumed.',
        upgrade: '✅ Plan changed successfully.'
      };
      _toast(actionMsgs[action] || '✅ Action completed.', 'success');

      _closeModal();
      var main = document.getElementById('adminMain');
      if (main && typeof window.renderAdminMemberships === 'function') window.renderAdminMemberships(main);
    } catch (e) {
      console.error('[AMM] Action error:', e);
      _toast('Error: ' + (e.message || String(e)), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
    }
  }

  /* ── Activate membership (uses existing _amemActivate but with audit) ─ */
  async function _activateWithAudit(id) {
    var client = _sb();
    if (!client) return;
    try {
      // Get current state for audit
      var memRes = await client.from('user_memberships')
        .select('id,user_id,status,expires_at,plan_id')
        .eq('id', id).maybeSingle();
      var mem = memRes && memRes.data ? memRes.data : {};

      var newExpiry = _daysFromNow(30);
      var res = await client.from('user_memberships')
        .update({ status: 'active', expires_at: newExpiry })
        .eq('id', id);
      if (res.error) throw new Error(res.error.message);

      await _logAudit({
        membership_id: id,
        user_id: mem.user_id,
        action: 'activate',
        old_status: mem.status,
        new_status: 'active',
        old_expires_at: mem.expires_at,
        new_expires_at: newExpiry,
        old_plan_id: mem.plan_id,
        new_plan_id: mem.plan_id,
        notes: 'Manual activation (+30 days)'
      });

      _toast('✅ Membership activated for 30 days.', 'success');
      var main = document.getElementById('adminMain');
      if (main && typeof window.renderAdminMemberships === 'function') window.renderAdminMemberships(main);
    } catch (e) {
      console.error('[AMM] Activate error:', e);
      _toast('Error: ' + e.message, 'error');
    }
  }

  /* ── Deactivate membership (with audit) ───────────────────────── */
  async function _deactivateWithAudit(id) {
    if (!confirm('Deactivate this membership? The user will lose Premium access immediately.')) return;
    var client = _sb();
    if (!client) return;
    try {
      var memRes = await client.from('user_memberships')
        .select('id,user_id,status,expires_at,plan_id')
        .eq('id', id).maybeSingle();
      var mem = memRes && memRes.data ? memRes.data : {};

      var res = await client.from('user_memberships')
        .update({ status: 'cancelled', expires_at: new Date().toISOString() })
        .eq('id', id);
      if (res.error) throw new Error(res.error.message);

      await _logAudit({
        membership_id: id,
        user_id: mem.user_id,
        action: 'deactivate',
        old_status: mem.status,
        new_status: 'cancelled',
        old_expires_at: mem.expires_at,
        new_expires_at: new Date().toISOString(),
        old_plan_id: mem.plan_id,
        new_plan_id: mem.plan_id,
        notes: 'Manual deactivation'
      });

      _toast('🚫 Membership deactivated.', 'info');
      var main = document.getElementById('adminMain');
      if (main && typeof window.renderAdminMemberships === 'function') window.renderAdminMemberships(main);
    } catch (e) {
      console.error('[AMM] Deactivate error:', e);
      _toast('Error: ' + e.message, 'error');
    }
  }

  /* ── Enhance the existing membership table with new action buttons ─ */
  function _enhanceTableActions() {
    // Find all rows in the membership table and add enhanced action buttons
    var rows = document.querySelectorAll('table.amem-table tbody tr');
    rows.forEach(function (row) {
      var actionCell = row.querySelector('td:last-child');
      if (!actionCell || actionCell.querySelector('.amm-action-btn')) return; // already enhanced

      var rowId = (row.id || '').replace('amem-row-', '');
      if (!rowId) return;

      // Read current status from the badge
      var badgeText = '';
      var badge = row.querySelector('.amem-badge');
      if (badge) badgeText = badge.textContent.trim().toLowerCase();

      var isSuspended = badgeText.indexOf('suspend') >= 0;
      var isActive = badgeText.indexOf('active') >= 0;
      var isExpired = badgeText.indexOf('expired') >= 0;

      // Build enhanced action buttons
      var btns = '';

      if (isSuspended) {
        btns += '<button class="amm-action-btn resume" onclick="window.AdminMembershipManager._resumeMembership(\'' + rowId + '\')">▶️ Resume</button>';
      }

      if (isActive || isExpired) {
        btns += '<button class="amm-action-btn extend" onclick="window.AdminMembershipManager._extendMembership(\'' + rowId + '\')">📅 Extend</button>';
        btns += '<button class="amm-action-btn renew" onclick="window.AdminMembershipManager._renewMembership(\'' + rowId + '\')">🔄 Renew</button>';
        btns += '<button class="amm-action-btn upgrade" onclick="window.AdminMembershipManager._upgradeMembership(\'' + rowId + '\')">⬆️ Plan</button>';
      }

      if (isActive && !isSuspended) {
        btns += '<button class="amm-action-btn suspend" onclick="window.AdminMembershipManager._suspendMembership(\'' + rowId + '\')">⏸️ Suspend</button>';
      }

      // Keep existing activate/deactivate buttons
      var existingBtns = actionCell.querySelectorAll('.amem-action-btn');
      var existingHtml = '';
      existingBtns.forEach(function (b) { existingHtml += b.outerHTML; });

      // Replace existing activate/deactivate with audited versions
      // But DON'T remove them — just add new buttons before them
      actionCell.innerHTML = btns + existingHtml;

      // Patch existing activate/deactivate to use audited versions
      var actBtn = actionCell.querySelector('.amem-action-btn.approve');
      if (actBtn) {
        actBtn.setAttribute('onclick', "window.AdminMembershipManager._activateMembership('" + rowId + "')");
      }
      var deactBtn = actionCell.querySelector('.amem-action-btn.deactivate');
      if (deactBtn) {
        deactBtn.setAttribute('onclick', "window.AdminMembershipManager._deactivateMembership('" + rowId + "')");
      }
    });
  }

  /* ── Add Grant button to the top of the memberships section ──── */
  function _injectGrantButton() {
    var sectionTitle = document.querySelector('.amem-section-title');
    if (!sectionTitle || document.getElementById('ammGrantBar')) return;

    var grantBar = document.createElement('div');
    grantBar.className = 'amm-grant-bar';
    grantBar.id = 'ammGrantBar';
    grantBar.innerHTML = '<div class="amm-grant-title">👑 Manual Membership Management</div>'
      + '<button class="amm-grant-btn" onclick="window.AdminMembershipManager._showGrantModal()">✨ Grant Membership</button>';

    sectionTitle.parentNode.insertBefore(grantBar, sectionTitle);
  }

  /* ── Fetch and display audit history for a membership ────────── */
  async function _showHistory(membershipId) {
    _injectCSS();
    var client = _sb();
    if (!client) { _toast('Supabase not connected.', 'error'); return; }

    var overlay = document.createElement('div');
    overlay.className = 'amm-modal-overlay';
    overlay.id = 'ammHistoryModal';
    overlay.innerHTML = '<div class="amm-modal">'
      + '<div class="amm-modal-header">'
      + '<div class="amm-modal-title">📜 Membership History</div>'
      + '<button class="amm-modal-close" onclick="window.AdminMembershipManager._closeHistoryModal()">✕ Close</button>'
      + '</div>'
      + '<div class="amm-modal-body"><div style="text-align:center;padding:24px;color:rgba(255,255,255,0.4)">Loading history…</div></div>'
      + '</div>';
    document.body.appendChild(overlay);

    try {
      var res = await client.from('membership_audit_log')
        .select('id,action,old_status,new_status,old_expires_at,new_expires_at,notes,created_at,admin_user_id')
        .eq('membership_id', membershipId)
        .order('created_at', { ascending: false })
        .limit(50);

      var body = overlay.querySelector('.amm-modal-body');
      if (!res || res.error || !res.data || res.data.length === 0) {
        body.innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.35);font-size:.85rem">No history records found. (Audit logging was added recently — older actions may not be logged.)</div>';
        return;
      }

      var rowsHtml = res.data.map(function (r) {
        return '<div class="amm-history-row">'
          + '<div class="amm-history-date">' + _fmtDate(r.created_at) + '</div>'
          + '<div class="amm-history-action" style="color:' + (AMM_STATUS_COLORS[r.new_status] || '#999') + '">' + _esc(r.action) + '</div>'
          + '<div class="amm-history-notes">' + _esc(r.notes || '') + '</div>'
          + '</div>';
      }).join('');

      body.innerHTML = '<div style="font-size:.72rem;color:rgba(255,255,255,0.4);margin-bottom:12px">'
        + res.data.length + ' records</div>' + rowsHtml;
    } catch (e) {
      var body2 = overlay.querySelector('.amm-modal-body');
      if (body2) body2.innerHTML = '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.35);font-size:.85rem">'
        + 'Audit log table not available yet. Run the SQL migration to create it.</div>';
    }
  }

  function _closeHistoryModal() {
    var m = document.getElementById('ammHistoryModal');
    if (m) m.remove();
  }

  /* ── Fetch membership data for action modal ──────────────────── */
  async function _fetchMembership(id) {
    var client = _sb();
    if (!client) return null;
    try {
      var res = await client.from('user_memberships')
        .select('id,user_id,plan_id,status,started_at,expires_at')
        .eq('id', id).maybeSingle();
      return (res && res.data) ? res.data : null;
    } catch (e) { return null; }
  }

  /* ── Public wrapper functions for onclick handlers ───────────── */
  async function _extendMembership(id) {
    if (!_cachedPlans) _cachedPlans = await _fetchPlans();
    var mem = await _fetchMembership(id);
    if (mem) _showActionModal('extend', mem);
  }
  async function _renewMembership(id) {
    if (!_cachedPlans) _cachedPlans = await _fetchPlans();
    var mem = await _fetchMembership(id);
    if (mem) _showActionModal('renew', mem);
  }
  async function _suspendMembership(id) {
    if (!_cachedPlans) _cachedPlans = await _fetchPlans();
    var mem = await _fetchMembership(id);
    if (mem) _showActionModal('suspend', mem);
  }
  async function _resumeMembership(id) {
    if (!_cachedPlans) _cachedPlans = await _fetchPlans();
    var mem = await _fetchMembership(id);
    if (mem) _showActionModal('resume', mem);
  }
  async function _upgradeMembership(id) {
    if (!_cachedPlans) _cachedPlans = await _fetchPlans();
    var mem = await _fetchMembership(id);
    if (mem) _showActionModal('upgrade', mem);
  }
  async function _activateMembership(id) {
    await _activateWithAudit(id);
  }
  async function _deactivateMembership(id) {
    await _deactivateWithAudit(id);
  }

  /* ── SQL Migration Helper (shows SQL for admin to run) ───────── */
  function _showSQLMigration() {
    _injectCSS();
    var sql = `-- ═══════════════════════════════════════════════════════════════
-- STUDYRIA — Membership Audit Log Table
-- Run this in Supabase SQL Editor to enable audit logging
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS membership_audit_log (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  membership_id   UUID REFERENCES user_memberships(id) ON DELETE SET NULL,
  user_id         TEXT,
  action          TEXT NOT NULL DEFAULT 'unknown',
  admin_user_id   TEXT,
  old_status      TEXT,
  new_status      TEXT,
  old_expires_at  TIMESTAMPTZ,
  new_expires_at  TIMESTAMPTZ,
  old_plan_id     UUID,
  new_plan_id     UUID,
  plan_slug       TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE membership_audit_log ENABLE ROW LEVEL SECURITY;

-- Admin-only: full access (adjust 'authenticated' to your admin role/policy as needed)
CREATE POLICY "Admin read audit log" ON membership_audit_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin write audit log" ON membership_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- Also ensure user_memberships allows admin writes (should already be the case)
-- If not, add:
-- CREATE POLICY "Admin update memberships" ON user_memberships
--   FOR UPDATE TO authenticated USING (true);

-- Add 'suspended' as valid status (if not already supported)
-- user_memberships.status is TEXT so no constraint change needed.`;

    var overlay = document.createElement('div');
    overlay.className = 'amm-modal-overlay';
    overlay.id = 'ammSQLModal';
    overlay.innerHTML = '<div class="amm-modal" style="max-width:680px">'
      + '<div class="amm-modal-header">'
      + '<div class="amm-modal-title">🗄️ SQL Migration</div>'
      + '<button class="amm-modal-close" onclick="window.AdminMembershipManager._closeSQLModal()">✕ Close</button>'
      + '</div>'
      + '<div class="amm-modal-body">'
      + '<div style="font-size:.8rem;color:rgba(255,255,255,0.5);margin-bottom:12px">Run this SQL in your Supabase Dashboard → SQL Editor to create the audit log table:</div>'
      + '<textarea readonly style="width:100%;min-height:320px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:14px;color:#10d98e;font-family:monospace;font-size:.72rem;line-height:1.5;white-space:pre;resize:vertical">' + _esc(sql) + '</textarea>'
      + '<div class="amm-btn-row">'
      + '<button class="amm-btn amm-btn-secondary" onclick="window.AdminMembershipManager._closeSQLModal()">Close</button>'
      + '<button class="amm-btn amm-btn-primary" onclick="window.AdminMembershipManager._copySQL()">📋 Copy SQL</button>'
      + '</div>'
      + '</div>'
      + '</div>';
    document.body.appendChild(overlay);
  }

  function _closeSQLModal() {
    var m = document.getElementById('ammSQLModal');
    if (m) m.remove();
  }

  function _copySQL() {
    var textarea = document.querySelector('#ammSQLModal textarea');
    if (textarea) {
      textarea.select();
      try { document.execCommand('copy'); _toast('✅ SQL copied to clipboard.', 'success'); }
      catch (e) { _toast('Copy failed. Select manually.', 'error'); }
    }
  }

  /* ── Init: hook into renderAdminMemberships to add UI ────────── */
  function _init() {
    _injectCSS();

    // Hook into the existing renderAdminMemberships function
    var origRender = window.renderAdminMemberships;
    if (origRender && !origRender._ammHooked) {
      window.renderAdminMemberships = async function (container) {
        await origRender.call(this, container);
        // After render completes, inject our enhancements
        setTimeout(function () {
          _injectGrantButton();
          _enhanceTableActions();
        }, 200);
      };
      window.renderAdminMemberships._ammHooked = true;
    }

    // Also add a "Setup Audit Log" button that appears once
    setTimeout(function () {
      var grantBar = document.getElementById('ammGrantBar');
      if (grantBar && !document.getElementById('ammSQLBtn')) {
        var sqlBtn = document.createElement('button');
        sqlBtn.id = 'ammSQLBtn';
        sqlBtn.className = 'amm-btn amm-btn-secondary';
        sqlBtn.style.cssText = 'margin-left:10px;font-size:.72rem;padding:6px 14px';
        sqlBtn.textContent = '🗄️ Setup Audit Log';
        sqlBtn.onclick = function () { _showSQLMigration(); };
        grantBar.appendChild(sqlBtn);
      }
    }, 500);
  }

  /* ── Public API ──────────────────────────────────────────────── */
  window.AdminMembershipManager = {
    _version: '1.0',

    // Modal operations
    _showGrantModal: _showGrantModal,
    _showActionModal: _showActionModal,
    _selectPlan: _selectPlan,
    _closeModal: _closeModal,
    _executeGrant: _executeGrant,
    _executeAction: _executeAction,
    _closeHistoryModal: _closeHistoryModal,
    _showSQLMigration: _showSQLMigration,
    _closeSQLModal: _closeSQLModal,
    _copySQL: _copySQL,

    // Per-row action wrappers
    _extendMembership: _extendMembership,
    _renewMembership: _renewMembership,
    _suspendMembership: _suspendMembership,
    _resumeMembership: _resumeMembership,
    _upgradeMembership: _upgradeMembership,
    _activateMembership: _activateMembership,
    _deactivateMembership: _deactivateMembership,

    // History
    _showHistory: _showHistory,

    // Plans (for external reference)
    plans: AMM_PLANS
  };

  // Auto-init on DOM ready or immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})();
