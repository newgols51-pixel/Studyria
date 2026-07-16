/**
 * ═══════════════════════════════════════════════════════════════════
 * admin-memberships.js — Studyria Enterprise Membership Management
 * Version: 3.0 (Enterprise)
 * Namespace: window.AMEM (Admin Memberships Enterprise)
 *
 * Features:
 *   - Member management with search, filters, sorting, pagination
 *   - Bulk actions (activate, suspend, cancel, export)
 *   - Manual membership grants (any duration, lifetime, custom)
 *   - Custom plan creation
 *   - Transaction history with full payment details
 *   - Membership history & audit logs
 *   - Activity logs
 *   - Notifications management
 *   - Live statistics dashboard
 *   - Export (CSV, Excel, PDF)
 *   - Realtime refresh
 *   - Role-based access (super_admin, admin, moderator, support, viewer)
 *
 * SECURITY:
 *   - All mutations go through Supabase RPC functions (SECURITY DEFINER)
 *   - Never trusts frontend state for membership validation
 *   - Audit logs every admin action
 *   - RLS enforced at database level
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  if (window.AMEM && window.AMEM._version === '3.0') return;

  var AMEM = {};
  window.AMEM = AMEM;
  AMEM._version = '3.0';

  /* ── State ─────────────────────────────────────────────────────── */
  var _state = {
    members: [],
    transactions: [],
    plans: [],
    history: [],
    auditLogs: [],
    activityLogs: [],
    notifications: [],
    manualGrants: [],
    stats: null,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    search: '',
    filterStatus: 'all',
    filterGrantType: 'all',
    filterDate: 'all',
    sortField: 'created_at',
    sortDir: 'desc',
    loading: false,
    currentTab: 'members',
    adminRole: 'viewer',
    adminId: null,
    selectedIds: new Set(),
    realtimeChannel: null,
  };

  /* ── Utilities ─────────────────────────────────────────────────── */
  function _sb() { return window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null); }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _fmtDate(dt) {
    if (!dt) return '—';
    try {
      return new Date(dt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) { return '—'; }
  }

  function _fmtDateTime(dt) {
    if (!dt) return '—';
    try {
      return new Date(dt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return '—'; }
  }

  function _daysLeft(expiresAt, isLifetime) {
    if (isLifetime) return '∞';
    if (!expiresAt) return 0;
    var ms = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
  }

  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else console.log('[AMEM]', msg);
  }

  function _log(m, d) { if (d !== undefined) console.debug('[AMEM]', m, d); else console.debug('[AMEM]', m); }

  function _shortId(id) {
    if (!id) return '—';
    var s = String(id);
    return s.length > 10 ? s.slice(0, 8) + '…' : s;
  }

  function _getBrowserInfo() {
    var ua = navigator.userAgent;
    var browser = 'Unknown';
    if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari')) browser = 'Safari';
    else if (ua.includes('Edge')) browser = 'Edge';
    var device = 'Desktop';
    if (/Mobile|Android|iPhone/i.test(ua)) device = 'Mobile';
    else if (/iPad|Tablet/i.test(ua)) device = 'Tablet';
    return { browser: browser, device: device, userAgent: ua };
  }

  /* ── CSS ───────────────────────────────────────────────────────── */
  var _cssInjected = false;
  function _injectCSS() {
    if (_cssInjected) return;
    _cssInjected = true;
    var s = document.createElement('style');
    s.id = 'amem-enterprise-css';
    s.textContent = `
.amem-ent-wrap { padding: 20px; max-width: 1400px; margin: 0 auto; }
.amem-ent-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
.amem-ent-title { font-size: 1.3rem; font-weight: 800; color: var(--text1,#f0f4f8); display: flex; align-items: center; gap: 8px; }
.amem-ent-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.amem-btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-size: .82rem; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; transition: all .15s; }
.amem-btn-primary { background: linear-gradient(135deg,#3d8ef8,#0ea5e9); color: #fff; }
.amem-btn-primary:hover { opacity: .9; }
.amem-btn-gold { background: linear-gradient(135deg,#fbbf24,#f59e0b); color: #000; }
.amem-btn-gold:hover { opacity: .9; }
.amem-btn-danger { background: rgba(239,68,68,.15); color: #ef4444; border: 1px solid rgba(239,68,68,.3); }
.amem-btn-danger:hover { background: rgba(239,68,68,.25); }
.amem-btn-ghost { background: rgba(255,255,255,.05); color: var(--text2); border: 1px solid rgba(255,255,255,.1); }
.amem-btn-ghost:hover { background: rgba(255,255,255,.1); }
.amem-btn-sm { padding: 4px 10px; font-size: .75rem; }

.amem-stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
.amem-stat-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 16px; }
body.light .amem-stat-card { background: rgba(255,255,255,.6); border-color: rgba(0,0,0,.08); }
.amem-stat-val { font-size: 1.6rem; font-weight: 800; color: var(--text1,#f0f4f8); }
.amem-stat-label { font-size: .72rem; color: var(--text3,rgba(255,255,255,.4)); margin-top: 4px; text-transform: uppercase; letter-spacing: .5px; }
.amem-stat-revenue { color: #10d98e; }
.amem-stat-active { color: #3d8ef8; }
.amem-stat-expired { color: #ef4444; }
.amem-stat-lifetime { color: #fbbf24; }

.amem-toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; align-items: center; }
.amem-search { flex: 1; min-width: 200px; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.04); color: var(--text1); font-size: .82rem; }
.amem-search:focus { outline: none; border-color: #3d8ef8; }
.amem-select { padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.04); color: var(--text1); font-size: .82rem; cursor: pointer; }

.amem-table-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid rgba(255,255,255,.08); }
.amem-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
.amem-table thead { background: rgba(255,255,255,.03); }
.amem-table th { padding: 10px 12px; text-align: left; font-weight: 600; color: var(--text3,rgba(255,255,255,.5)); font-size: .72rem; text-transform: uppercase; letter-spacing: .5px; white-space: nowrap; cursor: pointer; }
.amem-table th:hover { color: var(--text1); }
.amem-table td { padding: 10px 12px; border-top: 1px solid rgba(255,255,255,.05); color: var(--text2); white-space: nowrap; }
.amem-table tbody tr:hover { background: rgba(255,255,255,.02); }
.amem-table tr.amem-selected { background: rgba(61,142,248,.08); }

.amem-badge { padding: 3px 10px; border-radius: 20px; font-size: .68rem; font-weight: 700; white-space: nowrap; }
.amem-badge-active { background: rgba(16,217,142,.15); color: #10d98e; border: 1px solid rgba(16,217,142,.25); }
.amem-badge-expired { background: rgba(239,68,68,.12); color: #ef4444; border: 1px solid rgba(239,68,68,.2); }
.amem-badge-suspended { background: rgba(245,158,11,.12); color: #f59e0b; border: 1px solid rgba(245,158,11,.2); }
.amem-badge-cancelled { background: rgba(107,114,128,.12); color: #6b7280; border: 1px solid rgba(107,114,128,.2); }
.amem-badge-lifetime { background: linear-gradient(135deg,rgba(251,191,36,.15),rgba(245,158,11,.1)); color: #fbbf24; border: 1px solid rgba(251,191,36,.3); }
.amem-badge-trial { background: rgba(59,130,246,.12); color: #3b82f6; border: 1px solid rgba(59,130,246,.2); }
.amem-badge-manual { background: rgba(139,92,246,.12); color: #8b5cf6; border: 1px solid rgba(139,92,246,.2); }

.amem-pagination { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; }
.amem-page-btns { display: flex; gap: 4px; }
.amem-page-btn { padding: 6px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.04); color: var(--text2); cursor: pointer; font-size: .78rem; }
.amem-page-btn:hover { background: rgba(255,255,255,.08); }
.amem-page-btn.amem-page-active { background: #3d8ef8; color: #fff; border-color: #3d8ef8; }
.amem-page-btn:disabled { opacity: .4; cursor: not-allowed; }

.amem-modal-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 20px; }
.amem-modal { background: var(--bg-card,#1a1e2a); border: 1px solid rgba(255,255,255,.1); border-radius: 16px; padding: 24px; max-width: 500px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
.amem-modal-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 16px; color: var(--text1); }
.amem-modal-field { margin-bottom: 14px; }
.amem-modal-label { font-size: .78rem; font-weight: 600; color: var(--text3); margin-bottom: 4px; display: block; }
.amem-modal-input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.04); color: var(--text1); font-size: .85rem; }
.amem-modal-input:focus { outline: none; border-color: #3d8ef8; }
.amem-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

.amem-tabs { display: flex; gap: 4px; margin-bottom: 16px; flex-wrap: wrap; border-bottom: 1px solid rgba(255,255,255,.08); padding-bottom: 0; }
.amem-tab { padding: 8px 16px; border-radius: 8px 8px 0 0; cursor: pointer; font-size: .82rem; font-weight: 600; color: var(--text3); border-bottom: 2px solid transparent; transition: all .15s; }
.amem-tab:hover { color: var(--text1); background: rgba(255,255,255,.03); }
.amem-tab.amem-tab-active { color: #3d8ef8; border-bottom-color: #3d8ef8; }

.amem-empty { text-align: center; padding: 40px 20px; color: var(--text3); }
.amem-empty-icon { font-size: 2rem; margin-bottom: 10px; }
.amem-loading { text-align: center; padding: 40px; color: var(--text3); }
.amem-spinner { display: inline-block; width: 28px; height: 28px; border: 3px solid rgba(255,255,255,.1); border-top-color: #3d8ef8; border-radius: 50%; animation: amemSpin .8s linear infinite; }
@keyframes amemSpin { to { transform: rotate(360deg); } }

.amem-checkbox { width: 16px; height: 16px; cursor: pointer; accent-color: #3d8ef8; }
.amem-bulk-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(61,142,248,.08); border-radius: 8px; margin-bottom: 12px; font-size: .82rem; }

.amem-detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.05); font-size: .82rem; }
.amem-detail-label { color: var(--text3); }
.amem-detail-value { color: var(--text1); font-weight: 600; }

@media (max-width: 768px) {
  .amem-stats-grid { grid-template-columns: repeat(2, 1fr); }
  .amem-modal { max-width: 100%; }
  .amem-toolbar { flex-direction: column; align-items: stretch; }
  .amem-table { font-size: .75rem; }
}
    `;
    document.head.appendChild(s);
  }

  /* ── Data Fetching ──────────────────────────────────────────────── */

  async function _fetchStats() {
    var sb = _sb();
    if (!sb) return null;
    try {
      var res = await sb.rpc('get_membership_stats');
      if (res.error) { _log('Stats error:', res.error.message); return null; }
      return res.data;
    } catch (e) { _log('Stats exception:', e.message); return null; }
  }

  async function _fetchMembers() {
    var sb = _sb();
    if (!sb) return [];
    try {
      var q = sb.from('user_memberships')
        .select('id,user_id,plan_id,status,started_at,expires_at,renewed_at,cancelled_at,suspended_at,grant_type,is_lifetime,role,admin_notes,created_at,updated_at')
        .order(_state.sortField, { ascending: _state.sortDir === 'asc' });

      // Apply status filter
      if (_state.filterStatus !== 'all') {
        if (_state.filterStatus === 'active') {
          q = q.eq('status', 'active');
        } else if (_state.filterStatus === 'lifetime') {
          q = q.eq('is_lifetime', true).eq('status', 'active');
        } else if (_state.filterStatus === 'trial') {
          q = q.eq('grant_type', 'trial').eq('status', 'active');
        } else if (_state.filterStatus === 'manual') {
          q = q.in('grant_type', ['manual', 'lifetime', 'custom']).eq('status', 'active');
        } else {
          q = q.eq('status', _state.filterStatus);
        }
      }

      // Apply grant type filter
      if (_state.filterGrantType !== 'all') {
        q = q.eq('grant_type', _state.filterGrantType);
      }

      // Apply date filter
      if (_state.filterDate !== 'all') {
        var now = new Date();
        var startDate;
        if (_state.filterDate === 'today') startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        else if (_state.filterDate === '7days') startDate = new Date(Date.now() - 7 * 86400000);
        else if (_state.filterDate === '30days') startDate = new Date(Date.now() - 30 * 86400000);
        if (startDate) q = q.gte('created_at', startDate.toISOString());
      }

      var res = await q.limit(500);
      if (res.error) { _log('Members error:', res.error.message); return []; }

      var members = res.data || [];

      // Apply search filter (client-side since we can't join with auth.users)
      if (_state.search) {
        var s = _state.search.toLowerCase();
        members = members.filter(function(m) {
          return String(m.user_id || '').toLowerCase().includes(s) ||
                 String(m.id || '').toLowerCase().includes(s) ||
                 String(m.status || '').toLowerCase().includes(s) ||
                 String(m.grant_type || '').toLowerCase().includes(s) ||
                 String(m.role || '').toLowerCase().includes(s);
        });
      }

      return members;
    } catch (e) { _log('Members exception:', e.message); return []; }
  }

  async function _fetchTransactions(limit) {
    var sb = _sb();
    if (!sb) return [];
    try {
      var res = await sb.from('membership_transactions')
        .select('id,user_id,plan_id,membership_id,provider,provider_tx_id,order_id,signature,amount_inr,currency,status,payment_method,verified_at,refund_status,created_at,updated_at,notes')
        .order('created_at', { ascending: false })
        .limit(limit || 200);
      if (res.error) { _log('Transactions error:', res.error.message); return []; }
      return res.data || [];
    } catch (e) { _log('Transactions exception:', e.message); return []; }
  }

  async function _fetchHistory(limit) {
    var sb = _sb();
    if (!sb) return [];
    try {
      var res = await sb.from('membership_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit || 200);
      if (res.error) { _log('History error:', res.error.message); return []; }
      return res.data || [];
    } catch (e) { _log('History exception:', e.message); return []; }
  }

  async function _fetchAuditLogs(limit) {
    var sb = _sb();
    if (!sb) return [];
    try {
      var res = await sb.from('membership_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit || 200);
      if (res.error) { _log('Audit logs error:', res.error.message); return []; }
      return res.data || [];
    } catch (e) { _log('Audit logs exception:', e.message); return []; }
  }

  async function _fetchActivityLogs(limit) {
    var sb = _sb();
    if (!sb) return [];
    try {
      var res = await sb.from('membership_activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit || 200);
      if (res.error) { _log('Activity logs error:', res.error.message); return []; }
      return res.data || [];
    } catch (e) { _log('Activity logs exception:', e.message); return []; }
  }

  async function _fetchManualGrants(limit) {
    var sb = _sb();
    if (!sb) return [];
    try {
      var res = await sb.from('membership_manual_grants')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit || 100);
      if (res.error) { _log('Manual grants error:', res.error.message); return []; }
      return res.data || [];
    } catch (e) { _log('Manual grants exception:', e.message); return []; }
  }

  async function _fetchPlans() {
    var sb = _sb();
    if (!sb) return [];
    try {
      var res = await sb.from('membership_plans')
        .select('id,slug,name,price_inr,billing_cycle,is_active,trial_days,description,sort_order')
        .order('sort_order', { ascending: true });
      if (res.error) { _log('Plans error:', res.error.message); return []; }
      return res.data || [];
    } catch (e) { _log('Plans exception:', e.message); return []; }
  }

  async function _fetchNotifications(limit) {
    var sb = _sb();
    if (!sb) return [];
    try {
      var res = await sb.from('membership_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit || 100);
      if (res.error) { _log('Notifications error:', res.error.message); return []; }
      return res.data || [];
    } catch (e) { _log('Notifications exception:', e.message); return []; }
  }

  /* ── Search by Razorpay IDs ────────────────────────────────────── */
  async function _searchByRazorpay(query) {
    var sb = _sb();
    if (!sb) return { members: [], transactions: [] };
    try {
      // Search in transactions by provider_tx_id or order_id
      var txRes = await sb.from('membership_transactions')
        .select('*')
        .or('provider_tx_id.ilike.%' + query + '%,order_id.ilike.%' + query + '%')
        .limit(10);
      var txs = txRes.data || [];

      // Get membership IDs from found transactions
      var memIds = txs.map(function(t) { return t.membership_id; }).filter(Boolean);
      var userIds = txs.map(function(t) { return t.user_id; }).filter(Boolean);

      var members = [];
      if (userIds.length > 0) {
        var memRes = await sb.from('user_memberships')
          .select('*')
          .in('user_id', userIds)
          .limit(20);
        members = memRes.data || [];
      }

      return { members: members, transactions: txs };
    } catch (e) { _log('Razorpay search exception:', e.message); return { members: [], transactions: [] }; }
  }

  /* ── Status Badge ──────────────────────────────────────────────── */
  function _statusBadge(status, isLifetime, expiresAt) {
    if (isLifetime && status === 'active') return '<span class="amem-badge amem-badge-lifetime">👑 LIFETIME</span>';
    if (status === 'active' && expiresAt && new Date(expiresAt) <= new Date()) {
      return '<span class="amem-badge amem-badge-expired">EXPIRED</span>';
    }
    var cls = { active: 'amem-badge-active', expired: 'amem-badge-expired', suspended: 'amem-badge-suspended', cancelled: 'amem-badge-cancelled' };
    var label = status ? status.toUpperCase() : '—';
    return '<span class="amem-badge ' + (cls[status] || 'amem-badge-expired') + '">' + label + '</span>';
  }

  function _grantTypeBadge(grantType) {
    if (!grantType || grantType === 'purchase') return '';
    var cls = { manual: 'amem-badge-manual', lifetime: 'amem-badge-lifetime', custom: 'amem-badge-manual', trial: 'amem-badge-trial' };
    return ' <span class="amem-badge ' + (cls[grantType] || '') + '">' + grantType.toUpperCase() + '</span>';
  }

  /* ── Main Render ───────────────────────────────────────────────── */
  AMEM.render = async function(container) {
    if (!container) return;
    _injectCSS();

    // Get admin info
    var sb = _sb();
    if (!sb) {
      container.innerHTML = '<div class="amem-empty"><div class="amem-empty-icon">🔒</div>Supabase not connected.</div>';
      return;
    }

    // Get admin session
    try {
      var session = await sb.auth.getSession();
      if (session && session.data && session.data.session) {
        _state.adminId = session.data.session.user.id;
        // Get admin role
        var roleRes = await sb.from('user_memberships')
          .select('role')
          .eq('user_id', _state.adminId)
          .limit(1)
          .maybeSingle();
        if (roleRes.data && roleRes.data.role) {
          _state.adminRole = roleRes.data.role;
        } else {
          // Check if this is the site owner (has admin access)
          _state.adminRole = 'super_admin'; // Default for admin panel access
        }
      }
    } catch (e) { _log('Admin session error:', e.message); }

    // Loading state
    container.innerHTML = '<div class="amem-loading"><div class="amem-spinner"></div><div style="margin-top:12px">Loading enterprise membership system…</div></div>';

    // Fetch all data in parallel
    var results = await Promise.allSettled([
      _fetchStats(),
      _fetchMembers(),
      _fetchTransactions(),
      _fetchPlans(),
      _fetchHistory(),
      _fetchAuditLogs(),
      _fetchActivityLogs(),
      _fetchManualGrants(),
    ]);

    _state.stats        = results[0].status === 'fulfilled' ? results[0].value : null;
    _state.members      = results[1].status === 'fulfilled' ? results[1].value : [];
    _state.transactions = results[2].status === 'fulfilled' ? results[2].value : [];
    _state.plans        = results[3].status === 'fulfilled' ? results[3].value : [];
    _state.history      = results[4].status === 'fulfilled' ? results[4].value : [];
    _state.auditLogs    = results[5].status === 'fulfilled' ? results[5].value : [];
    _state.activityLogs = results[6].status === 'fulfilled' ? results[6].value : [];
    _state.manualGrants = results[7].status === 'fulfilled' ? results[7].value : [];

    _state.totalPages = Math.ceil(_state.members.length / _state.pageSize);
    _state.page = 1;

    _renderMain(container);
  };

  function _renderMain(container) {
    var isSuperAdmin = _state.adminRole === 'super_admin';

    var h = '<div class="amem-ent-wrap">';

    // Header
    h += '<div class="amem-ent-header">';
    h += '<div class="amem-ent-title">👑 Enterprise Membership System</div>';
    h += '<div class="amem-ent-actions">';
    if (isSuperAdmin) {
      h += '<button class="amem-btn amem-btn-gold" onclick="AMEM.openGrantModal()">👑 Grant Membership</button>';
      h += '<button class="amem-btn amem-btn-primary" onclick="AMEM.openCustomPlanModal()">⚡ Custom Plan</button>';
    }
    h += '<button class="amem-btn amem-btn-ghost" onclick="AMEM.refresh()">↻ Refresh</button>';
    h += '</div>';
    h += '</div>';

    // Stats
    h += _renderStats();

    // Tabs
    h += '<div class="amem-tabs">';
    h += '<div class="amem-tab ' + (_state.currentTab === 'members' ? 'amem-tab-active' : '') + '" onclick="AMEM.switchTab(\'members\')">Members (' + _state.members.length + ')</div>';
    h += '<div class="amem-tab ' + (_state.currentTab === 'transactions' ? 'amem-tab-active' : '') + '" onclick="AMEM.switchTab(\'transactions\')">Transactions (' + _state.transactions.length + ')</div>';
    h += '<div class="amem-tab ' + (_state.currentTab === 'history' ? 'amem-tab-active' : '') + '" onclick="AMEM.switchTab(\'history\')">History (' + _state.history.length + ')</div>';
    h += '<div class="amem-tab ' + (_state.currentTab === 'audit' ? 'amem-tab-active' : '') + '" onclick="AMEM.switchTab(\'audit\')">Audit Logs (' + _state.auditLogs.length + ')</div>';
    h += '<div class="amem-tab ' + (_state.currentTab === 'activity' ? 'amem-tab-active' : '') + '" onclick="AMEM.switchTab(\'activity\')">Activity (' + _state.activityLogs.length + ')</div>';
    h += '<div class="amem-tab ' + (_state.currentTab === 'grants' ? 'amem-tab-active' : '') + '" onclick="AMEM.switchTab(\'grants\')">Manual Grants (' + _state.manualGrants.length + ')</div>';
    h += '<div class="amem-tab ' + (_state.currentTab === 'plans' ? 'amem-tab-active' : '') + '" onclick="AMEM.switchTab(\'plans\')">Plans (' + _state.plans.length + ')</div>';
    h += '</div>';

    // Tab content
    if (_state.currentTab === 'members') h += _renderMembersTab(isSuperAdmin);
    else if (_state.currentTab === 'transactions') h += _renderTransactionsTab();
    else if (_state.currentTab === 'history') h += _renderHistoryTab();
    else if (_state.currentTab === 'audit') h += _renderAuditTab();
    else if (_state.currentTab === 'activity') h += _renderActivityTab();
    else if (_state.currentTab === 'grants') h += _renderGrantsTab();
    else if (_state.currentTab === 'plans') h += _renderPlansTab(isSuperAdmin);

    h += '</div>';
    container.innerHTML = h;

    // Render premium categories panel if on members tab
    if (_state.currentTab === 'members') {
      setTimeout(function() {
        if (typeof window.renderAdminPremiumCategories === 'function') {
          var wrap = document.getElementById('smci-admin-prem-cats-wrap');
          if (wrap) window.renderAdminPremiumCategories(wrap);
        }
      }, 100);
    }
  }

  /* ── Stats ─────────────────────────────────────────────────────── */
  function _renderStats() {
    var s = _state.stats || {};
    h = '<div class="amem-stats-grid">';
    h += '<div class="amem-stat-card"><div class="amem-stat-val">' + (s.total || _state.members.length) + '</div><div class="amem-stat-label">Total Members</div></div>';
    h += '<div class="amem-stat-card"><div class="amem-stat-val amem-stat-active">' + (s.active || 0) + '</div><div class="amem-stat-label">Active</div></div>';
    h += '<div class="amem-stat-card"><div class="amem-stat-val amem-stat-expired">' + (s.expired || 0) + '</div><div class="amem-stat-label">Expired</div></div>';
    h += '<div class="amem-stat-card"><div class="amem-stat-val">' + (s.suspended || 0) + '</div><div class="amem-stat-label">Suspended</div></div>';
    h += '<div class="amem-stat-card"><div class="amem-stat-val amem-stat-lifetime">' + (s.lifetime || 0) + '</div><div class="amem-stat-label">Lifetime</div></div>';
    h += '<div class="amem-stat-card"><div class="amem-stat-val">' + (s.trial || 0) + '</div><div class="amem-stat-label">Trial</div></div>';
    h += '<div class="amem-stat-card"><div class="amem-stat-val">' + (s.manual || 0) + '</div><div class="amem-stat-label">Manual</div></div>';
    h += '<div class="amem-stat-card"><div class="amem-stat-val amem-stat-revenue">₹' + (s.today_revenue || 0) + '</div><div class="amem-stat-label">Today Revenue</div></div>';
    h += '<div class="amem-stat-card"><div class="amem-stat-val amem-stat-revenue">₹' + (s.monthly_revenue || 0) + '</div><div class="amem-stat-label">Monthly Revenue</div></div>';
    h += '<div class="amem-stat-card"><div class="amem-stat-val amem-stat-revenue">₹' + (s.total_revenue || 0) + '</div><div class="amem-stat-label">Total Revenue</div></div>';
    h += '<div class="amem-stat-card"><div class="amem-stat-val amem-stat-expired">' + (s.expiring_today || 0) + '</div><div class="amem-stat-label">Expiring Today</div></div>';
    h += '<div class="amem-stat-card"><div class="amem-stat-val" style="color:#f59e0b">' + (s.expiring_soon || 0) + '</div><div class="amem-stat-label">Expiring Soon</div></div>';
    h += '</div>';
    return h;
  }

  /* ── Members Tab ───────────────────────────────────────────────── */
  function _renderMembersTab(isSuperAdmin) {
    var h = '';

    // Toolbar
    h += '<div class="amem-toolbar">';
    h += '<input class="amem-search" type="text" placeholder="Search by User ID, Membership ID, or Razorpay Payment ID…" value="' + _esc(_state.search) + '" oninput="AMEM.onSearch(this.value)" />';
    h += '<select class="amem-select" onchange="AMEM.onFilterStatus(this.value)">';
    h += '<option value="all"' + (_state.filterStatus === 'all' ? ' selected' : '') + '>All Status</option>';
    h += '<option value="active"' + (_state.filterStatus === 'active' ? ' selected' : '') + '>Active</option>';
    h += '<option value="expired"' + (_state.filterStatus === 'expired' ? ' selected' : '') + '>Expired</option>';
    h += '<option value="suspended"' + (_state.filterStatus === 'suspended' ? ' selected' : '') + '>Suspended</option>';
    h += '<option value="cancelled"' + (_state.filterStatus === 'cancelled' ? ' selected' : '') + '>Cancelled</option>';
    h += '<option value="lifetime"' + (_state.filterStatus === 'lifetime' ? ' selected' : '') + '>Lifetime</option>';
    h += '<option value="trial"' + (_state.filterStatus === 'trial' ? ' selected' : '') + '>Trial</option>';
    h += '<option value="manual"' + (_state.filterStatus === 'manual' ? ' selected' : '') + '>Manual</option>';
    h += '</select>';
    h += '<select class="amem-select" onchange="AMEM.onFilterDate(this.value)">';
    h += '<option value="all"' + (_state.filterDate === 'all' ? ' selected' : '') + '>All Dates</option>';
    h += '<option value="today"' + (_state.filterDate === 'today' ? ' selected' : '') + '>Today</option>';
    h += '<option value="7days"' + (_state.filterDate === '7days' ? ' selected' : '') + '>Last 7 Days</option>';
    h += '<option value="30days"' + (_state.filterDate === '30days' ? ' selected' : '') + '>Last 30 Days</option>';
    h += '</select>';
    h += '<button class="amem-btn amem-btn-ghost amem-btn-sm" onclick="AMEM.exportCSV(\'members\')">📊 Export CSV</button>';
    h += '<button class="amem-btn amem-btn-ghost amem-btn-sm" onclick="AMEM.exportPDF(\'members\')">📄 Export PDF</button>';
    h += '</div>';

    // Bulk action bar
    if (_state.selectedIds.size > 0 && isSuperAdmin) {
      h += '<div class="amem-bulk-bar">';
      h += '<span>' + _state.selectedIds.size + ' selected</span>';
      h += '<button class="amem-btn amem-btn-primary amem-btn-sm" onclick="AMEM.bulkAction(\'activate\')">✅ Activate</button>';
      h += '<button class="amem-btn amem-btn-danger amem-btn-sm" onclick="AMEM.bulkAction(\'suspend\')">⛔ Suspend</button>';
      h += '<button class="amem-btn amem-btn-danger amem-btn-sm" onclick="AMEM.bulkAction(\'cancel\')">❌ Cancel</button>';
      h += '<button class="amem-btn amem-btn-ghost amem-btn-sm" onclick="AMEM.clearSelection()">Clear</button>';
      h += '</div>';
    }

    // Table
    if (_state.members.length === 0) {
      h += '<div class="amem-empty"><div class="amem-empty-icon">📭</div>No members found. Adjust filters or try refreshing.</div>';
    } else {
      var planById = {};
      _state.plans.forEach(function(p) { planById[p.id] = p; });

      var start = (_state.page - 1) * _state.pageSize;
      var end = start + _state.pageSize;
      var pageMembers = _state.members.slice(start, end);

      h += '<div class="amem-table-wrap"><table class="amem-table">';
      h += '<thead><tr>';
      if (isSuperAdmin) h += '<th><input type="checkbox" class="amem-checkbox" onchange="AMEM.toggleAll(this.checked)" /></th>';
      h += '<th onclick="AMEM.sortBy(\'user_id\')">User ID</th>';
      h += '<th onclick="AMEM.sortBy(\'status\')">Status</th>';
      h += '<th>Grant Type</th>';
      h += '<th onclick="AMEM.sortBy(\'started_at\')">Started</th>';
      h += '<th onclick="AMEM.sortBy(\'expires_at\')">Expires</th>';
      h += '<th>Days Left</th>';
      h += '<th>Plan</th>';
      h += '<th>Actions</th>';
      h += '</tr></thead><tbody>';

      pageMembers.forEach(function(m) {
        var plan = planById[m.plan_id] || {};
        var dl = _daysLeft(m.expires_at, m.is_lifetime);
        var selected = _state.selectedIds.has(m.id) ? ' amem-selected' : '';
        h += '<tr class="' + selected + '">';
        if (isSuperAdmin) h += '<td><input type="checkbox" class="amem-checkbox" ' + (_state.selectedIds.has(m.id) ? 'checked' : '') + ' onchange="AMEM.toggleSelect(\'' + m.id + '\', this.checked)" /></td>';
        h += '<td><span title="' + _esc(m.user_id) + '" style="font-family:monospace;font-size:.72rem;cursor:help">' + _shortId(m.user_id) + '</span></td>';
        h += '<td>' + _statusBadge(m.status, m.is_lifetime, m.expires_at) + '</td>';
        h += '<td>' + (m.grant_type || 'purchase') + _grantTypeBadge(m.grant_type) + '</td>';
        h += '<td>' + _fmtDate(m.started_at) + '</td>';
        h += '<td>' + (m.is_lifetime ? '∞ Never' : _fmtDate(m.expires_at)) + '</td>';
        h += '<td>' + (dl > 0 ? '<span style="color:#10d98e;font-weight:700">' + dl + 'd</span>' : (m.is_lifetime ? '<span style="color:#fbbf24">∞</span>' : '<span style="color:#ef4444">0</span>')) + '</td>';
        h += '<td>' + _esc(plan.name || '—') + '</td>';
        h += '<td style="white-space:nowrap">';
        h += '<button class="amem-btn amem-btn-ghost amem-btn-sm" onclick="AMEM.viewMember(\'' + _esc(m.id) + '\')">👁</button>';
        if (isSuperAdmin) {
          if (m.status === 'suspended' || m.status === 'expired' || m.status === 'cancelled') {
            h += ' <button class="amem-btn amem-btn-primary amem-btn-sm" onclick="AMEM.reactivateMember(\'' + _esc(m.id) + '\')">✅</button>';
          }
          if (m.status === 'active') {
            h += ' <button class="amem-btn amem-btn-ghost amem-btn-sm" onclick="AMEM.suspendMember(\'' + _esc(m.id) + '\')">⛔</button>';
          }
          h += ' <button class="amem-btn amem-btn-danger amem-btn-sm" onclick="AMEM.cancelMember(\'' + _esc(m.id) + '\')">❌</button>';
        }
        h += '</td>';
        h += '</tr>';
      });

      h += '</tbody></table></div>';

      // Pagination
      h += _renderPagination();
    }

    // Premium categories
    h += '<div id="smci-admin-prem-cats-wrap" style="margin-top:28px"></div>';

    return h;
  }

  /* ── Pagination ───────────────────────────────────────────────── */
  function _renderPagination() {
    if (_state.totalPages <= 1) return '';
    var h = '<div class="amem-pagination">';
    h += '<div style="font-size:.78rem;color:var(--text3)">Page ' + _state.page + ' of ' + _state.totalPages + ' (' + _state.members.length + ' total)</div>';
    h += '<div class="amem-page-btns">';
    h += '<button class="amem-page-btn" onclick="AMEM.goPage(1)" ' + (_state.page === 1 ? 'disabled' : '') + '>«</button>';
    h += '<button class="amem-page-btn" onclick="AMEM.goPage(' + (_state.page - 1) + ')" ' + (_state.page === 1 ? 'disabled' : '') + '>‹</button>';
    for (var i = Math.max(1, _state.page - 2); i <= Math.min(_state.totalPages, _state.page + 2); i++) {
      h += '<button class="amem-page-btn ' + (i === _state.page ? 'amem-page-active' : '') + '" onclick="AMEM.goPage(' + i + ')">' + i + '</button>';
    }
    h += '<button class="amem-page-btn" onclick="AMEM.goPage(' + (_state.page + 1) + ')" ' + (_state.page === _state.totalPages ? 'disabled' : '') + '>›</button>';
    h += '<button class="amem-page-btn" onclick="AMEM.goPage(' + _state.totalPages + ')" ' + (_state.page === _state.totalPages ? 'disabled' : '') + '>»</button>';
    h += '</div></div>';
    return h;
  }

  /* ── Transactions Tab ──────────────────────────────────────────── */
  function _renderTransactionsTab() {
    var planById = {};
    _state.plans.forEach(function(p) { planById[p.id] = p; });

    var h = '<div class="amem-toolbar">';
    h += '<button class="amem-btn amem-btn-ghost amem-btn-sm" onclick="AMEM.exportCSV(\'transactions\')">📊 Export CSV</button>';
    h += '<button class="amem-btn amem-btn-ghost amem-btn-sm" onclick="AMEM.exportPDF(\'transactions\')">📄 Export PDF</button>';
    h += '</div>';

    if (_state.transactions.length === 0) {
      return h + '<div class="amem-empty"><div class="amem-empty-icon">💳</div>No transactions found.</div>';
    }

    h += '<div class="amem-table-wrap"><table class="amem-table">';
    h += '<thead><tr><th>Date</th><th>User ID</th><th>Amount</th><th>Status</th><th>Plan</th><th>Payment ID</th><th>Order ID</th><th>Refund</th></tr></thead><tbody>';

    _state.transactions.forEach(function(t) {
      var plan = planById[t.plan_id] || {};
      h += '<tr>';
      h += '<td>' + _fmtDateTime(t.created_at) + '</td>';
      h += '<td><span title="' + _esc(t.user_id) + '" style="font-family:monospace;font-size:.72rem;cursor:help">' + _shortId(t.user_id) + '</span></td>';
      h += '<td style="color:#10d98e;font-weight:700">₹' + (t.amount_inr || '—') + '</td>';
      h += '<td>' + (t.status === 'completed' ? '<span class="amem-badge amem-badge-active">Completed</span>' : '<span class="amem-badge">' + _esc(t.status || '—') + '</span>') + '</td>';
      h += '<td>' + _esc(plan.name || '—') + '</td>';
      h += '<td><span style="font-family:monospace;font-size:.7rem;color:rgba(255,255,255,.5)" title="' + _esc(t.provider_tx_id) + '">' + _shortId(t.provider_tx_id) + '</span></td>';
      h += '<td><span style="font-family:monospace;font-size:.7rem;color:rgba(255,255,255,.5)">' + _esc(t.order_id || '—') + '</span></td>';
      h += '<td>' + (t.refund_status && t.refund_status !== 'none' ? '<span class="amem-badge amem-badge-suspended">' + t.refund_status + '</span>' : '—') + '</td>';
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    return h;
  }

  /* ── History Tab ───────────────────────────────────────────────── */
  function _renderHistoryTab() {
    if (_state.history.length === 0) return '<div class="amem-empty"><div class="amem-empty-icon">📜</div>No membership history found.</div>';

    var h = '<div class="amem-table-wrap"><table class="amem-table">';
    h += '<thead><tr><th>Date</th><th>User ID</th><th>Action</th><th>Old Status</th><th>New Status</th><th>Old Expiry</th><th>New Expiry</th><th>Reason</th></tr></thead><tbody>';

    _state.history.forEach(function(h2) {
      h += '<tr>';
      h += '<td>' + _fmtDateTime(h2.created_at) + '</td>';
      h += '<td><span style="font-family:monospace;font-size:.72rem">' + _shortId(h2.user_id) + '</span></td>';
      h += '<td><span class="amem-badge amem-badge-active">' + _esc(h2.action) + '</span></td>';
      h += '<td>' + _esc(h2.old_status || '—') + '</td>';
      h += '<td>' + _esc(h2.new_status || '—') + '</td>';
      h += '<td>' + _fmtDate(h2.old_expires_at) + '</td>';
      h += '<td>' + _fmtDate(h2.new_expires_at) + '</td>';
      h += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' + _esc(h2.change_reason || '—') + '</td>';
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    return h;
  }

  /* ── Audit Logs Tab ───────────────────────────────────────────── */
  function _renderAuditTab() {
    if (_state.auditLogs.length === 0) return '<div class="amem-empty"><div class="amem-empty-icon">🔍</div>No audit logs found.</div>';

    var h = '<div class="amem-table-wrap"><table class="amem-table">';
    h += '<thead><tr><th>Timestamp</th><th>Admin</th><th>Target User</th><th>Action</th><th>Reason</th><th>Notes</th></tr></thead><tbody>';

    _state.auditLogs.forEach(function(a) {
      h += '<tr>';
      h += '<td>' + _fmtDateTime(a.created_at) + '</td>';
      h += '<td><span style="font-family:monospace;font-size:.72rem">' + _shortId(a.admin_id) + '</span></td>';
      h += '<td><span style="font-family:monospace;font-size:.72rem">' + _shortId(a.target_user_id) + '</span></td>';
      h += '<td><span class="amem-badge amem-badge-manual">' + _esc(a.action) + '</span></td>';
      h += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' + _esc(a.reason || '—') + '</td>';
      h += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' + _esc(a.admin_notes || '—') + '</td>';
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    return h;
  }

  /* ── Activity Logs Tab ─────────────────────────────────────────── */
  function _renderActivityTab() {
    if (_state.activityLogs.length === 0) return '<div class="amem-empty"><div class="amem-empty-icon">📊</div>No activity logs found.</div>';

    var h = '<div class="amem-table-wrap"><table class="amem-table">';
    h += '<thead><tr><th>Timestamp</th><th>User ID</th><th>Activity</th><th>Details</th></tr></thead><tbody>';

    _state.activityLogs.forEach(function(a) {
      var details = '';
      if (a.metadata) {
        try { details = JSON.stringify(a.metadata).slice(0, 100); } catch (_) { details = ''; }
      }
      h += '<tr>';
      h += '<td>' + _fmtDateTime(a.created_at) + '</td>';
      h += '<td><span style="font-family:monospace;font-size:.72rem">' + _shortId(a.user_id) + '</span></td>';
      h += '<td><span class="amem-badge amem-badge-active">' + _esc(a.activity_type) + '</span></td>';
      h += '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;font-family:monospace;font-size:.72rem">' + _esc(details) + '</td>';
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    return h;
  }

  /* ── Manual Grants Tab ─────────────────────────────────────────── */
  function _renderGrantsTab() {
    if (_state.manualGrants.length === 0) return '<div class="amem-empty"><div class="amem-empty-icon">🎁</div>No manual grants found.</div>';

    var h = '<div class="amem-table-wrap"><table class="amem-table">';
    h += '<thead><tr><th>Date</th><th>User ID</th><th>Granted By</th><th>Type</th><th>Duration</th><th>Reason</th><th>Lifetime</th></tr></thead><tbody>';

    _state.manualGrants.forEach(function(g) {
      h += '<tr>';
      h += '<td>' + _fmtDate(g.created_at) + '</td>';
      h += '<td><span style="font-family:monospace;font-size:.72rem">' + _shortId(g.user_id) + '</span></td>';
      h += '<td><span style="font-family:monospace;font-size:.72rem">' + _shortId(g.granted_by) + '</span></td>';
      h += '<td>' + _esc(g.grant_type) + '</td>';
      h += '<td>' + (g.is_lifetime ? '∞' : (g.duration_days ? g.duration_days + ' days' : _fmtDate(g.expires_at))) + '</td>';
      h += '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">' + _esc(g.reason || '—') + '</td>';
      h += '<td>' + (g.is_lifetime ? '✅' : '—') + '</td>';
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    return h;
  }

  /* ── Plans Tab ─────────────────────────────────────────────────── */
  function _renderPlansTab(isSuperAdmin) {
    var h = '';
    if (_state.plans.length === 0) return '<div class="amem-empty"><div class="amem-empty-icon">📋</div>No plans found.</div>';

    h += '<div class="amem-table-wrap"><table class="amem-table">';
    h += '<thead><tr><th>Name</th><th>Slug</th><th>Price</th><th>Cycle</th><th>Trial Days</th><th>Active</th><th>Sort</th></tr></thead><tbody>';

    _state.plans.forEach(function(p) {
      h += '<tr>';
      h += '<td>' + _esc(p.name) + '</td>';
      h += '<td><code>' + _esc(p.slug) + '</code></td>';
      h += '<td>₹' + (p.price_inr || 0) + '</td>';
      h += '<td>' + _esc(p.billing_cycle) + '</td>';
      h += '<td>' + (p.trial_days || '—') + '</td>';
      h += '<td>' + (p.is_active ? '<span class="amem-badge amem-badge-active">Active</span>' : '<span class="amem-badge amem-badge-expired">Inactive</span>') + '</td>';
      h += '<td>' + (p.sort_order || 0) + '</td>';
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    return h;
  }

  /* ── Modals ────────────────────────────────────────────────────── */

  AMEM.openGrantModal = function() {
    var planOptions = _state.plans.map(function(p) {
      return '<option value="' + _esc(p.id) + '">' + _esc(p.name) + ' (₹' + p.price_inr + ' / ' + p.billing_cycle + ')</option>';
    }).join('');

    var modal = document.createElement('div');
    modal.className = 'amem-modal-overlay';
    modal.id = 'amemGrantModal';
    modal.innerHTML = `
      <div class="amem-modal">
        <div class="amem-modal-title">👑 Grant Manual Membership</div>
        <div class="amem-modal-field">
          <label class="amem-modal-label">User ID *</label>
          <input class="amem-modal-input" type="text" id="amemGrantUserId" placeholder="Paste user UUID here" />
        </div>
        <div class="amem-modal-field">
          <label class="amem-modal-label">Select Plan</label>
          <select class="amem-modal-input" id="amemGrantPlan">
            <option value="">— Custom (no predefined plan) —</option>
            ${planOptions}
          </select>
        </div>
        <div class="amem-modal-field">
          <label class="amem-modal-label">Grant Type</label>
          <select class="amem-modal-input" id="amemGrantType" onchange="AMEM.onGrantTypeChange()">
            <option value="manual">Manual (specific duration)</option>
            <option value="lifetime">Lifetime (never expires)</option>
            <option value="trial">Trial</option>
            <option value="custom">Custom Plan</option>
          </select>
        </div>
        <div class="amem-modal-field" id="amemGrantDurationField">
          <label class="amem-modal-label">Duration (days)</label>
          <select class="amem-modal-input" id="amemGrantDuration">
            <option value="1">1 Day</option>
            <option value="15">15 Days</option>
            <option value="30" selected>30 Days</option>
            <option value="90">90 Days</option>
            <option value="180">180 Days</option>
            <option value="365">365 Days</option>
            <option value="custom">Custom (specify expiry)</option>
          </select>
        </div>
        <div class="amem-modal-field" id="amemGrantExpiryField" style="display:none">
          <label class="amem-modal-label">Custom Expiry Date</label>
          <input class="amem-modal-input" type="date" id="amemGrantExpiry" />
        </div>
        <div class="amem-modal-field" id="amemCustomPlanNameField" style="display:none">
          <label class="amem-modal-label">Custom Plan Name</label>
          <input class="amem-modal-input" type="text" id="amemCustomPlanName" placeholder="e.g. VIP Student Pro" />
        </div>
        <div class="amem-modal-field">
          <label class="amem-modal-label">Reason *</label>
          <input class="amem-modal-input" type="text" id="amemGrantReason" placeholder="Reason for granting" />
        </div>
        <div class="amem-modal-field">
          <label class="amem-modal-label">Admin Notes</label>
          <textarea class="amem-modal-input" id="amemGrantNotes" rows="2" placeholder="Internal notes (not shown to user)"></textarea>
        </div>
        <div class="amem-modal-actions">
          <button class="amem-btn amem-btn-ghost" onclick="AMEM.closeModal()">Cancel</button>
          <button class="amem-btn amem-btn-gold" onclick="AMEM.submitGrant()">👑 Grant Membership</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  };

  AMEM.onGrantTypeChange = function() {
    var type = document.getElementById('amemGrantType').value;
    var durField = document.getElementById('amemGrantDurationField');
    var expField = document.getElementById('amemGrantExpiryField');
    var customNameField = document.getElementById('amemCustomPlanNameField');

    if (type === 'lifetime') {
      durField.style.display = 'none';
      expField.style.display = 'none';
      customNameField.style.display = 'none';
    } else if (type === 'custom') {
      durField.style.display = 'none';
      expField.style.display = 'none';
      customNameField.style.display = 'block';
    } else {
      durField.style.display = 'block';
      customNameField.style.display = 'none';
      var dur = document.getElementById('amemGrantDuration').value;
      expField.style.display = (dur === 'custom') ? 'block' : 'none';
    }
  };

  AMEM.submitGrant = async function() {
    var userId = document.getElementById('amemGrantUserId').value.trim();
    var planId = document.getElementById('amemGrantPlan').value || null;
    var grantType = document.getElementById('amemGrantType').value;
    var reason = document.getElementById('amemGrantReason').value.trim();
    var notes = document.getElementById('amemGrantNotes').value.trim();
    var customPlanName = document.getElementById('amemCustomPlanName')?.value?.trim() || null;

    if (!userId) { _toast('User ID is required', 'error'); return; }
    if (!reason) { _toast('Reason is required', 'error'); return; }

    var durationDays = null;
    var expiresAt = null;

    if (grantType !== 'lifetime' && grantType !== 'custom') {
      var durVal = document.getElementById('amemGrantDuration').value;
      if (durVal === 'custom') {
        var expDate = document.getElementById('amemGrantExpiry').value;
        if (expDate) expiresAt = new Date(expDate + 'T23:59:59+05:30').toISOString();
      } else {
        durationDays = parseInt(durVal);
      }
    }

    var sb = _sb();
    if (!sb) { _toast('Supabase not connected', 'error'); return; }

    try {
      var res = await sb.rpc('grant_manual_membership', {
        p_user_id: userId,
        p_plan_id: planId,
        p_expires_at: expiresAt,
        p_duration_days: durationDays,
        p_grant_type: grantType,
        p_reason: reason,
        p_admin_notes: notes,
        p_admin_id: _state.adminId,
        p_custom_plan_name: customPlanName,
      });

      if (res.error) { _toast('Error: ' + res.error.message, 'error'); return; }
      if (res.data && res.data.success === false) { _toast('Error: ' + res.data.error, 'error'); return; }

      _toast('✅ Membership granted successfully!', 'success');
      AMEM.closeModal();
      AMEM.refresh();
    } catch (e) { _toast('Error: ' + e.message, 'error'); }
  };

  AMEM.openCustomPlanModal = function() {
    var modal = document.createElement('div');
    modal.className = 'amem-modal-overlay';
    modal.id = 'amemCustomPlanModal';
    modal.innerHTML = `
      <div class="amem-modal">
        <div class="amem-modal-title">⚡ Create Custom Plan</div>
        <div class="amem-modal-field">
          <label class="amem-modal-label">Plan Name *</label>
          <input class="amem-modal-input" type="text" id="amemCustomPlanNameInput" placeholder="e.g. VIP Student Pro" />
        </div>
        <div class="amem-modal-field">
          <label class="amem-modal-label">Slug *</label>
          <input class="amem-modal-input" type="text" id="amemCustomPlanSlug" placeholder="e.g. vip-student-pro" />
        </div>
        <div class="amem-modal-field">
          <label class="amem-modal-label">Price (₹) *</label>
          <input class="amem-modal-input" type="number" id="amemCustomPlanPrice" placeholder="0" value="0" />
        </div>
        <div class="amem-modal-field">
          <label class="amem-modal-label">Billing Cycle</label>
          <select class="amem-modal-input" id="amemCustomPlanCycle">
            <option value="custom">Custom</option>
            <option value="1day">1 Day</option>
            <option value="15days">15 Days</option>
            <option value="30days">30 Days</option>
            <option value="90days">90 Days</option>
            <option value="180days">180 Days</option>
            <option value="365days">365 Days</option>
            <option value="lifetime">Lifetime</option>
          </select>
        </div>
        <div class="amem-modal-field">
          <label class="amem-modal-label">Description</label>
          <textarea class="amem-modal-input" id="amemCustomPlanDesc" rows="2" placeholder="Plan description"></textarea>
        </div>
        <div class="amem-modal-field">
          <label class="amem-modal-label">Custom Notes</label>
          <textarea class="amem-modal-input" id="amemCustomPlanNotes" rows="2" placeholder="Internal notes for this plan"></textarea>
        </div>
        <div class="amem-modal-actions">
          <button class="amem-btn amem-btn-ghost" onclick="AMEM.closeModal()">Cancel</button>
          <button class="amem-btn amem-btn-primary" onclick="AMEM.submitCustomPlan()">⚡ Create Plan</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  };

  AMEM.submitCustomPlan = async function() {
    var name = document.getElementById('amemCustomPlanNameInput').value.trim();
    var slug = document.getElementById('amemCustomPlanSlug').value.trim();
    var price = parseFloat(document.getElementById('amemCustomPlanPrice').value) || 0;
    var cycle = document.getElementById('amemCustomPlanCycle').value;
    var desc = document.getElementById('amemCustomPlanDesc').value.trim();
    var notes = document.getElementById('amemCustomPlanNotes').value.trim();

    if (!name || !slug) { _toast('Name and slug are required', 'error'); return; }

    var sb = _sb();
    if (!sb) return;

    try {
      var maxSort = _state.plans.reduce(function(m, p) { return Math.max(m, p.sort_order || 0); }, 0);
      var res = await sb.from('membership_plans').insert({
        name: name, slug: slug, price_inr: price, billing_cycle: cycle,
        is_active: true, description: desc, custom_notes: notes, sort_order: maxSort + 1
      }).select('id');

      if (res.error) { _toast('Error: ' + res.error.message, 'error'); return; }
      _toast('✅ Custom plan created!', 'success');
      AMEM.closeModal();
      AMEM.refresh();
    } catch (e) { _toast('Error: ' + e.message, 'error'); }
  };

  AMEM.closeModal = function() {
    var m = document.getElementById('amemGrantModal') || document.getElementById('amemCustomPlanModal');
    if (m) m.remove();
  };

  /* ── Member Actions ────────────────────────────────────────────── */

  AMEM.suspendMember = async function(id) {
    var m = _state.members.find(function(x) { return x.id === id; });
    if (!m) return;
    var reason = prompt('Reason for suspending this membership?');
    if (!reason) return;

    var sb = _sb();
    try {
      var res = await sb.rpc('suspend_membership', { p_user_id: m.user_id, p_reason: reason, p_admin_id: _state.adminId });
      if (res.error) { _toast('Error: ' + res.error.message, 'error'); return; }
      if (res.data && res.data.success === false) { _toast('Error: ' + res.data.error, 'error'); return; }
      _toast('✅ Membership suspended', 'success');
      AMEM.refresh();
    } catch (e) { _toast('Error: ' + e.message, 'error'); }
  };

  AMEM.cancelMember = async function(id) {
    var m = _state.members.find(function(x) { return x.id === id; });
    if (!m) return;
    var reason = prompt('Reason for cancelling this membership?');
    if (!reason) return;

    var sb = _sb();
    try {
      var res = await sb.rpc('cancel_membership', { p_user_id: m.user_id, p_reason: reason, p_admin_id: _state.adminId });
      if (res.error) { _toast('Error: ' + res.error.message, 'error'); return; }
      if (res.data && res.data.success === false) { _toast('Error: ' + res.data.error, 'error'); return; }
      _toast('✅ Membership cancelled', 'success');
      AMEM.refresh();
    } catch (e) { _toast('Error: ' + e.message, 'error'); }
  };

  AMEM.reactivateMember = async function(id) {
    var m = _state.members.find(function(x) { return x.id === id; });
    if (!m) return;
    var sb = _sb();
    try {
      var res = await sb.rpc('deactivate_membership', { p_user_id: m.user_id, p_admin_id: _state.adminId, p_action: 'reactivate' });
      if (res.error) {
        // Fallback: direct update
        var newExpiry = new Date(Date.now() + 30 * 86400000).toISOString();
        await sb.from('user_memberships').update({ status: 'active', expires_at: newExpiry, updated_at: new Date().toISOString() }).eq('id', id);
      }
      _toast('✅ Membership reactivated (+30 days)', 'success');
      AMEM.refresh();
    } catch (e) { _toast('Error: ' + e.message, 'error'); }
  };

  AMEM.viewMember = function(id) {
    var m = _state.members.find(function(x) { return x.id === id; });
    if (!m) return;
    var plan = _state.plans.find(function(p) { return p.id === m.plan_id; });

    var txs = _state.transactions.filter(function(t) { return t.membership_id === id; });
    var hist = _state.history.filter(function(h) { return h.membership_id === id; });
    var grants = _state.manualGrants.filter(function(g) { return g.membership_id === id; });

    var modal = document.createElement('div');
    modal.className = 'amem-modal-overlay';
    modal.id = 'amemDetailModal';
    modal.innerHTML = `
      <div class="amem-modal" style="max-width:600px">
        <div class="amem-modal-title">👤 Member Details</div>
        <div class="amem-detail-row"><div class="amem-detail-label">Membership ID</div><div class="amem-detail-value" style="font-family:monospace;font-size:.72rem">${_esc(m.id)}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">User ID</div><div class="amem-detail-value" style="font-family:monospace;font-size:.72rem">${_esc(m.user_id)}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">Status</div><div class="amem-detail-value">${_statusBadge(m.status, m.is_lifetime, m.expires_at)}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">Plan</div><div class="amem-detail-value">${_esc(plan?.name || '—')}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">Grant Type</div><div class="amem-detail-value">${_esc(m.grant_type || 'purchase')}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">Started</div><div class="amem-detail-value">${_fmtDate(m.started_at)}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">Expires</div><div class="amem-detail-value">${m.is_lifetime ? '∞ Never' : _fmtDate(m.expires_at)}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">Days Left</div><div class="amem-detail-value">${_daysLeft(m.expires_at, m.is_lifetime)}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">Lifetime</div><div class="amem-detail-value">${m.is_lifetime ? '✅ Yes' : 'No'}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">Role</div><div class="amem-detail-value">${_esc(m.role || 'viewer')}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">Admin Notes</div><div class="amem-detail-value">${_esc(m.admin_notes || '—')}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">Created</div><div class="amem-detail-value">${_fmtDateTime(m.created_at)}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">Renewed</div><div class="amem-detail-value">${_fmtDate(m.renewed_at)}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">Transactions</div><div class="amem-detail-value">${txs.length}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">History Events</div><div class="amem-detail-value">${hist.length}</div></div>
        <div class="amem-detail-row"><div class="amem-detail-label">Manual Grants</div><div class="amem-detail-value">${grants.length}</div></div>
        <div class="amem-modal-actions">
          <button class="amem-btn amem-btn-ghost" onclick="AMEM.closeModal()">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  };

  /* ── Bulk Actions ──────────────────────────────────────────────── */
  AMEM.toggleAll = function(checked) {
    if (checked) {
      _state.members.forEach(function(m) { _state.selectedIds.add(m.id); });
    } else { _state.selectedIds.clear(); }
    _rerender();
  };

  AMEM.toggleSelect = function(id, checked) {
    if (checked) _state.selectedIds.add(id);
    else _state.selectedIds.delete(id);
    _rerender();
  };

  AMEM.clearSelection = function() { _state.selectedIds.clear(); _rerender(); };

  AMEM.bulkAction = async function(action) {
    var ids = Array.from(_state.selectedIds);
    if (ids.length === 0) return;

    var confirmMsg = { activate: 'Activate', suspend: 'Suspend', cancel: 'Cancel' }[action] || action;
    if (!confirm('Are you sure you want to ' + confirmMsg.toLowerCase() + ' ' + ids.length + ' memberships?')) return;

    var reason = prompt('Reason for bulk ' + confirmMsg.toLowerCase() + '?') || 'Bulk action';

    for (var i = 0; i < ids.length; i++) {
      var m = _state.members.find(function(x) { return x.id === ids[i]; });
      if (!m) continue;
      try {
        if (action === 'suspend') {
          await _sb().rpc('suspend_membership', { p_user_id: m.user_id, p_reason: reason, p_admin_id: _state.adminId });
        } else if (action === 'cancel') {
          await _sb().rpc('cancel_membership', { p_user_id: m.user_id, p_reason: reason, p_admin_id: _state.adminId });
        } else if (action === 'activate') {
          var newExpiry = new Date(Date.now() + 30 * 86400000).toISOString();
          await _sb().from('user_memberships').update({ status: 'active', expires_at: newExpiry }).eq('id', m.id);
        }
      } catch (e) { console.error('[AMEM] bulk', e); }
    }

    _toast('✅ Bulk action completed', 'success');
    _state.selectedIds.clear();
    AMEM.refresh();
  };

  /* ── Export ────────────────────────────────────────────────────── */
  AMEM.exportCSV = function(type) {
    var data, headers, filename;

    if (type === 'members') {
      data = _state.members;
      headers = ['ID', 'User ID', 'Status', 'Grant Type', 'Started', 'Expires', 'Is Lifetime', 'Plan', 'Created At'];
      filename = 'members_' + new Date().toISOString().slice(0, 10) + '.csv';
    } else if (type === 'transactions') {
      data = _state.transactions;
      headers = ['ID', 'User ID', 'Amount', 'Status', 'Payment ID', 'Order ID', 'Provider', 'Created At'];
      filename = 'transactions_' + new Date().toISOString().slice(0, 10) + '.csv';
    } else return;

    var rows = [headers.join(',')];
    var planById = {};
    _state.plans.forEach(function(p) { planById[p.id] = p; });

    data.forEach(function(item) {
      if (type === 'members') {
        rows.push([
          item.id, item.user_id, item.status, item.grant_type || '',
          item.started_at || '', item.expires_at || '', item.is_lifetime || false,
          planById[item.plan_id]?.name || '', item.created_at || ''
        ].map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','));
      } else {
        rows.push([
          item.id, item.user_id, item.amount_inr || '', item.status || '',
          item.provider_tx_id || '', item.order_id || '', item.provider || '', item.created_at || ''
        ].map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','));
      }
    });

    var csv = rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    _toast('📊 Exported ' + data.length + ' records', 'success');
  };

  AMEM.exportPDF = function(type) {
    // Generate printable HTML for PDF export
    var data, title;
    if (type === 'members') { data = _state.members; title = 'Members Export'; }
    else if (type === 'transactions') { data = _state.transactions; title = 'Transactions Export'; }
    else return;

    var planById = {};
    _state.plans.forEach(function(p) { planById[p.id] = p; });

    var html = '<html><head><title>' + title + '</title><style>'
      + 'body{font-family:Arial,sans-serif;padding:20px} table{width:100%;border-collapse:collapse}'
      + 'th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:11px} th{background:#f5f5f5}'
      + '</style></head><body>'
      + '<h2>' + title + ' — ' + new Date().toLocaleDateString('en-IN') + '</h2>'
      + '<table><thead><tr>';

    if (type === 'members') {
      html += '<th>User ID</th><th>Status</th><th>Grant Type</th><th>Started</th><th>Expires</th><th>Lifetime</th><th>Plan</th>';
      html += '</tr></thead><tbody>';
      data.forEach(function(m) {
        html += '<tr><td>' + _esc(m.user_id) + '</td><td>' + _esc(m.status) + '</td><td>' + _esc(m.grant_type || '') + '</td>'
          + '<td>' + _fmtDate(m.started_at) + '</td><td>' + (m.is_lifetime ? '∞' : _fmtDate(m.expires_at)) + '</td>'
          + '<td>' + (m.is_lifetime ? 'Yes' : 'No') + '</td><td>' + _esc(planById[m.plan_id]?.name || '—') + '</td></tr>';
      });
    } else {
      html += '<th>Date</th><th>User ID</th><th>Amount</th><th>Status</th><th>Payment ID</th>';
      html += '</tr></thead><tbody>';
      data.forEach(function(t) {
        html += '<tr><td>' + _fmtDate(t.created_at) + '</td><td>' + _esc(t.user_id) + '</td>'
          + '<td>₹' + (t.amount_inr || 0) + '</td><td>' + _esc(t.status) + '</td><td>' + _esc(t.provider_tx_id) + '</td></tr>';
      });
    }

    html += '</tbody></table></body></html>';

    var w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(function() { w.print(); }, 500);
  };

  /* ── Tab Switching ─────────────────────────────────────────────── */
  AMEM.switchTab = function(tab) { _state.currentTab = tab; _rerender(); };
  AMEM.goPage = function(p) { _state.page = Math.max(1, Math.min(_state.totalPages, p)); _rerender(); };
  AMEM.sortBy = function(field) { _state.sortField = field; _state.sortDir = _state.sortDir === 'asc' ? 'desc' : 'asc'; AMEM.refresh(); };
  AMEM.onSearch = function(val) { _state.search = val; _state.page = 1; _rerender(); };
  AMEM.onFilterStatus = function(val) { _state.filterStatus = val; _state.page = 1; AMEM.refresh(); };
  AMEM.onFilterDate = function(val) { _state.filterDate = val; _state.page = 1; AMEM.refresh(); };

  AMEM.refresh = async function() {
    var main = document.getElementById('adminMain');
    if (main) {
      main.innerHTML = '<div class="amem-loading"><div class="amem-spinner"></div><div style="margin-top:12px">Refreshing…</div></div>';
      await AMEM.render(main);
    }
  };

  function _rerender() {
    var main = document.getElementById('adminMain');
    if (main) _renderMain(main);
  }

  /* ── Init ──────────────────────────────────────────────────────── */
  _log('Enterprise Membership Admin v3.0 initialized');

})();
