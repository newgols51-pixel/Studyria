/* ══════════════════════════════════════════════════════════════════
 * STUDYRIA — Enterprise Membership Admin Panel v3.0
 * ══════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ── CSS ────────────────────────────────────────────────────── */
(function () {
  var css = [
    '.amem-wrap{padding:0 0 24px}',
    '.amem-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:18px}',
    '.amem-search{flex:1;min-width:200px;padding:9px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#e4e8f0;font-size:.82rem;outline:none}',
    '.amem-search:focus{border-color:rgba(251,191,36,0.4)}',
    '.amem-select{padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#e4e8f0;font-size:.78rem;cursor:pointer}',
    '.amem-select option{background:#1a1d28}',
    '.amem-btn{padding:8px 16px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#e4e8f0;font-size:.76rem;cursor:pointer;transition:all .2s;white-space:nowrap}',
    '.amem-btn:hover{background:rgba(255,255,255,0.1)}',
    '.amem-btn.primary{border-color:rgba(251,191,36,0.3);color:#fbbf24;background:rgba(251,191,36,0.08)}',
    '.amem-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:22px}',
    '.amem-stat{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px}',
    '.amem-stat-val{font-size:1.4rem;font-weight:900;color:#fbbf24}',
    '.amem-stat-label{font-size:.66rem;color:rgba(255,255,255,0.45);margin-top:3px}',
    '.amem-table-wrap{overflow-x:auto;border-radius:12px;border:1px solid rgba(255,255,255,0.08)}',
    '.amem-table{width:100%;border-collapse:collapse;font-size:.78rem}',
    '.amem-table th{padding:10px 12px;text-align:left;font-size:.65rem;font-weight:700;letter-spacing:.05em;color:rgba(255,255,255,0.4);background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;user-select:none}',
    '.amem-table th:hover{color:rgba(255,255,255,0.6)}',
    '.amem-table td{padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(255,255,255,0.8);vertical-align:middle}',
    '.amem-table tr:last-child td{border-bottom:none}',
    '.amem-table tr:hover td{background:rgba(61,142,248,0.03)}',
    '.amem-badge{display:inline-flex;align-items:center;padding:3px 8px;border-radius:20px;font-size:.62rem;font-weight:700}',
    '.amem-badge-active{background:rgba(16,217,142,0.12);color:#10d98e;border:1px solid rgba(16,217,142,0.25)}',
    '.amem-badge-expired{background:rgba(255,77,109,0.12);color:#ff4d6d;border:1px solid rgba(255,77,109,0.25)}',
    '.amem-badge-trial{background:rgba(245,158,11,0.12);color:#fbbf24;border:1px solid rgba(245,158,11,0.25)}',
    '.amem-badge-lifetime{background:rgba(168,85,247,0.12);color:#a855f7;border:1px solid rgba(168,85,247,0.25)}',
    '.amem-badge-manual{background:rgba(59,130,246,0.12);color:#3b82f6;border:1px solid rgba(59,130,246,0.25)}',
    '.amem-badge-suspended{background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.25)}',
    '.amem-badge-cancelled{background:rgba(107,114,128,0.12);color:#6b7280;border:1px solid rgba(107,114,128,0.25)}',
    '.amem-badge-none{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.4);border:1px solid rgba(255,255,255,0.1)}',
    '.amem-action-btn{padding:4px 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);font-size:.68rem;cursor:pointer;transition:all .2s;margin:2px}',
    '.amem-action-btn:hover{background:rgba(255,255,255,0.1)}',
    '.amem-action-btn.approve{border-color:rgba(16,217,142,0.3);color:#10d98e;background:rgba(16,217,142,0.08)}',
    '.amem-action-btn.deactivate{border-color:rgba(255,77,109,0.3);color:#ff4d6d;background:rgba(255,77,109,0.08)}',
    '.amem-action-btn.warning{border-color:rgba(245,158,11,0.3);color:#fbbf24;background:rgba(245,158,11,0.08)}',
    '.amem-action-btn.info{border-color:rgba(59,130,246,0.3);color:#3b82f6;background:rgba(59,130,246,0.08)}',
    '.amem-empty{text-align:center;padding:40px 20px;color:rgba(255,255,255,0.35);font-size:.85rem}',
    '.amem-section-title{font-size:1rem;font-weight:800;color:#e4e8f0;margin:20px 0 12px;display:flex;align-items:center;gap:8px}',
    '.amem-pagination{display:flex;gap:6px;align-items:center;justify-content:center;margin-top:16px}',
    '.amem-pagination button{padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.6);font-size:.74rem;cursor:pointer}',
    '.amem-pagination button.active{background:rgba(251,191,36,0.12);border-color:rgba(251,191,36,0.3);color:#fbbf24}',
    '.amem-pagination button:disabled{opacity:.3;cursor:not-allowed}',
    '.amem-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px}',
    '.amem-modal{background:#1a1d28;border:1px solid rgba(255,255,255,0.12);border-radius:18px;padding:28px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;position:relative}',
    '.amem-modal h3{font-size:1.1rem;font-weight:800;color:#fbbf24;margin-bottom:18px}',
    '.amem-modal label{display:block;font-size:.7rem;font-weight:600;color:rgba(255,255,255,0.5);margin-bottom:4px;margin-top:12px}',
    '.amem-modal input,.amem-modal select,.amem-modal textarea{width:100%;padding:9px 12px;border-radius:9px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:#e4e8f0;font-size:.8rem;outline:none}',
    '.amem-modal textarea{resize:vertical;min-height:60px}',
    '.amem-modal-actions{display:flex;gap:10px;margin-top:22px}',
    '.amem-drawer{position:fixed;top:0;right:0;width:420px;max-width:90vw;height:100vh;background:#1a1d28;border-left:1px solid rgba(255,255,255,0.12);z-index:10001;overflow-y:auto;transform:translateX(420px);transition:transform .3s;padding:24px}',
    '.amem-drawer.open{transform:translateX(0)}',
    '.amem-detail-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:.78rem}',
    '.amem-detail-label{color:rgba(255,255,255,0.4)}',
    '.amem-detail-val{color:#e4e8f0;font-weight:600}',
    '.amem-check{display:flex;align-items:center;gap:6px;padding:4px 0}',
    '.amem-check input{width:auto}',
    '.amem-tab-row{display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap}',
    '.amem-tab{padding:6px 14px;border-radius:8px;font-size:.72rem;cursor:pointer;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.5);transition:all .2s}',
    '.amem-tab.active{background:rgba(251,191,36,0.1);border-color:rgba(251,191,36,0.3);color:#fbbf24}',
    '.amem-bulk-bar{display:flex;gap:8px;align-items:center;padding:10px 14px;background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.15);border-radius:10px;margin-bottom:12px}',
    '.amem-spinner{width:16px;height:16px;border:2px solid rgba(251,191,36,0.2);border-top-color:#fbbf24;border-radius:50%;animation:amem-spin .6s linear infinite}',
    '@keyframes amem-spin{to{transform:rotate(360deg)}}',
    '.amem-close{position:absolute;top:16px;right:16px;width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.5);font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center}'
  ].join('\n');
  var s = document.createElement('style');
  s.id = 'amem-enterprise-css';
  if (!document.getElementById(s.id)) { document.head.appendChild(s); s.textContent = css; }
})();

/* ── State ──────────────────────────────────────────────────── */
var _es = {
  page: 0, perPage: 20, sortBy: 'created_at', sortDir: 'desc',
  filter: 'all', search: '', dateFilter: 'all',
  members: [], plans: [], transactions: [], history: [],
  selected: new Set(), loading: false, activeTab: 'members',
  stats: {}, planById: {}
};

/* ── Helpers ────────────────────────────────────────────────── */
function _esc(s) { return String(s || '').replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function _fmtDate(d) { if (!d) return '\u2014'; try { return new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); } catch(_) { return '\u2014'; } }
function _daysLeft(expires_at) { if (!expires_at) return 99999; var diff = new Date(expires_at).getTime() - Date.now(); return Math.max(0, Math.ceil(diff / 86400000)); }
function _shortId(id) { return id ? _esc(String(id).slice(0, 8)) + '&hellip;' : '\u2014'; }
function _toast(msg, type) { if (typeof window.showToast === 'function') window.showToast(msg, type || 'info'); }
function _statusBadge(status, expires_at) {
  var isExpired = (status === 'active' || status === 'trial') && expires_at && new Date(expires_at).getTime() <= Date.now();
  var s = isExpired ? 'expired' : (status || 'none');
  var cls = { active:'amem-badge-active', expired:'amem-badge-expired', trial:'amem-badge-trial', lifetime:'amem-badge-lifetime', manual:'amem-badge-manual', suspended:'amem-badge-suspended', cancelled:'amem-badge-cancelled', pending:'amem-badge-none', none:'amem-badge-none' };
  var labels = { active:'Active', expired:'Expired', trial:'Trial', lifetime:'Lifetime', manual:'Manual', suspended:'Suspended', cancelled:'Cancelled', pending:'Pending', none:'None' };
  return '<span class="amem-badge ' + (cls[s] || cls.none) + '">' + (labels[s] || s) + '</span>';
}
function _statCard(val, label, color) { return '<div class="amem-stat"><div class="amem-stat-val" style="color:' + color + '">' + val + '</div><div class="amem-stat-label">' + label + '</div></div>'; }
function _adminUid() { return (window.currentUser || {}).id || null; }

/* ── Insert audit/history/notification (non-fatal) ──────────── */
async function _audit(client, table, data) {
  try { await client.from(table).insert(data); } catch (_) {}
}

/* ── Load data from Supabase ────────────────────────────────── */
async function _loadData(client) {
  _es.loading = true;
  var results = await Promise.allSettled([
    client.from('user_memberships').select('id,user_id,plan_id,status,started_at,expires_at,created_at,updated_at,renewed_at,granted_by,grant_reason,admin_notes').order('created_at', { ascending: false }).limit(500),
    client.from('membership_transactions').select('id,user_id,membership_id,provider_tx_id,amount_inr,status,created_at,notes,razorpay_payment_id,razorpay_order_id,payment_method,verified_at,refund_status').order('created_at', { ascending: false }).limit(200),
    client.from('membership_plans').select('id,slug,name,price_inr,duration_days,is_lifetime,is_trial').order('sort_order', { ascending: true }),
    client.from('membership_history').select('id,membership_id,user_id,action,old_status,new_status,old_expires_at,new_expires_at,plan_id,changed_by,reason,created_at').order('created_at', { ascending: false }).limit(100)
  ]);
  var memRes = results[0].status === 'fulfilled' ? results[0].value : { data: [], error: results[0].reason };
  if (memRes.error) throw new Error(memRes.error.message);
  _es.members = memRes.data || [];
  _es.transactions = (results[1].status === 'fulfilled' && results[1].value.data) ? results[1].value.data : [];
  _es.plans = (results[2].status === 'fulfilled' && results[2].value.data) ? results[2].value.data : [];
  _es.history = (results[3].status === 'fulfilled' && results[3].value.data) ? results[3].value.data : [];
  _es.plans.forEach(function (p) { _es.planById[p.id] = p; });
  var now = Date.now();
  _es.stats = {
    total: _es.members.length,
    active: _es.members.filter(function (m) { return ['active','trial','manual'].indexOf(m.status) > -1 && m.expires_at && new Date(m.expires_at).getTime() > now; }).length,
    expired: _es.members.filter(function (m) { return m.status === 'expired' || ((m.status === 'active'||m.status === 'trial') && m.expires_at && new Date(m.expires_at).getTime() <= now); }).length,
    suspended: _es.members.filter(function (m) { return m.status === 'suspended'; }).length,
    lifetime: _es.members.filter(function (m) { return m.status === 'lifetime'; }).length,
    trial: _es.members.filter(function (m) { return m.status === 'trial'; }).length,
    manual: _es.members.filter(function (m) { return m.status === 'manual'; }).length,
    totalRevenue: _es.transactions.filter(function (t) { return t.status === 'completed' || t.status === 'success'; }).reduce(function (s, t) { return s + (Number(t.amount_inr) || 0); }, 0),
    monthRevenue: _es.transactions.filter(function (t) { return (t.status === 'completed' || t.status === 'success') && new Date(t.created_at).getTime() >= now - 30*86400000; }).reduce(function (s, t) { return s + (Number(t.amount_inr) || 0); }, 0),
    todayRevenue: _es.transactions.filter(function (t) { return (t.status === 'completed' || t.status === 'success') && new Date(t.created_at).getTime() >= now - 86400000; }).reduce(function (s, t) { return s + (Number(t.amount_inr) || 0); }, 0),
    expiringToday: _es.members.filter(function (m) { var d = _daysLeft(m.expires_at); return d >= 0 && d <= 1 && m.status !== 'lifetime'; }).length,
    expiringSoon: _es.members.filter(function (m) { var d = _daysLeft(m.expires_at); return d > 0 && d <= 7 && m.status !== 'lifetime'; }).length
  };
  _es.loading = false;
}

/* ── Filtered + paginated members ───────────────────────────── */
function _getFilteredMembers() {
  var list = _es.members.slice();
  if (_es.filter !== 'all') {
    var now = Date.now();
    list = list.filter(function (m) {
      if (_es.filter === 'active') return ['active','trial','manual'].indexOf(m.status) > -1 && m.expires_at && new Date(m.expires_at).getTime() > now;
      if (_es.filter === 'expired') return m.status === 'expired' || ((m.status === 'active'||m.status === 'trial') && m.expires_at && new Date(m.expires_at).getTime() <= now);
      if (_es.filter === 'suspended') return m.status === 'suspended';
      if (_es.filter === 'lifetime') return m.status === 'lifetime';
      if (_es.filter === 'trial') return m.status === 'trial';
      if (_es.filter === 'manual') return m.status === 'manual';
      if (_es.filter === 'cancelled') return m.status === 'cancelled';
      return true;
    });
  }
  if (_es.search) {
    var q = _es.search.toLowerCase();
    list = list.filter(function (m) {
      var txMatch = _es.transactions.some(function (t) { return t.user_id === m.user_id && ((t.provider_tx_id && t.provider_tx_id.toLowerCase().indexOf(q) > -1) || (t.razorpay_order_id && t.razorpay_order_id.toLowerCase().indexOf(q) > -1) || (t.razorpay_payment_id && t.razorpay_payment_id.toLowerCase().indexOf(q) > -1)); });
      return (m.user_id && m.user_id.toLowerCase().indexOf(q) > -1) || (m.id && m.id.toLowerCase().indexOf(q) > -1) || txMatch;
    });
  }
  if (_es.dateFilter !== 'all') {
    var days = _es.dateFilter === 'today' ? 1 : _es.dateFilter === '7d' ? 7 : _es.dateFilter === '30d' ? 30 : 0;
    if (days > 0) { var cutoff = Date.now() - days*86400000; list = list.filter(function (m) { return new Date(m.created_at).getTime() >= cutoff; }); }
  }
  list.sort(function (a, b) {
    var va = a[_es.sortBy], vb = b[_es.sortBy];
    if (!va && !vb) return 0; if (!va) return 1; if (!vb) return -1;
    if (va < vb) return _es.sortDir === 'asc' ? -1 : 1;
    if (va > vb) return _es.sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  return list;
}

/* ── Render panel ───────────────────────────────────────────── */
function _renderPanel(container) {
  var h = '<div class="amem-wrap">';
  h += '<div class="amem-tab-row">';
  h += '<div class="amem-tab ' + (_es.activeTab === 'members' ? 'active' : '') + '" onclick="_amemTab(\'members\')">\uD83D\uDC65 Members</div>';
  h += '<div class="amem-tab ' + (_es.activeTab === 'transactions' ? 'active' : '') + '" onclick="_amemTab(\'transactions\')">\uD83D\uDCB3 Transactions</div>';
  h += '<div class="amem-tab ' + (_es.activeTab === 'history' ? 'active' : '') + '" onclick="_amemTab(\'history\')">\uD83D\uDCDC History</div>';
  h += '<div class="amem-tab ' + (_es.activeTab === 'audit' ? 'active' : '') + '" onclick="_amemTab(\'audit\')">\uD83D\uDD0D Audit</div>';
  h += '</div>';
  if (_es.activeTab === 'members') h += _renderMembersTab();
  else if (_es.activeTab === 'transactions') h += _renderTransactionsTab();
  else if (_es.activeTab === 'history') h += _renderHistoryTab();
  else if (_es.activeTab === 'audit') h += _renderAuditTab();
  h += '</div>';
  container.innerHTML = h;
}

function _renderMembersTab() {
  var h = _renderStats();
  h += '<div class="amem-toolbar">';
  h += '<input class="amem-search" type="text" placeholder="\uD83D\uDD0D Search User ID, Payment ID, Order ID\u2026" value="' + _esc(_es.search) + '" oninput="_amemSearch(this.value)" />';
  h += '<select class="amem-select" onchange="_amemFilter(this.value)">';
  var opts = [['all','All Status'],['active','Active'],['expired','Expired'],['suspended','Suspended'],['lifetime','Lifetime'],['trial','Trial'],['manual','Manual'],['cancelled','Cancelled']];
  opts.forEach(function (o) { h += '<option value="' + o[0] + '"' + (_es.filter === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
  h += '</select>';
  h += '<select class="amem-select" onchange="_amemDateFilter(this.value)">';
  var dOpts = [['all','All Time'],['today','Today'],['7d','Last 7 Days'],['30d','Last 30 Days']];
  dOpts.forEach(function (o) { h += '<option value="' + o[0] + '"' + (_es.dateFilter === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
  h += '</select>';
  h += '<button class="amem-btn primary" onclick="_amemOpenGrant()">\uD83D\uDC51 Grant</button>';
  h += '<button class="amem-btn" onclick="_amemExportCSV()">\uD83D\uDCE5 Export</button>';
  h += '<button class="amem-btn" onclick="window.renderAdminMemberships(document.getElementById(\'adminMain\'))">\u21BB</button>';
  h += '</div>';
  if (_es.selected.size > 0) {
    h += '<div class="amem-bulk-bar"><span style="font-size:.76rem;color:#fbbf24">' + _es.selected.size + ' selected</span>';
    h += '<button class="amem-action-btn approve" onclick="_amemBulkActivate()">Activate All</button>';
    h += '<button class="amem-action-btn deactivate" onclick="_amemBulkSuspend()">Suspend All</button>';
    h += '<button class="amem-action-btn" onclick="_amemClearSelection()">Clear</button></div>';
  }
  var filtered = _getFilteredMembers();
  var totalPages = Math.ceil(filtered.length / _es.perPage);
  var pageMembers = filtered.slice(_es.page * _es.perPage, (_es.page + 1) * _es.perPage);
  if (!pageMembers.length) { h += '<div class="amem-empty">No members found.</div>'; }
  else {
    h += '<div class="amem-table-wrap"><table class="amem-table"><thead><tr>';
    h += '<th style="width:30px"><input type="checkbox" onchange="_amemToggleAll(this.checked)" /></th>';
    h += '<th onclick="_amemSort(\'user_id\')">User ID</th>';
    h += '<th onclick="_amemSort(\'plan_id\')">Plan</th>';
    h += '<th onclick="_amemSort(\'status\')">Status</th>';
    h += '<th onclick="_amemSort(\'started_at\')">Started</th>';
    h += '<th onclick="_amemSort(\'expires_at\')">Expires</th>';
    h += '<th>Days Left</th>';
    h += '<th>Actions</th>';
    h += '</tr></thead><tbody>';
    pageMembers.forEach(function (m) {
      var plan = _es.planById[m.plan_id] || {};
      var dl = _daysLeft(m.expires_at);
      var checked = _es.selected.has(m.id) ? 'checked' : '';
      h += '<tr><td><input type="checkbox" ' + checked + ' onchange="_amemToggle(\'' + _esc(m.id) + '\', this.checked)" /></td>';
      h += '<td><span title="' + _esc(m.user_id) + '" style="cursor:help;font-family:monospace;font-size:.7rem">' + _shortId(m.user_id) + '</span></td>';
      h += '<td>' + _esc(plan.name || 'Unknown') + '</td>';
      h += '<td>' + _statusBadge(m.status, m.expires_at) + '</td>';
      h += '<td>' + _fmtDate(m.started_at) + '</td>';
      h += '<td>' + (m.status === 'lifetime' ? '\u267E Never' : _fmtDate(m.expires_at)) + '</td>';
      h += '<td>' + (m.status === 'lifetime' ? '\u221E' : (dl > 0 ? '<span style="color:#10d98e;font-weight:700">' + dl + 'd</span>' : '<span style="color:#ff4d6d">0</span>')) + '</td>';
      h += '<td style="white-space:nowrap">';
      h += '<button class="amem-action-btn info" onclick="_amemViewProfile(\'' + _esc(m.id) + '\')">\uD83D\uDC41</button>';
      h += '<button class="amem-action-btn approve" onclick="_amemExtend(\'' + _esc(m.id) + '\')">+30d</button>';
      h += '<button class="amem-action-btn warning" onclick="_amemSuspend(\'' + _esc(m.id) + '\')">\u23F8</button>';
      h += '<button class="amem-action-btn deactivate" onclick="_amemCancel(\'' + _esc(m.id) + '\')">\u2715</button>';
      h += '</td></tr>';
    });
    h += '</tbody></table></div>';
    if (totalPages > 1) {
      h += '<div class="amem-pagination">';
      h += '<button onclick="_amemPage(' + Math.max(0, _es.page - 1) + ')" ' + (_es.page === 0 ? 'disabled' : '') + '>\u2190 Prev</button>';
      for (var i = 0; i < Math.min(totalPages, 10); i++) { h += '<button class="' + (i === _es.page ? 'active' : '') + '" onclick="_amemPage(' + i + ')">' + (i+1) + '</button>'; }
      h += '<button onclick="_amemPage(' + Math.min(totalPages-1, _es.page+1) + ')" ' + (_es.page >= totalPages-1 ? 'disabled' : '') + '>Next \u2192</button>';
      h += '<span style="margin-left:10px;font-size:.72rem;color:rgba(255,255,255,0.4)">' + filtered.length + ' total</span></div>';
    }
  }
  h += '<div class="amem-section-title" style="margin-top:28px">\u2B50 Premium Category Management</div>';
  h += '<div id="smci-admin-prem-cats-wrap"></div>';
  return h;
}

function _renderStats() {
  var s = _es.stats;
  return '<div class="amem-stats">'
    + _statCard(s.total, 'Total', '#fbbf24')
    + _statCard(s.active, 'Active', '#10d98e')
    + _statCard(s.expired, 'Expired', '#ff4d6d')
    + _statCard(s.suspended, 'Suspended', '#ef4444')
    + _statCard(s.lifetime, 'Lifetime', '#a855f7')
    + _statCard(s.trial, 'Trial', '#fbbf24')
    + _statCard(s.manual, 'Manual', '#3b82f6')
    + _statCard('\u20B9' + s.totalRevenue, 'Total Rev', '#10d98e')
    + _statCard('\u20B9' + s.monthRevenue, '30d Rev', '#60a5fa')
    + _statCard(s.expiringToday, 'Exp Today', '#ff4d6d')
    + _statCard(s.expiringSoon, 'Exp \u22647d', '#fbbf24')
    + '</div>';
}

function _renderTransactionsTab() {
  var txns = _es.transactions;
  if (!txns.length) return '<div class="amem-section-title">\uD83D\uDCB3 Transactions</div><div class="amem-empty">No transactions.</div>';
  var h = '<div class="amem-section-title">\uD83D\uDCB3 Transactions (' + txns.length + ')</div>';
  h += '<div class="amem-table-wrap"><table class="amem-table"><thead><tr><th>Date</th><th>User</th><th>Amount</th><th>Status</th><th>Method</th><th>Payment ID</th><th>Order ID</th><th>Refund</th></tr></thead><tbody>';
  txns.forEach(function (t) {
    h += '<tr><td>' + _fmtDate(t.created_at) + '</td>';
    h += '<td><span style="font-family:monospace;font-size:.7rem">' + _shortId(t.user_id) + '</span></td>';
    h += '<td style="color:#10d98e;font-weight:700">\u20B9' + (t.amount_inr || '\u2014') + '</td>';
    h += '<td>' + (t.status === 'completed' || t.status === 'success' ? '<span class="amem-badge amem-badge-active">Success</span>' : '<span class="amem-badge amem-badge-none">' + _esc(t.status) + '</span>') + '</td>';
    h += '<td>' + _esc(t.payment_method || 'razorpay') + '</td>';
    h += '<td style="font-family:monospace;font-size:.66rem;color:rgba(255,255,255,0.4)">' + _esc((t.razorpay_payment_id || t.provider_tx_id || '').slice(0, 20)) + '\u2026</td>';
    h += '<td style="font-family:monospace;font-size:.66rem;color:rgba(255,255,255,0.4)">' + _esc((t.razorpay_order_id || '').slice(0, 20)) + '\u2026</td>';
    h += '<td>' + (t.refund_status && t.refund_status !== 'none' ? '<span class="amem-badge amem-badge-expired">' + _esc(t.refund_status) + '</span>' : '\u2014') + '</td></tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

function _renderHistoryTab() {
  var hist = _es.history;
  if (!hist || !hist.length) return '<div class="amem-section-title">\uD83D\uDCDC History</div><div class="amem-empty">No history. Run SQL migration to create membership_history table.</div>';
  var h = '<div class="amem-section-title">\uD83D\uDCDC History (' + hist.length + ')</div>';
  h += '<div class="amem-table-wrap"><table class="amem-table"><thead><tr><th>Date</th><th>User</th><th>Action</th><th>Old</th><th>New</th><th>Old Expiry</th><th>New Expiry</th><th>Reason</th></tr></thead><tbody>';
  hist.forEach(function (r) {
    h += '<tr><td>' + _fmtDate(r.created_at) + '</td>';
    h += '<td>' + _shortId(r.user_id) + '</td>';
    h += '<td><span class="amem-badge amem-badge-active">' + _esc(r.action) + '</span></td>';
    h += '<td>' + _esc(r.old_status || '\u2014') + '</td>';
    h += '<td>' + _esc(r.new_status || '\u2014') + '</td>';
    h += '<td>' + _fmtDate(r.old_expires_at) + '</td>';
    h += '<td>' + _fmtDate(r.new_expires_at) + '</td>';
    h += '<td style="font-size:.72rem;color:rgba(255,255,255,0.5)">' + _esc(r.reason || '\u2014') + '</td></tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

function _renderAuditTab() {
  return '<div class="amem-section-title">\uD83D\uDD0D Audit Logs</div><div class="amem-empty">Audit logs stored in <code>membership_audit_logs</code>. Run enterprise SQL migration. Every admin action is logged with admin ID, target user, action, old/new values, reason, IP, timestamp.</div>';
}

/* ════════════════════════════════════════════════════════════
 * ACTIONS
 * ════════════════════════════════════════════════════════════ */
window._amemTab = function (tab) { _es.activeTab = tab; var main = document.getElementById('adminMain'); if (main) _renderPanel(main); };
var _searchTimer;
window._amemSearch = function (q) { _es.search = q; _es.page = 0; clearTimeout(_searchTimer); _searchTimer = setTimeout(function () { var main = document.getElementById('adminMain'); if (main) _renderPanel(main); }, 300); };
window._amemFilter = function (f) { _es.filter = f; _es.page = 0; var main = document.getElementById('adminMain'); if (main) _renderPanel(main); };
window._amemDateFilter = function (f) { _es.dateFilter = f; _es.page = 0; var main = document.getElementById('adminMain'); if (main) _renderPanel(main); };
window._amemSort = function (col) { _es.sortBy = col; _es.sortDir = _es.sortDir === 'asc' ? 'desc' : 'asc'; var main = document.getElementById('adminMain'); if (main) _renderPanel(main); };
window._amemPage = function (p) { _es.page = p; var main = document.getElementById('adminMain'); if (main) _renderPanel(main); };
window._amemToggle = function (id, checked) { if (checked) _es.selected.add(id); else _es.selected.delete(id); };
window._amemToggleAll = function (checked) { var f = _getFilteredMembers().slice(_es.page*_es.perPage, (_es.page+1)*_es.perPage); if (checked) f.forEach(function (m) { _es.selected.add(m.id); }); else f.forEach(function (m) { _es.selected.delete(m.id); }); var main = document.getElementById('adminMain'); if (main) _renderPanel(main); };
window._amemClearSelection = function () { _es.selected.clear(); var main = document.getElementById('adminMain'); if (main) _renderPanel(main); };

window._amemExtend = async function (id) {
  var client = window.supabaseClient; if (!client) return;
  try {
    var mem = _es.members.find(function (m) { return m.id === id; }); if (!mem) return;
    var baseDate = (mem.expires_at && new Date(mem.expires_at).getTime() > Date.now()) ? mem.expires_at : new Date().toISOString();
    var newExpiry = new Date(new Date(baseDate).getTime() + 30*86400000).toISOString();
    var res = await client.from('user_memberships').update({ status:'active', expires_at:newExpiry, renewed_at:new Date().toISOString() }).eq('id', id);
    if (res.error) throw new Error(res.error.message);
    await _audit(client, 'membership_history', { membership_id:id, user_id:mem.user_id, action:'extended', old_status:mem.status, new_status:'active', old_expires_at:mem.expires_at, new_expires_at:newExpiry, changed_by:_adminUid(), reason:'admin_extend_30d' });
    await _audit(client, 'membership_audit_logs', { admin_id:_adminUid(), target_user_id:mem.user_id, membership_id:id, action:'extend_30d', old_value:{expires_at:mem.expires_at}, new_value:{expires_at:newExpiry}, reason:'Admin extended 30 days' });
    await _audit(client, 'membership_notifications', { user_id:mem.user_id, notification_type:'membership_extended', title:'Membership Extended!', message:'Extended by 30 days. New expiry: ' + new Date(newExpiry).toLocaleDateString('en-IN'), related_membership_id:id });
    _toast('\u2705 Extended 30d', 'success');
    await _loadData(client); var main = document.getElementById('adminMain'); if (main) _renderPanel(main);
  } catch (e) { _toast('Error: ' + e.message, 'error'); }
};

window._amemSuspend = async function (id) {
  if (!confirm('Suspend this membership?')) return;
  var client = window.supabaseClient; if (!client) return;
  try {
    var mem = _es.members.find(function (m) { return m.id === id; });
    var res = await client.from('user_memberships').update({ status:'suspended' }).eq('id', id);
    if (res.error) throw new Error(res.error.message);
    await _audit(client, 'membership_history', { membership_id:id, user_id:mem.user_id, action:'suspended', old_status:mem.status, new_status:'suspended', old_expires_at:mem.expires_at, new_expires_at:mem.expires_at, changed_by:_adminUid(), reason:'admin_suspend' });
    await _audit(client, 'membership_audit_logs', { admin_id:_adminUid(), target_user_id:mem.user_id, membership_id:id, action:'suspend', old_value:{status:mem.status}, new_value:{status:'suspended'}, reason:'Admin suspended' });
    await _audit(client, 'membership_notifications', { user_id:mem.user_id, notification_type:'membership_suspended', title:'Membership Suspended', message:'Your Premium has been suspended. Contact support.', related_membership_id:id });
    _toast('\u23F8 Suspended', 'info');
    await _loadData(client); var main = document.getElementById('adminMain'); if (main) _renderPanel(main);
  } catch (e) { _toast('Error: ' + e.message, 'error'); }
};

window._amemCancel = async function (id) {
  if (!confirm('Cancel this membership permanently?')) return;
  var client = window.supabaseClient; if (!client) return;
  try {
    var mem = _es.members.find(function (m) { return m.id === id; });
    var res = await client.from('user_memberships').update({ status:'cancelled', cancelled_at:new Date().toISOString() }).eq('id', id);
    if (res.error) throw new Error(res.error.message);
    await _audit(client, 'membership_history', { membership_id:id, user_id:mem.user_id, action:'cancelled', old_status:mem.status, new_status:'cancelled', old_expires_at:mem.expires_at, new_expires_at:mem.expires_at, changed_by:_adminUid(), reason:'admin_cancel' });
    await _audit(client, 'membership_audit_logs', { admin_id:_adminUid(), target_user_id:mem.user_id, membership_id:id, action:'cancel', old_value:{status:mem.status}, new_value:{status:'cancelled'}, reason:'Admin cancelled' });
    _toast('\u2715 Cancelled', 'info');
    await _loadData(client); var main = document.getElementById('adminMain'); if (main) _renderPanel(main);
  } catch (e) { _toast('Error: ' + e.message, 'error'); }
};

window._amemBulkActivate = async function () {
  if (!confirm('Activate ' + _es.selected.size + ' memberships for 30d?')) return;
  var client = window.supabaseClient; if (!client) return;
  var ids = Array.from(_es.selected); var newExpiry = new Date(Date.now()+30*86400000).toISOString();
  try { for (var i = 0; i < ids.length; i++) { await client.from('user_memberships').update({status:'active',expires_at:newExpiry}).eq('id',ids[i]); }
    _toast('\u2705 Activated ' + ids.length, 'success'); _es.selected.clear();
    await _loadData(client); var main = document.getElementById('adminMain'); if (main) _renderPanel(main);
  } catch (e) { _toast('Error: ' + e.message, 'error'); }
};
window._amemBulkSuspend = async function () {
  if (!confirm('Suspend ' + _es.selected.size + ' memberships?')) return;
  var client = window.supabaseClient; if (!client) return;
  var ids = Array.from(_es.selected);
  try { for (var i = 0; i < ids.length; i++) { await client.from('user_memberships').update({status:'suspended'}).eq('id',ids[i]); }
    _toast('\u23F8 Suspended ' + ids.length, 'info'); _es.selected.clear();
    await _loadData(client); var main = document.getElementById('adminMain'); if (main) _renderPanel(main);
  } catch (e) { _toast('Error: ' + e.message, 'error'); }
};

window._amemExportCSV = function () {
  var filtered = _getFilteredMembers();
  var rows = [['User ID','Plan','Status','Started','Expires','Days Left','Created']];
  filtered.forEach(function (m) { var p = _es.planById[m.plan_id] || {}; rows.push([m.user_id, p.name||'Unknown', m.status, m.started_at, m.expires_at, _daysLeft(m.expires_at), m.created_at]); });
  var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c||'').replace(/"/g,'""') + '"'; }).join(','); }).join('\n');
  var blob = new Blob([csv], {type:'text/csv'}); var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'studyria-members-' + new Date().toISOString().slice(0,10) + '.csv'; a.click();
  _toast('\uD83D\uDCE5 Exported ' + filtered.length + ' members', 'success');
};

/* ── Grant modal ───────────────────────────────────────────── */
window._amemOpenGrant = function () {
  var planOpts = _es.plans.map(function (p) { return '<option value="' + p.id + '" data-days="' + (p.duration_days||0) + '" data-lifetime="' + (!!p.is_lifetime) + '">' + _esc(p.name) + ' (' + (p.is_lifetime ? 'Lifetime' : (p.duration_days||0)+'d') + ')</option>'; }).join('');
  var h = '<div class="amem-modal-bg" id="amem-grant-modal" onclick="if(event.target===this)_amemCloseGrant()"><div class="amem-modal">';
  h += '<button class="amem-close" onclick="_amemCloseGrant()">\u2715</button>';
  h += '<h3>\uD83D\uDC51 Grant Membership</h3>';
  h += '<label>User ID (UUID)</label><input type="text" id="amem-grant-user" placeholder="Paste user UUID\u2026" />';
  h += '<label>Plan</label><select id="amem-grant-plan">' + planOpts + '<option value="custom">\u2699 Custom\u2026</option></select>';
  h += '<div id="amem-grant-custom" style="display:none"><label>Custom Duration (days)</label><input type="number" id="amem-grant-days" placeholder="45" min="1" /><label>Custom Name</label><input type="text" id="amem-grant-name" placeholder="Special Promo" /></div>';
  h += '<label>Lifetime</label><div class="amem-check"><input type="checkbox" id="amem-grant-lifetime" onchange="document.getElementById(\'amem-grant-expires\').disabled=this.checked" /> <span style="font-size:.76rem;color:rgba(255,255,255,0.6)">Never expires</span></div>';
  h += '<label>Expiry (empty = plan default)</label><input type="datetime-local" id="amem-grant-expires" />';
  h += '<label>Reason</label><input type="text" id="amem-grant-reason" placeholder="Promo, Support\u2026" />';
  h += '<label>Notes</label><textarea id="amem-grant-notes" placeholder="Internal notes"></textarea>';
  h += '<div class="amem-modal-actions"><button class="amem-btn primary" onclick="_amemSubmitGrant()">\u2705 Grant</button><button class="amem-btn" onclick="_amemCloseGrant()">Cancel</button></div>';
  h += '</div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
  document.getElementById('amem-grant-plan').addEventListener('change', function () { document.getElementById('amem-grant-custom').style.display = this.value === 'custom' ? 'block' : 'none'; });
};
window._amemCloseGrant = function () { var m = document.getElementById('amem-grant-modal'); if (m) m.remove(); };

window._amemSubmitGrant = async function () {
  var client = window.supabaseClient; if (!client) return;
  var userId = document.getElementById('amem-grant-user').value.trim();
  var planId = document.getElementById('amem-grant-plan').value;
  var isLifetime = document.getElementById('amem-grant-lifetime').checked;
  var customDays = parseInt(document.getElementById('amem-grant-days').value) || 0;
  var expiresInput = document.getElementById('amem-grant-expires').value;
  var reason = document.getElementById('amem-grant-reason').value.trim() || 'admin_grant';
  var notes = document.getElementById('amem-grant-notes').value.trim();
  if (!userId) { _toast('Enter user UUID', 'error'); return; }
  if (userId.indexOf('@') > -1 && userId.indexOf('-') === -1) { _toast('Paste user UUID, not email', 'error'); return; }
  var durationDays = 0, actualPlanId = planId;
  if (planId === 'custom') { if (!customDays && !isLifetime) { _toast('Enter duration or lifetime', 'error'); return; } durationDays = customDays; actualPlanId = _es.plans.length > 0 ? _es.plans[0].id : null; }
  else { var plan = _es.plans.find(function (p) { return p.id === planId; }); durationDays = plan ? plan.duration_days : 30; if (plan && plan.is_lifetime) isLifetime = true; }
  var now = new Date().toISOString();
  var expiresAt = isLifetime ? null : (expiresInput ? new Date(expiresInput).toISOString() : new Date(Date.now()+durationDays*86400000).toISOString());
  try {
    var existing = await client.from('user_memberships').select('id,status,expires_at').eq('user_id', userId).order('expires_at',{ascending:false}).limit(1).maybeSingle();
    var existingMem = (!existing.error && existing.data) ? existing.data : null;
    var membershipId;
    if (existingMem) {
      var updData = { status: isLifetime?'lifetime':'active', plan_id: actualPlanId, auto_renew: false, granted_by: _adminUid(), grant_reason: reason, admin_notes: notes };
      if (!isLifetime) updData.expires_at = expiresAt; else updData.expires_at = null;
      if (!existingMem.expires_at || new Date(existingMem.expires_at) <= new Date(now) || existingMem.status !== 'active') updData.started_at = now;
      var updRes = await client.from('user_memberships').update(updData).eq('id', existingMem.id).select('id').single();
      if (updRes.error) throw new Error(updRes.error.message); membershipId = updRes.data.id;
    } else {
      var insData = { user_id: userId, plan_id: actualPlanId, status: isLifetime?'lifetime':'active', started_at: now, auto_renew: false, granted_by: _adminUid(), grant_reason: reason, admin_notes: notes };
      if (!isLifetime) insData.expires_at = expiresAt;
      var insRes = await client.from('user_memberships').insert(insData).select('id').single();
      if (insRes.error) throw new Error(insRes.error.message); membershipId = insRes.data.id;
    }
    await _audit(client, 'membership_history', { membership_id:membershipId, user_id:userId, action:'granted', old_status:existingMem?existingMem.status:null, new_status:isLifetime?'lifetime':'active', old_expires_at:existingMem?existingMem.expires_at:null, new_expires_at:expiresAt, plan_id:actualPlanId, changed_by:_adminUid(), reason:reason });
    await _audit(client, 'membership_manual_grants', { admin_id:_adminUid(), user_id:userId, plan_id:actualPlanId, membership_id:membershipId, duration_days:durationDays, started_at:now, expires_at:expiresAt, reason:reason, notes:notes });
    await _audit(client, 'membership_audit_logs', { admin_id:_adminUid(), target_user_id:userId, membership_id:membershipId, action:'manual_grant', old_value:existingMem?{status:existingMem.status,expires_at:existingMem.expires_at}:null, new_value:{status:isLifetime?'lifetime':'active',expires_at:expiresAt,plan_id:actualPlanId}, reason:reason });
    await _audit(client, 'membership_notifications', { user_id:userId, notification_type:'manual_grant', title:'Premium Granted!', message:'You received ' + (isLifetime?'Lifetime Premium':'Premium') + (isLifetime?'':' until '+new Date(expiresAt).toLocaleDateString('en-IN')), related_membership_id:membershipId });
    _amemCloseGrant(); _toast('\u2705 Granted', 'success');
    await _loadData(client); var main = document.getElementById('adminMain'); if (main) _renderPanel(main);
  } catch (e) { _toast('Error: ' + e.message, 'error'); }
};

/* ── Profile drawer ─────────────────────────────────────────── */
window._amemViewProfile = function (id) {
  var mem = _es.members.find(function (m) { return m.id === id; }); if (!mem) return;
  var plan = _es.planById[mem.plan_id] || {};
  var userTxns = _es.transactions.filter(function (t) { return t.user_id === mem.user_id; });
  var userHist = _es.history.filter(function (h) { return h.user_id === mem.user_id; });
  var dl = _daysLeft(mem.expires_at);
  var h = '<div class="amem-drawer open" id="amem-drawer"><button class="amem-close" onclick="_amemCloseDrawer()">\u2715</button><h3>\uD83D\uDC64 Member Profile</h3>';
  h += '<div class="amem-detail-row"><span class="amem-detail-label">User ID</span><span class="amem-detail-val" style="font-family:monospace;font-size:.7rem">' + _esc(mem.user_id) + '</span></div>';
  h += '<div class="amem-detail-row"><span class="amem-detail-label">Plan</span><span class="amem-detail-val">' + _esc(plan.name||'Unknown') + '</span></div>';
  h += '<div class="amem-detail-row"><span class="amem-detail-label">Status</span><span class="amem-detail-val">' + _statusBadge(mem.status, mem.expires_at) + '</span></div>';
  h += '<div class="amem-detail-row"><span class="amem-detail-label">Started</span><span class="amem-detail-val">' + _fmtDate(mem.started_at) + '</span></div>';
  h += '<div class="amem-detail-row"><span class="amem-detail-label">Expires</span><span class="amem-detail-val">' + (mem.status==='lifetime'?'\u267E Never':_fmtDate(mem.expires_at)) + '</span></div>';
  h += '<div class="amem-detail-row"><span class="amem-detail-label">Days Left</span><span class="amem-detail-val">' + (mem.status==='lifetime'?'\u221E':dl+'d') + '</span></div>';
  h += '<div class="amem-detail-row"><span class="amem-detail-label">Renewed</span><span class="amem-detail-val">' + _fmtDate(mem.renewed_at) + '</span></div>';
  h += '<div class="amem-detail-row"><span class="amem-detail-label">Grant Reason</span><span class="amem-detail-val">' + _esc(mem.grant_reason||'\u2014') + '</span></div>';
  h += '<div class="amem-detail-row"><span class="amem-detail-label">Notes</span><span class="amem-detail-val">' + _esc(mem.admin_notes||'\u2014') + '</span></div>';
  h += '<div style="margin-top:16px"><h4 style="color:#fbbf24;font-size:.82rem;margin-bottom:8px">\uD83D\uDCB3 Transactions (' + userTxns.length + ')</h4>';
  if (userTxns.length) {
    h += '<div class="amem-table-wrap" style="max-height:200px;overflow-y:auto"><table class="amem-table"><thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>';
    userTxns.forEach(function (t) { h += '<tr><td>' + _fmtDate(t.created_at) + '</td><td>\u20B9' + (t.amount_inr||'\u2014') + '</td><td>' + _esc(t.status) + '</td></tr>'; });
    h += '</tbody></table></div>';
  } else { h += '<div style="color:rgba(255,255,255,0.3);font-size:.76rem;padding:10px 0">None</div>'; }
  h += '</div><div style="margin-top:16px"><h4 style="color:#fbbf24;font-size:.82rem;margin-bottom:8px">\uD83D\uDCDC History (' + userHist.length + ')</h4>';
  if (userHist.length) {
    h += '<div class="amem-table-wrap" style="max-height:200px;overflow-y:auto"><table class="amem-table"><thead><tr><th>Date</th><th>Action</th><th>Reason</th></tr></thead><tbody>';
    userHist.forEach(function (r) { h += '<tr><td>' + _fmtDate(r.created_at) + '</td><td>' + _esc(r.action) + '</td><td style="font-size:.72rem">' + _esc(r.reason||'\u2014') + '</td></tr>'; });
    h += '</tbody></table></div>';
  } else { h += '<div style="color:rgba(255,255,255,0.3);font-size:.76rem;padding:10px 0">None</div>'; }
  h += '</div>';
  h += '<div style="margin-top:20px;display:flex;gap:6px;flex-wrap:wrap">';
  h += '<button class="amem-action-btn approve" onclick="_amemExtend(\'' + _esc(mem.id) + '\');_amemCloseDrawer()">+30d</button>';
  h += '<button class="amem-action-btn warning" onclick="_amemSuspend(\'' + _esc(mem.id) + '\');_amemCloseDrawer()">Suspend</button>';
  h += '<button class="amem-action-btn deactivate" onclick="_amemCancel(\'' + _esc(mem.id) + '\');_amemCloseDrawer()">Cancel</button>';
  h += '</div></div>';
  var existing = document.getElementById('amem-drawer'); if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', h);
};
window._amemCloseDrawer = function () { var d = document.getElementById('amem-drawer'); if (d) { d.classList.remove('open'); setTimeout(function () { d.remove(); }, 300); } };

/* ── Main entry ─────────────────────────────────────────────── */
window.renderAdminMemberships = async function (container) {
  if (!container) return;
  container.innerHTML = '<div style="padding:48px;text-align:center;color:rgba(255,255,255,0.4)"><div class="amem-spinner" style="margin:0 auto 10px;width:24px;height:24px;border-width:3px"></div>Loading\u2026</div>';
  var client = window.supabaseClient;
  if (!client) { container.innerHTML = '<div class="amem-empty">Supabase not connected.</div>'; return; }
  try {
    await _loadData(client);
    _es.activeTab = 'members';
    _renderPanel(container);
    setTimeout(function () { var wrap = document.getElementById('smci-admin-prem-cats-wrap'); if (wrap && typeof window.renderAdminPremiumCategories === 'function') window.renderAdminPremiumCategories(wrap); }, 100);
  } catch (err) {
    container.innerHTML = '<div class="amem-empty">\u26A0 Error: ' + _esc(err.message||String(err)) + '<br><br><button class="amem-btn primary" onclick="window.renderAdminMemberships(document.getElementById(\'adminMain\'))">\u21BB Retry</button></div>';
  }
};

})();
