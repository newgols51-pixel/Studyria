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
    // Remove any existing modal first
    document.querySelectorAll('.rm-modal-overlay').forEach(function(m) { m.remove(); });

    var overlay = document.createElement('div');
    overlay.className = 'rm-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'rm-modal';
    modal.addEventListener('click', function(e) { e.stopPropagation(); });

    var header = document.createElement('div');
    header.className = 'rm-modal-header';
    header.innerHTML = '<h2 style="font-size:1.1rem;font-weight:700;color:var(--rm-text);margin:0">' + sanitize(title) + '</h2>';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'rm-modal-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', function() { overlay.remove(); if (onClose) onClose(); });
    header.appendChild(closeBtn);

    var body = document.createElement('div');
    body.id = 'rmModalBody';
    body.innerHTML = contentHTML;

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) { overlay.remove(); if (onClose) onClose(); }
    });

    document.body.appendChild(overlay);

    // Trap focus: close on Escape key
    var onKey = function(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); }
    };
    document.addEventListener('keydown', onKey);

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
  // Route map: module id -> page id (must match id="page-xxx" in index.html)
  var MODULE_ROUTES = {
    'mock-test':      'mock-test',
    'resume-builder': 'resume-builder',
    'internship-hub': 'internship-hub',
    'video-courses':  'video-courses',
    'certificate-gen':'certificate-gen',
    'study-planner':  'study-planner',
    'interview-prep': 'interview-prep',
    'digital-store':  'digital-store',
  };

  function _navigateToModule(id) {
    // Close picker first
    closeModal();

    // Resolve route
    var routeId = MODULE_ROUTES[id] || id;

    // Verify page exists in DOM
    var pageEl = document.getElementById('page-' + routeId);

    if (!pageEl) {
      // Graceful fallback — navigate to a coming-soon state
      _showComingSoon(id);
      return;
    }

    // Use existing navigate() if available
    try {
      if (typeof navigate === 'function') {
        navigate(routeId);
        return;
      }
      // Fallback: hash routing
      if (typeof router !== 'undefined' && typeof router.push === 'function') {
        router.push(routeId);
        return;
      }
      // Last resort: manual page switch (mirrors what navigate() does)
      _manualNavigate(routeId);
    } catch (err) {
      console.warn('[StudyriaRevenue] Navigation error:', err);
      _showToast('Navigation failed. Please try again.', 'error');
    }
  }

  function _manualNavigate(pageId) {
    // Minimal fallback that mirrors Studyria's existing navigate() logic
    try {
      document.querySelectorAll('.page.active').forEach(function(p) { p.classList.remove('active'); });
      var target = document.getElementById('page-' + pageId);
      if (target) {
        target.classList.add('active');
        window.scrollTo(0, 0);
      }
    } catch (e) {
      _showToast('Could not open ' + pageId, 'error');
    }
  }

  function _showComingSoon(moduleId) {
    var names = {
      'mock-test': 'Mock Tests', 'resume-builder': 'Resume Builder',
      'internship-hub': 'Jobs & Internships', 'video-courses': 'Video Courses',
      'certificate-gen': 'Certificates', 'study-planner': 'Study Planner',
      'interview-prep': 'Interview Prep', 'digital-store': 'Digital Store',
    };
    var name = names[moduleId] || moduleId;
    openModal('Coming Soon', [
      '<div style="text-align:center;padding:32px 16px">',
      '<div style="font-size:3rem;margin-bottom:16px">\u23f3</div>',
      '<h2 style="color:var(--rm-text);margin-bottom:8px">' + sanitize(name) + '</h2>',
      '<p style="color:var(--rm-text-muted)">This module is launching soon. Stay tuned!</p>',
      '</div>'
    ].join(''));
  }

  function _showToast(msg, type) {
    try {
      if (typeof toast === 'function') { toast(msg, type); return; }
      // Fallback toast
      var t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:10px 20px;border-radius:8px;z-index:99999;font-size:0.9rem;pointer-events:none';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function() { t.remove(); }, 3000);
    } catch(e) {}
  }

  function openModulePicker() {
    var modules = [
      { id: 'mock-test',      icon: '\ud83d\udcdd', name: 'Mock Tests' },
      { id: 'resume-builder',  icon: '\ud83d\udcc4', name: 'Resume Builder' },
      { id: 'internship-hub',  icon: '\ud83d\udcbc', name: 'Jobs & Internships' },
      { id: 'video-courses',   icon: '\ud83c\udf93', name: 'Video Courses' },
      { id: 'certificate-gen', icon: '\ud83d\udcdc', name: 'Certificates' },
      { id: 'study-planner',   icon: '\ud83d\udcc5', name: 'Study Planner' },
      { id: 'interview-prep',  icon: '\ud83c\udfa4', name: 'Interview Prep' },
      { id: 'digital-store',   icon: '\ud83d\uded2', name: 'Digital Store' },
    ];

    // Build grid using data attributes — NO inline onclick strings
    var cards = modules.map(function(m) {
      return '<div class="rm-module-card" data-module="' + m.id + '" role="button" tabindex="0" ' +
        'aria-label="Open ' + m.name + '">' +
        '<div class="rm-module-icon">' + m.icon + '</div>' +
        '<div class="rm-module-name">' + m.name + '</div></div>';
    }).join('');

    var overlay = openModal('Studyria More', '<div class="rm-module-grid" id="rmModuleGrid">' + cards + '</div>');

    // Attach event listeners AFTER modal is in DOM — event delegation on grid
    var grid = document.getElementById('rmModuleGrid');
    if (!grid) return;

    function handleModuleClick(e) {
      // Walk up to find rm-module-card (handles click on child icon/text)
      var card = e.target;
      while (card && !card.classList.contains('rm-module-card')) {
        card = card.parentElement;
      }
      if (!card) return;
      var moduleId = card.getAttribute('data-module');
      if (!moduleId) return;
      _navigateToModule(moduleId);
    }

    // Click
    grid.addEventListener('click', handleModuleClick);

    // Touch (mobile tap — prevents ghost click issues)
    grid.addEventListener('touchend', function(e) {
      var card = e.target;
      while (card && !card.classList.contains('rm-module-card')) {
        card = card.parentElement;
      }
      if (!card) return;
      e.preventDefault();
      var moduleId = card.getAttribute('data-module');
      if (moduleId) _navigateToModule(moduleId);
    }, { passive: false });

    // Keyboard accessibility (Enter/Space on focused card)
    grid.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        var card = e.target;
        if (card && card.classList.contains('rm-module-card')) {
          e.preventDefault();
          var moduleId = card.getAttribute('data-module');
          if (moduleId) _navigateToModule(moduleId);
        }
      }
    });
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
    _navigateToModule, _showComingSoon,
    _modules,
  });

  console.log('[StudyriaRevenue] V5.1 Core loaded.');

}(typeof self !== 'undefined' ? self : this));
