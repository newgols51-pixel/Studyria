/* ═══════════════════════════════════════════════════════════════════════
   GSN — Global Search & Notifications
   Premium live-notification carousel + global search for Studyria.
   Uses ONLY real backend data. No fake counts. No demo data.
   Theme: Paper Cream + Maroon + Gold.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function getSB() { return window.supabaseClient || null; }

  var GSN = {
    _counts: null, _countsLoading: false, _countsError: false,
    _notifs: null, _notifsLoading: false, _notifsError: false,
    _searchTerm: '', _searchTab: 'all', _searchResults: [],
    _searchLoading: false, _searchError: false, _searchDone: false,
    _filtersOpen: false, _debounceTimer: null
  };

  var TYPE_ICONS = { pdf:'📚', job:'💼', quiz:'🧠', mock:'📝', affairs:'📰', category:'📂', announcement:'📢' };
  var TYPE_LABELS = { pdf:'PDF', job:'JOB', quiz:'QUIZ', mock:'MOCK TEST', affairs:'CURRENT AFFAIRS', category:'CATEGORY', announcement:'ANNOUNCEMENT' };

  // ═══════════════════════════════════════════════════════════════════
  // PART A — LIVE NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════

  async function loadNotifications() {
    if (GSN._notifsLoading) return;
    GSN._notifsLoading = true; GSN._notifsError = false;
    renderNotifications();
    var sb = getSB(); var items = [];
    try {
      // Active announcements
      if (sb) {
        var annRes = await sb.from('announcements').select('id, title, message, created_at').eq('active', true).order('created_at', { ascending: false }).limit(5);
        if (annRes.data && !annRes.error) {
          annRes.data.forEach(function (a) {
            items.push({ id:'ann-'+a.id, type:'announcement', title:a.title||'', desc:a.message||'', date:a.created_at, cta:null });
          });
        }
      }
      // Latest active jobs
      if (sb && items.length < 10) {
        var jobRes = await sb.from('jobs').select('id, title, org, organization, description, last_date, published_at, created_at').eq('active', true).order('created_at', { ascending: false }).limit(10);
        if (jobRes.data && !jobRes.error) {
          jobRes.data.forEach(function (j) {
            if (items.length >= 10) return;
            items.push({ id:'job-'+j.id, type:'job', title:j.title||'', desc:j.org||j.organization||'', date:j.published_at||j.created_at, cta:"navigate('career-hub')", ctaLabel:'View Job →' });
          });
        }
      }
      // Recent current affairs
      if (sb && items.length < 10) {
        try {
          var caRes = await sb.from('current_affairs').select('id, title, description, created_at').eq('is_deleted', false).order('created_at', { ascending: false }).limit(5);
          if (caRes.data && !caRes.error) {
            caRes.data.forEach(function (c) {
              if (items.length >= 10) return;
              items.push({ id:'ca-'+c.id, type:'affairs', title:c.title||'', desc:(c.description||'').substring(0,80), date:c.created_at, cta:"navigate('brainlab');setTimeout(function(){if(typeof BrainLab!=='undefined'&&BrainLab.switchTab)BrainLab.switchTab('affairs');},400)", ctaLabel:'Read →' });
            });
          }
        } catch(e2) {}
      }
      // Deduplicate
      var seen = {};
      items = items.filter(function (i) { if (seen[i.id]) return false; seen[i.id] = true; return true; });
      // Sort by date desc
      items.sort(function (a, b) { return (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0); });
      // Max 10
      items = items.slice(0, 10);
      GSN._notifs = items;
    } catch (e) {
      console.warn('[GSN] Notification load error:', e);
      GSN._notifsError = true;
    }
    GSN._notifsLoading = false;
    renderNotifications();
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr); var diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }

  function renderNotifications() {
    var container = document.getElementById('gsnNotifSection');
    if (!container) return;
    var count = GSN._notifs ? GSN._notifs.length : 0;
    var loading = GSN._notifsLoading;
    var error = GSN._notifsError;
    var badgeText = loading ? '…' : count + ' Live';
    var badgeClass = loading ? 'gsn-badge-loading' : (count > 0 ? 'gsn-badge-live' : 'gsn-badge-zero');

    var html = '<div class="gsn-notif-head"><div class="gsn-notif-title-wrap"><span class="gsn-notif-icon">🔔</span><span class="gsn-notif-title">Live Notifications</span></div><span class="gsn-notif-badge ' + badgeClass + '"><span class="gsn-notif-dot"></span>' + esc(badgeText) + '</span></div>';

    if (loading) {
      html += '<div class="gsn-notif-track-outer"><div class="gsn-notif-track">';
      for (var i = 0; i < 3; i++) html += '<div class="gsn-notif-card gsn-skeleton-card"><div class="gsn-sk-line" style="width:60%"></div><div class="gsn-sk-line" style="width:85%"></div><div class="gsn-sk-line" style="width:40%"></div></div>';
      html += '</div></div>';
      container.innerHTML = html; return;
    }
    if (error) {
      html += '<div class="gsn-notif-error"><span>Unable to load notifications</span> <button class="gsn-retry-btn" onclick="GSN.retryNotif()">Retry</button></div>';
      container.innerHTML = html; return;
    }
    if (count === 0) {
      html += '<div class="gsn-notif-empty"><span class="gsn-notif-empty-icon">📭</span><span>No active notifications right now</span></div>';
      container.innerHTML = html; return;
    }

    html += '<div class="gsn-notif-track-outer"><div class="gsn-notif-track">';
    GSN._notifs.forEach(function (n) {
      var icon = TYPE_ICONS[n.type] || '📢';
      var label = TYPE_LABELS[n.type] || 'GENERAL';
      var timeStr = timeAgo(n.date);
      var ctaHtml = n.cta ? '<button class="gsn-notif-cta" onclick="' + esc(n.cta) + '">' + esc(n.ctaLabel || 'View →') + '</button>' : '';
      html += '<div class="gsn-notif-card gsn-type-' + n.type + '"><div class="gsn-notif-card-top"><span class="gsn-notif-type-icon">' + icon + '</span><span class="gsn-notif-type-label">' + esc(label) + '</span>' + (timeStr ? '<span class="gsn-notif-time">' + esc(timeStr) + '</span>' : '') + '</div><div class="gsn-notif-card-title">' + esc(n.title) + '</div>' + (n.desc ? '<div class="gsn-notif-card-desc">' + esc(n.desc) + '</div>' : '') + ctaHtml + '</div>';
    });
    html += '</div></div>';
    container.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART B — GLOBAL SEARCH
  // ═══════════════════════════════════════════════════════════════════

  async function loadCounts() {
    if (GSN._countsLoading) return;
    GSN._countsLoading = true; GSN._countsError = false;
    renderSearchTabs();
    var sb = getSB();
    var counts = { all:0, pdf:0, job:0, quiz:0, mock:0, affairs:0, category:0 };
    try {
      if (sb) {
        var pdfRes = await sb.from('pdfs').select('id', { count:'exact', head:true }).eq('status','published');
        if (!pdfRes.error) counts.pdf = pdfRes.count || 0; else { var lp = (window.PDFS||[]).filter(function(p){return !p.status||p.status==='published';}); counts.pdf = lp.length; }
        var jobRes = await sb.from('jobs').select('id', { count:'exact', head:true }).eq('active', true);
        if (!jobRes.error) counts.job = jobRes.count || 0;
        try { var caRes = await sb.from('current_affairs').select('id', { count:'exact', head:true }).eq('is_deleted', false); if (caRes.error) throw caRes.error; counts.affairs = caRes.count || 0; } catch(e) {}
        try { var catRes = await sb.from('categories').select('id', { count:'exact', head:true }).eq('enabled', true); if (catRes.error) throw catRes.error; counts.category = catRes.count || 0; } catch(e) { counts.category = (window._dbCategories || []).length; }
      }
      if (typeof SQ !== 'undefined') counts.quiz = SQ.length;
      if (typeof SM !== 'undefined') counts.mock = SM.length;
      counts.all = counts.pdf + counts.job + counts.quiz + counts.mock + counts.affairs + counts.category;
      GSN._counts = counts;
    } catch (e) {
      console.warn('[GSN] Count load error:', e);
      GSN._countsError = true;
    }
    GSN._countsLoading = false;
    renderSearchTabs();
  }

  function renderSearchTabs() {
    var tabsEl = document.getElementById('gsnSearchTabs');
    if (!tabsEl) return;
    var c = GSN._counts, loading = GSN._countsLoading, error = GSN._countsError;
    var tabs = [ {key:'all',label:'All'}, {key:'pdf',label:'PDFs'}, {key:'job',label:'Jobs'}, {key:'quiz',label:'Quizzes'}, {key:'mock',label:'Mock Tests'}, {key:'affairs',label:'Current Affairs'}, {key:'category',label:'Categories'} ];
    var html = '';
    tabs.forEach(function (t) {
      var active = GSN._searchTab === t.key ? ' gsn-tab-active' : '';
      var countText = '';
      if (loading) countText = ' <span class="gsn-tab-count gsn-tab-loading">•••</span>';
      else if (error) countText = ' <span class="gsn-tab-count gsn-tab-error">!</span>';
      else if (c) countText = ' <span class="gsn-tab-count">' + (c[t.key] || 0) + '</span>';
      html += '<button class="gsn-tab' + active + '" onclick="GSN.setTab(\'' + t.key + '\')">' + esc(t.label) + countText + '</button>';
    });
    tabsEl.innerHTML = html;
  }

  function renderSearchSection() {
    var container = document.getElementById('gsnSearchSection');
    if (!container) return;
    var html = '<div class="gsn-search-head"><div class="gsn-search-title">🔎 Search Studyria</div><div class="gsn-search-sub">Find PDFs, Jobs, Quizzes, Mock Tests, Current Affairs & more.</div></div>'
      + '<div class="gsn-search-bar-wrap"><div class="gsn-search-bar">'
      + '<svg class="gsn-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
      + '<input type="search" id="gsnSearchInput" class="gsn-search-input" placeholder="Search anything on Studyria…" autocomplete="off" oninput="GSN.onSearchInput()" />'
      + '<button class="gsn-search-clear" id="gsnSearchClear" style="display:none" onclick="GSN.clearSearch()" aria-label="Clear search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
      + '</div></div>'
      + '<div class="gsn-tabs-row" id="gsnSearchTabs"></div>'
      + '<div class="gsn-filters-row"><button class="gsn-filters-btn' + (GSN._filtersOpen ? ' gsn-filters-open' : '') + '" onclick="GSN.toggleFilters()">⚙ Filters</button>'
      + '<div class="gsn-filters-panel" id="gsnFiltersPanel" style="display:none">'
      + '<select id="gsnFilterCategory" class="gsn-filter-select" onchange="GSN.onFilterChange()"><option value="">All Categories</option></select>'
      + '<select id="gsnFilterPrice" class="gsn-filter-select" onchange="GSN.onFilterChange()"><option value="">All Prices</option><option value="free">Free</option><option value="paid">Paid</option></select>'
      + '</div></div>'
      + '<div class="gsn-results-wrap" id="gsnResultsWrap" style="display:none">'
      + '<div class="gsn-results-loading" id="gsnResultsLoading" style="display:none"><div class="gsn-spinner"></div> Searching…</div>'
      + '<div class="gsn-results-count" id="gsnResultsCount"></div>'
      + '<div class="gsn-results-grid" id="gsnResultsGrid"></div>'
      + '<div class="gsn-results-empty" id="gsnResultsEmpty" style="display:none"><div class="gsn-results-empty-icon">🔍</div><div class="gsn-results-empty-text">No results found. Try a different search term.</div></div>'
      + '<div class="gsn-results-error" id="gsnResultsError" style="display:none"><div>Unable to load content</div><button class="gsn-retry-btn" onclick="GSN.retrySearch()">Retry</button></div>'
      + '</div>';
    container.innerHTML = html;
    populateFilters();
    renderSearchTabs();
  }

  function populateFilters() {
    var catSelect = document.getElementById('gsnFilterCategory');
    if (!catSelect) return;
    var cats = window._dbCategories || [];
    var html = '<option value="">All Categories</option>';
    cats.forEach(function (c) { html += '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>'; });
    catSelect.innerHTML = html;
  }

  // ── Search Behavior ─────────────────────────────────────────────
  function onSearchInput() {
    var input = document.getElementById('gsnSearchInput');
    var clear = document.getElementById('gsnSearchClear');
    if (!input) return;
    GSN._searchTerm = input.value.trim();
    if (clear) clear.style.display = GSN._searchTerm ? 'flex' : 'none';
    clearTimeout(GSN._debounceTimer);
    if (!GSN._searchTerm) { clearResults(); return; }
    GSN._debounceTimer = setTimeout(runSearch, 350);
  }

  function setTab(tab) {
    GSN._searchTab = tab;
    renderSearchTabs();
    if (GSN._searchTerm) runSearch(); else clearResults();
  }

  function clearSearch() {
    var input = document.getElementById('gsnSearchInput');
    if (input) input.value = '';
    GSN._searchTerm = '';
    var clear = document.getElementById('gsnSearchClear');
    if (clear) clear.style.display = 'none';
    clearResults();
  }

  function clearResults() {
    var wrap = document.getElementById('gsnResultsWrap');
    if (wrap) wrap.style.display = 'none';
    var grid = document.getElementById('gsnResultsGrid');
    if (grid) grid.innerHTML = '';
    var countEl = document.getElementById('gsnResultsCount');
    if (countEl) countEl.innerHTML = '';
    GSN._searchResults = []; GSN._searchDone = false;
  }

  function toggleFilters() {
    GSN._filtersOpen = !GSN._filtersOpen;
    var btn = document.querySelector('.gsn-filters-btn');
    var panel = document.getElementById('gsnFiltersPanel');
    if (btn) btn.classList.toggle('gsn-filters-open', GSN._filtersOpen);
    if (panel) panel.style.display = GSN._filtersOpen ? 'flex' : 'none';
  }

  function onFilterChange() { if (GSN._searchTerm) runSearch(); }

  async function runSearch() {
    var term = GSN._searchTerm.toLowerCase().trim();
    var tab = GSN._searchTab;
    if (!term) { clearResults(); return; }
    GSN._searchLoading = true; GSN._searchError = false; GSN._searchDone = false;
    var wrap = document.getElementById('gsnResultsWrap');
    var loading = document.getElementById('gsnResultsLoading');
    var grid = document.getElementById('gsnResultsGrid');
    var empty = document.getElementById('gsnResultsEmpty');
    var errorEl = document.getElementById('gsnResultsError');
    var countEl = document.getElementById('gsnResultsCount');
    if (wrap) wrap.style.display = 'block';
    if (loading) loading.style.display = 'flex';
    if (grid) grid.innerHTML = '';
    if (empty) empty.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
    if (countEl) countEl.innerHTML = '';

    var results = []; var sb = getSB();
    var filterCat = document.getElementById('gsnFilterCategory') ? document.getElementById('gsnFilterCategory').value : '';
    var filterPrice = document.getElementById('gsnFilterPrice') ? document.getElementById('gsnFilterPrice').value : '';
    var encTerm = encodeURIComponent(term);

    try {
      // ── PDFs ──
      if (tab === 'all' || tab === 'pdf') {
        if (sb) {
          var pq = sb.from('pdfs').select('*').eq('status','published').or('title.ilike.%' + encTerm + '%,author.ilike.%' + encTerm + '%,category.ilike.%' + encTerm + '%,seo_keywords.ilike.%' + encTerm + '%').limit(20);
          if (filterCat) { var co = (window._dbCategories||[]).find(function(c){return c.name===filterCat;}); pq = co ? pq.eq('category_id', co.id) : pq.eq('category', filterCat); }
          if (filterPrice === 'free') pq = pq.eq('price', 0);
          if (filterPrice === 'paid') pq = pq.gt('price', 0);
          var pr = await pq;
          if (pr.data) pr.data.forEach(function(p) {
            results.push({ type:'pdf', title:p.title||'', subtitle:(p.category||'')+(p.author?' · '+p.author:''), price:p.price||0, mrp:p.mrp||0, cta:"navigate('library')", ctaLabel:'View →' });
          });
        }
        // Fallback local
        if (results.filter(function(r){return r.type==='pdf';}).length === 0) {
          (window.PDFS||[]).forEach(function(p) {
            if (p.status && p.status !== 'published') return;
            var m = (p.title||'').toLowerCase().includes(term) || (p.author||'').toLowerCase().includes(term) || (p.category||'').toLowerCase().includes(term);
            if (!m) return;
            if (filterCat && (p.category||'') !== filterCat) return;
            if (filterPrice==='free' && (p.price||0)>0) return;
            if (filterPrice==='paid' && (p.price||0)===0) return;
            results.push({ type:'pdf', title:p.title||'', subtitle:(p.category||'')+(p.author?' · '+p.author:''), price:p.price||0, cta:"navigate('library')", ctaLabel:'View →' });
          });
        }
      }
      // ── Jobs ──
      if (tab === 'all' || tab === 'job') {
        if (sb) {
          var jr = await sb.from('jobs').select('*').eq('active', true).or('title.ilike.%' + encTerm + '%,org.ilike.%' + encTerm + '%,organization.ilike.%' + encTerm + '%,description.ilike.%' + encTerm + '%').limit(20);
          if (jr.data) jr.data.forEach(function(j) {
            results.push({ type:'job', title:j.title||'', subtitle:j.org||j.organization||'', meta:j.last_date?'Last Date: '+new Date(j.last_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'', cta:"navigate('career-hub')", ctaLabel:'View Job →' });
          });
        }
      }
      // ── Quizzes ──
      if (tab === 'all' || tab === 'quiz') {
        if (typeof SQ !== 'undefined') SQ.forEach(function(q) {
          if ((q.title||'').toLowerCase().includes(term) || (q.category||'').toLowerCase().includes(term)) {
            results.push({ type:'quiz', title:q.title||'', subtitle:q.category||'', meta:(typeof BrainLab!=='undefined'&&BrainLab.countByCategory)?BrainLab.countByCategory(q.category)+' questions':'', cta:"navigate('brainlab');setTimeout(function(){if(typeof BrainLab!=='undefined'&&BrainLab.startCategoryQuiz)BrainLab.startCategoryQuiz('"+q.id+"');},400)", ctaLabel:'Start →' });
          }
        });
      }
      // ── Mock Tests ──
      if (tab === 'all' || tab === 'mock') {
        if (typeof SM !== 'undefined') SM.forEach(function(m) {
          if ((m.title||'').toLowerCase().includes(term) || (m.exam||'').toLowerCase().includes(term)) {
            results.push({ type:'mock', title:m.title||'', subtitle:m.exam||'', meta:(typeof BrainLab!=='undefined'&&BrainLab.countByExam)?BrainLab.countByExam(m.exam)+' questions':'', cta:"navigate('brainlab');setTimeout(function(){if(typeof BrainLab!=='undefined'&&BrainLab.startMock)BrainLab.startMock('"+m.id+"');},400)", ctaLabel:'Start →' });
          }
        });
      }
      // ── Current Affairs ──
      if (tab === 'all' || tab === 'affairs') {
        if (sb) {
          try {
            var cr = await sb.from('current_affairs').select('*').eq('is_deleted', false).or('title.ilike.%' + encTerm + '%,description.ilike.%' + encTerm + '%').limit(20);
            if (cr.data) cr.data.forEach(function(c) {
              results.push({ type:'affairs', title:c.title||'', subtitle:(c.description||'').substring(0,60), meta:c.created_at?new Date(c.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}):'', cta:"navigate('brainlab');setTimeout(function(){if(typeof BrainLab!=='undefined'&&BrainLab.switchTab)BrainLab.switchTab('affairs');},400)", ctaLabel:'Read →' });
            });
          } catch(e3) {}
        }
      }
      // ── Categories ──
      if (tab === 'all' || tab === 'category') {
        (window._dbCategories||[]).forEach(function(c) {
          if ((c.name||'').toLowerCase().includes(term) || (c.description||'').toLowerCase().includes(term)) {
            results.push({ type:'category', title:c.name||'', subtitle:c.description||'', cta:"navigate('library');setTimeout(function(){var f=document.getElementById('dCat');if(f){f.value='"+esc(c.name).replace(/'/g,"\\'")+"';f.dispatchEvent(new Event('change'));}},300)", ctaLabel:'Browse →' });
          }
        });
      }
      GSN._searchResults = results;
    } catch (e) {
      console.warn('[GSN] Search error:', e);
      GSN._searchError = true;
    }
    GSN._searchLoading = false; GSN._searchDone = true;
    renderResults();
  }

  function renderResults() {
    var loading = document.getElementById('gsnResultsLoading');
    var grid = document.getElementById('gsnResultsGrid');
    var empty = document.getElementById('gsnResultsEmpty');
    var errorEl = document.getElementById('gsnResultsError');
    var countEl = document.getElementById('gsnResultsCount');
    if (loading) loading.style.display = 'none';
    if (GSN._searchError) {
      if (grid) grid.innerHTML = '';
      if (empty) empty.style.display = 'none';
      if (errorEl) errorEl.style.display = 'flex';
      if (countEl) countEl.innerHTML = '';
      return;
    }
    var results = GSN._searchResults;
    if (countEl) countEl.innerHTML = results.length > 0 ? '<strong>' + results.length + '</strong> result' + (results.length !== 1 ? 's' : '') : '';
    if (results.length === 0) {
      if (grid) grid.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      if (errorEl) errorEl.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
    if (grid) {
      grid.innerHTML = results.map(function (r) {
        var icon = TYPE_ICONS[r.type] || '📄';
        var label = TYPE_LABELS[r.type] || 'RESULT';
        var priceHtml = '';
        if (r.type === 'pdf') {
          if (r.price === 0) priceHtml = '<span class="gsn-result-price gsn-price-free">FREE</span>';
          else priceHtml = '<span class="gsn-result-price">₹' + r.price + '</span>';
        }
        var metaHtml = r.meta ? '<div class="gsn-result-meta">' + esc(r.meta) + '</div>' : '';
        return '<div class="gsn-result-card gsn-type-' + r.type + '"><div class="gsn-result-top"><span class="gsn-result-type-icon">' + icon + '</span><span class="gsn-result-type-label">' + esc(label) + '</span></div><div class="gsn-result-title">' + esc(r.title) + '</div>' + (r.subtitle ? '<div class="gsn-result-subtitle">' + esc(r.subtitle) + '</div>' : '') + metaHtml + '<div class="gsn-result-bottom">' + priceHtml + '<button class="gsn-result-cta" onclick="' + esc(r.cta) + '">' + esc(r.ctaLabel || 'View →') + '</button></div></div>';
      }).join('');
    }
  }

  function retryNotif() { loadNotifications(); }
  function retrySearch() { runSearch(); }

  // ═══════════════════════════════════════════════════════════════════
  // INJECTION & BOOT
  // ═══════════════════════════════════════════════════════════════════

  function injectSections() {
    var homePage = document.getElementById('page-home');
    if (!homePage) return;
    if (document.getElementById('gsnContainer')) return;
    var container = document.createElement('div');
    container.id = 'gsnContainer';
    container.className = 'gsn-container';
    container.innerHTML = '<div id="gsnNotifSection"></div>';
    // Insert BEFORE the discover section (right after hero)
    var discover = document.getElementById('discover-section');
    if (discover && discover.parentNode) {
      discover.parentNode.insertBefore(container, discover);
    } else {
      var hero = homePage.querySelector('.sh-hero');
      if (hero && hero.parentNode) hero.parentNode.insertBefore(container, hero.nextSibling);
      else homePage.insertBefore(container, homePage.firstChild);
    }
    setTimeout(function () { loadNotifications(); enhanceDiscoverSection(); }, 200);
  }

  function onNavigate(e) {
    if (e.detail === 'home') {
      setTimeout(function () {
        if (!document.getElementById('gsnContainer')) injectSections();
        else { loadNotifications(); enhanceDiscoverSection(); }
      }, 300);
    }
  }

  function boot() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(injectSections, 500); });
    else setTimeout(injectSections, 500);
    document.addEventListener('studyria:navigate', onNavigate);
    
  }

  window.GSN = {
    onSearchInput: onSearchInput, setTab: setTab, clearSearch: clearSearch,
    toggleFilters: toggleFilters, onFilterChange: onFilterChange,
    retryNotif: retryNotif, retrySearch: retrySearch
  };

  boot();
})();
