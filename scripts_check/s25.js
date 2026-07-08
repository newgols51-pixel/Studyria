
  // ══════════════════════════════════════════════════════════════════
  // BLOG — front-end logic (list, filters, article view, SEO metadata)
  // Self-contained: reads/writes only blog-* DOM ids and window.loadBlog*
  // helpers from supabase.js. Does not touch any other page's code.
  // ══════════════════════════════════════════════════════════════════
  window._blogState = { page: 0, pageSize: 12, category: '', tag: '', search: '' };

  async function renderBlogList() {
    await Promise.all([_blogRenderCategoryChips(), _blogRenderTagChips()]);
    await _blogFetchAndRenderGrid();
  }

  async function _blogRenderCategoryChips() {
    const wrap = document.getElementById('blogCategoryFilters');
    if (!wrap || !window.loadBlogCategories) return;
    const cats = await window.loadBlogCategories();
    const s = window._blogState;
    wrap.innerHTML = `<span class="blog-chip ${!s.category ? 'active' : ''}" onclick="blogSetCategory('')">All</span>` +
      cats.map(c => `<span class="blog-chip ${s.category === c ? 'active' : ''}" onclick="blogSetCategory('${c.replace(/'/g, "\\'")}')">${_esc(c)}</span>`).join('');
  }

  async function _blogRenderTagChips() {
    const wrap = document.getElementById('blogTagFilters');
    if (!wrap || !window.loadBlogTags) return;
    const tags = await window.loadBlogTags();
    const s = window._blogState;
    if (!tags.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = tags.slice(0, 14).map(t =>
      `<span class="blog-chip ${s.tag === t ? 'active' : ''}" style="font-size:.72rem;padding:5px 12px" onclick="blogSetTag('${t.replace(/'/g, "\\'")}')">#${_esc(t)}</span>`
    ).join('');
  }

  window.blogSetCategory = function (cat) {
    window._blogState.category = window._blogState.category === cat ? '' : cat;
    window._blogState.page = 0;
    renderBlogList();
  };
  window.blogSetTag = function (tag) {
    window._blogState.tag = window._blogState.tag === tag ? '' : tag;
    window._blogState.page = 0;
    renderBlogList();
  };
  let _blogSearchTimer = null;
  window.blogDebouncedSearch = function () {
    clearTimeout(_blogSearchTimer);
    _blogSearchTimer = setTimeout(() => {
      window._blogState.search = (document.getElementById('blogSearchInput')?.value || '').trim();
      window._blogState.page = 0;
      _blogFetchAndRenderGrid();
    }, 350);
  };

  async function _blogFetchAndRenderGrid() {
    const grid = document.getElementById('blogGrid');
    const pager = document.getElementById('blogPagination');
    if (!grid) return;
    grid.innerHTML = `<div class="blog-empty">⏳ Loading articles…</div>`;
    const s = window._blogState;
    if (!window.loadBlogPosts) { grid.innerHTML = `<div class="blog-empty">Blog is temporarily unavailable.</div>`; return; }
    const { posts, total } = await window.loadBlogPosts({
      category: s.category || undefined,
      tag: s.tag || undefined,
      search: s.search || undefined,
      limit: s.pageSize,
      offset: s.page * s.pageSize,
    });
    if (!posts.length) {
      grid.innerHTML = `<div class="blog-empty">📭 No articles found${s.search ? ` for "${_esc(s.search)}"` : ''}. Check back soon!</div>`;
      if (pager) pager.innerHTML = '';
      return;
    }
    grid.innerHTML = posts.map(_blogCardHTML).join('');
    const pageCount = Math.max(1, Math.ceil(total / s.pageSize));
    if (pager) {
      if (pageCount <= 1) { pager.innerHTML = ''; }
      else {
        let btns = '';
        for (let i = 0; i < pageCount; i++) {
          btns += `<button class="${i === s.page ? 'active' : ''}" onclick="blogGoPage(${i})">${i + 1}</button>`;
        }
        pager.innerHTML = btns;
      }
    }
  }

  window.blogGoPage = function (n) {
    window._blogState.page = n;
    _blogFetchAndRenderGrid();
    document.getElementById('blogListView')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  function _blogCardHTML(p) {
    const dateStr = p.published_at ? new Date(p.published_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    const cover = p.cover_image
      ? `<img src="${p.cover_image}" alt="${_esc(p.title)}" loading="lazy">`
      : `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.2" opacity="0.85"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    return `
    <div class="blog-card" onclick="openBlogPost('${p.slug}')">
      <div class="blog-card-cover">${cover}</div>
      <div class="blog-card-body">
        ${p.category ? `<div class="blog-card-cat">${_esc(p.category)}</div>` : ''}
        <div class="blog-card-title">${_esc(p.title)}</div>
        ${p.excerpt ? `<div class="blog-card-excerpt">${_esc(p.excerpt)}</div>` : ''}
        <div class="blog-card-meta">
          <span>✍️ ${_esc(p.author_name || 'Studyria Team')}</span>
          ${dateStr ? `<span>· ${dateStr}</span>` : ''}
          ${p.view_count ? `<span>· 👁 ${Number(p.view_count).toLocaleString()}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  // ── Article view ──────────────────────────────────────────────────
  window.openBlogPost = async function (slug, fromRoute) {
    const listV = document.getElementById('blogListView');
    const artV  = document.getElementById('blogArticleView');
    const body  = document.getElementById('blogArticleContent');
    if (!listV || !artV || !body) return;

    listV.style.display = 'none';
    artV.style.display  = '';
    body.innerHTML = `<div class="blog-empty">⏳ Loading article…</div>`;
    window.scrollTo(0, 0);

    if (!fromRoute) {
      const hash = '#blog/' + encodeURIComponent(slug);
      if (location.hash !== hash) history.pushState({ page: 'blog/' + slug }, '', hash);
    }

    const post = window.loadBlogPostBySlug ? await window.loadBlogPostBySlug(slug) : null;
    if (!post) {
      body.innerHTML = `<div class="blog-empty">😕 This article couldn't be found. <a onclick="closeBlogPost()" style="color:var(--accent);cursor:pointer">Back to Blog</a></div>`;
      return;
    }
    window._blogCurrentPost = post;

    const dateStr = post.published_at ? new Date(post.published_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    const coverHTML = post.cover_image ? `<div class="blog-article-cover"><img src="${post.cover_image}" alt="${_esc(post.title)}" decoding="async"></div>` : '';
    const tagsHTML = (post.tags && post.tags.length)
      ? `<div class="blog-article-tags">${post.tags.map(t => `<span class="blog-tag-pill">#${_esc(t)}</span>`).join('')}</div>` : '';

    body.innerHTML = `
      <div class="blog-article-header">
        ${post.category ? `<div class="blog-article-cat">${_esc(post.category)}</div>` : ''}
        <h1 class="blog-article-title">${_esc(post.title)}</h1>
        <div class="blog-article-meta">
          <span>✍️ ${_esc(post.author_name || 'Studyria Team')}</span>
          ${dateStr ? `<span>· ${dateStr}</span>` : ''}
          <span>· 👁 ${Number(post.view_count || 0).toLocaleString()} views</span>
        </div>
      </div>
      ${coverHTML}
      <div class="blog-article-body">${post.content}</div>
      ${tagsHTML}
      <div class="blog-related" id="blogRelatedWrap"></div>
    `;

    _blogSetMeta(post);

    // Related posts
    const relWrap = document.getElementById('blogRelatedWrap');
    if (relWrap && window.loadRelatedBlogPosts) {
      const related = await window.loadRelatedBlogPosts(post, 3);
      if (related.length) {
        relWrap.innerHTML = `<h3>You might also like</h3><div class="blog-grid">${related.map(_blogCardHTML).join('')}</div>`;
      }
    }
  };

  window.closeBlogPost = function () {
    _blogResetMeta();
    if (location.hash.indexOf('#blog/') === 0) history.pushState({ page: 'blog' }, '', '#blog');
    navigate('blog');
  };

  // ── Dynamic SEO metadata (first feature on this site to do this) ───
  window._blogDefaultMeta = null;
  function _blogSetMeta(post) {
    if (!window._blogDefaultMeta) {
      window._blogDefaultMeta = {
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content || '',
        ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
        ogDesc: document.querySelector('meta[property="og:description"]')?.content || '',
        ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
        canonical: document.querySelector('link[rel="canonical"]')?.href || '',
      };
    }
    const title = (post.meta_title || post.title) + ' | Studyria Blog';
    const desc  = post.meta_description || post.excerpt || '';
    document.title = title;
    _blogSetTag('meta[name="description"]', 'content', desc);
    _blogSetTag('meta[property="og:title"]', 'content', title);
    _blogSetTag('meta[property="og:description"]', 'content', desc);
    if (post.cover_image) _blogSetTag('meta[property="og:image"]', 'content', post.cover_image);
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    if (canonicalEl) canonicalEl.href = 'https://studyria.qzz.io/#blog/' + encodeURIComponent(post.slug);

    // JSON-LD Article structured data
    let ld = document.getElementById('blogArticleLd');
    if (!ld) { ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.id = 'blogArticleLd'; document.head.appendChild(ld); }
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: desc,
      image: post.cover_image ? [post.cover_image] : undefined,
      datePublished: post.published_at || post.created_at,
      dateModified: post.updated_at || post.published_at || post.created_at,
      author: { '@type': 'Organization', name: post.author_name || 'Studyria Team' },
      publisher: { '@type': 'Organization', name: 'Studyria' },
    });
  }
  window._blogResetMeta = function _blogResetMeta() {
    const d = window._blogDefaultMeta;
    if (!d) return;
    document.title = d.title;
    _blogSetTag('meta[name="description"]', 'content', d.description);
    _blogSetTag('meta[property="og:title"]', 'content', d.ogTitle);
    _blogSetTag('meta[property="og:description"]', 'content', d.ogDesc);
    _blogSetTag('meta[property="og:image"]', 'content', d.ogImage);
    const canonicalEl = document.querySelector('link[rel="canonical"]');
    if (canonicalEl && d.canonical) canonicalEl.href = d.canonical;
    const ld = document.getElementById('blogArticleLd');
    if (ld) ld.remove();
  };
  function _blogSetTag(selector, attr, value) {
    if (value == null) return;
    const el = document.querySelector(selector);
    if (el) el.setAttribute(attr, value);
  }

  // ── Slug routing: #blog/{slug} works from direct links, back/forward,
  // and page refresh — without touching the core navigate()/popstate code.
  (function () {
    function wrapForBlogRouting() {
      if (typeof window.navigate !== 'function' || window.navigate.__blogWrapped) return;
      const original = window.navigate;
      const wrapped = function (page) {
        if (typeof page === 'string' && page.indexOf('blog/') === 0) {
          const slug = decodeURIComponent(page.slice(5));
          const p = original('blog');
          return (p && p.then ? p : Promise.resolve()).then(() => { window.openBlogPost(slug, true); });
        }
        return original.apply(this, arguments);
      };
      wrapped.__blogWrapped = true;
      window.navigate = wrapped;
    }
    let attempts = 0;
    const t = setInterval(() => { wrapForBlogRouting(); if (++attempts > 40) clearInterval(t); }, 250);
  })();
  