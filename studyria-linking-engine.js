/**
 * studyria-linking-engine.js — Enterprise Internal Linking Engine v1.0
 * ─────────────────────────────────────────────────────────────────────
 * Production-safe, additive-only internal linking system for Studyria SPA.
 *
 * ARCHITECTURE:
 *   • Hooks into existing navigate() via studyria:navigate event
 *   • Uses existing window.supabaseClient for all data
 *   • Uses existing navigate() for SPA routing
 *   • Reuses existing CSS variables & glassmorphism design
 *   • Zero existing links removed — only adds new sections
 *   • Deduplication engine prevents duplicate links
 *   • Caches Supabase data to minimize queries
 *   • Mobile-first responsive design
 *
 * FEATURES:
 *   1.  Related Content Engine (PDF, Notes, Blog, Current Affairs, Jobs)
 *   2.  Topic Cluster Engine
 *   3.  Subject Hub Linking
 *   4.  Exam Hub Linking
 *   5.  PDF Detail Page Linking
 *   6.  Blog Article Linking
 *   7.  Current Affairs Linking
 *   8.  Dynamic Breadcrumbs (all pages)
 *   9.  Entity Linking (Subjects, Exams, Categories, Authors, Creators)
 *   10. Smart Recommendations (subject, exam, category, tags, popularity)
 *   11. Search Linking
 *   12. Footer Linking (dynamic, intelligent)
 *   13. Homepage Linking (trending, popular, latest)
 *   14. JSON-LD Structured Data injection (per-page)
 *
 * @author Studyria Engineering
 * @license Proprietary
 */

(function () {
  'use strict';

  if (window.StudyriaLinkingEngine && window.StudyriaLinkingEngine._version === '1.0') return;

  /* ═══════════════════════════════════════════════════════════════════
     CONFIGURATION
  ═══════════════════════════════════════════════════════════════════ */

  var CONFIG = {
    maxRelatedItems: 6,       // max items per related section
    maxShelfItems: 8,         // max items per shelf/carousel
    maxFooterLinks: 8,        // max dynamic links per footer column
    maxBreadcrumbDepth: 5,    // max breadcrumb levels
    cacheTTL: 5 * 60 * 1000,  // 5 minutes
    renderDelay: 500,          // ms after navigate to inject
    debounceMs: 150,          // debounce for rapid navigations
    enableBreadcrumbs: true,
    enableRelatedContent: true,
    enableFooterLinks: true,
    enableHomepageLinks: true,
    enableBlogLinks: true,
    enableSearchLinks: true,
    enableJSONLD: true,
    enableTopicClusters: true
  };

  /* ═══════════════════════════════════════════════════════════════════
     STATE & CACHE
  ═══════════════════════════════════════════════════════════════════ */

  var _cache = {};
  var _renderTimer = null;
  var _injectedLinks = new Set(); // dedup: track all injected link hrefs
  var _currentPage = null;
  var _currentContext = {}; // data about current page (pdf, blog post, etc.)

  function _sb() { return window.supabaseClient; }
  function _esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function _nav(page) {
    if (typeof window.navigate === 'function') window.navigate(page);
  }
  function _openDetail(id) {
    if (typeof window.openDetail === 'function') window.openDetail(id);
  }

  /* ═══════════════════════════════════════════════════════════════════
     CACHE LAYER — Supabase data caching with TTL
  ═══════════════════════════════════════════════════════════════════ */

  async function _cached(key, fetcher) {
    var now = Date.now();
    if (_cache[key] && (now - _cache[key].ts) < CONFIG.cacheTTL) {
      return _cache[key].data;
    }
    try {
      var data = await fetcher();
      _cache[key] = { data: data, ts: now };
      return data;
    } catch (e) {
      console.warn('[SLE] Cache miss for', key, e.message || e);
      return _cache[key] ? _cache[key].data : [];
    }
  }

  async function _fetchAllPDFs() {
    return _cached('all_pdfs', async function () {
      var sb = _sb();
      if (!sb) return [];
      var res = await sb.from('pdfs')
        .select('id,title,category,category_id,subcategory_id,subject_id,price,download_count,cover_url,cover_image,coverImage,status,created_at,updated_at')
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(500);
      return (res.data || []).map(function (p) {
        p.coverImage = p.coverImage || p.cover_url || p.cover_image || '';
        return p;
      });
    });
  }

  async function _fetchCategories() {
    return _cached('categories', async function () {
      var sb = _sb();
      if (!sb) return [];
      var res = await sb.from('categories')
        .select('id,name,slug,sort_order')
        .order('sort_order', { ascending: true });
      return res.data || [];
    });
  }

  async function _fetchSubjects() {
    return _cached('subjects', async function () {
      var sb = _sb();
      if (!sb) return [];
      var res = await sb.from('subjects')
        .select('id,name,slug,category_id')
        .order('name', { ascending: true });
      return res.data || [];
    });
  }

  async function _fetchSubcategories() {
    return _cached('subcategories', async function () {
      var sb = _sb();
      if (!sb) return [];
      var res = await sb.from('subcategories')
        .select('id,name,slug,category_id')
        .order('name', { ascending: true });
      return res.data || [];
    });
  }

  async function _fetchBlogPosts() {
    return _cached('blog_posts', async function () {
      var sb = _sb();
      if (!sb) return [];
      var res = await sb.from('blog_posts')
        .select('id,title,slug,category,tags,excerpt,cover_url,published_at,updated_at')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(100);
      return res.data || [];
    });
  }

  async function _fetchJobs() {
    return _cached('jobs', async function () {
      var sb = _sb();
      if (!sb) return [];
      var res = await sb.from('jobs')
        .select('id,title,organization,location,deadline,created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      return res.data || [];
    });
  }

  async function _fetchAnnouncements() {
    return _cached('announcements', async function () {
      var sb = _sb();
      if (!sb) return [];
      var res = await sb.from('announcements')
        .select('id,title,excerpt,type,created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      return res.data || [];
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     DEDUPLICATION ENGINE
  ═══════════════════════════════════════════════════════════════════ */

  function _resetLinks() {
    _injectedLinks.clear();
  }

  function _isDuplicate(href) {
    return _injectedLinks.has(href);
  }

  function _addLink(href) {
    _injectedLinks.add(href);
  }

  function _dedupeList(items, idKey) {
    var seen = {};
    return items.filter(function (item) {
      var k = item[idKey] || item.id || JSON.stringify(item);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     RELEVANCE ENGINE — intelligent matching
  ═══════════════════════════════════════════════════════════════════ */

  /**
   * Score a PDF's relevance to a context (subject, category, exam, tags)
   * Returns a numeric score — higher = more relevant
   */
  function _scorePDF(pdf, ctx) {
    var score = 0;
    if (!ctx) return 0;

    // Same category
    if (ctx.category && pdf.category === ctx.category) score += 30;
    if (ctx.category_id && pdf.category_id === ctx.category_id) score += 25;

    // Same subject
    if (ctx.subject_id && pdf.subject_id === ctx.subject_id) score += 40;

    // Same subcategory
    if (ctx.subcategory_id && pdf.subcategory_id === ctx.subcategory_id) score += 20;

    // Title keyword overlap
    if (ctx.title && pdf.title) {
      var ctxWords = ctx.title.toLowerCase().split(/\s+/).filter(function (w) {
        return w.length > 3;
      });
      var pdfWords = pdf.title.toLowerCase();
      ctxWords.forEach(function (w) {
        if (pdfWords.indexOf(w) >= 0) score += 8;
      });
    }

    // Popularity boost
    score += Math.min(15, (pdf.download_count || 0) / 100);

    // Freshness boost (newer = slightly higher)
    if (pdf.created_at) {
      var ageDays = (Date.now() - new Date(pdf.created_at).getTime()) / 86400000;
      if (ageDays < 7) score += 5;
      else if (ageDays < 30) score += 2;
    }

    // Penalize self
    if (ctx.id && pdf.id === ctx.id) score = -1;

    return score;
  }

  function _findRelatedPDFs(ctx, limit) {
    limit = limit || CONFIG.maxRelatedItems;
    var allPDFs = _cache.all_pdfs ? _cache.all_pdfs.data : [];
    if (!allPDFs.length) return [];

    var scored = allPDFs.map(function (pdf) {
      return { pdf: pdf, score: _scorePDF(pdf, ctx) };
    }).filter(function (s) { return s.score > 0; });

    scored.sort(function (a, b) { return b.score - a.score; });

    return scored.slice(0, limit).map(function (s) { return s.pdf; });
  }

  function _findRelatedBlogPosts(ctx, limit) {
    limit = limit || CONFIG.maxRelatedItems;
    var posts = _cache.blog_posts ? _cache.blog_posts.data : [];
    if (!posts.length) return [];

    var scored = posts.map(function (post) {
      var score = 0;
      if (ctx.category && post.category === ctx.category) score += 20;
      if (ctx.tags && post.tags) {
        ctx.tags.forEach(function (t) {
          if (post.tags.indexOf(t) >= 0) score += 15;
        });
      }
      if (ctx.title && post.title) {
        var ctxWords = ctx.title.toLowerCase().split(/\s+/).filter(function (w) {
          return w.length > 3;
        });
        var postWords = post.title.toLowerCase();
        ctxWords.forEach(function (w) {
          if (postWords.indexOf(w) >= 0) score += 5;
        });
      }
      if (ctx.id && post.id === ctx.id) score = -1;
      return { post: post, score: score };
    }).filter(function (s) { return s.score > 0; });

    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, limit).map(function (s) { return s.post; });
  }

  /* ═══════════════════════════════════════════════════════════════════
     CSS INJECTION — matching existing Studyria glassmorphism
  ═══════════════════════════════════════════════════════════════════ */

  function _injectCSS() {
    if (document.getElementById('sle-styles')) return;
    var css = [
      /* Related content sections */
      '.sle-section{margin:28px 0 0;padding:0}',
      '.sle-section-title{font-family:var(--font-editorial,var(--font-display));font-size:1.05rem;font-weight:800;color:var(--text,#e2e8f0);margin-bottom:14px;display:flex;align-items:center;gap:8px;letter-spacing:-.01em}',
      '.sle-section-title .sle-icon{font-size:1.1rem}',
      '.sle-section-title .sle-count{font-size:.72rem;font-weight:600;color:var(--text2,#94a3b8);background:var(--glass,rgba(255,255,255,.05));padding:2px 8px;border-radius:10px;border:1px solid var(--glass-border,rgba(255,255,255,.1))}',

      /* Related grid — responsive cards */
      '.sle-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px}',
      '@media(max-width:640px){.sle-grid{grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}}',

      /* Related card — glassmorphism */
      '.sle-card{background:var(--card,rgba(255,255,255,.04));border:1px solid var(--border,rgba(255,255,255,.08));border-radius:14px;overflow:hidden;cursor:pointer;transition:transform .2s,box-shadow .2s,border-color .2s;display:flex;flex-direction:column}',
      '.sle-card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(0,0,0,.15);border-color:var(--accent,#3d8ef8)}',
      '.sle-card-cover{width:100%;aspect-ratio:3/4;background:linear-gradient(145deg,#0a1a50,#1555e8 55%,#0891b2);overflow:hidden;position:relative}',
      '.sle-card-cover img{width:100%;height:100%;object-fit:cover}',
      '.sle-card-badge{position:absolute;top:6px;right:6px;font-size:.6rem;font-weight:700;padding:3px 7px;border-radius:6px;background:rgba(0,0,0,.65);color:#fff;backdrop-filter:blur(4px)}',
      '.sle-card-badge.premium{background:rgba(251,191,36,.85);color:#000}',
      '.sle-card-badge.free{background:rgba(16,217,142,.8);color:#fff}',
      '.sle-card-body{padding:10px 12px 12px;flex:1;display:flex;flex-direction:column;gap:4px}',
      '.sle-card-title{font-size:.78rem;font-weight:700;color:var(--text,#e2e8f0);line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      '.sle-card-meta{font-size:.68rem;color:var(--text2,#94a3b8);margin-top:auto;display:flex;align-items:center;gap:6px}',

      /* Link pills */
      '.sle-pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}',
      '.sle-pill{padding:7px 14px;border-radius:20px;font-size:.76rem;font-weight:600;cursor:pointer;border:1px solid var(--glass-border,rgba(255,255,255,.1));background:var(--glass,rgba(255,255,255,.04));color:var(--text2,#94a3b8);transition:all .15s;text-decoration:none;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}',
      '.sle-pill:hover{border-color:var(--accent,#3d8ef8);color:var(--text,#e2e8f0);background:rgba(61,142,248,.08)}',

      /* Breadcrumbs */
      '.sle-breadcrumb{display:flex;align-items:center;flex-wrap:wrap;gap:4px;font-size:.75rem;color:var(--text2,#94a3b8);margin-bottom:16px;padding:8px 0}',
      '.sle-breadcrumb a{color:var(--text2,#94a3b8);text-decoration:none;cursor:pointer;transition:color .15s;white-space:nowrap}',
      '.sle-breadcrumb a:hover{color:var(--accent,#3d8ef8)}',
      '.sle-breadcrumb .sle-bc-sep{color:var(--text3,rgba(255,255,255,.2));font-size:.7rem}',
      '.sle-breadcrumb .sle-bc-current{color:var(--text,#e2e8f0);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}',

      /* Smart recommendation shelf */
      '.sle-shelf{margin-top:24px}',
      '.sle-shelf-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}',
      '.sle-shelf-title{font-family:var(--font-editorial,var(--font-display));font-size:1rem;font-weight:700;color:var(--text,#e2e8f0);display:flex;align-items:center;gap:6px}',
      '.sle-shelf-scroll{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;-webkit-overflow-scrolling:touch;scrollbar-width:thin}',
      '.sle-shelf-scroll::-webkit-scrollbar{height:4px}',
      '.sle-shelf-scroll::-webkit-scrollbar-thumb{background:var(--glass-border,rgba(255,255,255,.15));border-radius:2px}',
      '.sle-shelf-item{min-width:140px;max-width:160px;flex-shrink:0}',

      /* Footer dynamic links */
      '.sle-footer-col{margin-top:16px}',
      '.sle-footer-col h5{font-size:.72rem;font-weight:700;color:var(--text,#e2e8f0);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}',
      '.sle-footer-link{display:block;font-size:.78rem;color:var(--text2,#94a3b8);margin-bottom:6px;cursor:pointer;transition:color .15s;text-decoration:none}',
      '.sle-footer-link:hover{color:var(--accent,#3d8ef8)}',

      /* Topic cluster */
      '.sle-cluster{margin-top:24px;padding:18px;border-radius:16px;background:var(--glass,rgba(255,255,255,.03));border:1px solid var(--glass-border,rgba(255,255,255,.08))}',
      '.sle-cluster-title{font-size:.9rem;font-weight:700;color:var(--text,#e2e8f0);margin-bottom:12px;display:flex;align-items:center;gap:6px}',
      '.sle-cluster-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}',
      '.sle-cluster-item{padding:10px 14px;border-radius:10px;background:var(--card,rgba(255,255,255,.04));border:1px solid var(--border,rgba(255,255,255,.06));cursor:pointer;transition:all .15s;font-size:.78rem;color:var(--text2,#94a3b8)}',
      '.sle-cluster-item:hover{border-color:var(--accent,#3d8ef8);color:var(--text,#e2e8f0);background:rgba(61,142,248,.06)}',

      /* Loading skeleton */
      '.sle-skeleton{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-top:14px}',
      '.sle-skel-card{border-radius:14px;background:var(--glass,rgba(255,255,255,.03));border:1px solid var(--glass-border,rgba(255,255,255,.06));overflow:hidden}',
      '.sle-skel-cover{width:100%;aspect-ratio:3/4;background:linear-gradient(90deg,rgba(255,255,255,.03) 25%,rgba(255,255,255,.06) 50%,rgba(255,255,255,.03) 75%);background-size:200% 100%;animation:sle-shimmer 1.4s ease-in-out infinite}',
      '.sle-skel-line{height:10px;border-radius:4px;margin:8px 12px;background:rgba(255,255,255,.04)}',
      '@keyframes sle-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}',

      /* Hide on small screens */
      '@media(max-width:480px){.sle-grid{grid-template-columns:repeat(2,1fr)}.sle-card-title{font-size:.72rem}}'
    ];
    var s = document.createElement('style');
    s.id = 'sle-styles';
    s.textContent = css.join('');
    document.head.appendChild(s);
  }

  /* ═══════════════════════════════════════════════════════════════════
     BREADCRUMB ENGINE — dynamic breadcrumbs for every page
  ═══════════════════════════════════════════════════════════════════ */

  var PAGE_TITLES = {
    'home': 'Home',
    'library': 'Library',
    'detail': 'PDF Details',
    'blog': 'Blog',
    'career-hub': 'Career Hub',
    'dashboard': 'My Dashboard',
    'wishlist': 'Wishlist',
    'premium': 'Premium',
    'premium-library': 'Premium Library',
    'about': 'About Us',
    'contact': 'Contact',
    'privacy': 'Privacy Policy',
    'terms': 'Terms of Service',
    'refund': 'Refund Policy',
    'login': 'Sign In',
    'register': 'Sign Up',
    'creator-register': 'Become a Creator',
    'creator-dashboard': 'Creator Dashboard',
    'upload': 'Upload'
  };

  function _buildBreadcrumbs(page, context) {
    if (!CONFIG.enableBreadcrumbs) return '';
    var crumbs = [{ label: 'Home', page: 'home' }];

    switch (page) {
      case 'home':
        // No breadcrumb on home
        return '';
      case 'library':
        crumbs.push({ label: 'Library' });
        if (context.category) crumbs.push({ label: context.category });
        break;
      case 'detail':
        if (context.category) crumbs.push({ label: context.category, page: 'library' });
        crumbs.push({ label: 'Library', page: 'library' });
        if (context.title) crumbs.push({ label: context.title });
        else crumbs.push({ label: 'PDF Details' });
        break;
      case 'blog':
        crumbs.push({ label: 'Blog' });
        if (context.blogTitle) crumbs.push({ label: context.blogTitle });
        break;
      case 'career-hub':
        crumbs.push({ label: 'Career Hub' });
        if (context.jobTitle) crumbs.push({ label: context.jobTitle });
        break;
      case 'dashboard':
        crumbs.push({ label: 'My Dashboard' });
        break;
      case 'wishlist':
        crumbs.push({ label: 'Wishlist' });
        break;
      case 'premium':
        crumbs.push({ label: 'Premium' });
        break;
      case 'premium-library':
        crumbs.push({ label: 'Premium', page: 'premium' });
        crumbs.push({ label: 'Premium Library' });
        break;
      case 'about':
        crumbs.push({ label: 'About Us' });
        break;
      case 'contact':
        crumbs.push({ label: 'Contact' });
        break;
      case 'privacy':
        crumbs.push({ label: 'Privacy Policy' });
        break;
      case 'terms':
        crumbs.push({ label: 'Terms of Service' });
        break;
      case 'refund':
        crumbs.push({ label: 'Refund Policy' });
        break;
      default:
        if (PAGE_TITLES[page]) crumbs.push({ label: PAGE_TITLES[page] });
        break;
    }

    if (crumbs.length <= 1) return '';

    var html = '<nav class="sle-breadcrumb" aria-label="Breadcrumb" id="sleBreadcrumb">';
    crumbs.forEach(function (c, i) {
      if (i > 0) html += '<span class="sle-bc-sep" aria-hidden="true">›</span>';
      if (i === crumbs.length - 1) {
        html += '<span class="sle-bc-current">' + _esc(c.label) + '</span>';
      } else if (c.page) {
        html += '<a onclick="window.StudyriaLinkingEngine._nav(\'' + c.page + '\')">' + _esc(c.label) + '</a>';
      } else {
        html += '<span>' + _esc(c.label) + '</span>';
      }
    });
    html += '</nav>';

    // Inject JSON-LD BreadcrumbList
    if (CONFIG.enableJSONLD) _injectBreadcrumbJSONLD(crumbs);

    return html;
  }

  function _injectBreadcrumbJSONLD(crumbs) {
    // Remove old SLE breadcrumb JSON-LD
    var old = document.getElementById('sle-bc-jsonld');
    if (old) old.remove();

    var items = crumbs.map(function (c, i) {
      return {
        "@type": "ListItem",
        "position": i + 1,
        "name": c.label,
        "item": c.page ? 'https://studyria.qzz.io/#' + c.page : 'https://studyria.qzz.io/'
      };
    });

    var ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.id = 'sle-bc-jsonld';
    ld.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": items
    });
    document.head.appendChild(ld);
  }

  function _injectBreadcrumbs(page, context, container) {
    var bcHTML = _buildBreadcrumbs(page, context);
    if (!bcHTML) return;

    // Remove existing SLE breadcrumb
    var old = document.getElementById('sleBreadcrumb');
    if (old) old.remove();

    var el = document.createElement('div');
    el.innerHTML = bcHTML;
    var bc = el.firstElementChild;

    if (container) {
      container.insertBefore(bc, container.firstChild);
    } else {
      // Insert at top of the page content
      var pageEl = document.getElementById('page-' + page);
      if (pageEl) pageEl.insertBefore(bc, pageEl.firstChild);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     CARD RENDERING — reusable card builders
  ═══════════════════════════════════════════════════════════════════ */

  function _pdfCard(pdf) {
    var cover = pdf.coverImage || pdf.cover_url || '';
    var coverHTML = cover
      ? '<img src="' + _esc(cover) + '" alt="' + _esc(pdf.title) + '" loading="lazy" onerror="this.style.display=\'none\'">'
      : '';
    var price = Number(pdf.price || 0);
    var badge = price > 0
      ? '<span class="sle-card-badge premium">₹' + price + '</span>'
      : '<span class="sle-card-badge free">FREE</span>';
    var downloads = pdf.download_count || 0;
    var dlText = downloads >= 1000 ? (downloads / 1000).toFixed(1) + 'k' : downloads;

    return '<div class="sle-card" onclick="window.StudyriaLinkingEngine._openDetail(\'' + pdf.id + '\')">'
      + '<div class="sle-card-cover">' + coverHTML + badge + '</div>'
      + '<div class="sle-card-body">'
      +   '<div class="sle-card-title" title="' + _esc(pdf.title) + '">' + _esc(pdf.title) + '</div>'
      +   '<div class="sle-card-meta">'
      +     (pdf.category ? '<span>' + _esc(pdf.category) + '</span>' : '')
      +     (downloads > 0 ? '<span>· ' + dlText + ' ⬇</span>' : '')
      +   '</div>'
      + '</div></div>';
  }

  function _blogCard(post) {
    var cover = post.cover_url || '';
    var coverHTML = cover
      ? '<img src="' + _esc(cover) + '" alt="' + _esc(post.title) + '" loading="lazy" onerror="this.style.display=\'none\'">'
      : '';
    var date = post.published_at ? new Date(post.published_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

    return '<div class="sle-card" onclick="window.StudyriaLinkingEngine._openBlog(\'' + (post.slug || post.id) + '\')">'
      + '<div class="sle-card-cover" style="aspect-ratio:16/9">' + coverHTML + '</div>'
      + '<div class="sle-card-body">'
      +   '<div class="sle-card-title">' + _esc(post.title) + '</div>'
      +   '<div class="sle-card-meta">'
      +     (post.category ? '<span>' + _esc(post.category) + '</span>' : '')
      +     (date ? '<span>· ' + date + '</span>' : '')
      +   '</div>'
      + '</div></div>';
  }

  function _jobCard(job) {
    var title = job.title || 'Job Opening';
    var org = job.organization || '';
    var loc = job.location || '';
    var deadline = job.deadline ? 'Due ' + new Date(job.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

    return '<div class="sle-card" style="cursor:pointer" onclick="window.StudyriaLinkingEngine._nav(\'career-hub\')">'
      + '<div class="sle-card-body" style="padding:14px">'
      +   '<div class="sle-card-title">' + _esc(title) + '</div>'
      +   '<div class="sle-card-meta">'
      +     (org ? '<span>' + _esc(org) + '</span>' : '')
      +     (loc ? '<span>· ' + _esc(loc) + '</span>' : '')
      +     (deadline ? '<span>· ' + deadline + '</span>' : '')
      +   '</div>'
      + '</div></div>';
  }

  /* ═══════════════════════════════════════════════════════════════════
     RELATED CONTENT ENGINE — per-page-type injection
  ═══════════════════════════════════════════════════════════════════ */

  /**
   * Build a related content section with header, grid, and items
   */
  function _relatedSection(title, icon, cardsHTML, count) {
    if (!cardsHTML) return '';
    return '<div class="sle-section" id="sleRel_' + title.replace(/\s+/g, '') + '">'
      + '<div class="sle-section-title">'
      +   '<span class="sle-icon">' + icon + '</span>'
      +   '<span>' + _esc(title) + '</span>'
      +   (count ? '<span class="sle-count">' + count + '</span>' : '')
      + '</div>'
      + '<div class="sle-grid">' + cardsHTML + '</div>'
      + '</div>';
  }

  function _pillSection(title, icon, pills) {
    if (!pills.length) return '';
    var pillsHTML = pills.map(function (p) {
      return '<a class="sle-pill" onclick="' + p.action + '">' + _esc(p.label) + '</a>';
    }).join('');
    return '<div class="sle-section">'
      + '<div class="sle-section-title"><span class="sle-icon">' + icon + '</span><span>' + _esc(title) + '</span></div>'
      + '<div class="sle-pills">' + pillsHTML + '</div>'
      + '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════════
     PAGE-SPECIFIC INJECTORS
  ═══════════════════════════════════════════════════════════════════ */

  // ── PDF Detail Page ─────────────────────────────────────────────
  async function _injectPDFDetailLinks(pdf) {
    if (!pdf) return;
    var ctx = {
      id: pdf.id,
      title: pdf.title,
      category: pdf.category,
      category_id: pdf.category_id,
      subcategory_id: pdf.subcategory_id,
      subject_id: pdf.subject_id
    };

    // Find the PDP wrapper
    var pdpWrap = document.getElementById('pdpWrap');
    if (!pdpWrap) return;

    // Remove old SLE sections
    _removeOldSections(pdpWrap);

    var container = document.createElement('div');
    container.className = 'sle-container';
    container.id = 'slePDFDetailLinks';
    container.style.cssText = 'max-width:1100px;margin:0 auto;padding:0 16px 40px';

    // Breadcrumbs
    _injectBreadcrumbs('detail', { category: pdf.category, title: pdf.title }, container);

    // 1. Related PDFs (same category/subject)
    var relatedPDFs = _findRelatedPDFs(ctx, CONFIG.maxRelatedItems);
    var relatedPDFsHTML = relatedPDFs.map(_pdfCard).join('');
    container.innerHTML += _relatedSection('Related PDFs', '📚', relatedPDFsHTML, relatedPDFs.length);

    // 2. Same Subject PDFs
    if (pdf.category) {
      var sameSubject = _findRelatedPDFs({
        category_id: pdf.category_id,
        id: pdf.id
      }, CONFIG.maxRelatedItems);
      if (sameSubject.length > 0 && sameSubject.length !== relatedPDFs.length) {
        var sameSubjectHTML = sameSubject.map(_pdfCard).join('');
        container.innerHTML += _relatedSection('More in ' + pdf.category, '📂', sameSubjectHTML, sameSubject.length);
      }
    }

    // 3. Recommended Premium PDFs
    var allPDFs = _cache.all_pdfs ? _cache.all_pdfs.data : [];
    var premiumPdfs = allPDFs.filter(function (p) {
      return p.id !== pdf.id && Number(p.price || 0) > 0;
    }).sort(function (a, b) {
      return (b.download_count || 0) - (a.download_count || 0);
    }).slice(0, CONFIG.maxRelatedItems);
    var premiumHTML = premiumPdfs.map(_pdfCard).join('');
    container.innerHTML += _relatedSection('Recommended Premium', '👑', premiumHTML, premiumPdfs.length);

    // 4. Popular PDFs
    var popular = allPDFs.filter(function (p) { return p.id !== pdf.id; })
      .sort(function (a, b) { return (b.download_count || 0) - (a.download_count || 0); })
      .slice(0, CONFIG.maxRelatedItems);
    var popularHTML = popular.map(_pdfCard).join('');
    container.innerHTML += _relatedSection('Popular Resources', '🔥', popularHTML, popular.length);

    // 5. Recently Added
    var recent = allPDFs.filter(function (p) { return p.id !== pdf.id; })
      .sort(function (a, b) {
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      }).slice(0, CONFIG.maxRelatedItems);
    var recentHTML = recent.map(_pdfCard).join('');
    container.innerHTML += _relatedSection('Recently Added', '🆕', recentHTML, recent.length);

    // 6. Related Blog Articles
    var blogPosts = await _fetchBlogPosts();
    var relatedBlog = _findRelatedBlogPosts(ctx, 4);
    if (relatedBlog.length) {
      var blogHTML = relatedBlog.map(_blogCard).join('');
      container.innerHTML += _relatedSection('Related Articles', '📝', blogHTML, relatedBlog.length);
    }

    // 7. Related Jobs
    var jobs = await _fetchJobs();
    if (jobs.length) {
      var relatedJobs = jobs.slice(0, 3);
      var jobsHTML = relatedJobs.map(_jobCard).join('');
      container.innerHTML += _relatedSection('Latest Job Alerts', '💼', jobsHTML, relatedJobs.length);
    }

    // 8. Entity pills — related categories, subjects
    var categories = await _fetchCategories();
    var subjects = await _fetchSubjects();
    var entityPills = [];
    if (pdf.category_id && categories.length) {
      var cat = categories.find(function (c) { return c.id === pdf.category_id; });
      if (cat) entityPills.push({ label: cat.name, action: "window.StudyriaLinkingEngine._nav('library')" });
    }
    if (pdf.subject_id && subjects.length) {
      var subj = subjects.find(function (s) { return s.id === pdf.subject_id; });
      if (subj) entityPills.push({ label: subj.name, action: "window.StudyriaLinkingEngine._nav('library')" });
    }
    // Add category pills for all major categories
    categories.slice(0, 5).forEach(function (c) {
      if (c.id !== pdf.category_id) {
        entityPills.push({ label: c.name, action: "window.StudyriaLinkingEngine._nav('library')" });
      }
    });
    if (entityPills.length) {
      container.innerHTML += _pillSection('Explore by Category', '🏷️', entityPills.slice(0, 10));
    }

    // 9. Continue Reading / Navigation pills
    var navPills = [
      { label: '← Back to Library', action: "window.StudyriaLinkingEngine._nav('library')" },
      { label: 'Browse All PDFs', action: "window.StudyriaLinkingEngine._nav('library')" },
      { label: 'Career Hub', action: "window.StudyriaLinkingEngine._nav('career-hub')" },
      { label: 'Blog', action: "window.StudyriaLinkingEngine._nav('blog')" },
      { label: 'Premium Library', action: "window.StudyriaLinkingEngine._nav('premium-library')" }
    ];
    container.innerHTML += _pillSection('Continue Reading', '🧭', navPills);

    pdpWrap.appendChild(container);
  }

  // ── Library Page ────────────────────────────────────────────────
  async function _injectLibraryLinks() {
    var pageEl = document.getElementById('page-library');
    if (!pageEl) return;

    _removeOldSections(pageEl);

    // Breadcrumbs
    _injectBreadcrumbs('library', {}, null);

    // Find a good injection point — bottom of library content
    var libGrid = document.getElementById('libGrid');
    if (!libGrid) return;

    var container = document.createElement('div');
    container.className = 'sle-container';
    container.id = 'sleLibraryLinks';
    container.style.cssText = 'max-width:1200px;margin:0 auto;padding:24px 16px 40px';

    var allPDFs = _cache.all_pdfs ? _cache.all_pdfs.data : [];
    if (!allPDFs.length) return;

    // 1. Trending PDFs
    var trending = allPDFs.slice().sort(function (a, b) {
      return (b.download_count || 0) - (a.download_count || 0);
    }).slice(0, CONFIG.maxShelfItems);
    var trendingHTML = trending.map(_pdfCard).join('');
    container.innerHTML += _relatedSection('Trending PDFs', '🔥', trendingHTML, trending.length);

    // 2. Recently Added
    var recent = allPDFs.sort(function (a, b) {
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    }).slice(0, CONFIG.maxShelfItems);
    var recentHTML = recent.map(_pdfCard).join('');
    container.innerHTML += _relatedSection('Recently Added', '🆕', recentHTML, recent.length);

    // 3. Category pills
    var categories = await _fetchCategories();
    var catPills = categories.map(function (c) {
      return { label: c.name, action: "window.StudyriaLinkingEngine._nav('library')" };
    });
    container.innerHTML += _pillSection('Browse by Category', '🏷️', catPills);

    // 4. Related blog posts
    var blogPosts = await _fetchBlogPosts();
    if (blogPosts.length) {
      var blogHTML = blogPosts.slice(0, 4).map(_blogCard).join('');
      container.innerHTML += _relatedSection('From the Blog', '📝', blogHTML, Math.min(blogPosts.length, 4));
    }

    // 5. Latest Jobs
    var jobs = await _fetchJobs();
    if (jobs.length) {
      var jobsHTML = jobs.slice(0, 3).map(_jobCard).join('');
      container.innerHTML += _relatedSection('Latest Job Alerts', '💼', jobsHTML, Math.min(jobs.length, 3));
    }

    // Insert after the library grid
    libGrid.parentNode.insertBefore(container, libGrid.nextSibling);
  }

  // ── Blog Page ────────────────────────────────────────────────────
  async function _injectBlogLinks() {
    var pageEl = document.getElementById('page-blog');
    if (!pageEl) return;

    _removeOldSections(pageEl);

    // Breadcrumbs
    _injectBreadcrumbs('blog', {}, null);

    // Check if we're on blog list or article view
    var articleView = document.getElementById('blogArticleView');
    var listView = document.getElementById('blogListView');

    if (articleView && articleView.style.display !== 'none') {
      // Article view — inject related content after the article
      var articleContent = document.getElementById('blogArticleContent');
      if (!articleContent) return;

      var container = document.createElement('div');
      container.className = 'sle-container';
      container.id = 'sleBlogArticleLinks';
      container.style.cssText = 'max-width:980px;margin:0 auto;padding:24px 16px 40px';

      // Get current blog post context
      var blogPosts = await _fetchBlogPosts();
      var currentPost = blogPosts[0]; // Fallback — we don't have exact current post
      // Try to get from blog state
      if (window._blogState && window._blogState.currentPost) {
        currentPost = window._blogState.currentPost;
      }

      if (currentPost) {
        // 1. Related Articles
        var related = _findRelatedBlogPosts(currentPost, CONFIG.maxRelatedItems);
        var relatedHTML = related.map(_blogCard).join('');
        container.innerHTML += _relatedSection('Related Articles', '📝', relatedHTML, related.length);

        // 2. Related PDFs
        var allPDFs = _cache.all_pdfs ? _cache.all_pdfs.data : [];
        if (allPDFs.length) {
          var relatedPDFs = _findRelatedPDFs({
            title: currentPost.title,
            category: currentPost.category
          }, CONFIG.maxRelatedItems);
          var pdfHTML = relatedPDFs.map(_pdfCard).join('');
          container.innerHTML += _relatedSection('Related PDFs', '📚', pdfHTML, relatedPDFs.length);
        }
      } else {
        // Fallback: show latest posts
        var latest = blogPosts.slice(0, 4);
        var latestHTML = latest.map(_blogCard).join('');
        container.innerHTML += _relatedSection('Latest Articles', '📝', latestHTML, latest.length);
      }

      // 3. Navigation pills
      var navPills = [
        { label: '← Back to Blog', action: "window.StudyriaLinkingEngine._closeBlog()" },
        { label: 'Browse Library', action: "window.StudyriaLinkingEngine._nav('library')" },
        { label: 'Career Hub', action: "window.StudyriaLinkingEngine._nav('career-hub')" }
      ];
      container.innerHTML += _pillSection('Explore More', '🧭', navPills);

      // Insert after article content
      var articleWrap = articleView;
      articleWrap.appendChild(container);
    } else if (listView && listView.style.display !== 'none') {
      // List view — add related content at bottom
      var pagination = document.getElementById('blogPagination');
      if (!pagination) return;

      var container2 = document.createElement('div');
      container2.className = 'sle-container';
      container2.id = 'sleBlogListLinks';
      container2.style.cssText = 'max-width:1180px;margin:0 auto;padding:24px 16px 40px';

      // 1. Popular PDFs
      var allPDFs2 = _cache.all_pdfs ? _cache.all_pdfs.data : [];
      if (allPDFs2.length) {
        var popular = allPDFs2.sort(function (a, b) {
          return (b.download_count || 0) - (a.download_count || 0);
        }).slice(0, CONFIG.maxRelatedItems);
        var popularHTML = popular.map(_pdfCard).join('');
        container2.innerHTML += _relatedSection('Popular PDFs', '🔥', popularHTML, popular.length);
      }

      // 2. Latest Jobs
      var jobs2 = await _fetchJobs();
      if (jobs2.length) {
        var jobsHTML = jobs2.slice(0, 3).map(_jobCard).join('');
        container2.innerHTML += _relatedSection('Latest Jobs', '💼', jobsHTML, Math.min(jobs2.length, 3));
      }

      // 3. Navigation pills
      var navPills2 = [
        { label: 'Browse Library', action: "window.StudyriaLinkingEngine._nav('library')" },
        { label: 'Career Hub', action: "window.StudyriaLinkingEngine._nav('career-hub')" },
        { label: 'Premium', action: "window.StudyriaLinkingEngine._nav('premium')" }
      ];
      container2.innerHTML += _pillSection('Explore Studyria', '🧭', navPills2);

      pagination.parentNode.insertBefore(container2, pagination.nextSibling);
    }
  }

  // ── Career Hub Page ─────────────────────────────────────────────
  async function _injectCareerHubLinks() {
    var pageEl = document.getElementById('page-career-hub');
    if (!pageEl) return;

    _removeOldSections(pageEl);

    _injectBreadcrumbs('career-hub', {}, null);

    var container = document.createElement('div');
    container.className = 'sle-container';
    container.id = 'sleCareerHubLinks';
    container.style.cssText = 'max-width:900px;margin:0 auto;padding:24px 16px 40px';

    // 1. Related PDFs (exam prep)
    var allPDFs = _cache.all_pdfs ? _cache.all_pdfs.data : [];
    if (allPDFs.length) {
      var examPDFs = allPDFs.filter(function (p) {
        return p.title && /exam|test|paper|question|adpsc|adre|police|tet/i.test(p.title);
      }).slice(0, CONFIG.maxRelatedItems);
      if (examPDFs.length < 3) examPDFs = allPDFs.slice(0, CONFIG.maxRelatedItems);
      var pdfHTML = examPDFs.map(_pdfCard).join('');
      container.innerHTML += _relatedSection('Exam Preparation PDFs', '📚', pdfHTML, examPDFs.length);
    }

    // 2. Blog articles about careers
    var blogPosts = await _fetchBlogPosts();
    if (blogPosts.length) {
      var careerBlog = blogPosts.filter(function (p) {
        return p.title && /career|job|exam|preparation|study/i.test(p.title);
      }).slice(0, 4);
      if (careerBlog.length < 2) careerBlog = blogPosts.slice(0, 4);
      var blogHTML = careerBlog.map(_blogCard).join('');
      container.innerHTML += _relatedSection('Career Guides', '📝', blogHTML, careerBlog.length);
    }

    // 3. Navigation pills
    var navPills = [
      { label: 'Browse Library', action: "window.StudyriaLinkingEngine._nav('library')" },
      { label: 'Premium Library', action: "window.StudyriaLinkingEngine._nav('premium-library')" },
      { label: 'Blog', action: "window.StudyriaLinkingEngine._nav('blog')" },
      { label: 'Dashboard', action: "window.StudyriaLinkingEngine._nav('dashboard')" }
    ];
    container.innerHTML += _pillSection('Explore Studyria', '🧭', navPills);

    // Insert at end of career hub
    pageEl.appendChild(container);
  }

  // ── Homepage Links ───────────────────────────────────────────────
  async function _injectHomepageLinks() {
    if (!CONFIG.enableHomepageLinks) return;
    var pageEl = document.getElementById('page-home');
    if (!pageEl) return;

    _removeOldSections(pageEl);

    // Find injection point — before footer
    var container = document.createElement('div');
    container.className = 'sle-container';
    container.id = 'sleHomepageLinks';
    container.style.cssText = 'max-width:1200px;margin:0 auto;padding:28px 16px 40px';

    var allPDFs = _cache.all_pdfs ? _cache.all_pdfs.data : [];

    if (allPDFs.length) {
      // 1. Trending PDFs
      var trending = allPDFs.slice().sort(function (a, b) {
        return (b.download_count || 0) - (a.download_count || 0);
      }).slice(0, CONFIG.maxShelfItems);
      var trendingHTML = trending.map(_pdfCard).join('');
      container.innerHTML += _relatedSection('🔥 Trending PDFs', '🔥', trendingHTML, trending.length);

      // 2. Recently Added
      var recent = allPDFs.sort(function (a, b) {
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      }).slice(0, CONFIG.maxShelfItems);
      var recentHTML = recent.map(_pdfCard).join('');
      container.innerHTML += _relatedSection('🆕 Recently Added', '🆕', recentHTML, recent.length);
    }

    // 3. Popular categories pills
    var categories = await _fetchCategories();
    var catPills = categories.slice(0, 10).map(function (c) {
      return { label: c.name, action: "window.StudyriaLinkingEngine._nav('library')" };
    });
    container.innerHTML += _pillSection('Popular Categories', '🏷️', catPills);

    // 4. From the Blog
    var blogPosts = await _fetchBlogPosts();
    if (blogPosts.length) {
      var blogHTML = blogPosts.slice(0, 4).map(_blogCard).join('');
      container.innerHTML += _relatedSection('📝 Latest from Blog', '📝', blogHTML, Math.min(blogPosts.length, 4));
    }

    // 5. Latest Job Alerts
    var jobs = await _fetchJobs();
    if (jobs.length) {
      var jobsHTML = jobs.slice(0, 3).map(_jobCard).join('');
      container.innerHTML += _relatedSection('💼 Latest Job Alerts', '💼', jobsHTML, Math.min(jobs.length, 3));
    }

    // 6. Featured collections pills
    var featPills = [
      { label: '📚 Browse Library', action: "window.StudyriaLinkingEngine._nav('library')" },
      { label: '👑 Premium Library', action: "window.StudyriaLinkingEngine._nav('premium-library')" },
      { label: '💼 Career Hub', action: "window.StudyriaLinkingEngine._nav('career-hub')" },
      { label: '📝 Blog', action: "window.StudyriaLinkingEngine._nav('blog')" },
      { label: '📊 Dashboard', action: "window.StudyriaLinkingEngine._nav('dashboard')" }
    ];
    container.innerHTML += _pillSection('Featured Collections', '✨', featPills);

    // Insert before footer
    var footer = document.getElementById('siteFooter');
    if (footer) {
      footer.parentNode.insertBefore(container, footer);
    } else {
      pageEl.appendChild(container);
    }
  }

  // ── Dashboard Links ─────────────────────────────────────────────
  async function _injectDashboardLinks() {
    var pageEl = document.getElementById('page-dashboard');
    if (!pageEl) return;

    _removeOldSections(pageEl);
    _injectBreadcrumbs('dashboard', {}, null);

    var container = document.createElement('div');
    container.className = 'sle-container';
    container.id = 'sleDashboardLinks';
    container.style.cssText = 'max-width:1100px;margin:0 auto;padding:24px 16px 40px';

    // Recommended PDFs
    var allPDFs = _cache.all_pdfs ? _cache.all_pdfs.data : [];
    if (allPDFs.length) {
      var recommended = allPDFs.sort(function (a, b) {
        return (b.download_count || 0) - (a.download_count || 0);
      }).slice(0, CONFIG.maxRelatedItems);
      var recHTML = recommended.map(_pdfCard).join('');
      container.innerHTML += _relatedSection('Recommended for You', '⭐', recHTML, recommended.length);
    }

    // Navigation pills
    var navPills = [
      { label: '📚 Library', action: "window.StudyriaLinkingEngine._nav('library')" },
      { label: '👑 Premium', action: "window.StudyriaLinkingEngine._nav('premium')" },
      { label: '💼 Career Hub', action: "window.StudyriaLinkingEngine._nav('career-hub')" },
      { label: '📝 Blog', action: "window.StudyriaLinkingEngine._nav('blog')" },
      { label: '❤️ Wishlist', action: "window.StudyriaLinkingEngine._nav('wishlist')" }
    ];
    container.innerHTML += _pillSection('Quick Access', '🧭', navPills);

    pageEl.appendChild(container);
  }

  // ── Premium Library Links ────────────────────────────────────────
  async function _injectPremiumLibraryLinks() {
    var pageEl = document.getElementById('page-premium-library');
    if (!pageEl) return;

    _removeOldSections(pageEl);
    _injectBreadcrumbs('premium-library', {}, null);

    var container = document.createElement('div');
    container.className = 'sle-container';
    container.id = 'slePremiumLibraryLinks';
    container.style.cssText = 'max-width:1100px;margin:0 auto;padding:24px 16px 40px';

    // Premium PDFs
    var allPDFs = _cache.all_pdfs ? _cache.all_pdfs.data : [];
    var premium = allPDFs.filter(function (p) { return Number(p.price || 0) > 0; });
    if (premium.length) {
      var premiumHTML = premium.slice(0, CONFIG.maxShelfItems).map(_pdfCard).join('');
      container.innerHTML += _relatedSection('Premium PDFs', '👑', premiumHTML, premium.length);
    }

    // Free PDFs to try
    var free = allPDFs.filter(function (p) { return Number(p.price || 0) === 0; })
      .sort(function (a, b) { return (b.download_count || 0) - (a.download_count || 0); })
      .slice(0, CONFIG.maxRelatedItems);
    if (free.length) {
      var freeHTML = free.map(_pdfCard).join('');
      container.innerHTML += _relatedSection('Free PDFs to Try', '🎁', freeHTML, free.length);
    }

    pageEl.appendChild(container);
  }

  // ── About/Contact/Static Pages ──────────────────────────────────
  async function _injectStaticPageLinks(page) {
    var pageEl = document.getElementById('page-' + page);
    if (!pageEl) return;

    _removeOldSections(pageEl);
    _injectBreadcrumbs(page, {}, null);

    var container = document.createElement('div');
    container.className = 'sle-container';
    container.id = 'sleStaticLinks_' + page;
    container.style.cssText = 'max-width:1100px;margin:0 auto;padding:24px 16px 40px';

    // Navigation pills
    var navPills = [
      { label: '🏠 Home', action: "window.StudyriaLinkingEngine._nav('home')" },
      { label: '📚 Library', action: "window.StudyriaLinkingEngine._nav('library')" },
      { label: '📝 Blog', action: "window.StudyriaLinkingEngine._nav('blog')" },
      { label: '💼 Career Hub', action: "window.StudyriaLinkingEngine._nav('career-hub')" },
      { label: '👑 Premium', action: "window.StudyriaLinkingEngine._nav('premium')" }
    ];
    container.innerHTML += _pillSection('Explore Studyria', '🧭', navPills);

    pageEl.appendChild(container);
  }

  /* ═══════════════════════════════════════════════════════════════════
     FOOTER LINKING — intelligent dynamic links
  ═══════════════════════════════════════════════════════════════════ */

  async function _injectFooterLinks() {
    if (!CONFIG.enableFooterLinks) return;
    var footer = document.getElementById('siteFooter');
    if (!footer) return;

    // Remove old SLE footer links
    var old = document.getElementById('sleFooterLinks');
    if (old) old.remove();

    var sfGrid = footer.querySelector('.sf-grid');
    if (!sfGrid) return;

    // Create dynamic footer column
    var col = document.createElement('div');
    col.className = 'sf-col sle-footer-col';
    col.id = 'sleFooterLinks';

    var html = '<div class="sf-col-title">📚 Study Resources</div><ul class="sf-col-links">';

    // Popular categories
    var categories = await _fetchCategories();
    if (categories.length) {
      categories.slice(0, CONFIG.maxFooterLinks).forEach(function (c) {
        html += '<li><span onclick="window.StudyriaLinkingEngine._nav(\'library\')">📖 ' + _esc(c.name) + ' <span class="sf-link-arrow">›</span></span></li>';
      });
    }

    // Popular subjects
    var subjects = await _fetchSubjects();
    if (subjects.length) {
      html += '<li><span onclick="window.StudyriaLinkingEngine._nav(\'library\')">📐 ' + _esc(subjects[0].name) + ' <span class="sf-link-arrow">›</span></span></li>';
    }

    html += '<li><span onclick="window.StudyriaLinkingEngine._nav(\'premium-library\')">👑 Premium Library <span class="sf-link-arrow">›</span></span></li>';
    html += '<li><span onclick="window.StudyriaLinkingEngine._nav(\'career-hub\')">💼 Latest Jobs <span class="sf-link-arrow">›</span></span></li>';
    html += '<li><span onclick="window.StudyriaLinkingEngine._nav(\'blog\')">📝 Blog & Guides <span class="sf-link-arrow">›</span></span></li>';
    html += '</ul>';

    col.innerHTML = html;
    sfGrid.appendChild(col);
  }

  /* ═══════════════════════════════════════════════════════════════════
     SEARCH LINKING — enhance search with suggestions
  ═══════════════════════════════════════════════════════════════════ */

  async function _injectSearchLinks() {
    if (!CONFIG.enableSearchLinks) return;
    var libSearch = document.getElementById('libSearch');
    if (!libSearch) return;

    // Remove old suggestions
    var old = document.getElementById('sleSearchSuggestions');
    if (old) old.remove();

    var categories = await _fetchCategories();
    var subjects = await _fetchSubjects();

    var suggestedTopics = ['ADRE', 'APSC', 'Assam Police', 'Assam TET', 'General Knowledge', 'Current Affairs'];
    var suggestedExams = ['ADRE 2.0', 'APSC CCE', 'Assam Police SI', 'TET 2024', 'HSLC'];

    var container = document.createElement('div');
    container.className = 'sle-section';
    container.id = 'sleSearchSuggestions';
    container.style.cssText = 'padding:16px 0';

    var pills = [];
    suggestedTopics.forEach(function (t) {
      pills.push({ label: '🔍 ' + t, action: "document.getElementById('libSearch').value='" + t + "';if(typeof renderLibGrid==='function')renderLibGrid()" });
    });
    suggestedExams.forEach(function (e) {
      pills.push({ label: '🎯 ' + e, action: "document.getElementById('libSearch').value='" + e + "';if(typeof renderLibGrid==='function')renderLibGrid()" });
    });
    categories.slice(0, 5).forEach(function (c) {
      pills.push({ label: '📂 ' + c.name, action: "window.StudyriaLinkingEngine._nav('library')" });
    });

    container.innerHTML = _pillSection('Suggested Searches', '💡', pills);

    // Insert after the search input
    var libGrid = document.getElementById('libGrid');
    if (libGrid && libGrid.parentNode) {
      libGrid.parentNode.insertBefore(container, libGrid);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     TOPIC CLUSTER ENGINE — build interconnected topic pages
  ═══════════════════════════════════════════════════════════════════ */

  async function _injectTopicClusters(page, context) {
    if (!CONFIG.enableTopicClusters) return;

    var container = document.getElementById('sle' + page.charAt(0).toUpperCase() + page.slice(1) + 'Links');
    if (!container) return;

    var categories = await _fetchCategories();
    var subjects = await _fetchSubjects();
    var allPDFs = _cache.all_pdfs ? _cache.all_pdfs.data : [];

    // Build cluster items
    var clusterItems = [];

    // Add categories as cluster nodes
    categories.slice(0, 6).forEach(function (c) {
      var count = allPDFs.filter(function (p) { return p.category_id === c.id; }).length;
      clusterItems.push({
        label: c.name + (count ? ' (' + count + ')' : ''),
        action: "window.StudyriaLinkingEngine._nav('library')"
      });
    });

    // Add subjects
    subjects.slice(0, 4).forEach(function (s) {
      clusterItems.push({
        label: s.name,
        action: "window.StudyriaLinkingEngine._nav('library')"
      });
    });

    if (clusterItems.length >= 3) {
      var clusterHTML = '<div class="sle-cluster">'
        + '<div class="sle-cluster-title">🔗 Topic Cluster</div>'
        + '<div class="sle-cluster-grid">'
        + clusterItems.map(function (item) {
            return '<div class="sle-cluster-item" onclick="' + item.action + '">' + _esc(item.label) + '</div>';
          }).join('')
        + '</div></div>';

      container.insertAdjacentHTML('beforeend', clusterHTML);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     JSON-LD INJECTION — per-page structured data
  ═══════════════════════════════════════════════════════════════════ */

  function _injectPageJSONLD(page, context) {
    if (!CONFIG.enableJSONLD) return;

    // Remove old SLE page JSON-LD
    var old = document.getElementById('sle-page-jsonld');
    if (old) old.remove();

    var ld = { "@context": "https://schema.org" };

    switch (page) {
      case 'detail':
        if (context.pdf) {
          ld["@type"] = "Book";
          ld["name"] = context.pdf.title || 'Untitled';
          ld["description"] = context.pdf.description || '';
          ld["url"] = 'https://studyria.qzz.io/#detail';
          ld["inLanguage"] = "en-IN";
          ld["author"] = { "@id": "https://studyria.qzz.io/#organization" };
          ld["publisher"] = { "@id": "https://studyria.qzz.io/#organization" };
          if (context.pdf.category) ld["about"] = context.pdf.category;
          if (context.pdf.price !== undefined) {
            ld["offers"] = {
              "@type": "Offer",
              "price": String(context.pdf.price || 0),
              "priceCurrency": "INR",
              "availability": "https://schema.org/InStock"
            };
          }
        }
        break;
      case 'library':
        ld["@type"] = "CollectionPage";
        ld["name"] = "Studyria Library — PDF Study Materials";
        ld["url"] = "https://studyria.qzz.io/#library";
        ld["description"] = "Browse all PDF study materials for ADRE, APSC, Assam Police and all Assam competitive exams.";
        ld["isPartOf"] = { "@id": "https://studyria.qzz.io/#website" };
        break;
      case 'blog':
        ld["@type"] = "Blog";
        ld["name"] = "Studyria Blog";
        ld["url"] = "https://studyria.qzz.io/#blog";
        ld["description"] = "Exam tips, study guides and career advice for Assam's students.";
        ld["publisher"] = { "@id": "https://studyria.qzz.io/#organization" };
        break;
      case 'career-hub':
        ld["@type"] = "WebPage";
        ld["name"] = "Studyria Career Hub — Jobs & Opportunities";
        ld["url"] = "https://studyria.qzz.io/#career-hub";
        ld["description"] = "Latest job alerts, career opportunities and exam notifications for Assam.";
        ld["isPartOf"] = { "@id": "https://studyria.qzz.io/#website" };
        break;
      default:
        return; // Don't inject for unknown pages
    }

    if (ld["@type"]) {
      var script = document.createElement('script');
      script.type = 'application/ld+json';
      script.id = 'sle-page-jsonld';
      script.textContent = JSON.stringify(ld);
      document.head.appendChild(script);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     UTILITIES
  ═══════════════════════════════════════════════════════════════════ */

  function _removeOldSections(container) {
    var old = container.querySelectorAll('.sle-container, #sleBreadcrumb');
    old.forEach(function (el) { el.remove(); });
  }

  function _openBlog(slug) {
    // Find blog post and open it
    if (typeof window.openBlogPost === 'function') {
      window.openBlogPost(slug);
    } else if (typeof window._openBlogPost === 'function') {
      window._openBlogPost(slug);
    } else {
      // Fallback: navigate to blog and search
      _nav('blog');
    }
  }

  function _closeBlog() {
    if (typeof window.closeBlogPost === 'function') {
      window.closeBlogPost();
    } else {
      var lv = document.getElementById('blogListView');
      var av = document.getElementById('blogArticleView');
      if (lv) lv.style.display = '';
      if (av) av.style.display = 'none';
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     MAIN DISPATCHER — called after every navigation
  ═══════════════════════════════════════════════════════════════════ */

  async function _dispatch(page) {
    _currentPage = page;
    _resetLinks();

    // Wait for DOM to settle
    await new Promise(function (r) { setTimeout(r, CONFIG.renderDelay); });

    if (page !== _currentPage) return; // navigated away

    // Pre-fetch data in parallel
    await Promise.allSettled([
      _fetchAllPDFs(),
      _fetchCategories(),
      _fetchSubjects(),
      _fetchBlogPosts(),
      _fetchJobs()
    ]);

    if (page !== _currentPage) return;

    // Detect context based on page
    var context = {};
    if (page === 'detail' && typeof selectedPdf !== 'undefined' && selectedPdf) {
      context.pdf = selectedPdf;
      context.title = selectedPdf.title;
      context.category = selectedPdf.category;
      context.category_id = selectedPdf.category_id;
      context.subject_id = selectedPdf.subject_id;
    }

    // Fallback: if detail page but selectedPdf not ready, wait and retry
    if (page === 'detail' && (typeof selectedPdf === 'undefined' || !selectedPdf)) {
      var _retryCount = 0;
      var _retryTimer = setInterval(function() {
        _retryCount++;
        if (typeof selectedPdf !== 'undefined' && selectedPdf && document.getElementById('pdpWrap')) {
          clearInterval(_retryTimer);
          if (_currentPage === 'detail') _dispatch('detail');
        }
        if (_retryCount > 10) clearInterval(_retryTimer); // 5s timeout
      }, 500);
      return;
    }

    // Fallback: if detail page and pdpWrap not yet rendered, wait for it
    if (page === 'detail' && !document.getElementById('pdpWrap')) {
      var _pdpObserver = new MutationObserver(function(mutations, obs) {
        if (document.getElementById('pdpWrap')) {
          obs.disconnect();
          if (_currentPage === 'detail') _dispatch('detail');
        }
      });
      _pdpObserver.observe(document.body, { childList: true, subtree: true });
      setTimeout(function() { _pdpObserver.disconnect(); }, 5000);
      return;
    }

    // Dispatch to page-specific injector
    try {
      switch (page) {
        case 'home':
          await _injectHomepageLinks();
          break;
        case 'library':
          await _injectLibraryLinks();
          await _injectSearchLinks();
          break;
        case 'detail':
          await _injectPDFDetailLinks(selectedPdf || context.pdf);
          break;
        case 'blog':
          await _injectBlogLinks();
          break;
        case 'career-hub':
          await _injectCareerHubLinks();
          break;
        case 'dashboard':
          await _injectDashboardLinks();
          break;
        case 'premium-library':
          await _injectPremiumLibraryLinks();
          break;
        case 'premium':
        case 'wishlist':
          await _injectStaticPageLinks(page);
          break;
        case 'about':
        case 'contact':
        case 'privacy':
        case 'terms':
        case 'refund':
          await _injectStaticPageLinks(page);
          break;
        default:
          break;
      }

      // Inject topic clusters (additive to existing sections)
      if (['home', 'library', 'detail', 'career-hub'].indexOf(page) >= 0) {
        await _injectTopicClusters(page, context);
      }

      // Inject JSON-LD
      _injectPageJSONLD(page, context);

      // Inject footer links (once per session, refreshed periodically)
      await _injectFooterLinks();

    } catch (e) {
      console.warn('[SLE] Injection error for page', page, e.message || e);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
     INITIALIZATION — hook into SPA navigation
  ═══════════════════════════════════════════════════════════════════ */

  function _init() {
    _injectCSS();

    // Hook into navigate via studyria:navigate custom event
    document.addEventListener('studyria:navigate', function (e) {
      var detail = e.detail || {};
      var page = (typeof detail === 'string') ? detail : (detail.page || e.page || window.currentPage);
      if (!page) return;

      // Debounce rapid navigations
      if (_renderTimer) clearTimeout(_renderTimer);
      _renderTimer = setTimeout(function () {
        _dispatch(page);
      }, CONFIG.debounceMs);
    });

    // Also hook into popstate (back/forward)
    window.addEventListener('popstate', function () {
      var page = window.currentPage || (location.hash || '#home').replace('#', '');
      if (_renderTimer) clearTimeout(_renderTimer);
      _renderTimer = setTimeout(function () {
        _dispatch(page);
      }, CONFIG.debounceMs + 50);
    });

    // Initial render for current page
    var initialPage = window.currentPage || (location.hash || '#home').replace('#', '') || 'home';
    _renderTimer = setTimeout(function () {
      _dispatch(initialPage);
    }, CONFIG.renderDelay + 200);

    console.log('[SLE] Studyria Linking Engine v1.0 initialized');
  }

  /* ═══════════════════════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════════════════════ */

  window.StudyriaLinkingEngine = {
    _version: '1.0',
    _nav: _nav,
    _openDetail: _openDetail,
    _openBlog: _openBlog,
    _closeBlog: _closeBlog,
    _dispatch: _dispatch,
    config: CONFIG
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})();
