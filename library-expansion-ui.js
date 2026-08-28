// ════════════════════════════════════════════════════════════════════
// STUDYRIA — Library Expansion UI Enhancement
// Adds: smart shelves, enhanced search, content verification badges,
// version indicators. Loaded AFTER index.html, additive only.
// ════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ── 1. ENHANCED SEARCH ────────────────────────────────────────────
  // Extends the existing search to also match exam_tags, subject_tags,
  // topic_tags, material_type, language, and subcategory fields.

  if (typeof window.renderLibGrid === 'function' && !window._libSearchEnhanced) {
    window._libSearchEnhanced = true;
    const _origRenderLibGrid = window.renderLibGrid;

    window.renderLibGrid = async function() {
      const search = (document.getElementById('libSearch')?.value || '').toLowerCase().trim();
      const sort = document.getElementById('libSort')?.value || 'popular';
      const grid = document.getElementById('libGrid');
      const empty = document.getElementById('libEmpty');
      const countEl = document.getElementById('libCount');

      if (grid) grid.innerHTML = Array(8).fill('<div class="ottlib-grid-card ottlib-skeleton" style="aspect-ratio:2/3"></div>').join('');

      // Load from Supabase
      if (window.supabaseClient) {
        try {
          let q = window.supabaseClient.from('pdfs').select('*').eq('status', 'published');
          if (libCat && libCat !== 'All') {
            const catObj = (window._dbCategories||[]).find(c => c.name === libCat);
            q = catObj ? q.eq('category_id', catObj.id) : q.eq('category', libCat);
          }
          q = q.order('created_at', { ascending: false }).limit(200);
          const { data, error } = await q;
          if (!error && data && data.length > 0) {
            data.forEach(row => {
              const idx = window.PDFS.findIndex(p => String(p.id) === String(row.id));
              if (idx >= 0) window.PDFS[idx] = Object.assign(window.PDFS[idx], row);
              else window.PDFS.push(row);
            });
          }
        } catch(e) { console.warn('Library Supabase fetch:', e); }
      }

      // Enhanced filtering: search across title, author, category, AND
      // exam_tags, subject_tags, topic_tags, material_type, language, subcategory
      let filtered = validPdfs(window.PDFS || []).filter(p => {
        const catMatch = (libCat === 'All' || !libCat || p.category === libCat);
        if (!catMatch) return false;
        if (freeOnly && !(p.free || p.price === 0)) return false;
        const examFilter = document.getElementById('libExamFilter')?.value || '';
        const materialFilter = document.getElementById('libMaterialFilter')?.value || '';
        if (examFilter && !(p.exam_tags || p.category || '').includes(examFilter)) return false;
        if (materialFilter && (p.material_type || '') !== materialFilter) return false;

        if (search === '') return true;

        // Search in all text fields
        const searchFields = [
          p.title, p.author, p.category, p.subcategory,
          p.exam_tags, p.subject_tags, p.topic_tags,
          p.material_type, p.language, p.description,
          p.badge, p.source_name
        ].map(f => (f || '').toLowerCase());

        return searchFields.some(f => f.includes(search));
      });

      // Sorting
      if (sort === 'popular') filtered.sort((a,b) => (b.download_count||b.sales||0) - (a.download_count||a.sales||0));
      if (sort === 'rating')  filtered.sort((a,b) => (b.rating||0) - (a.rating||0));
      if (sort === 'price-low') filtered.sort((a,b) => (a.price||0) - (b.price||0));
      if (sort === 'price-high') filtered.sort((a,b) => (b.price||0) - (a.price||0));
      if (sort === 'newest') filtered.sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));

      if (countEl) countEl.textContent = `${filtered.length} PDFs`;

      if (grid) {
        if (filtered.length === 0) {
          grid.innerHTML = '';
          if (empty) {
            empty.classList.remove('hidden');
            const emptyTitle = empty.querySelector('.lib-empty-title');
            const emptyBody = empty.querySelector('p, .lib-empty-body, .lib-empty-sub');
            if (emptyTitle) emptyTitle.textContent = search || libCat !== 'All' ? 'No PDFs Found' : 'Library Loading…';
            if (emptyBody) emptyBody.textContent = search ? `No results for "${search}". Try searching by exam name (ADRE, APSC), subject, or topic.` : libCat && libCat !== 'All' ? `No PDFs in "${libCat}" yet. Browse All Categories.` : 'PDFs are loading. Please check your connection.';
          }
        } else {
          if (empty) empty.classList.add('hidden');
          if (typeof ottlibCardHTML === 'function') {
            grid.innerHTML = filtered.map(p => ottlibCardHTML(p)).join('');
          } else {
            grid.innerHTML = filtered.map(p => pdfCardHTML(p)).join('');
          }
        }
      }
      renderLibHeroStats();
      if (typeof ottlibRenderShelves === 'function') ottlibRenderShelves();
      if (typeof ottlibRenderSmartShelves === 'function') ottlibRenderSmartShelves();
      setTimeout(() => { if (typeof window.initLazyImages === 'function') window.initLazyImages(); }, 100);
    };
    console.log('✅ Library search enhanced — now matches exam_tags, subject_tags, topic_tags, material_type, language');
  }

  // ── 2. SMART SHELVES ──────────────────────────────────────────────
  // Adds curated shelves based on exam tags and material types.
  // Only shows shelves with actual content. Hidden when empty.

  window.ottlibRenderSmartShelves = function() {
    const pdfs = (window.PDFS||[]).filter(p => p.title && (p.status === 'published' || p.status === 'approved' || (!p.status && p.title)));

    // Define smart shelves
    const shelves = [
      {
        id: 'ottlibADREShelf',
        label: '🔥 Most Useful for ADRE',
        dotColor: '#930205',
        badgeText: 'Must Have',
        badgeColor: 'rgba(147,2,5,0.12)',
        badgeBorder: 'rgba(147,2,5,0.3)',
        filter: p => (p.exam_tags || p.category || '').includes('ADRE'),
        sort: 'downloads'
      },
      {
        id: 'ottlibGKShelf',
        label: '🏛️ Assam GK Essentials',
        dotColor: '#d97706',
        badgeText: 'Assam Special',
        badgeColor: 'rgba(217,119,6,0.12)',
        badgeBorder: 'rgba(217,119,6,0.3)',
        filter: p => (p.category || '').includes('Assam GK') || (p.subject_tags || '').includes('Assam'),
        sort: 'downloads'
      },
      {
        id: 'ottlibCAShelf',
        label: '📰 Current Affairs',
        dotColor: '#14b8a6',
        badgeText: 'Updated',
        badgeColor: 'rgba(20,184,166,0.12)',
        badgeBorder: 'rgba(20,184,166,0.3)',
        filter: p => (p.category || '').includes('Current Affairs') || (p.material_type || '').includes('current_affairs') || (p.material_type || '').includes('monthly') || (p.material_type || '').includes('weekly') || (p.material_type || '').includes('daily'),
        sort: 'newest'
      },
      {
        id: 'ottlibRevisionShelf',
        label: '🎯 Last-Minute Revision',
        dotColor: '#f59e0b',
        badgeText: 'Quick Fix',
        badgeColor: 'rgba(245,158,11,0.12)',
        badgeBorder: 'rgba(245,158,11,0.3)',
        filter: p => {
          const mt = (p.material_type || '');
          return mt.includes('revision') || mt.includes('formula') || mt.includes('one-liner') || mt.includes('shortcut') || (p.badge || '').includes('Last Minute');
        },
        sort: 'downloads'
      },
      {
        id: 'ottlibFreeShelf',
        label: '🆓 Free Study Materials',
        dotColor: '#10d98e',
        badgeText: 'Free',
        badgeColor: 'rgba(16,217,142,0.12)',
        badgeBorder: 'rgba(16,217,142,0.3)',
        filter: p => p.free || p.price === 0,
        sort: 'downloads'
      },
      {
        id: 'ottlibPremiumShelf',
        label: '💎 Premium Collections',
        dotColor: '#c99a3c',
        badgeText: 'Premium',
        badgeColor: 'rgba(201,154,60,0.12)',
        badgeBorder: 'rgba(201,154,60,0.3)',
        filter: p => !p.free && p.price > 0 && p.price >= 99,
        sort: 'price-high'
      }
    ];

    // Find or create the container
    let container = document.getElementById('ottlibSmartShelvesContainer');
    if (!container) {
      // Insert after the existing category rows container
      const catRows = document.getElementById('ottlibCategoryRowsContainer');
      if (catRows) {
        container = document.createElement('div');
        container.id = 'ottlibSmartShelvesContainer';
        catRows.parentNode.insertBefore(container, catRows.nextSibling);
      } else {
        // Fallback: insert before the Continue Reading section
        const contSec = document.getElementById('ottlibContinueSection');
        if (contSec) {
          container = document.createElement('div');
          container.id = 'ottlibSmartShelvesContainer';
          contSec.parentNode.insertBefore(container, contSec);
        }
      }
    }
    if (!container) return;

    // Build shelves
    let html = '';
    for (const shelf of shelves) {
      let items = pdfs.filter(shelf.filter);
      if (items.length === 0) continue; // Don't show empty shelves

      if (shelf.sort === 'downloads') {
        items.sort((a,b) => (b.download_count||b.sales||0) - (a.download_count||a.sales||0));
      } else if (shelf.sort === 'newest') {
        items.sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));
      } else if (shelf.sort === 'price-high') {
        items.sort((a,b) => (b.price||0) - (a.price||0));
      }
      items = items.slice(0, 12); // Max 12 per shelf

      html += `
        <div class="ottlib-divider"></div>
        <section class="ottlib-section" id="${shelf.id}">
          <div class="ottlib-section-head">
            <div class="ottlib-section-label">
              <span class="ottlib-section-dot" style="background:${shelf.dotColor};box-shadow:0 0 8px ${shelf.dotColor}"></span>
              <span class="ottlib-section-text">${shelf.label}</span>
              <span class="ottlib-section-badge" style="background:${shelf.badgeColor};color:${shelf.dotColor};border:1px solid ${shelf.badgeBorder}">${shelf.badgeText}</span>
            </div>
            <button class="ottlib-see-all" onclick="setLibCatFilter('All')">See All →</button>
          </div>
          <div class="ottlib-track-outer">
            <div class="ottlib-track" id="${shelf.id}Track">
              ${items.map((p,i) => ottlibCardHTML(p, shelf.sort === 'downloads' ? {rank:i+1} : {})).join('')}
            </div>
          </div>
        </section>`;
    }

    container.innerHTML = html;
  };

  // ── 3. CONTENT VERIFICATION BADGE ─────────────────────────────────
  // Adds a small "✓ Verified" or "Studyria Original" badge to cards
  // that have verification_status = 'verified' or content_source_type = 'original'

  if (typeof window.ottlibCardHTML === 'function' && !window._cardVerificationEnhanced) {
    window._cardVerificationEnhanced = true;
    const _origOttlibCardHTML = window.ottlibCardHTML;

    window.ottlibCardHTML = function(p, opts = {}) {
      const cardHTML = _origOttlibCardHTML.call(this, p, opts);

      // Add verification badge after rendering
      if ((p.verification_status === 'verified' || p.content_source_type === 'original') && !cardHTML.includes('studyria-verified')) {
        const badgeHTML = `<span class="studyria-verified-badge" style="position:absolute;bottom:4px;left:4px;background:rgba(16,217,142,0.9);color:white;font-size:9px;padding:2px 6px;border-radius:4px;font-weight:600;z-index:5;">✓ Studyria Original</span>`;
        return cardHTML.replace('<div class="ottlib-card-inner">', `<div class="ottlib-card-inner">${badgeHTML}`);
      }

      return cardHTML;
    };
  }

  // ── 4. SEARCH PLACEHOLDER ENHANCEMENT ─────────────────────────────
  const searchInput = document.getElementById('libSearch');
  if (searchInput && !searchInput.dataset.enhanced) {
    searchInput.dataset.enhanced = '1';
    searchInput.placeholder = 'Search by exam (ADRE, APSC), subject, topic, or title…';
  }

  // ── 5. INTEGRATION ────────────────────────────────────────────────
  // Hook into existing render cycles
  if (typeof window.ottlibRenderShelves === 'function' && !window._smartShelfHooked) {
    window._smartShelfHooked = true;
    const _origShelves = window.ottlibRenderShelves;
    window.ottlibRenderShelves = function() {
      _origShelves.call(this);
      if (typeof window.ottlibRenderSmartShelves === 'function') {
        window.ottlibRenderSmartShelves();
      }
    };
  }

  // Also hook into page navigation
  if (typeof window.navigate === 'function' && !window._libNavHooked) {
    window._libNavHooked = true;
    const _origNav = window.navigate;
    window.navigate = function(page) {
      const result = _origNav.apply(this, arguments);
      if (page === 'library') {
        setTimeout(() => {
          if (typeof window.ottlibRenderSmartShelves === 'function') {
            window.ottlibRenderSmartShelves();
          }
        }, 200);
      }
      return result;
    };
  }

  console.log('✅ Library Expansion UI loaded — smart shelves, enhanced search, verification badges active');
})();

// ── 6. RESPONSIVE STYLES FOR NEW FILTERS ──────────────────────────
(function() {
  const style = document.createElement('style');
  style.id = 'library-expansion-styles';
  style.textContent = `
    @media (max-width: 768px) {
      #libExamFilter, #libMaterialFilter {
        min-width: 0 !important;
        width: 100%;
        margin-top: 8px;
      }
      .ottlib-hero-search {
        flex-wrap: wrap;
      }
    }
    .studyria-verified-badge {
      position: absolute;
      bottom: 4px;
      left: 4px;
      background: rgba(16,217,142,0.9);
      color: white;
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      z-index: 5;
    }
  `;
  document.head.appendChild(style);
  console.log('✅ Library expansion responsive styles injected');
})();
