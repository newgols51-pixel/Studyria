/**
 * ══════════════════════════════════════════════════════════════════════
 * PDF CLASSIFICATION SYSTEM — COMPLETE REFACTOR PATCH
 * ══════════════════════════════════════════════════════════════════════
 *
 * HOW TO USE:
 *   Paste this entire <script> block at the very END of index.html,
 *   just before </body>. It overrides all relevant functions via
 *   re-declaration (functions hoisted last win) and patches the DOM.
 *
 * WHAT THIS FIXES:
 *   1.  Only category_id is required — all others save NULL when blank
 *   2.  Removes ALL validation for optional classification fields
 *   3.  PDFs with NULL fields: upload ✓  edit ✓  appear in library ✓
 *       appear in search ✓  appear in filters ✓
 *   4.  Hides empty/null values everywhere — never shows "Empty" etc.
 *   5.  Adds "+ Create New" inline option to every classification dropdown
 *   6.  Fixes Discover filter dropdowns to load dynamically from DB
 *   7.  Fixes library display to not require category
 *   8.  Fixes detail page chips — only shows non-null values
 *   9.  Fixes classification breadcrumb — only non-null parts shown
 *   10. Fixes "Who Should Read" to not assume subcategory
 *
 * ══════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────
// SECTION 1 — UTILITY: safe value checker
// Never renders empty / null / undefined / "not selected" strings
// ─────────────────────────────────────────────────────────────────────

/**
 * Returns true only when val is a non-empty, non-placeholder string.
 * Blocks: null, undefined, '', '—', 'null', 'undefined',
 *         strings that match common "not selected" placeholders.
 */
function _isValidClassif(val) {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  if (!s) return false;
  const blocklist = [
    '—', 'null', 'undefined', 'empty', 'not selected',
    'select category', 'select subcategory', 'select academic level',
    'select stream', 'select semester', 'select subject',
    '— select category first —', '— select subcategory first —',
    '— select academic level first —', '— select stream first —',
    '— select semester/class first —', 'loading…', 'loading...',
    'no subcategories found', 'no academic levels found',
    'no streams found', 'no semester/classes found', 'no subjects found',
  ];
  return !blocklist.includes(s.toLowerCase());
}

/**
 * Returns only the valid (non-null, non-empty, non-placeholder)
 * classification parts from a PDF object.
 * Order: Category → Subcategory → Academic Level → Stream → Semester → Subject
 */
function _classifParts(pdf) {
  if (!pdf) return [];
  // Only 'category' is stored as a text label in the schema.
  // All other classification levels are stored as _id FK columns only.
  return [
    pdf.category,
  ].filter(_isValidClassif);
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 2 — CORE SAVE: remove optional-field validation,
//             ensure NULL is saved for unselected fields
// ─────────────────────────────────────────────────────────────────────

async function adminSavePDF() {
  const btn = document.getElementById('adminSavePDFBtn');
  const g = id => document.getElementById(id)?.value?.trim?.() ?? document.getElementById(id)?.value ?? '';

  const title         = g('apTitle');
  const author        = g('apAuthor');
  const category      = g('apCat');          // REQUIRED (only this one)
  const subcategory   = g('apSubcat');        // optional → NULL if blank
  const academicLevel = g('apAcademicLevel'); // optional → NULL if blank
  const stream        = g('apStream');        // optional → NULL if blank
  const semesterClass = g('apSemesterClass'); // optional → NULL if blank
  const subject       = g('apSubject');       // optional → NULL if blank

  const sellPrice = parseFloat(g('apSellPrice') || 0);
  const origPrice = parseFloat(g('apOrigPrice') || 0);
  const isFree    = document.getElementById('apFree')?.checked;
  const desc        = g('apDesc');
  const badge       = g('apBadge');
  const examYear    = g('apExamYear');
  const slug        = g('apSlug') || generateSlug(title);
  const seoTitle    = g('apSeoTitle');
  const seoDesc     = g('apSeoDesc');
  const seoKeywords = g('apSeoKeywords');
  const dlCount     = parseInt(g('apDownloads') || 0);
  const views       = parseInt(g('apViews') || 0);
  const wishCount   = parseInt(g('apWishlist') || 0);

  // ── VALIDATION: only title + category required ────────────────────
  if (!title)    { showToast('Title is required!', 'error'); return; }
  if (!category) { showToast('Category is required!', 'error'); return; }
  // ↑ All other classification fields (subcategory, academic_level, etc.)
  //   are intentionally NOT validated — they save NULL when blank.

  const isEditing = !!window.adminEditingPDFId;
  const coverFile = document.getElementById('adminCoverFile')?.files[0];
  const pdfFile   = document.getElementById('adminPDFFile')?.files[0];

  if (!isEditing) {
    if (!pdfFile)   { showToast('Please select a PDF file to upload!', 'error'); return; }
    if (!coverFile) { showToast('Please select a cover image to upload!', 'error'); return; }
  }

  if (!window.supabaseClient) { showToast('Supabase not connected.', 'error'); return; }

  btn.innerHTML = `<span class="auth-spinner"></span>${isEditing ? 'Updating…' : 'Publishing…'}`;
  btn.disabled = true;

  let coverUrl = isEditing ? (window.adminEditingCoverUrl || null) : null;
  let pdfUrl   = isEditing ? (window.adminEditingPdfUrl   || null) : null;

  function showProgress(type, pct, label) {
    const bar  = document.getElementById(`admin${type}ProgressBar`);
    const wrap = document.getElementById(`admin${type}Progress`);
    const txt  = document.getElementById(`admin${type}ProgressText`);
    if (wrap) wrap.style.display = '';
    if (bar)  bar.style.width = pct + '%';
    if (txt)  txt.textContent = label;
  }

  try {
    if (coverFile) {
      showProgress('Cover', 20, 'Uploading cover image…');
      btn.innerHTML = `<span class="auth-spinner"></span>Uploading cover…`;
      const ext   = coverFile.name.split('.').pop().toLowerCase();
      const fpath = `${Date.now()}_${slug.slice(0,40)}.${ext}`;
      const { error: coverErr } = await window.supabaseClient.storage
        .from('covers').upload(fpath, coverFile, { upsert: true, contentType: coverFile.type });
      if (coverErr) throw new Error(`Cover upload failed: ${coverErr.message}`);
      const { data: cd } = window.supabaseClient.storage.from('covers').getPublicUrl(fpath);
      if (!cd?.publicUrl) throw new Error('Cover URL generation failed.');
      coverUrl = cd.publicUrl;
      showProgress('Cover', 100, '✅ Cover uploaded');
    }

    if (pdfFile) {
      showProgress('PDF', 20, 'Uploading PDF file…');
      btn.innerHTML = `<span class="auth-spinner"></span>Uploading PDF…`;
      const fpath2 = `${Date.now()}_${slug.slice(0,40)}.pdf`;
      const { error: pdfErr } = await window.supabaseClient.storage
        .from('pdfs').upload(fpath2, pdfFile, { upsert: true, contentType: 'application/pdf' });
      if (pdfErr) throw new Error(`PDF upload failed: ${pdfErr.message}`);
      const { data: pd } = window.supabaseClient.storage.from('pdfs').getPublicUrl(fpath2);
      if (!pd?.publicUrl) throw new Error('PDF URL generation failed.');
      pdfUrl = pd.publicUrl;
      showProgress('PDF', 100, '✅ PDF uploaded');
    }

    if (!isEditing && (!pdfUrl || !coverUrl)) {
      throw new Error('Upload verification failed — urls still null.');
    }

    btn.innerHTML = `<span class="auth-spinner"></span>Saving to database…`;

    // ── Resolve IDs — null when field is empty ────────────────────
    const categoryId      = apGetSelectedId('apCat')         || null;
    const subcategoryId   = apGetSelectedId('apSubcat')       || null;
    const academicLevelId = apGetSelectedId('apAcademicLevel')|| null;
    const streamId        = apGetSelectedId('apStream')       || null;
    const semesterClassId = apGetSelectedId('apSemesterClass')|| null;
    const subjectId       = apGetSelectedId('apSubject')      || null;

    // ── VALIDATION: DB must only ever receive numeric IDs, never names.
    //    If any resolved classification ID is non-numeric, STOP — do not
    //    send SQL. (Legacy bigint columns like subcategory/academic_level/
    //    stream/semester_class/subject must never receive display text.) ──
    {
      const _isNumericId = v => v === null || v === undefined || v === '' || /^\d+$/.test(String(v));
      const _idFields = { categoryId, subcategoryId, academicLevelId, streamId, semesterClassId, subjectId };
      const _badField = Object.entries(_idFields).find(([,v]) => !_isNumericId(v));
      if (_badField) {
        showToast(`Invalid category mapping. (${_badField[0]} is not a valid ID)`, 'error');
        btn.innerHTML = isEditing ? '💾 Update PDF' : '🚀 Publish PDF';
        btn.disabled = false;
        return;
      }
    }

    // ── Payload — only columns that exist in the pdfs table schema ──
    const payload = {
      title,
      author:            author          || null,
      category:          category,       // required — always set
      category_id:       categoryId,
      subcategory_id:    subcategoryId,
      academic_level_id: academicLevelId,
      stream_id:         streamId,
      semester_class_id: semesterClassId,
      subject_id:        subjectId,
      description:       desc            || null,
      preview:           desc            || null,
      selling_price:     isFree ? 0 : sellPrice,
      original_price:    origPrice       || null,
      price:             isFree ? 0 : sellPrice,
      free:              isFree || sellPrice === 0,  // ← CRITICAL: must be saved so free PDFs open correctly
      badge:             badge           || null,
      exam_year:         examYear        || null,
      slug:              slug            || null,
      seo_title:         seoTitle        || null,
      seo_description:   seoDesc         || null,
      seo_keywords:      seoKeywords     || null,
      cover_url:         coverUrl,
      pdf_url:           pdfUrl,
      status:            (window._spmSaveAsDraft ? 'draft' : 'published'),
      ...(isEditing ? {
        download_count: dlCount,
      } : {})
    };

    if (isEditing) {
      const { error: updateErr } = await window.supabaseClient
        .from('pdfs').update(payload).eq('id', window.adminEditingPDFId);
      if (updateErr) throw new Error(`Database update failed: ${updateErr.message}`);
      logAdminActivity(`Updated PDF: "${title}" (id:${window.adminEditingPDFId})`, 'green');
      showToast(`✅ "${title}" updated successfully!`, 'success');
    } else {
      payload.created_at = new Date().toISOString();
      const { error: insertErr } = await window.supabaseClient.from('pdfs').insert(payload);
      if (insertErr) throw new Error(`Database insert failed: ${insertErr.message}`);
      logAdminActivity(`Published PDF: "${title}" in ${category}`, 'green');
      const _savedMsg = window._spmSaveAsDraft ? `✅ "${title}" saved as Draft!` : `✅ "${title}" published instantly!`;
      showToast(_savedMsg, 'success');
    }

    window.adminEditingPDFId    = null;
    window.adminEditingCoverUrl = null;
    window.adminEditingPdfUrl   = null;

    try {
      const { data: refreshed } = await window.supabaseClient
        .from('pdfs').select('*').eq('status', 'published')
        .order('created_at', { ascending: false }).limit(200);
      if (refreshed?.length) {
        window.PDFS.length = 0;
        refreshed.forEach(r => window.PDFS.push(r));
      }
    } catch(e) { console.warn('PDFS refresh error:', e); }

    btn.innerHTML = `✅ ${isEditing ? 'Updated!' : 'Published!'}`;
    setTimeout(() => switchAdminTab('pdfs'), 1200);

  } catch (err) {
    console.error('adminSavePDF error:', err);
    showToast('❌ ' + (err.message || 'Save failed'), 'error');
    btn.innerHTML = isEditing ? '💾 Update PDF' : '🚀 Publish PDF';
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 3 — CLASSIFICATION PATH DISPLAY
// Only show non-null parts — never show "empty", "null", etc.
// ─────────────────────────────────────────────────────────────────────

function apUpdateClassifPath() {
  const g = id => document.getElementById(id)?.value || '';
  const parts = [
    g('apCat'), g('apSubcat'), g('apAcademicLevel'),
    g('apStream'), g('apSemesterClass'), g('apSubject')
  ].filter(_isValidClassif);  // ← only non-empty, non-placeholder values
  const el = document.getElementById('apClassifPathText');
  if (el) el.textContent = parts.length ? parts.join(' › ') : 'none';
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 4 — CLASSIFICATION DROPDOWNS WITH "+ Create New"
// Patches apOnCategoryChange, apLoadChildDropdown, apResetBelow
// ─────────────────────────────────────────────────────────────────────

/**
 * Appends a "+ Create New {label}" option at the top of any select.
 * On selection, opens the inline Classification Manager at that level.
 */
function _appendCreateNewOption(selectEl, label, cmLevel) {
  if (!selectEl) return;
  const opt = document.createElement('option');
  opt.value = '__create_new__';
  opt.dataset.cmLevel = cmLevel;
  opt.textContent = `➕ Create New ${label}`;
  opt.style.color = 'var(--accent)';
  opt.style.fontWeight = '700';
  selectEl.insertBefore(opt, selectEl.options[1] || null);
}

/**
 * Handles "+ Create New" selection in any classification dropdown.
 * Opens the Classification Manager panel at the appropriate level.
 */
function _handleCreateNewSelection(selectEl, cmLevel) {
  if (!selectEl || selectEl.value !== '__create_new__') return false;
  selectEl.value = '';  // reset to empty
  // Open the CM panel at this level
  const cmBody = document.getElementById('apCMBody');
  if (cmBody) cmBody.style.display = 'block';
  if (typeof apCMSwitchLevel === 'function') apCMSwitchLevel(cmLevel);
  // Expand the CM panel header if collapsed
  const cmToggle = document.getElementById('apCMToggleIcon');
  if (cmToggle) cmToggle.style.transform = 'rotate(180deg)';
  showToast(`Opening Classification Manager → ${cmLevel.replace(/_/g,' ')}`, 'info');
  return true;
}

// Map select IDs → CM level table names
const _SELECT_TO_CM_LEVEL = {
  apCat:           'categories',
  apSubcat:        'subcategories',
  apAcademicLevel: 'academic_levels',
  apStream:        'streams',
  apSemesterClass: 'semester_classes',
  apSubject:       'subjects',
};

// Map select IDs → human labels
const _SELECT_LABELS = {
  apCat:           'Category',
  apSubcat:        'Subcategory',
  apAcademicLevel: 'Academic Level',
  apStream:        'Stream',
  apSemesterClass: 'Semester/Class',
  apSubject:       'Subject',
};

// ── Override cascade helpers to inject "+ Create New" ────────────────

async function apLoadChildDropdown(table, filterField, parentId, targetSelectId, emptyLabel, noResultLabel) {
  const targetEl = document.getElementById(targetSelectId);
  if (!targetEl) return;

  if (!parentId) {
    // No parent selected — still show empty option + Create New
    const label = _SELECT_LABELS[targetSelectId] || table.replace(/_/g,' ');
    const cmLvl = _SELECT_TO_CM_LEVEL[targetSelectId] || table;
    targetEl.innerHTML = `<option value="">${emptyLabel}</option>`;
    _appendCreateNewOption(targetEl, label, cmLvl);
    updateAdminPDFPreview();
    return;
  }

  targetEl.innerHTML = '<option value="">Loading…</option>';
  if (!window.supabaseClient) {
    targetEl.innerHTML = `<option value="">${noResultLabel}</option>`;
    _appendCreateNewOption(targetEl, _SELECT_LABELS[targetSelectId] || '', _SELECT_TO_CM_LEVEL[targetSelectId] || table);
    return;
  }

  try {
    const { data, error } = await window.supabaseClient.from(table).select('*').eq(filterField, parentId).order('sort_order').order('name');
    if (error) throw error;
    const label = _SELECT_LABELS[targetSelectId] || table.replace(/_/g,' ');
    const cmLvl = _SELECT_TO_CM_LEVEL[targetSelectId] || table;
    if (data && data.length) {
      targetEl.innerHTML = `<option value="">Select ${table.replace(/_/g,' ')}…</option>` +
        data.map(r => `<option value="${r.name}" data-id="${r.id}">${r.name}</option>`).join('');
    } else {
      targetEl.innerHTML = `<option value="">${noResultLabel}</option>`;
    }
    _appendCreateNewOption(targetEl, label, cmLvl);
  } catch(e) {
    console.warn(`${table} fetch error:`, e);
    targetEl.innerHTML = `<option value="">${noResultLabel}</option>`;
    _appendCreateNewOption(targetEl, _SELECT_LABELS[targetSelectId] || '', _SELECT_TO_CM_LEVEL[targetSelectId] || table);
  }
  updateAdminPDFPreview();
}

function apResetBelow(levels) {
  const map = {
    subcat:   { id:'apSubcat',        label:'— select category first —',     cm:'subcategories' },
    level:    { id:'apAcademicLevel', label:'— select subcategory first —',  cm:'academic_levels' },
    stream:   { id:'apStream',        label:'— select academic level first —',cm:'streams' },
    semester: { id:'apSemesterClass', label:'— select stream first —',       cm:'semester_classes' },
    subject:  { id:'apSubject',       label:'— select semester/class first —',cm:'subjects' },
  };
  levels.forEach(k => {
    const cfg = map[k];
    const el = document.getElementById(cfg.id);
    if (!el) return;
    el.innerHTML = `<option value="">${cfg.label}</option>`;
    _appendCreateNewOption(el, _SELECT_LABELS[cfg.id] || k, cfg.cm);
  });
  updateAdminPDFPreview();
}

async function apOnCategoryChange() {
  // Check for "+ Create New" selection
  const catEl = document.getElementById('apCat');
  if (_handleCreateNewSelection(catEl, 'categories')) return;

  apResetBelow(['subcat','level','stream','semester','subject']);
  const catId = apGetSelectedId('apCat');
  if (!catId) { apUpdateClassifPath(); return; }

  if (window.supabaseClient) {
    try {
      const { data } = await window.supabaseClient.from('subcategories')
        .select('*').eq('category_id', catId).order('sort_order').order('name');
      const subcatEl = document.getElementById('apSubcat');
      if (!subcatEl) return;
      if (data && data.length) {
        if (!window._dbSubcategories) window._dbSubcategories = [];
        data.forEach(s => {
          if (!window._dbSubcategories.find(x => x.id === s.id)) window._dbSubcategories.push(s);
        });
        if (!window._dbSubcatMap) window._dbSubcatMap = {};
        window._dbSubcatMap[catId] = data;
        subcatEl.innerHTML = '<option value="">Select Subcategory…</option>' +
          data.map(s => `<option value="${s.name}" data-id="${s.id}">${s.name}</option>`).join('');
      } else {
        subcatEl.innerHTML = '<option value="">No subcategories found — or skip</option>';
      }
      _appendCreateNewOption(subcatEl, 'Subcategory', 'subcategories');
    } catch(e) { console.warn('Subcategory fetch error:', e); }
  }
  updateAdminPDFPreview();
  apUpdateClassifPath();
}

async function apOnSubcategoryChange() {
  const el = document.getElementById('apSubcat');
  if (_handleCreateNewSelection(el, 'subcategories')) return;
  apResetBelow(['level','stream','semester','subject']);
  const subcatId = apGetSelectedId('apSubcat');
  await apLoadChildDropdown('academic_levels', 'subcategory_id', subcatId, 'apAcademicLevel',
    '— optional: select subcategory first —', 'No academic levels — skip or create');
  apUpdateClassifPath();
}

async function apOnAcademicLevelChange() {
  const el = document.getElementById('apAcademicLevel');
  if (_handleCreateNewSelection(el, 'academic_levels')) return;
  apResetBelow(['stream','semester','subject']);
  const levelId = apGetSelectedId('apAcademicLevel');
  await apLoadChildDropdown('streams', 'academic_level_id', levelId, 'apStream',
    '— optional: select academic level first —', 'No streams — skip or create');
  apUpdateClassifPath();
}

async function apOnStreamChange() {
  const el = document.getElementById('apStream');
  if (_handleCreateNewSelection(el, 'streams')) return;
  apResetBelow(['semester','subject']);
  const streamId = apGetSelectedId('apStream');
  await apLoadChildDropdown('semester_classes', 'stream_id', streamId, 'apSemesterClass',
    '— optional: select stream first —', 'No semester/classes — skip or create');
  apUpdateClassifPath();
}

async function apOnSemesterClassChange() {
  const el = document.getElementById('apSemesterClass');
  if (_handleCreateNewSelection(el, 'semester_classes')) return;
  const semSubjEl = document.getElementById('apSubject');
  if (semSubjEl) {
    semSubjEl.innerHTML = '<option value="">— optional: select semester/class first —</option>';
    _appendCreateNewOption(semSubjEl, 'Subject', 'subjects');
  }
  const semId = apGetSelectedId('apSemesterClass');
  await apLoadChildDropdown('subjects', 'semester_class_id', semId, 'apSubject',
    '— optional: select semester/class first —', 'No subjects — skip or create');
  apUpdateClassifPath();
}

// Subject change handler (new — handles Create New)
function apOnSubjectChange() {
  const el = document.getElementById('apSubject');
  if (_handleCreateNewSelection(el, 'subjects')) return;
  updateAdminPDFPreview();
  apUpdateClassifPath();
}

// ── Patch the subject dropdown's onchange in the DOM ─────────────────
(function _patchSubjectOnchange() {
  const subEl = document.getElementById('apSubject');
  if (subEl && !subEl.dataset.patched) {
    subEl.setAttribute('onchange', 'apOnSubjectChange()');
    subEl.dataset.patched = '1';
    _appendCreateNewOption(subEl, 'Subject', 'subjects');
  }
})();

// ── Patch category dropdown to add Create New on init ────────────────
(function _patchCategoryCreateNew() {
  const catEl = document.getElementById('apCat');
  if (catEl && !catEl.dataset.patched) {
    _appendCreateNewOption(catEl, 'Category', 'categories');
    catEl.dataset.patched = '1';
  }
})();

// ─────────────────────────────────────────────────────────────────────
// SECTION 5 — CATEGORY RELOAD with "+ Create New" preserved
// ─────────────────────────────────────────────────────────────────────

async function apRefreshCategories() {
  if (!window.supabaseClient) { showToast('Supabase not connected', 'error'); return; }
  try {
    const { data, error } = await window.supabaseClient.from('categories').select('*').order('sort_order').order('name');
    if (error) throw error;
    window._dbCategories = data || [];
    const catEl = document.getElementById('apCat');
    if (!catEl) return;
    const current = catEl.value;
    catEl.innerHTML = '<option value="">— Select Category —</option>' +
      (data||[]).map(c => `<option value="${c.name}" data-id="${c.id}">${c.name}</option>`).join('');
    _appendCreateNewOption(catEl, 'Category', 'categories');
    if (current) catEl.value = current;

    // Also refresh Discover filter category dropdown
    const dCat = document.getElementById('dCat');
    if (dCat) {
      const dCurrent = dCat.value;
      dCat.innerHTML = '<option value="">All Categories</option>' +
        (data||[]).map(c => `<option value="${c.name}">${c.name}</option>`).join('');
      if (dCurrent) dCat.value = dCurrent;
    }

    showToast('✅ Categories reloaded', 'success');
  } catch(e) { showToast('Reload failed: ' + e.message, 'error'); }
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 6 — LIBRARY: include PDFs with NULL classifications
// Patch renderLibGrid to not filter out PDFs without a category
// ─────────────────────────────────────────────────────────────────────

async function renderLibGrid() {
  const search  = (document.getElementById('libSearch')?.value || '').toLowerCase();
  const sort    = document.getElementById('libSort')?.value || 'popular';
  const grid    = document.getElementById('libGrid');
  const empty   = document.getElementById('libEmpty');
  const countEl = document.getElementById('libCount');

  if (grid) grid.innerHTML = shelfSkeletons(8);

  // Load from Supabase — no classification filter, just status=published
  if (window.supabaseClient) {
    try {
      let q = window.supabaseClient.from('pdfs').select('*').eq('status', 'published');
      if (libCat && libCat !== 'All') {
        const catObj = (window._dbCategories||[]).find(c => c.name === libCat);
        q = catObj ? q.eq('category_id', catObj.id) : q.eq('category', libCat);
      }
      q = q.order('created_at', { ascending: false }).limit(100);
      const { data, error } = await q;
      if (!error && data && data.length > 0) {
        data.forEach(row => {
          const idx = window.PDFS.findIndex(p => String(p.id) === String(row.id));
          if (idx >= 0) Object.assign(window.PDFS[idx], row);
          else window.PDFS.push(row);
        });
      }
    } catch(e) { console.warn('Library Supabase fetch:', e); }
  }

  // Filter: if libCat is "All", include PDFs with NULL category too
  let filtered = (window.PDFS || []).filter(p => {
    const catMatch = libCat === 'All' || p.category === libCat;
    const freeMatch = !freeOnly || p.free || p.price === 0 || p.selling_price === 0;
    const searchMatch = search === '' ||
      (p.title||'').toLowerCase().includes(search) ||
      (p.author||'').toLowerCase().includes(search) ||
      (p.category||'').toLowerCase().includes(search) ||
      (p.subcategory||'').toLowerCase().includes(search) ||
      (p.subject||'').toLowerCase().includes(search);
    return catMatch && freeMatch && searchMatch;
  });

  if (sort === 'popular')    filtered.sort((a,b) => (b.download_count||b.sales||0) - (a.download_count||a.sales||0));
  if (sort === 'rating')     filtered.sort((a,b) => (b.rating||0) - (a.rating||0));
  if (sort === 'price-low')  filtered.sort((a,b) => (a.selling_price||a.price||0) - (b.selling_price||b.price||0));
  if (sort === 'price-high') filtered.sort((a,b) => (b.selling_price||b.price||0) - (a.selling_price||a.price||0));
  if (sort === 'newest')     filtered.sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));

  if (countEl) countEl.textContent = `${filtered.length} PDFs found`;
  if (grid) grid.innerHTML = filtered.length
    ? filtered.map(p => pdfCardHTML(normalizePdf(p))).join('')
    : '';
  if (empty) empty.classList.toggle('hidden', filtered.length > 0);
  renderLibHeroStats();
  renderLibShelves();
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 7 — SEARCH/DISCOVER: include PDFs with NULL classifications
// ─────────────────────────────────────────────────────────────────────

async function runDiscover() {
  const query   = (document.getElementById('discoverSearch')?.value || '').trim().toLowerCase();
  const cat     = document.getElementById('dCat')?.value     || '';
  const sub     = document.getElementById('dSub')?.value     || '';
  const stream  = document.getElementById('dStream')?.value  || '';
  const subject = document.getElementById('dSubject')?.value || '';

  const hasFilters = query || cat || sub || stream || subject;
  const resultsWrap = document.getElementById('discoverResultsWrap');
  resultsWrap.style.display = hasFilters ? 'block' : 'none';
  if (!hasFilters) { updateActivePills(); return; }

  document.getElementById('discoverLoading').style.display = 'flex';
  document.getElementById('discoverResults').innerHTML = '';
  document.getElementById('discoverEmpty').style.display = 'none';
  updateActivePills();

  let results = [];

  if (typeof supabase !== 'undefined') {
    try {
      let q = supabase.from('pdfs').select('*');
      if (cat) {
        const catObj = (window._dbCategories||[]).find(c => c.name === cat || c.slug === cat);
        q = catObj ? q.eq('category_id', catObj.id) : q.eq('category', cat);
      }
      if (sub) {
        const subObj = (window._dbSubcategories||[]).find(s => s.name === sub || s.slug === sub);
        q = subObj ? q.eq('subcategory_id', subObj.id) : q.eq('subcategory', sub);
      }
      if (stream)  q = q.eq('stream', stream);
      if (subject) q = q.eq('subject', subject);
      if (query)   q = q.or(`title.ilike.%${query}%,subject.ilike.%${query}%,seo_keywords.ilike.%${query}%,category.ilike.%${query}%,subcategory.ilike.%${query}%`);
      q = q.eq('status', 'published').limit(40);
      const { data, error } = await q;
      if (!error && data && data.length > 0) results = data;
    } catch(e) { /* fallback to local */ }
  }

  // Fallback: local filter — PDFs with NULL classification fields are included
  if (results.length === 0) {
    results = (window.PDFS||[]).filter(p => {
      const matchQ = !query ||
        (p.title||'').toLowerCase().includes(query) ||
        (p.author||'').toLowerCase().includes(query) ||
        (p.category||'').toLowerCase().includes(query) ||
        (p.subcategory||'').toLowerCase().includes(query) ||
        (p.subject||'').toLowerCase().includes(query) ||
        (p.stream||'').toLowerCase().includes(query);
      // For filters: if filter is set, match. If filter is empty, include ALL PDFs
      // (including those with null for that field)
      const matchCat    = !cat    || (p.category    || '').toLowerCase() === cat.toLowerCase();
      const matchSub    = !sub    || (p.subcategory || '').toLowerCase() === sub.toLowerCase();
      const matchStream = !stream || (p.stream      || '').toLowerCase() === stream.toLowerCase();
      const matchSubj   = !subject|| (p.subject     || '').toLowerCase() === subject.toLowerCase();
      return matchQ && matchCat && matchSub && matchStream && matchSubj;
    });
  }

  document.getElementById('discoverLoading').style.display = 'none';

  const discoverResultsCount = document.getElementById('discoverResultsCount');
  if (discoverResultsCount) discoverResultsCount.textContent = `${results.length} PDFs found`;

  if (results.length === 0) {
    document.getElementById('discoverEmpty').style.display = 'block';
  } else {
    document.getElementById('discoverResults').innerHTML =
      results.map(p => pdfCardHTML(normalizePdf(p))).join('');
  }
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 8 — DISCOVER FILTERS: load dynamically from DB
// (replaces hardcoded static options with live DB values)
// ─────────────────────────────────────────────────────────────────────

async function _loadDiscoverFiltersFromDB() {
  if (!window.supabaseClient) return;
  try {
    // Category
    const { data: cats } = await window.supabaseClient.from('categories').select('id,name').order('sort_order').order('name');
    const dCat = document.getElementById('dCat');
    if (dCat && cats?.length) {
      dCat.innerHTML = '<option value="">All Categories</option>' +
        cats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
    }

    // Subcategory (all, not filtered — user can type/select freely)
    const { data: subs } = await window.supabaseClient.from('subcategories').select('id,name').order('sort_order').order('name');
    const dSub = document.getElementById('dSub');
    if (dSub && subs?.length) {
      dSub.innerHTML = '<option value="">All Levels</option>' +
        subs.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    }

    // Streams
    const { data: streams } = await window.supabaseClient.from('streams').select('id,name').order('sort_order').order('name');
    const dStream = document.getElementById('dStream');
    if (dStream && streams?.length) {
      dStream.innerHTML = '<option value="">All Streams</option>' +
        streams.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    }

    // Subjects
    const { data: subjects } = await window.supabaseClient.from('subjects').select('id,name').order('sort_order').order('name');
    const dSubject = document.getElementById('dSubject');
    if (dSubject && subjects?.length) {
      dSubject.innerHTML = '<option value="">All Subjects</option>' +
        subjects.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    }
  } catch(e) {
    console.warn('Discover filter load from DB failed (static options remain):', e);
  }
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 9 — HOME GRID: include PDFs with NULL category
// ─────────────────────────────────────────────────────────────────────

function renderHomeGrid() {
  const search = (document.getElementById('homeSearch')?.value || '').toLowerCase();
  // PDFs with null/undefined category are included when homeCat === 'All'
  let filtered = (window.PDFS || []).filter(p => {
    const catMatch = typeof homeCat === 'undefined' || homeCat === 'All' || p.category === homeCat;
    const searchMatch = search === '' ||
      (p.title||'').toLowerCase().includes(search) ||
      (p.author||'').toLowerCase().includes(search) ||
      (p.category||'').toLowerCase().includes(search);
    return catMatch && searchMatch;
  });
  const grid = document.getElementById('homeGrid');
  const empty = document.getElementById('homeEmpty');
  if (grid) grid.innerHTML = filtered.slice(0, 8).map(pdfCardHTML).join('');
  if (empty) empty.classList.toggle('hidden', filtered.length > 0);
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 10 — DETAIL PAGE CHIPS: hide null/empty classification fields
// Only shows values that exist — "Government Exams • ADRE" not "... • Empty"
// ─────────────────────────────────────────────────────────────────────

/**
 * Builds the pdp-info-chips HTML for the detail page.
 * Only renders chips for non-null, non-empty classification values.
 * Call after renderDetail() to patch the chips element.
 */
function _buildDetailClassifChips(pdf) {
  const chips = [];

  if (_isValidClassif(pdf.category))
    chips.push(`<div class="pdp-info-chip"><span class="pdp-ic-icon">📚</span><span class="pdp-ic-label">Category</span><span class="pdp-ic-val">${_esc(pdf.category)}</span></div>`);

  if (_isValidClassif(pdf.subcategory))
    chips.push(`<div class="pdp-info-chip"><span class="pdp-ic-icon">🏫</span><span class="pdp-ic-label">Class/Level</span><span class="pdp-ic-val">${_esc(pdf.subcategory)}</span></div>`);

  if (_isValidClassif(pdf.academic_level))
    chips.push(`<div class="pdp-info-chip"><span class="pdp-ic-icon">🎓</span><span class="pdp-ic-label">Academic Level</span><span class="pdp-ic-val">${_esc(pdf.academic_level)}</span></div>`);

  if (_isValidClassif(pdf.stream))
    chips.push(`<div class="pdp-info-chip"><span class="pdp-ic-icon">🌊</span><span class="pdp-ic-label">Stream</span><span class="pdp-ic-val">${_esc(pdf.stream)}</span></div>`);

  if (_isValidClassif(pdf.semester_class))
    chips.push(`<div class="pdp-info-chip"><span class="pdp-ic-icon">📅</span><span class="pdp-ic-label">Semester/Class</span><span class="pdp-ic-val">${_esc(pdf.semester_class)}</span></div>`);

  if (_isValidClassif(pdf.subject))
    chips.push(`<div class="pdp-info-chip"><span class="pdp-ic-icon">📖</span><span class="pdp-ic-label">Subject</span><span class="pdp-ic-val">${_esc(pdf.subject)}</span></div>`);

  return chips.join('');
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 11 — PDF CARD CHIPS: never show null/empty values
// Patches pdfCardHTML's chip logic to use _isValidClassif
// ─────────────────────────────────────────────────────────────────────

// We patch this by wrapping the original function.
// The chip render at lines 7700-7706 already uses `if (pdf.subject)` etc.
// which handles null. But we override to also use _isValidClassif to block
// placeholder strings like "undefined", "—", "null", etc.

const _origPdfCardHTML = typeof window.pdfCardHTML === 'function' ? window.pdfCardHTML : null;

function _cmPatchedPdfCardHTML(pdf) {
  // Ensure null-safety on classification fields before passing to original
  if (pdf) {
    ['category','subcategory','academic_level','stream','semester_class','subject'].forEach(k => {
      if (!_isValidClassif(pdf[k])) pdf[k] = null;
    });
  }
  return _origPdfCardHTML ? _origPdfCardHTML(pdf) : '';
}
window.pdfCardHTML = _cmPatchedPdfCardHTML;

// ─────────────────────────────────────────────────────────────────────
// SECTION 12 — ADMIN PDF TABLE: show "—" for null category (not crash)
// ─────────────────────────────────────────────────────────────────────

function adminFilterPDFs(query) {
  const pdfs = (window._adminPDFs || window.PDFS || []).filter(p =>
    !query ||
    (p.title||'').toLowerCase().includes(query.toLowerCase()) ||
    (p.category||'').toLowerCase().includes(query.toLowerCase()) ||
    (p.author||'').toLowerCase().includes(query.toLowerCase())
  );
  const tbody = document.getElementById('adminPDFTableBody');
  if (!tbody) return;
  tbody.innerHTML = pdfs.map(p => {
    const catBadge = _isValidClassif(p.category)
      ? `<span class="admin-badge admin-badge-accent">${p.category}</span>`
      : `<span class="admin-badge" style="opacity:.4">—</span>`;
    return `<tr>
      <td style="font-size:.82rem;font-weight:600;color:var(--text)">${p.title||'—'}</td>
      <td>${catBadge}</td>
      <td style="font-size:.75rem;color:var(--text2)">${p.author||'—'}</td>
      <td style="font-size:.75rem;color:var(--text2)">${p.status||'—'}</td>
      <td style="font-size:.72rem;color:var(--text2)">${p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="adminEditPDF('${p.id}')">✏️ Edit</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="adminDeletePDF('${p.id}')">🗑️</button>
      </td>
    </tr>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 13 — CLASSIFICATION BREADCRUMB IN PREVIEW
// Only show non-null parts in the live PDF preview panel
// ─────────────────────────────────────────────────────────────────────

const _origUpdateAdminPDFPreview = typeof window.updateAdminPDFPreview === 'function' ? window.updateAdminPDFPreview : null;

function _cmPatchedUpdateAdminPDFPreview() {
  // Call original first (if it exists) to handle non-classification preview fields
  if (_origUpdateAdminPDFPreview) {
    try { _origUpdateAdminPDFPreview(); } catch(e) {}
  }
  // Override the classification line to use _isValidClassif
  const g = id => document.getElementById(id);
  const classifLine = g('apPreviewCatLine');
  if (classifLine) {
    const parts = [
      g('apCat')?.value, g('apSubcat')?.value,
      g('apAcademicLevel')?.value, g('apStream')?.value,
      g('apSemesterClass')?.value, g('apSubject')?.value
    ].filter(_isValidClassif);
    classifLine.textContent = parts.join(' › ') || '—';
  }
}
window.updateAdminPDFPreview = _cmPatchedUpdateAdminPDFPreview;

// ─────────────────────────────────────────────────────────────────────
// SECTION 14 — "WHO SHOULD READ THIS" — don't assume subcategory
// Patch renderDetail to use category OR subcategory for the audience chip
// ─────────────────────────────────────────────────────────────────────
// This is read-only HTML generation inside renderDetail() which we cannot
// fully override without duplicating 200+ lines. Instead we patch the DOM
// after renderDetail fires by hooking into the navigate function.

const _origNavigate = typeof window.navigate === 'function' ? window.navigate : null; // FIX: capture true original via window.navigate (avoids self-reference from function hoisting)
function _cmPatchedNavigate(page, ...args) { // FIX: renamed from 'navigate' to prevent hoisting self-collision (was causing infinite recursion / Maximum call stack error)
  if (typeof _origNavigate === 'function') _origNavigate(page, ...args);
  // After detail renders, fix "Who Should Read This" audience chips
  if (page === 'detail') {
    requestAnimationFrame(() => {
      const audienceChips = document.querySelectorAll('.pdp-audience-chip');
      // The first chip is dynamic (subcategory students)
      if (audienceChips.length > 0) {
        const pdf = window.selectedPdf;
        const firstChip = audienceChips[0];
        if (firstChip && pdf) {
          // Use the most specific available classification label
          const label = _isValidClassif(pdf.subject)       ? pdf.subject + ' Students'
                      : _isValidClassif(pdf.subcategory)   ? pdf.subcategory + ' Students'
                      : _isValidClassif(pdf.category)      ? pdf.category + ' Students'
                      : 'Study Material Students';
          firstChip.innerHTML = `<span>📚</span><span>${label}</span>`;
        }
      }

      // Also patch pdpInfoChips — rebuild with null-safe logic
      const chipsEl = document.getElementById('pdpInfoChips');
      const pdf = window.selectedPdf;
      if (chipsEl && pdf) {
        const classifChips = _buildDetailClassifChips(pdf);
        // Preserve non-classification chips (language, pages, downloads, dates, access)
        const existingNonClassif = chipsEl.querySelectorAll(
          '.pdp-info-chip:not([data-classif])'
        );
        // Mark classification chips and replace
        const nonClassifHTML = Array.from(existingNonClassif).map(el => el.outerHTML).join('');
        chipsEl.innerHTML = classifChips + nonClassifHTML;
      }
    });
  }
}
window.navigate = _cmPatchedNavigate; // FIX: expose patched navigate globally after original is safely wrapped

// ─────────────────────────────────────────────────────────────────────
// SECTION 15 — CLASSIFICATION MANAGEMENT: "+ Create New" from dropdowns
// Patches apCMSwitchLevel to refresh dropdowns after adding new item
// ─────────────────────────────────────────────────────────────────────

const _origApCMLoadAll = typeof window.apCMLoadAll === 'function' ? window.apCMLoadAll : null;

async function _cmPatchedApCMLoadAll() {
  // Call original load
  if (_origApCMLoadAll) await _origApCMLoadAll();

  // After loading, refresh the category dropdown to reflect new items
  const catEl = document.getElementById('apCat');
  if (catEl && window._apCM?.data?.categories?.length) {
    const current = catEl.value;
    catEl.innerHTML = '<option value="">— Select Category —</option>' +
      window._apCM.data.categories.map(c =>
        `<option value="${c.name}" data-id="${c.id}">${c.name}</option>`
      ).join('');
    _appendCreateNewOption(catEl, 'Category', 'categories');
    if (current) catEl.value = current;
  }

  // Refresh the Discover category dropdown too
  const dCat = document.getElementById('dCat');
  if (dCat && window._apCM?.data?.categories?.length) {
    const dCurrent = dCat.value;
    dCat.innerHTML = '<option value="">All Categories</option>' +
      window._apCM.data.categories.map(c =>
        `<option value="${c.name}">${c.name}</option>`
      ).join('');
    if (dCurrent) dCat.value = dCurrent;
  }
}
window.apCMLoadAll = _cmPatchedApCMLoadAll;

// ─────────────────────────────────────────────────────────────────────
// SECTION 16 — FORM LABEL UPDATES
// Patches the Classification section header to say "Only Category required"
// and removes the * (required asterisk) from optional fields in the DOM
// ─────────────────────────────────────────────────────────────────────

(function _patchFormLabels() {
  // Remove * from optional field labels (subcategory, academic level, etc.)
  // Category label should keep its * since it IS required.
  const optionalSelectIds = ['apSubcat','apAcademicLevel','apStream','apSemesterClass','apSubject'];
  optionalSelectIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // Find the closest label element
    const wrapper = el.closest('.ap-classif-item');
    if (!wrapper) return;
    const label = wrapper.querySelector('.ap-label');
    if (!label) return;
    const req = label.querySelector('.ap-req');
    if (req) req.remove();
    // Add "(optional)" hint if not already there
    if (!label.querySelector('.ap-optional')) {
      const opt = document.createElement('span');
      opt.className = 'ap-optional';
      opt.style.cssText = 'font-size:.65rem;color:var(--text3);font-weight:400;margin-left:4px;text-transform:none';
      opt.textContent = '(optional)';
      label.appendChild(opt);
    }
  });

  // Update the classification card subtitle
  const subtitle = document.querySelector('.ap-card-title span[style*="0.68rem"]');
  if (subtitle && subtitle.textContent.includes('cascade')) {
    subtitle.textContent = '— Only Category required. All others optional.';
  }
})();

// ─────────────────────────────────────────────────────────────────────
// SECTION 17 — CATEGORY MANAGER: "+ Create New" from Discover filters
// ─────────────────────────────────────────────────────────────────────

// Quick-create modal for admins clicking "+ Create New" in search filters
function _openQuickCreateClassif(table, label) {
  const name = prompt(`Create new ${label}:`);
  if (!name?.trim()) return;
  if (!window.supabaseClient) { showToast('Supabase not connected', 'error'); return; }

  const payload = {
    name: name.trim(),
    slug: (typeof generateSlug === 'function') ? generateSlug(name.trim()) : name.trim().toLowerCase().replace(/\s+/g,'-'),
    sort_order: 0,
  };

  window.supabaseClient.from(table).insert(payload).then(({ error }) => {
    if (error) {
      showToast('Create failed: ' + error.message, 'error');
    } else {
      showToast(`✅ ${label} "${name.trim()}" created!`, 'success');
      // Refresh relevant filters
      _loadDiscoverFiltersFromDB();
      apRefreshCategories();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 18 — INIT: run on DOMContentLoaded / document ready
// ─────────────────────────────────────────────────────────────────────

function _classifRefactorInit() {
  // Load Discover filter dropdowns from DB
  _loadDiscoverFiltersFromDB();

  // Add "+ Create New" to Discover filter selects (for admin users only)
  // These are simpler — just trigger a quick-create modal
  const filterSelectIds = [
    { id: 'dCat',     table: 'categories',    label: 'Category' },
    { id: 'dSub',     table: 'subcategories', label: 'Subcategory' },
    { id: 'dStream',  table: 'streams',       label: 'Stream' },
    { id: 'dSubject', table: 'subjects',      label: 'Subject' },
  ];
  filterSelectIds.forEach(({ id, table, label }) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.createNewPatched) return;
    el.dataset.createNewPatched = '1';
    const opt = document.createElement('option');
    opt.value = `__create_${table}__`;
    opt.textContent = `➕ Create New ${label}`;
    opt.style.color = 'var(--accent)';
    opt.style.fontWeight = '700';
    el.appendChild(opt);
    el.addEventListener('change', () => {
      if (el.value.startsWith('__create_')) {
        el.value = '';
        // Only show for admins (check if admin panel is available)
        if (window.currentUser?.role === 'admin' || document.getElementById('adminPanel')?.style.display !== 'none') {
          _openQuickCreateClassif(table, label);
        } else {
          showToast('Admin access required to create new categories.', 'info');
        }
      }
    });
  });

  console.log('[ClassifRefactor] ✅ PDF Classification Refactor loaded.');
  console.log('[ClassifRefactor] Rules:');
  console.log('  - Only category_id is required');
  console.log('  - All other fields save NULL when blank');
  console.log('  - NULL classification PDFs: upload ✓ edit ✓ library ✓ search ✓ filters ✓');
  console.log('  - Empty/null values never displayed in UI');
  console.log('  - "+ Create New" added to all classification dropdowns');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _classifRefactorInit);
} else {
  // DOM already ready (script placed at end of body)
  setTimeout(_classifRefactorInit, 0);
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 19 — PREMIUM EDIT UI INTEGRATION
// Patches adminSavePDF payload to also include IDs from the premium
// cascading dropdowns (pepCat, pepSubcat, etc.) when editing via SBP.
// Also syncs pepCat → sbeCat to keep the original save pipeline intact.
// ─────────────────────────────────────────────────────────────────────

(function _pepIntegrationPatch() {

  /**
   * getSelectIdFromEl(selectId)
   * Returns data-id of the currently selected option, or null.
   */
  function _pepGetId(selectId) {
    const el = document.getElementById(selectId);
    if (!el) return null;
    const opt = el.options[el.selectedIndex];
    return opt?.dataset?.id || null;
  }

  /**
   * Patch the SPM publish flow to include new classification FK IDs
   * from the premium editor dropdowns (pepCat → category_id, etc.).
   * These are merged into the item object before sbpBuildPublishPayload
   * converts item → Supabase row.
   */
  if (typeof window.sbpBuildPublishPayload === 'function') {
    const _origBuild = window.sbpBuildPublishPayload;
    window.sbpBuildPublishPayload = function(item) {
      const payload = _origBuild(item);
      // Merge premium dropdown IDs if present
      if (item.categoryId)      payload.category_id       = item.categoryId;
      if (item.subcategoryId)   payload.subcategory_id    = item.subcategoryId;
      if (item.academicLevelId) payload.academic_level_id = item.academicLevelId;
      if (item.streamId)        payload.stream_id         = item.streamId;
      if (item.semesterClassId) payload.semester_class_id = item.semesterClassId;
      if (item.subjectId)       payload.subject_id        = item.subjectId;
      // Also write text values for display columns
      if (item.subcategory)  payload.subcategory    = item.subcategory  || null;
      if (item.academicLevel)payload.academic_level = item.academicLevel|| null;
      if (item.stream)       payload.stream         = item.stream       || null;
      if (item.semesterClass)payload.semester_class = item.semesterClass|| null;
      if (item.subject)      payload.subject        = item.subject      || null;
      return payload;
    };
  }

  /**
   * Patch the existing adminSavePDF (used by legacy Add/Edit PDF tab)
   * to also read classification IDs from premium dropdowns if they exist
   * in the DOM (i.e. when premium-edit-pdf-ui.js is loaded).
   * Safe no-op if the pep* elements don't exist.
   */
  const _origAdminSavePDF = window.adminSavePDF;
  if (typeof _origAdminSavePDF === 'function') {
    window.adminSavePDF = async function() {
      // Sync pepCat → apCat if premium editor is active
      const pepCatEl = document.getElementById('pepCat');
      const apCatEl  = document.getElementById('apCat');
      if (pepCatEl?.value && apCatEl) apCatEl.value = pepCatEl.value;
      return _origAdminSavePDF.apply(this, arguments);
    };
  }

  console.log('[ClassifRefactor] ✅ Section 19 — Premium Edit UI integration patch applied.');
})();
