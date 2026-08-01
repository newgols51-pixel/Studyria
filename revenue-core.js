/**
 * ═══════════════════════════════════════════════════════════════════════════
 * revenue-core.js — Studyria V5.1 Revenue Modules Core
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shared utilities, Supabase helpers, and common rendering functions
 * used by all 8 revenue modules.
 *
 * SAFETY CONTRACT
 * ───────────────
 * • Never modifies existing Studyria code
 * • Uses window.supabaseClient (set by supabase.js)
 * • All queries are RLS-safe (anon key only)
 * • All inputs sanitized before DB writes
 * • Soft delete only (deleted_at, never DELETE)
 * • Admin writes via service_role Edge Functions (not frontend)
 *
 * @module StudyriaRevenue
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

(function (root) {
  'use strict';

  if (root.StudyriaRevenue && root.StudyriaRevenue._version === '5.1') return;

  // ── Dependency accessor ──────────────────────────────────────────────────
  const _sb = () => root.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
  const _user = async () => {
    try {
      const sb = _sb(); if (!sb) return null;
      const { data: { user } } = await sb.auth.getUser();
      return user || null;
    } catch { return null; }
  };
  const _isAdmin = () => {
    try { return root.currentUser?.role === 'admin' || root._studyriaIsAdmin === true; }
    catch { return false; }
  };

  // ── Input sanitization ───────────────────────────────────────────────────
  function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>'"]/g, c => ({'<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function sanitizeObj(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') out[k] = sanitize(v);
      else if (Array.isArray(v)) out[k] = v.map(x => typeof x === 'string' ? sanitize(x) : (typeof x === 'object' ? sanitizeObj(x) : x));
      else if (typeof v === 'object' && v !== null) out[k] = sanitizeObj(v);
      else out[k] = v;
    }
    return out;
  }

  // ── Toast (reuse existing) ───────────────────────────────────────────────
  function toast(msg, type) {
    if (typeof root.showToast === 'function') { root.showToast(msg, type || 'info'); return; }
    console.log(`[Revenue ${type || 'info'}] ${msg}`);
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────
  function skeletonHTML(count) {
    let html = '';
    for (let i = 0; i < (count || 6); i++) {
      html += '<div class="rm-skeleton rm-skeleton-card"></div>';
    }
    return `<div class="rm-grid rm-grid-3">${html}</div>`;
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  function emptyHTML(icon, text) {
    return `<div class="rm-empty">
      <div class="rm-empty-icon">${icon || '📭'}</div>
      <div class="rm-empty-text">${sanitize(text || 'No content available yet.')}</div>
    </div>`;
  }

  // ── Error state ───────────────────────────────────────────────────────────
  function errorHTML(msg) {
    return `<div class="rm-error">
      <div class="rm-empty-icon">⚠️</div>
      <div class="rm-empty-text">${sanitize(msg || 'Something went wrong.')}</div>
      <button class="rm-btn rm-btn-ghost" onclick="location.reload()">Retry</button>
    </div>`;
  }

  // ── Pagination state ──────────────────────────────────────────────────────
  const _paginationState = new Map();

  function getPagination(key) {
    return _paginationState.get(key) || { page: 0, hasMore: true, loading: false };
  }

  function setPagination(key, state) {
    _paginationState.set(key, state);
  }

  // ── Safe DB query wrapper ─────────────────────────────────────────────────
  async function safeQuery(table, opts) {
    const sb = _sb();
    if (!sb) throw new Error('Supabase client not available');

    let query = sb.from(table).select(opts.select || '*');

    // Filters
    if (opts.eq) { for (const [k, v] of Object.entries(opts.eq)) query = query.eq(k, v); }
    if (opts.neq) { for (const [k, v] of Object.entries(opts.neq)) query = query.neq(k, v); }
    if (opts.in) { for (const [k, v] of Object.entries(opts.in)) query = query.in(k, v); }

    // Only published, not deleted (default)
    if (opts.publishedOnly !== false) {
      query = query.eq('is_published', true);
      query = query.is('deleted_at', null);
    }

    // Ordering
    if (opts.order) {
      query = query.order(opts.order.column, { ascending: opts.order.ascending ?? false });
    }

    // Pagination
    if (opts.limit) query = query.limit(opts.limit);
    if (opts.offset) query = query.range(opts.offset, opts.offset + (opts.limit || 20) - 1);

    // Single
    if (opts.single) query = query.single();

    const { data, error } = await query;

    if (error) {
      console.error(`[Revenue] Query error on ${table}:`, error.message);
      throw error;
    }

    return data || [];
  }

  // ── Safe insert ───────────────────────────────────────────────────────────
  async function safeInsert(table, payload) {
    const sb = _sb();
    if (!sb) throw new Error('Supabase client not available');

    const user = await _user();
    if (!user) throw new Error('Authentication required');

    const sanitized = sanitizeObj(payload);
    if (table !== 'leaderboards' && table !== 'mock_attempts' && table !== 'applications' && table !== 'course_enrollments' && table !== 'purchases' && table !== 'course_progress' && table !== 'planner_tasks' && table !== 'study_planners' && table !== 'resumes' && table !== 'resume_reviews' && table !== 'interview_attempts' && table !== 'product_reviews' && table !== 'certificates') {
      sanitized.created_by = user.id;
    }

    const { data, error } = await sb.from(table).insert(sanitized).select();

    if (error) {
      console.error(`[Revenue] Insert error on ${table}:`, error.message);
      throw error;
    }

    return data?.[0] || null;
  }

  // ── Safe update (owner-scoped) ────────────────────────────────────────────
  async function safeUpdate(table, id, payload, userIdField) {
    const sb = _sb();
    if (!sb) throw new Error('Supabase client not available');

    const user = await _user();
    if (!user) throw new Error('Authentication required');

    const sanitized = sanitizeObj(payload);
    const uf = userIdField || 'user_id';

    const { data, error } = await sb.from(table)
      .update(sanitized)
      .eq('id', id)
      .eq(uf, user.id)
      .select();

    if (error) {
      console.error(`[Revenue] Update error on ${table}:`, error.message);
      throw error;
    }

    return data?.[0] || null;
  }

  // ── Soft delete (owner-scoped) ───────────────────────────────────────────
  async function safeSoftDelete(table, id, userIdField) {
    const sb = _sb();
    if (!sb) throw new Error('Supabase client not available');

    const user = await _user();
    if (!user) throw new Error('Authentication required');

    const uf = userIdField || 'user_id';

    const { error } = await sb.from(table)
      .update({ deleted_at: new Date().toISOString(), is_published: false })
      .eq('id', id)
      .eq(uf, user.id);

    if (error) throw error;
    return true;
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────
  function openModal(title, contentHTML, onClose) {
    const overlay = document.createElement('div');
    overlay.className = 'rm-modal-overlay';
    overlay.innerHTML = `
      <div class="rm-modal" onclick="event.stopPropagation()">
        <div class="rm-modal-header">
          <h2 style="font-size:1.1rem;font-weight:700;color:var(--rm-text);margin:0">${sanitize(title)}</h2>
          <button class="rm-modal-close" id="rmModalClose">✕</button>
        </div>
        <div id="rmModalBody">${contentHTML}</div>
      </div>`;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); if (onClose) onClose(); }
    });

    document.getElementById('rmModalClose')?.addEventListener('click', () => {
      overlay.remove(); if (onClose) onClose();
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  function closeModal() {
    document.querySelectorAll('.rm-modal-overlay').forEach(m => m.remove());
  }

  // ── Date formatting ────────────────────────────────────────────────────────
  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return dateStr; }
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days > 30) return formatDate(dateStr);
    if (days > 0) return `${days}d ago`;
    const hrs = Math.floor(diff / 3600000);
    if (hrs > 0) return `${hrs}h ago`;
    const mins = Math.floor(diff / 60000);
    if (mins > 0) return `${mins}m ago`;
    return 'just now';
  }

  // ── Debounce ──────────────────────────────────────────────────────────────
  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait || 300);
    };
  }

  // ── Infinite scroll setup ─────────────────────────────────────────────────
  function setupInfiniteScroll(containerId, loadMoreFn) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const sentinel = document.createElement('div');
    sentinel.id = containerId + '-sentinel';
    sentinel.style.height = '1px';
    container.appendChild(sentinel);

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMoreFn();
    }, { rootMargin: '200px' });

    observer.observe(sentinel);
    return observer;
  }

  // ── Module registry ───────────────────────────────────────────────────────
  const _modules = {};

  function register(name, module) {
    _modules[name] = module;
  }

  function getModule(name) {
    return _modules[name] || null;
  }

  function initModule(name) {
    const mod = _modules[name];
    if (mod && typeof mod.init === 'function') {
      try { mod.init(); } catch (e) { console.error(`[Revenue] Module ${name} init failed:`, e); }
    }
  }

  function initAll() {
    Object.keys(_modules).forEach(name => initModule(name));
  }

  // ── Export ────────────────────────────────────────────────────────────────
  
  // ── Module picker (bottom nav "More" button) ──────────────────────────────
  function openModulePicker() {
    const modules = [
      { id: 'mock-test',      icon: '\u{1F4DD}', name: 'Mock Tests' },
      { id: 'resume-builder',  icon: '\u{1F4C4}', name: 'Resume Builder' },
      { id: 'internship-hub',  icon: '\u{1F4BC}', name: 'Jobs & Internships' },
      { id: 'video-courses',   icon: '\u{1F393}', name: 'Video Courses' },
      { id: 'certificate-gen', icon: '\u{1F4DC}', name: 'Certificates' },
      { id: 'study-planner',   icon: '\u{1F4C5}', name: 'Study Planner' },
      { id: 'interview-prep',  icon: '\u{1F3A4}', name: 'Interview Prep' },
      { id: 'digital-store',   icon: '\u{1F6D2}', name: 'Digital Store' },
    ];
    const grid = modules.map(function(m) {
      return '<div class="rm-module-card" onclick="navigate(\'' + m.id + '\'); StudyriaRevenue._closePicker()">' +
        '<div class="rm-module-icon">' + m.icon + '</div>' +
        '<div class="rm-module-name">' + m.name + '</div></div>';
    }).join('');
    openModal('Studyria More', '<div class="rm-module-grid">' + grid + '</div>');
  }
  function _closePicker() { closeModal(); }

  root.StudyriaRevenue = Object.freeze({
    _version: '5.1',

    // Core utilities
    _sb, _user, _isAdmin,
    sanitize, sanitizeObj,
    toast,
    skeletonHTML, emptyHTML, errorHTML,

    // DB helpers
    safeQuery, safeInsert, safeUpdate, safeSoftDelete,

    // Pagination
    getPagination, setPagination,

    // UI helpers
    openModal, closeModal,
    formatDate, formatTime, timeAgo,
    debounce, setupInfiniteScroll,

    // Module registry
    register, getModule, initModule, initAll,
    openModulePicker, _closePicker,
    _modules,
  });

  console.log('[StudyriaRevenue] V5.1 Core loaded.');

}(typeof self !== 'undefined' ? self : this));
