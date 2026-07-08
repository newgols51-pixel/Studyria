
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
  const _resolve = (idVal, cache) => (cache||[]).find(s=>String(s.id)===String(idVal))?.name || null;
  return [
    pdf.category,
    _resolve(pdf.subcategory_id,    window._dbSubcategories),
    _resolve(pdf.academic_level_id, window._dbAcademicLevels),
    _resolve(pdf.stream_id,         window._dbStreams),
    _resolve(pdf.semester_class_id, window._dbSemesterClasses),
    _resolve(pdf.subject_id,        window._dbSubjects),
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
      // Store the bare storage path — pdfs bucket is PRIVATE so getPublicUrl would
      // produce a non-functional URL. createSignedUrl is called at read-time instead.
      pdfUrl = fpath2;
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

    // ── Payload — all optional fields explicitly NULL when blank ──
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
      free:              isFree || sellPrice === 0,
      badge:             badge           || null,
      exam_year:         examYear        || null,
      slug:              slug            || null,
      seo_title:         seoTitle        || null,
      seo_description:   seoDesc         || null,
      seo_keywords:      seoKeywords     || null,
      cover_url:         coverUrl,
      pdf_url:           pdfUrl,
      status:            'published',
      ...(isEditing ? {
        download_count: dlCount,
        views:          views,
        wishlist_count: wishCount
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
      showToast(`✅ "${title}" published instantly!`, 'success');
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
  if (resultsWrap) resultsWrap.style.display = hasFilters ? 'block' : 'none';
  if (!hasFilters) { updateActivePills(); return; }

  const _discoverLoading2 = document.getElementById('discoverLoading');
  const _discoverResults2 = document.getElementById('discoverResults');
  const _discoverEmpty2   = document.getElementById('discoverEmpty');
  if (_discoverLoading2) _discoverLoading2.style.display = 'flex';
  if (_discoverResults2) _discoverResults2.innerHTML = '';
  if (_discoverEmpty2)   _discoverEmpty2.style.display = 'none';
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
        q = subObj ? q.eq('subcategory_id', subObj.id) : q.eq('category_id', catObj?.id || null);
      }
      if (stream) {
        const strObj = (window._dbStreams||[]).find(s => s.name === stream || s.slug === stream);
        if (strObj) q = q.eq('stream_id', strObj.id);
      }
      if (subject) {
        const subjObj = (window._dbSubjects||[]).find(s => s.name === subject || s.slug === subject);
        if (subjObj) q = q.eq('subject_id', subjObj.id);
      }
      if (query)   q = q.or(`title.ilike.%${query}%,seo_keywords.ilike.%${query}%,category.ilike.%${query}%`);
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
        (p.category||'').toLowerCase().includes(query);
      // For filters: if filter is set, match. If filter is empty, include ALL PDFs
      // (including those with null for that field)
      const matchCat    = !cat    || (p.category    || '').toLowerCase() === cat.toLowerCase();
      const matchSub    = !sub    || String(p.subcategory_id) === String((window._dbSubcategories||[]).find(s=>s.name===sub)?.id||'');
      const matchStream = !stream || String(p.stream_id) === String((window._dbStreams||[]).find(s=>s.name===stream)?.id||'');
      const matchSubj   = !subject|| String(p.subject_id) === String((window._dbSubjects||[]).find(s=>s.name===subject)?.id||'');
      return matchQ && matchCat && matchSub && matchStream && matchSubj;
    });
  }

  const _dl2 = document.getElementById('discoverLoading');
  if (_dl2) _dl2.style.display = 'none';

  const discoverResultsCount = document.getElementById('discoverResultsCount');
  if (discoverResultsCount) discoverResultsCount.textContent = `${results.length} PDFs found`;

  const _de2 = document.getElementById('discoverEmpty');
  const _dr2 = document.getElementById('discoverResults');

  if (results.length === 0) {
    if (_de2) _de2.style.display = 'block';
  } else {
    if (_dr2) _dr2.innerHTML =
      results.map(p => pdfCardHTML(normalizePdf(p))).join('');
    // Refresh ownership-aware button labels
    setTimeout(_refreshFreeButtonLabels, 50);
  }
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 8 — DISCOVER FILTERS: load dynamically from DB
// (replaces hardcoded static options with live DB values)
// ─────────────────────────────────────────────────────────────────────

async function _loadDiscoverFiltersFromDB() {
  if (!window.supabaseClient) return;
  // PERF: cache filter options for 10 minutes — these rarely change
  const CACHE_KEY = 'studyria_discover_filters';
  const CACHE_TTL = 600000; // 10 minutes
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const { ts, cats, subs, streams, subjects } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) {
        _applyDiscoverFilters(cats, subs, streams, subjects);
        return;
      }
    }
  } catch(e) {}
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
    // PERF: cache the filter data
    try {
      sessionStorage.setItem('studyria_discover_filters', JSON.stringify({ ts: Date.now(), cats, subs, streams, subjects }));
    } catch(e) {}
  } catch(e) {
    console.warn('Discover filter load from DB failed (static options remain):', e);
  }
}

// Helper to apply cached filter data to DOM
function _applyDiscoverFilters(cats, subs, streams, subjects) {
  const dCat = document.getElementById('dCat');
  if (dCat && cats?.length) {
    dCat.innerHTML = '<option value="">All Categories</option>' +
      cats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  }
  const dSub = document.getElementById('dSub');
  if (dSub && subs?.length) {
    dSub.innerHTML = '<option value="">All Levels</option>' +
      subs.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  }
  const dStream = document.getElementById('dStream');
  if (dStream && streams?.length) {
    dStream.innerHTML = '<option value="">All Streams</option>' +
      streams.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  }
  const dSubject = document.getElementById('dSubject');
  if (dSubject && subjects?.length) {
    dSubject.innerHTML = '<option value="">All Subjects</option>' +
      subjects.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  }
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
  const _res = (idVal, cache) => (cache||[]).find(s=>String(s.id)===String(idVal))?.name || null;

  if (_isValidClassif(pdf.category))
    chips.push(`<div class="pdp-info-chip"><span class="pdp-ic-icon">📚</span><span class="pdp-ic-label">Category</span><span class="pdp-ic-val">${_esc(pdf.category)}</span></div>`);

  const _subcatName = _res(pdf.subcategory_id, window._dbSubcategories);
  if (_isValidClassif(_subcatName))
    chips.push(`<div class="pdp-info-chip"><span class="pdp-ic-icon">🏫</span><span class="pdp-ic-label">Class/Level</span><span class="pdp-ic-val">${_esc(_subcatName)}</span></div>`);

  const _levelName = _res(pdf.academic_level_id, window._dbAcademicLevels);
  if (_isValidClassif(_levelName))
    chips.push(`<div class="pdp-info-chip"><span class="pdp-ic-icon">🎓</span><span class="pdp-ic-label">Academic Level</span><span class="pdp-ic-val">${_esc(_levelName)}</span></div>`);

  const _streamName = _res(pdf.stream_id, window._dbStreams);
  if (_isValidClassif(_streamName))
    chips.push(`<div class="pdp-info-chip"><span class="pdp-ic-icon">🌊</span><span class="pdp-ic-label">Stream</span><span class="pdp-ic-val">${_esc(_streamName)}</span></div>`);

  const _semName = _res(pdf.semester_class_id, window._dbSemesterClasses);
  if (_isValidClassif(_semName))
    chips.push(`<div class="pdp-info-chip"><span class="pdp-ic-icon">📅</span><span class="pdp-ic-label">Semester/Class</span><span class="pdp-ic-val">${_esc(_semName)}</span></div>`);

  const _subjName = _res(pdf.subject_id, window._dbSubjects);
  if (_isValidClassif(_subjName))
    chips.push(`<div class="pdp-info-chip"><span class="pdp-ic-icon">📖</span><span class="pdp-ic-label">Subject</span><span class="pdp-ic-val">${_esc(_subjName)}</span></div>`);

  return chips.join('');
}

// ─────────────────────────────────────────────────────────────────────
// SECTION 11 — PDF CARD CHIPS: never show null/empty values
// Applied inline: sanitize classification fields before pdfCardHTML calls
// NOTE: The recursive override that was here caused RangeError (infinite
// recursion via hoisting). It is removed. The original pdfCardHTML at
// line 7660 already uses `if (pdf.subject)` etc. for null-safety.
// Classification sanitization is applied via _sanitizeClassifFields().
// ─────────────────────────────────────────────────────────────────────

function _sanitizeClassifFields(pdf) {
  if (!pdf) return pdf;
  // Only `category` is a valid text column on pdfs; all others use _id columns
  ['category'].forEach(k => {
    if (!_isValidClassif(pdf[k])) pdf[k] = null;
  });
  return pdf;
}

// Patch pdfCardHTML safely using IIFE (avoids hoisting-caused self-reference).
// Must run AFTER the original function declaration is parsed; since script
// executes top-to-bottom after full parse, window.pdfCardHTML is already set.
(function() {
  const _orig = window.pdfCardHTML || (typeof pdfCardHTML === 'function' ? pdfCardHTML : null);
  if (typeof _orig === 'function') {
    window.pdfCardHTML = function pdfCardHTML(pdf) {
      return _orig(_sanitizeClassifFields(pdf));
    };
    // Keep global name in sync for any non-window references
    try { pdfCardHTML = window.pdfCardHTML; } catch(e) {}
  }
})();

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
// FIX: Use IIFE to capture original before patching (avoids hoisting recursion)
// ─────────────────────────────────────────────────────────────────────

(function() {
  const _origUpdateAdminPDFPreview = typeof updateAdminPDFPreview === 'function' ? updateAdminPDFPreview : null;
  window.updateAdminPDFPreview = function updateAdminPDFPreview() {
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
  };
})();

// ─────────────────────────────────────────────────────────────────────
// SECTION 14 — "WHO SHOULD READ THIS" — don't assume subcategory
// Patch renderDetail to use category OR subcategory for the audience chip
// ─────────────────────────────────────────────────────────────────────
// This is read-only HTML generation inside renderDetail() which we cannot
// fully override without duplicating 200+ lines. Instead we patch the DOM
// after renderDetail fires by hooking into the navigate function.

// FIX: Use a post-hoist wrapper to avoid infinite recursion.
// function declarations are hoisted, so capturing navigate before redefining
// it as a function declaration always captured itself → Maximum call stack exceeded.
// Solution: capture first, then assign via variable (not function declaration).
const _origNavigate = typeof navigate === 'function' ? navigate : null;
const _navigatePatch = function(page, ...args) {
  if (_origNavigate) _origNavigate(page, ...args);
  // After detail renders, fix "Who Should Read This" audience chips
  if (page === 'detail') {
    requestAnimationFrame(() => {
      const audienceChips = document.querySelectorAll('.pdp-audience-chip');
      // The first chip is dynamic (subcategory students)
      if (audienceChips.length > 0) {
        const pdf = window.selectedPdf;
        const firstChip = audienceChips[0];
        if (firstChip && pdf) {
          const _res = (idVal, cache) => (cache||[]).find(s=>String(s.id)===String(idVal))?.name || null;
          const label = _isValidClassif(_res(pdf.subject_id, window._dbSubjects))
                          ? _res(pdf.subject_id, window._dbSubjects) + ' Students'
                      : _isValidClassif(_res(pdf.subcategory_id, window._dbSubcategories))
                          ? _res(pdf.subcategory_id, window._dbSubcategories) + ' Students'
                      : _isValidClassif(pdf.category)
                          ? pdf.category + ' Students'
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
};
// FIX: Assign the patched function to navigate and window.navigate
// This avoids the hoisting-caused infinite recursion.
navigate = _navigatePatch;
window.navigate = navigate;

// ─────────────────────────────────────────────────────────────────────
// SECTION 15 — CLASSIFICATION MANAGEMENT: "+ Create New" from dropdowns
// Patches apCMSwitchLevel to refresh dropdowns after adding new item
// ─────────────────────────────────────────────────────────────────────

(function() {
  const _origApCMLoadAll = typeof apCMLoadAll === 'function' ? apCMLoadAll : null;
  window.apCMLoadAll = async function apCMLoadAll() {
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
  };
})();

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

}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _classifRefactorInit);
} else {
  // DOM already ready (script placed at end of body)
  setTimeout(_classifRefactorInit, 0);
}

// ═══════════════════════════════════════════════════════════════════
// ⚙️ HEADER MANAGER
// ═══════════════════════════════════════════════════════════════════
function renderHeaderManager(main) {
  main.innerHTML = `
  <style>
  .hm-card{background:var(--glass);border:1px solid var(--glass-border);border-radius:16px;padding:20px 22px;margin-bottom:16px}
  .hm-card-title{font-weight:800;font-size:.95rem;color:var(--text);margin-bottom:16px;display:flex;align-items:center;gap:8px}
  .hm-item{display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--bg2);border:1px solid var(--glass-border);border-radius:12px;margin-bottom:8px;cursor:grab;transition:all .2s}
  .hm-item:hover{border-color:rgba(61,142,248,.4);background:rgba(61,142,248,.06)}
  .hm-item-drag{font-size:1rem;color:var(--text2);cursor:grab}
  .hm-item-label{flex:1;font-size:.87rem;font-weight:600;color:var(--text)}
  .hm-item-pos{font-size:.72rem;color:var(--text2);background:var(--glass);padding:2px 8px;border-radius:6px;border:1px solid var(--glass-border)}
  .hm-toggle-wrap{display:flex;align-items:center;gap:8px}
  .hm-toggle{position:relative;width:40px;height:22px;border-radius:11px;background:var(--glass-border);border:none;cursor:pointer;transition:background .2s}
  .hm-toggle.on{background:var(--accent)}
  .hm-toggle::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s;box-shadow:0 1px 4px rgba(0,0,0,.3)}
  .hm-toggle.on::after{transform:translateX(18px)}
  .hm-pos-select{background:var(--bg2);border:1px solid var(--glass-border);border-radius:8px;color:var(--text);font-size:.8rem;padding:4px 8px;font-family:var(--font-body)}
  .hm-save-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px}
  .hm-msg{font-size:.78rem;font-weight:600;color:var(--success)}
  </style>

  <div class="admin-section-title">⚙️ Header Manager</div>
  <div class="admin-section-sub">Control what appears in the site header — order, visibility, and position.</div>

  <div class="hm-card">
    <div class="hm-card-title">🔀 Reorder & Show/Hide Items</div>
    <div id="hmItemList">
      <div style="padding:20px;text-align:center;color:var(--text2);font-size:.82rem">Loading header config…</div>
    </div>
  </div>

  <div class="hm-card">
    <div class="hm-card-title">📍 Header Position</div>
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <label style="font-size:.85rem;color:var(--text2)">Position:</label>
      <select class="hm-pos-select" id="hmPositionSelect">
        <option value="fixed-top">Fixed Top (default)</option>
        <option value="sticky-top">Sticky Top</option>
        <option value="static">Static (scrolls away)</option>
      </select>
      <label style="font-size:.85rem;color:var(--text2)">Height:</label>
      <select class="hm-pos-select" id="hmHeightSelect">
        <option value="56px">Compact (56px)</option>
        <option value="64px" selected>Default (64px)</option>
        <option value="72px">Tall (72px)</option>
      </select>
    </div>
  </div>

  <div class="hm-save-bar">
    <button class="btn btn-primary btn-sm" onclick="hmSave()">💾 Save to Supabase</button>
    <button class="btn btn-ghost btn-sm" onclick="hmLoad()">↺ Reset</button>
    <span class="hm-msg" id="hmMsg" style="display:none">✅ Saved!</span>
  </div>`;

  hmLoad();
}

const HM_DEFAULT_ITEMS = [
  {id:'logo',      label:'🎓 Logo / Brand',   visible:true,  order:0},
  {id:'darkmode',  label:'🌙 Dark Mode Toggle',visible:true,  order:1},
  {id:'auth',      label:'👤 Sign In / Profile',visible:true, order:2},
  {id:'burger',    label:'🍔 Burger Menu',     visible:true,  order:3},
  {id:'pwa',       label:'📲 PWA Install Btn', visible:false, order:4},
];

let hmItems = [];

async function hmLoad() {
  const list = document.getElementById('hmItemList');
  if (!list) return;
  try {
    const { data, error } = await window._supabase
      .from('site_config')
      .select('value')
      .eq('key', 'header_config')
      .single();
    hmItems = (data && !error) ? JSON.parse(data.value) : [...HM_DEFAULT_ITEMS];
  } catch(e) {
    hmItems = [...HM_DEFAULT_ITEMS];
  }
  hmRender();
}

function hmRender() {
  const list = document.getElementById('hmItemList');
  if (!list) return;
  const sorted = [...hmItems].sort((a,b)=>a.order-b.order);
  list.innerHTML = sorted.map((item,i) => `
    <div class="hm-item" draggable="true" data-id="${item.id}" ondragstart="hmDragStart(event,'${item.id}')" ondragover="hmDragOver(event)" ondrop="hmDrop(event,'${item.id}')">
      <span class="hm-item-drag">⋮⋮</span>
      <span class="hm-item-label">${item.label}</span>
      <span class="hm-item-pos">pos ${item.order+1}</span>
      <div class="hm-toggle-wrap">
        <span style="font-size:.72rem;color:var(--text2)">${item.visible?'Visible':'Hidden'}</span>
        <button class="hm-toggle ${item.visible?'on':''}" onclick="hmToggle('${item.id}')" title="Toggle visibility"></button>
      </div>
    </div>`).join('');
}

let _hmDragId = null;
function hmDragStart(e, id) { _hmDragId = id; e.dataTransfer.effectAllowed='move'; }
function hmDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect='move'; }
function hmDrop(e, targetId) {
  e.preventDefault();
  if (!_hmDragId || _hmDragId === targetId) return;
  const srcIdx = hmItems.findIndex(x=>x.id===_hmDragId);
  const tgtIdx = hmItems.findIndex(x=>x.id===targetId);
  if (srcIdx<0||tgtIdx<0) return;
  const sorted = [...hmItems].sort((a,b)=>a.order-b.order);
  const srcPos = sorted.findIndex(x=>x.id===_hmDragId);
  const tgtPos = sorted.findIndex(x=>x.id===targetId);
  sorted.splice(tgtPos,0,sorted.splice(srcPos,1)[0]);
  sorted.forEach((item,i)=>{ const f=hmItems.find(x=>x.id===item.id); if(f) f.order=i; });
  _hmDragId = null;
  hmRender();
}
function hmToggle(id) {
  const item = hmItems.find(x=>x.id===id);
  if (item) { item.visible = !item.visible; hmRender(); }
}

async function hmSave() {
  const msg = document.getElementById('hmMsg');
  const pos  = document.getElementById('hmPositionSelect')?.value;
  const h    = document.getElementById('hmHeightSelect')?.value;
  const payload = { items: hmItems, position: pos, height: h };
  try {
    await window._supabase.from('site_config').upsert({ key:'header_config', value: JSON.stringify(payload) });
    if (msg) { msg.style.display='inline'; setTimeout(()=>msg.style.display='none',2500); }
    showToast('Header config saved!','success');
  } catch(e) {
    showToast('Save failed: '+e.message,'error');
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🍔 NAVIGATION MANAGER
// ═══════════════════════════════════════════════════════════════════
const NM_BADGE_PRESETS = ['NEW','HOT','VIP','BETA','PRO','SALE'];
const NM_ICON_PRESETS  = ['🏠','📚','📊','⚙️','👤','🌟','💎','🔥','📖','🎯','🎓','📝','🔔','💡','🏆','🌐','📱','💰','🔒','✨'];
const NM_CATEGORY_PRESETS = ['Study','Careers','Community','Main','Tools','Resources','Premium'];

let nmItems = [];
let nmEditId = null;

function renderNavManager(main) {
  main.innerHTML = `
  <style>
  .nm-card{background:var(--glass);border:1px solid var(--glass-border);border-radius:16px;padding:20px 22px;margin-bottom:16px}
  .nm-card-title{font-weight:800;font-size:.95rem;color:var(--text);margin-bottom:16px;display:flex;align-items:center;gap:8px}
  .nm-item{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg2);border:1px solid var(--glass-border);border-radius:12px;margin-bottom:8px;transition:all .2s}
  .nm-item:hover{border-color:rgba(61,142,248,.35)}
  .nm-item-icon{font-size:1.1rem;width:28px;text-align:center;flex-shrink:0}
  .nm-item-info{flex:1;min-width:0}
  .nm-item-label{font-size:.87rem;font-weight:700;color:var(--text);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .nm-item-sub{font-size:.7rem;color:var(--text2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .nm-badge{font-size:.6rem;font-weight:800;padding:1px 6px;border-radius:4px;letter-spacing:.05em}
  .nm-badge-new{background:rgba(16,217,142,.15);color:var(--success);border:1px solid rgba(16,217,142,.3)}
  .nm-badge-hot{background:rgba(255,77,109,.15);color:var(--danger);border:1px solid rgba(255,77,109,.3)}
  .nm-badge-vip{background:rgba(139,92,246,.15);color:#a78bfa;border:1px solid rgba(139,92,246,.3)}
  .nm-badge-beta{background:rgba(251,191,36,.15);color:#fbbf24;border:1px solid rgba(251,191,36,.3)}
  .nm-badge-pro{background:rgba(61,142,248,.15);color:var(--accent);border:1px solid rgba(61,142,248,.3)}
  .nm-badge-sale{background:rgba(255,100,0,.15);color:#f97316;border:1px solid rgba(255,100,0,.3)}
  .nm-item-actions{display:flex;gap:6px;flex-shrink:0}
  .nm-btn{padding:5px 10px;border-radius:8px;font-size:.72rem;font-weight:700;border:1px solid var(--glass-border);cursor:pointer;font-family:var(--font-body);transition:all .15s;background:var(--glass);color:var(--text)}
  .nm-btn:hover{border-color:var(--accent);color:var(--accent)}
  .nm-btn-danger:hover{border-color:var(--danger);color:var(--danger)}
  .nm-hidden-item{opacity:.45}
  .nm-form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
  @media(max-width:500px){.nm-form-row{grid-template-columns:1fr}}
  .nm-label{font-size:.78rem;font-weight:700;color:var(--text2);margin-bottom:5px;display:block}
  .nm-input{width:100%;background:var(--bg2);border:1px solid var(--glass-border);border-radius:10px;color:var(--text);font-size:.85rem;padding:9px 12px;font-family:var(--font-body);box-sizing:border-box}
  .nm-input:focus{outline:none;border-color:var(--accent)}
  .nm-select{width:100%;background:var(--bg2);border:1px solid var(--glass-border);border-radius:10px;color:var(--text);font-size:.85rem;padding:9px 12px;font-family:var(--font-body)}
  .nm-icon-grid{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  .nm-icon-btn{width:34px;height:34px;border-radius:8px;border:1px solid var(--glass-border);background:var(--bg2);font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}
  .nm-icon-btn:hover,.nm-icon-btn.sel{border-color:var(--accent);background:rgba(61,142,248,.12)}
  .nm-analytics-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--glass-border)}
  .nm-analytics-label{font-size:.83rem;color:var(--text)}
  .nm-analytics-val{font-size:.92rem;font-weight:800;color:var(--accent)}
  </style>

  <div class="admin-section-title">🍔 Navigation Manager</div>
  <div class="admin-section-sub">Manage all burger menu items — dynamic, fully customizable, saved to Supabase.</div>

  <div class="nm-card">
    <div class="nm-card-title" style="justify-content:space-between">
      <span>📋 Menu Items</span>
      <button class="btn btn-primary btn-sm" onclick="nmOpenAdd()">+ Add Item</button>
    </div>
    <div id="nmItemList"><div style="padding:20px;text-align:center;color:var(--text2);font-size:.82rem">Loading…</div></div>
  </div>

  <!-- Edit/Add Form -->
  <div class="nm-card" id="nmFormCard" style="display:none">
    <div class="nm-card-title" id="nmFormTitle">✏️ Edit Item</div>
    <div class="nm-form-row">
      <div>
        <label class="nm-label">Label *</label>
        <input class="nm-input" id="nmFLabel" placeholder="e.g. Library" maxlength="40"/>
      </div>
      <div>
        <label class="nm-label">Category</label>
        <select class="nm-select" id="nmFCategory">
          ${NM_CATEGORY_PRESETS.map(c=>`<option value="${c}">${c}</option>`).join('')}
          <option value="custom">Custom…</option>
        </select>
      </div>
    </div>
    <div class="nm-form-row">
      <div>
        <label class="nm-label">Link Type</label>
        <select class="nm-select" id="nmFLinkType" onchange="nmLinkTypeChange()">
          <option value="internal">Internal Page</option>
          <option value="external">External URL</option>
        </select>
      </div>
      <div>
        <label class="nm-label" id="nmFLinkLabel">Page ID (e.g. library)</label>
        <input class="nm-input" id="nmFLink" placeholder="library"/>
      </div>
    </div>
    <div class="nm-form-row">
      <div>
        <label class="nm-label">Badge</label>
        <select class="nm-select" id="nmFBadge">
          <option value="">None</option>
          ${NM_BADGE_PRESETS.map(b=>`<option value="${b}">${b}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="nm-label">Text Color (optional)</label>
        <input class="nm-input" id="nmFColor" type="color" style="height:40px;padding:4px 6px"/>
      </div>
    </div>
    <div style="margin-bottom:14px">
      <label class="nm-label">Icon Emoji</label>
      <input class="nm-input" id="nmFIcon" placeholder="🏠 or any emoji" maxlength="4" style="width:80px;display:inline;margin-right:10px"/>
      <div class="nm-icon-grid" id="nmIconGrid">
        ${NM_ICON_PRESETS.map(ic=>`<button class="nm-icon-btn" onclick="nmPickIcon('${ic}')">${ic}</button>`).join('')}
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem;color:var(--text)">
        <input type="checkbox" id="nmFVisible" checked style="accent-color:var(--accent)"/> Visible
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem;color:var(--text)">
        <input type="checkbox" id="nmFPremium" style="accent-color:#a78bfa"/> Premium only
      </label>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="nmSaveItem()">💾 Save Item</button>
      <button class="btn btn-ghost btn-sm" onclick="nmCloseForm()">Cancel</button>
    </div>
    <div id="nmFormMsg" style="display:none;margin-top:10px;font-size:.78rem;font-weight:600;color:var(--success)"></div>
  </div>

  <!-- Click Analytics -->
  <div class="nm-card">
    <div class="nm-card-title">📊 Click Analytics (Premium)</div>
    <div id="nmAnalytics"><div style="color:var(--text2);font-size:.82rem;text-align:center;padding:12px">Loading analytics…</div></div>
  </div>

  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">
    <button class="btn btn-primary btn-sm" onclick="nmSaveAll()">💾 Save All to Supabase</button>
    <button class="btn btn-ghost btn-sm" onclick="nmLoad()">↺ Reload from DB</button>
    <span id="nmGlobalMsg" style="display:none;font-size:.78rem;font-weight:600;color:var(--success)">✅ Saved!</span>
  </div>`;

  nmLoad();
}

const NM_DEFAULT_ITEMS = [
  // 📚 STUDY
  {id:'req',    label:'PDF Requests',    icon:'📩', category:'Study',     linkType:'internal', link:'career-hub',    badge:'NEW',    color:'', visible:true, premium:false, clicks:0, order:0},
  // 💼 CAREERS
  {id:'jobs',   label:'Jobs',            icon:'💼', category:'Careers',   linkType:'internal', link:'jobs',          badge:'NEW', color:'', visible:true, premium:false, clicks:0, order:1},
  {id:'res',    label:'Results',         icon:'📢', category:'Careers',   linkType:'internal', link:'results',       badge:'',    color:'', visible:true, premium:false, clicks:0, order:2},
  {id:'sch',    label:'Scholarships',    icon:'🎓', category:'Careers',   linkType:'internal', link:'scholarships',  badge:'HOT', color:'', visible:true, premium:false, clicks:0, order:3},
  {id:'exam',   label:'Exam Calendar',   icon:'📅', category:'Careers',   linkType:'internal', link:'exam-calendar', badge:'',    color:'', visible:true, premium:false, clicks:0, order:4},
  // 🤝 COMMUNITY
  {id:'part',   label:'Partner Program', icon:'🎓', category:'Community', linkType:'internal', link:'partners',      badge:'VIP', color:'', visible:true, premium:false, clicks:0, order:5},
  {id:'cc',     label:'Content Creators',icon:'👥', category:'Community', linkType:'internal', link:'creators',      badge:'',    color:'', visible:true, premium:false, clicks:0, order:6},
  {id:'top',    label:'Top Contributors',icon:'🏅', category:'Community', linkType:'internal', link:'contributors',  badge:'',    color:'', visible:true, premium:false, clicks:0, order:7},
];

async function nmLoad() {
  try {
    const { data, error } = await window._supabase
      .from('site_config')
      .select('value')
      .eq('key', 'nav_menu_items')
      .single();
    nmItems = (data && !error) ? JSON.parse(data.value) : [...NM_DEFAULT_ITEMS];
  } catch(e) {
    nmItems = [...NM_DEFAULT_ITEMS];
  }
  nmRender();
  nmRenderAnalytics();
  // Also refresh the live hamburger menu
  loadDynamicMenuItems();
}

function nmRender() {
  const list = document.getElementById('nmItemList');
  if (!list) return;
  const sorted = [...nmItems].sort((a,b)=>a.order-b.order);
  if (!sorted.length) { list.innerHTML = '<div style="color:var(--text2);font-size:.82rem;text-align:center;padding:16px">No items yet. Click + Add Item.</div>'; return; }
  list.innerHTML = sorted.map((item,i) => {
    const badgeCls = item.badge ? `nm-badge nm-badge-${item.badge.toLowerCase()}` : '';
    return `<div class="nm-item ${item.visible?'':'nm-hidden-item'}" draggable="true" data-id="${item.id}"
      ondragstart="nmDragStart(event,'${item.id}')" ondragover="nmDragOver(event)" ondrop="nmDrop(event,'${item.id}')">
      <span class="nm-item-icon">${item.icon||'📄'}</span>
      <div class="nm-item-info">
        <div class="nm-item-label">
          ${item.label}
          ${item.badge?`<span class="${badgeCls}">${item.badge}</span>`:''}
          ${item.premium?'<span class="nm-badge nm-badge-vip">VIP</span>':''}
          ${!item.visible?'<span style="font-size:.68rem;color:var(--text2)">(hidden)</span>':''}
        </div>
        <div class="nm-item-sub">${item.linkType==='external'?'🌐 ':''}<span style="color:var(--text2)">${item.category||'Main'} · </span>${item.link} · ${item.clicks||0} clicks</div>
      </div>
      <div class="nm-item-actions">
        <button class="nm-btn" onclick="nmMoveUp('${item.id}')">↑</button>
        <button class="nm-btn" onclick="nmMoveDown('${item.id}')">↓</button>
        <button class="nm-btn" onclick="nmEditItem('${item.id}')">✏️</button>
        <button class="nm-btn nm-btn-danger" onclick="nmDeleteItem('${item.id}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function nmRenderAnalytics() {
  const el = document.getElementById('nmAnalytics');
  if (!el) return;
  const sorted = [...nmItems].sort((a,b)=>(b.clicks||0)-(a.clicks||0));
  if (!sorted.length) { el.innerHTML='<div style="color:var(--text2);font-size:.82rem;text-align:center;padding:12px">No data yet.</div>'; return; }
  el.innerHTML = sorted.map(item=>`
    <div class="nm-analytics-row">
      <span class="nm-analytics-label">${item.icon||''} ${item.label}</span>
      <span class="nm-analytics-val">${item.clicks||0} clicks</span>
    </div>`).join('');
}

let _nmDragId = null;
function nmDragStart(e, id) { _nmDragId = id; e.dataTransfer.effectAllowed='move'; }
function nmDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect='move'; }
function nmDrop(e, targetId) {
  e.preventDefault();
  if (!_nmDragId || _nmDragId===targetId) return;
  const sorted = [...nmItems].sort((a,b)=>a.order-b.order);
  const srcPos = sorted.findIndex(x=>x.id===_nmDragId);
  const tgtPos = sorted.findIndex(x=>x.id===targetId);
  sorted.splice(tgtPos,0,sorted.splice(srcPos,1)[0]);
  sorted.forEach((item,i)=>{ const f=nmItems.find(x=>x.id===item.id); if(f) f.order=i; });
  _nmDragId=null; nmRender();
}
function nmMoveUp(id) {
  const sorted=nmItems.slice().sort((a,b)=>a.order-b.order);
  const idx=sorted.findIndex(x=>x.id===id);
  if(idx<=0) return;
  [sorted[idx].order,sorted[idx-1].order]=[sorted[idx-1].order,sorted[idx].order];
  nmRender();
}
function nmMoveDown(id) {
  const sorted=nmItems.slice().sort((a,b)=>a.order-b.order);
  const idx=sorted.findIndex(x=>x.id===id);
  if(idx<0||idx>=sorted.length-1) return;
  [sorted[idx].order,sorted[idx+1].order]=[sorted[idx+1].order,sorted[idx].order];
  nmRender();
}

function nmLinkTypeChange() {
  const t = document.getElementById('nmFLinkType')?.value;
  const lbl = document.getElementById('nmFLinkLabel');
  const inp = document.getElementById('nmFLink');
  if (!lbl||!inp) return;
  if (t==='external') { lbl.textContent='Full URL'; inp.placeholder='https://example.com'; }
  else { lbl.textContent='Page ID (e.g. library)'; inp.placeholder='library'; }
}

function nmPickIcon(ic) {
  const inp = document.getElementById('nmFIcon');
  if (inp) inp.value = ic;
  document.querySelectorAll('.nm-icon-btn').forEach(b=>b.classList.toggle('sel',b.textContent===ic));
}

function nmOpenAdd() {
  nmEditId = null;
  document.getElementById('nmFormTitle').textContent = '➕ Add Menu Item';
  document.getElementById('nmFLabel').value='';
  document.getElementById('nmFLink').value='';
  document.getElementById('nmFIcon').value='📄';
  document.getElementById('nmFBadge').value='';
  document.getElementById('nmFColor').value='#ffffff';
  document.getElementById('nmFCategory').value='Main';
  document.getElementById('nmFLinkType').value='internal';
  document.getElementById('nmFVisible').checked=true;
  document.getElementById('nmFPremium').checked=false;
  document.getElementById('nmFormMsg').style.display='none';
  document.getElementById('nmFormCard').style.display='';
  document.getElementById('nmFormCard').scrollIntoView({behavior:'smooth'});
  nmLinkTypeChange();
}

function nmEditItem(id) {
  const item = nmItems.find(x=>x.id===id);
  if (!item) return;
  nmEditId = id;
  document.getElementById('nmFormTitle').textContent = '✏️ Edit: '+item.label;
  document.getElementById('nmFLabel').value = item.label;
  document.getElementById('nmFLink').value  = item.link;
  document.getElementById('nmFIcon').value  = item.icon||'📄';
  document.getElementById('nmFBadge').value = item.badge||'';
  document.getElementById('nmFColor').value = item.color||'#ffffff';
  document.getElementById('nmFCategory').value = item.category||'Main';
  document.getElementById('nmFLinkType').value  = item.linkType||'internal';
  document.getElementById('nmFVisible').checked = item.visible!==false;
  document.getElementById('nmFPremium').checked = !!item.premium;
  document.getElementById('nmFormMsg').style.display='none';
  document.getElementById('nmFormCard').style.display='';
  document.getElementById('nmFormCard').scrollIntoView({behavior:'smooth'});
  nmLinkTypeChange();
}

function nmCloseForm() {
  document.getElementById('nmFormCard').style.display='none';
  nmEditId=null;
}

function nmSaveItem() {
  const label    = document.getElementById('nmFLabel').value.trim();
  const link     = document.getElementById('nmFLink').value.trim();
  const icon     = document.getElementById('nmFIcon').value.trim()||'📄';
  const badge    = document.getElementById('nmFBadge').value;
  const color    = document.getElementById('nmFColor').value;
  const category = document.getElementById('nmFCategory').value;
  const linkType = document.getElementById('nmFLinkType').value;
  const visible  = document.getElementById('nmFVisible').checked;
  const premium  = document.getElementById('nmFPremium').checked;
  if (!label) { showToast('Label is required','error'); return; }
  if (!link)  { showToast('Link is required','error'); return; }

  if (nmEditId) {
    const item = nmItems.find(x=>x.id===nmEditId);
    if (item) Object.assign(item,{label,link,icon,badge,color,category,linkType,visible,premium});
  } else {
    const id = 'nm_'+Date.now();
    nmItems.push({id,label,link,icon,badge,color,category,linkType,visible,premium,clicks:0,order:nmItems.length});
  }
  nmRender();
  nmCloseForm();
  showToast('Item saved — click "Save All to Supabase" to persist.','success');
}

function nmDeleteItem(id) {
  if (!confirm('Delete this menu item?')) return;
  nmItems = nmItems.filter(x=>x.id!==id);
  nmRender();
  nmRenderAnalytics();
}

async function nmSaveAll() {
  const msg = document.getElementById('nmGlobalMsg');
  try {
    await window._supabase.from('site_config').upsert({key:'nav_menu_items', value:JSON.stringify(nmItems)});
    if (msg) { msg.style.display='inline'; setTimeout(()=>msg.style.display='none',2500); }
    showToast('Navigation saved!','success');
    loadDynamicMenuItems();
  } catch(e) {
    showToast('Save failed: '+e.message,'error');
  }
}

// ═══════════════════════════════════════════════════════════════════
// 🌐 DYNAMIC MENU LOADER (runs on every page load)
// ═══════════════════════════════════════════════════════════════════
async function loadDynamicMenuItems() {
  const container = document.getElementById('dynamicMenuItems');
  if (!container) return;

  const BADGE_STYLE = {
    'NEW' :'background:rgba(16,217,142,.18);color:#10d98e;border:1px solid rgba(16,217,142,.35)',
    'HOT' :'background:rgba(255,77,109,.18);color:#ff6b85;border:1px solid rgba(255,77,109,.35)',
    'VIP' :'background:rgba(139,92,246,.18);color:#b794f4;border:1px solid rgba(139,92,246,.35)',
    'BETA':'background:rgba(251,191,36,.18);color:#fbbf24;border:1px solid rgba(251,191,36,.35)',
    'PRO' :'background:rgba(61,142,248,.18);color:#60a5fa;border:1px solid rgba(61,142,248,.35)',
    'SALE':'background:rgba(255,130,0,.18);color:#fb923c;border:1px solid rgba(255,130,0,.35)',
  };

  // ── Default sections shown when Supabase has no data yet ──
  const DEFAULT_SECTIONS = [
    {
      section: '📚 STUDY',
      items: [
        { id:'req',  label:'PDF Requests',   icon:'📩', link:'career-hub', linkType:'internal', badge:'NEW', color:'' },
        { id:'blog', label:'Blog',           icon:'📝', link:'blog',       linkType:'internal', badge:'',    color:'' },
      ]
    },
    {
      section: '💼 CAREERS',
      items: [
        { id:'jobs',  label:'Jobs',          icon:'💼', link:'jobs',       linkType:'internal', badge:'NEW', color:'' },
        { id:'res',   label:'Results',       icon:'📢', link:'results',    linkType:'internal', badge:'',    color:'' },
        { id:'sch',   label:'Scholarships',  icon:'🎓', link:'scholarships',linkType:'internal',badge:'HOT', color:'' },
        { id:'exam',  label:'Exam Calendar', icon:'📅', link:'exam-calendar',linkType:'internal',badge:'',  color:'' },
      ]
    },
    {
      section: '🤝 COMMUNITY',
      items: [
        { id:'part',  label:'Partner Program',   icon:'🎓', link:'partners',  linkType:'internal', badge:'VIP', color:'' },
        { id:'cc',    label:'Content Creators',  icon:'👥', link:'creators',  linkType:'internal', badge:'',    color:'' },
        { id:'top',   label:'Top Contributors',  icon:'🏅', link:'contributors',linkType:'internal',badge:'',  color:'' },
      ]
    },
  ];

  function buildItemHTML(item, idx) {
    const badgeHTML = item.badge && BADGE_STYLE[item.badge]
      ? `<span class="hm-badge hm-badge-${item.badge.toLowerCase()}">${item.badge}</span>`
      : '';
    const colorStyle = item.color && item.color !== '#ffffff' ? `color:${item.color}` : '';
    const action = item.linkType === 'external'
      ? `window.open('${item.link.replace(/'/g,"\\'")}','_blank')`
      : `navigate('${item.link.replace(/'/g,"\\'")}')`;
    const animDelay = (idx * 0.04).toFixed(2);
    return `<button class="hamburger-item" style="${colorStyle};animation-delay:${animDelay}s"
        onclick="(function(){const m=document.getElementById('hamburgerMenu');if(m&&m.__x)m.__x.$data.sidebarOpen=false;else if(window._alpine)window._alpine.sidebarOpen=false;})();${action};nmTrackClick('${item.id}')"
        onmouseenter="this.querySelector('.hm-icon')&&(this.querySelector('.hm-icon').style.transform='scale(1.12)')"
        onmouseleave="this.querySelector('.hm-icon')&&(this.querySelector('.hm-icon').style.transform='')">
      <span class="hm-icon">${item.icon || '📄'}</span>
      <span class="hm-item-label">${item.label}</span>
      ${badgeHTML}
    </button>`;
  }

  function buildSectionsHTML(sections) {
    return sections.map((sec, si) => `
      <div class="hm-section" style="animation-delay:${(si * 0.06).toFixed(2)}s">
        <div class="hm-section-label">${sec.section}</div>
      </div>
      ${sec.items.map((item, ii) => buildItemHTML(item, si * 10 + ii)).join('')}
    `).join('');
  }

  try {
    const { data, error } = await window._supabase
      .from('site_config')
      .select('value')
      .eq('key', 'nav_menu_items')
      .single();

    if (error || !data) throw new Error('No config');

    const flat = JSON.parse(data.value).filter(x => x.visible !== false).sort((a, b) => a.order - b.order);

    if (!flat.length) throw new Error('Empty');

    // Group by category
    const catMap = {};
    const catOrder = [];
    flat.forEach(item => {
      const cat = item.category || 'Main';
      if (!catMap[cat]) { catMap[cat] = []; catOrder.push(cat); }
      catMap[cat].push(item);
    });

    const catEmojis = { 'Main':'🏠','Study':'📚','Careers':'💼','Community':'🤝','Tools':'🔧','Resources':'📦','Premium':'💎' };
    const sections = catOrder.map(cat => ({
      section: (catEmojis[cat] || '📂') + ' ' + cat.toUpperCase(),
      items: catMap[cat]
    }));

    container.innerHTML = buildSectionsHTML(sections);

  } catch(e) {
    // Fallback to default sections
    container.innerHTML = buildSectionsHTML(DEFAULT_SECTIONS);
  }
}

async function nmTrackClick(id) {
  try {
    const { data } = await window._supabase.from('site_config').select('value').eq('key','nav_menu_items').single();
    if (!data) return;
    const items = JSON.parse(data.value);
    const item = items.find(x=>x.id===id);
    if (item) {
      item.clicks = (item.clicks||0)+1;
      await window._supabase.from('site_config').upsert({key:'nav_menu_items',value:JSON.stringify(items)});
    }
  } catch(e) {}
}

// Auto-load dynamic menu on startup
(function() {
  function _tryLoad() {
    if (window._supabase) { loadDynamicMenuItems(); }
    else { setTimeout(_tryLoad, 400); }
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',_tryLoad);
  else setTimeout(_tryLoad,400);
})();

// ══════════════════════════════════════════════════════════════════
// OTT HOME LAYOUT MANAGER — Admin Panel
// Netflix × JioHotstar × Apple Books inspired homepage builder
// ══════════════════════════════════════════════════════════════════

async function renderOTTHomeLayoutManager(main) {
  main.innerHTML = `<div style="text-align:center;padding:48px 0">
    <div style="font-size:2.5rem;margin-bottom:12px">🏠</div>
    <div style="font-weight:700;color:var(--text2)">Loading OTT Home Layout Manager…</div>
  </div>`;

  const sb = window.supabaseClient || window._supabase;

  // Load current settings
  let cfg = {};
  if (sb) {
    try {
      const { data } = await sb.from('site_config').select('key,value')
        .like('key', 'ott_%');
      if (data) data.forEach(r => cfg[r.key] = r.value);
    } catch(e) {}
  }

  const g = (k, fb) => cfg[k] !== undefined ? cfg[k] : fb;
  const isOn = (k, fb='1') => g(k, fb) === '1' || g(k, fb) === 'true' || g(k, fb) === true;

  // Load PDFs for picker
  const pdfs = window.PDFS || [];

  // Build featured PDF picker
  let savedFeaturedIds = [];
  try { savedFeaturedIds = JSON.parse(g('ott_featured_pdf_ids','[]')); } catch(e){}

  function featuredPickerHTML() {
    if (!pdfs.length) return '<div class="text-muted text-sm">No PDFs found. Ensure your pdfs table has data.</div>';
    return `<div style="max-height:240px;overflow-y:auto;border:1px solid var(--glass-border);border-radius:10px;padding:8px">
      ${pdfs.slice(0,50).map(p => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background .15s" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background='transparent'">
          <input type="checkbox" class="ott-featured-cb" value="${p.id}" ${savedFeaturedIds.includes(String(p.id))||savedFeaturedIds.includes(p.id)?'checked':''} style="accent-color:var(--accent);width:15px;height:15px;flex-shrink:0">
          ${p.cover_url?`<img src="${p.cover_url}" alt="${(p.title || 'PDF cover').replace(/"/g,'&quot;')}" style="width:28px;height:28px;object-fit:cover;border-radius:5px;flex-shrink:0" onerror="this.style.display='none'" loading="lazy" decoding="async">`:''}
          <span style="font-size:.82rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${p.title||'—'}</span>
          ${p.free?'<span style="font-size:.6rem;background:rgba(16,217,142,.15);color:#10d98e;border-radius:5px;padding:1px 6px;flex-shrink:0">FREE</span>':
            p.price?`<span style="font-size:.6rem;background:rgba(61,142,248,.1);color:var(--accent);border-radius:5px;padding:1px 6px;flex-shrink:0">₹${p.price}</span>`:''}
        </label>`).join('')}
    </div>`;
  }

  const sectionRows = [
    { key:'ott_for_you_enabled',         label:'✨ For You Hero Carousel', titleKey:'ott_for_you_title',      dflt:'✨ For You',                desc:'Large featured cards with auto-scroll' },
    { key:'ott_continue_enabled',        label:'📖 Continue Reading',      titleKey:'ott_continue_title',     dflt:'📖 Continue Reading',       desc:'PDFs the user recently opened' },
    { key:'ott_ai_reco_enabled',         label:'🤖 AI Recommended',        titleKey:'ott_ai_reco_title',      dflt:'🤖 AI Recommended',         desc:'Smart picks based on user history' },
    { key:'ott_trending_enabled',        label:'🔥 Trending This Week',    titleKey:'ott_trending_title',     dflt:'🔥 Trending This Week',     desc:'Most downloaded content' },
    { key:'ott_popular_enabled',         label:'🎓 Popular Among Students',titleKey:'ott_popular_title',      dflt:'🎓 Popular Among Students', desc:'High views + downloads score' },
    { key:'ott_new_arrivals_enabled',    label:'🆕 New Arrivals',          titleKey:'ott_new_arrivals_title', dflt:'🆕 New Arrivals',           desc:'PDFs added in last 30 days' },
    { key:'ott_recently_added_enabled',  label:'🕐 Recently Added',        titleKey:'ott_recent_title',       dflt:'🕐 Recently Added',         desc:'Latest additions in chronological order' },
  ];

  main.innerHTML = `
  <style>
  .hlm-card { background:var(--bg2);border:1px solid var(--glass-border);border-radius:18px;padding:22px 20px;margin-bottom:16px; }
  .hlm-card-title { font-family:var(--font-display);font-size:1rem;font-weight:800;color:var(--text);margin-bottom:14px;display:flex;align-items:center;gap:8px; }
  .hlm-row { display:flex;align-items:center;justify-content:space-between;padding:13px 0;border-bottom:1px solid var(--glass-border);gap:16px; }
  .hlm-row:last-child { border-bottom:none; }
  .hlm-row-info { flex:1;min-width:0; }
  .hlm-row-label { font-size:.88rem;font-weight:700;color:var(--text);margin-bottom:2px; }
  .hlm-row-desc { font-size:.72rem;color:var(--text2);line-height:1.4; }
  .hlm-toggle { width:46px;height:26px;border-radius:13px;border:none;cursor:pointer;position:relative;transition:all .25s;flex-shrink:0; }
  .hlm-toggle.on { background:linear-gradient(135deg,#3d8ef8,#00c8e8); }
  .hlm-toggle:not(.on) { background:rgba(255,255,255,0.1); }
  .hlm-toggle::after { content:'';position:absolute;top:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .25s;box-shadow:0 2px 6px rgba(0,0,0,0.3); }
  .hlm-toggle.on::after { left:23px; }
  .hlm-toggle:not(.on)::after { left:3px; }
  .hlm-input { width:100%;background:var(--bg2);border:1px solid var(--glass-border);border-radius:10px;color:var(--text);font-size:.85rem;padding:9px 12px;font-family:var(--font-body);box-sizing:border-box; }
  .hlm-input:focus { outline:none;border-color:var(--accent); }
  .hlm-field { margin-bottom:12px; }
  .hlm-label { font-size:.78rem;font-weight:700;color:var(--text2);margin-bottom:5px;display:block; }
  .hlm-save-bar { display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;align-items:center; }
  .hlm-save-msg { font-size:.78rem;font-weight:700;color:var(--success);opacity:0;transition:opacity .3s; }
  .hlm-section-row { display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--glass-border); }
  .hlm-section-row:last-child { border-bottom:none; }
  .hlm-drag-handle { color:var(--text3);cursor:grab;font-size:1rem;padding:0 4px; }
  .hlm-section-title-input { flex:1;background:var(--surface);border:1px solid var(--glass-border);border-radius:8px;padding:7px 10px;color:var(--text);font-size:.82rem;font-family:var(--font-body); }
  .hlm-section-title-input:focus { outline:none;border-color:var(--accent); }
  .hlm-preview-badge { display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:6px;font-size:.62rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase; }
  .hlm-animation-btn { padding:6px 14px;border-radius:8px;border:1px solid var(--glass-border);background:var(--glass);color:var(--text2);font-size:.75rem;cursor:pointer;font-family:var(--font-body);transition:all .15s; }
  .hlm-animation-btn.active,.hlm-animation-btn:hover { border-color:var(--accent);color:var(--accent);background:rgba(61,142,248,.1); }
  </style>

  <div style="margin-bottom:22px">
    <div style="font-family:var(--font-display);font-size:1.5rem;font-weight:800;background:linear-gradient(135deg,#f59e0b,#f97316);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">🏠 Home Layout Manager</div>
    <div style="font-size:.85rem;color:var(--text2);margin-top:4px">OTT-style discovery UX — Netflix × JioHotstar × Apple Books inspired</div>
  </div>

  <!-- ── SECTION MANAGER ─────────────────────────────────────── -->
  <div class="hlm-card">
    <div class="hlm-card-title">📋 Section Manager <span style="font-size:.72rem;font-weight:500;color:var(--text2)">Enable/disable & rename each section</span></div>
    ${sectionRows.map((s,i) => `
    <div class="hlm-section-row" draggable="true" data-ott-section="${s.key}">
      <span class="hlm-drag-handle" title="Drag to reorder">⠿</span>
      <button class="hlm-toggle ${isOn(s.key)?'on':''}" id="hlmTog_${s.key}" onclick="this.classList.toggle('on')"></button>
      <span style="font-size:.88rem">${s.label}</span>
      <input class="hlm-section-title-input" id="hlmTitle_${s.key}" value="${g(s.titleKey,s.dflt)}" placeholder="${s.dflt}" style="max-width:220px">
      <span class="hlm-row-desc" style="flex:1;font-size:.7rem">${s.desc}</span>
    </div>`).join('')}
    <div class="hlm-save-bar">
      <button class="btn btn-primary btn-sm" onclick="hlmSaveSections()">💾 Save Sections</button>
      <span class="hlm-save-msg" id="hlmSecMsg"></span>
    </div>
  </div>

  <!-- ── FEATURED PDF MANAGER ────────────────────────────────── -->
  <div class="hlm-card">
    <div class="hlm-card-title">⭐ Featured PDF Manager <span style="font-size:.72rem;font-weight:500;color:var(--text2)">Select PDFs for the hero carousel</span></div>
    <div style="font-size:.78rem;color:var(--text2);margin-bottom:12px">Select up to 8 PDFs to feature in the "For You" hero carousel. Leave empty to auto-select by downloads.</div>
    <div id="hlmFeaturedPicker">${featuredPickerHTML()}</div>
    <div class="hlm-save-bar" style="margin-top:14px">
      <button class="btn btn-primary btn-sm" onclick="hlmSaveFeatured()">💾 Save Featured PDFs</button>
      <button class="btn btn-ghost btn-sm" onclick="document.querySelectorAll('.ott-featured-cb').forEach(cb=>cb.checked=false)">Clear All</button>
      <span class="hlm-save-msg" id="hlmFeatMsg"></span>
    </div>
  </div>

  <!-- ── CAROUSEL MANAGER ─────────────────────────────────────── -->
  <div class="hlm-card">
    <div class="hlm-card-title">🎠 Carousel Manager</div>
    <div class="hlm-row">
      <div class="hlm-row-info">
        <div class="hlm-row-label">Auto-Scroll Hero Carousel</div>
        <div class="hlm-row-desc">Automatically advance to next featured card</div>
      </div>
      <button class="hlm-toggle ${isOn('ott_auto_scroll')?'on':''}" id="hlmAutoScroll" onclick="this.classList.toggle('on')"></button>
    </div>
    <div class="hlm-row">
      <div class="hlm-row-info">
        <div class="hlm-row-label">Auto-Scroll Interval (ms)</div>
        <div class="hlm-row-desc">Time between carousel slides (default: 4500ms)</div>
      </div>
      <input class="hlm-input" id="hlmScrollInterval" type="number" value="${g('ott_auto_scroll_interval','4500')}" style="max-width:110px;text-align:center" min="2000" max="15000" step="500">
    </div>
    <div class="hlm-save-bar">
      <button class="btn btn-primary btn-sm" onclick="hlmSaveCarousel()">💾 Save Carousel Settings</button>
      <span class="hlm-save-msg" id="hlmCarMsg"></span>
    </div>
  </div>

  <!-- ── ANIMATION MANAGER ────────────────────────────────────── -->
  <div class="hlm-card">
    <div class="hlm-card-title">✨ Animation Manager</div>
    <div class="hlm-row">
      <div class="hlm-row-info">
        <div class="hlm-row-label">Animation Speed</div>
        <div class="hlm-row-desc">Controls card transitions and carousel speed</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${['slow','normal','fast'].map(sp => `<button class="hlm-animation-btn ${g('ott_animation_speed','normal')===sp?'active':''}" onclick="hlmSetAnim('${sp}',this)">${sp.charAt(0).toUpperCase()+sp.slice(1)}</button>`).join('')}
      </div>
    </div>
    <div class="hlm-row">
      <div class="hlm-row-info">
        <div class="hlm-row-label">Glow Effects</div>
        <div class="hlm-row-desc">Premium neon glow on card hover</div>
      </div>
      <button class="hlm-toggle ${isOn('ott_glow_effects','1')?'on':''}" id="hlmGlowToggle" onclick="this.classList.toggle('on')"></button>
    </div>
    <div class="hlm-row">
      <div class="hlm-row-info">
        <div class="hlm-row-label">Partial Card Preview</div>
        <div class="hlm-row-desc">Show edge of next card to indicate scrollability</div>
      </div>
      <button class="hlm-toggle ${isOn('ott_peek_preview','1')?'on':''}" id="hlmPeekToggle" onclick="this.classList.toggle('on')"></button>
    </div>
    <div class="hlm-save-bar">
      <button class="btn btn-primary btn-sm" onclick="hlmSaveAnimations()">💾 Save Animation Settings</button>
      <span class="hlm-save-msg" id="hlmAnimMsg"></span>
    </div>
  </div>

  <!-- ── RECOMMENDATION MANAGER ──────────────────────────────── -->
  <div class="hlm-card">
    <div class="hlm-card-title">🤖 Recommendation Manager</div>
    <div class="hlm-row">
      <div class="hlm-row-info">
        <div class="hlm-row-label">AI Recommendations Engine</div>
        <div class="hlm-row-desc">Scores PDFs by downloads, recency & category match</div>
      </div>
      <button class="hlm-toggle ${isOn('ott_ai_reco_enabled')?'on':''}" id="hlmAIReco" onclick="this.classList.toggle('on')"></button>
    </div>
    <div class="hlm-row">
      <div class="hlm-row-info">
        <div class="hlm-row-label">Continue Reading Tracking</div>
        <div class="hlm-row-desc">Track recently opened PDFs via browser history</div>
      </div>
      <button class="hlm-toggle ${isOn('ott_continue_enabled')?'on':''}" id="hlmContinue" onclick="this.classList.toggle('on')"></button>
    </div>
    <div class="hlm-save-bar">
      <button class="btn btn-primary btn-sm" onclick="hlmSaveRecoSettings()">💾 Save Recommendation Settings</button>
      <span class="hlm-save-msg" id="hlmRecoMsg"></span>
    </div>
  </div>

  <!-- ── VISUAL THEME MANAGER ────────────────────────────────── -->
  <div class="hlm-card">
    <div class="hlm-card-title">🎨 Visual Theme Manager</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-bottom:14px">
      ${[
        {id:'netflix', name:'Netflix Dark', bg:'#141414', accent:'#e50914', desc:'Classic OTT dark'},
        {id:'hotstar', name:'JioHotstar', bg:'#1a0533', accent:'#1978f2', desc:'Premium blue-violet'},
        {id:'apple', name:'Apple Books', bg:'#1c1c1e', accent:'#0a84ff', desc:'Clean minimal'},
        {id:'studyria', name:'Studyria Blue', bg:'#080c14', accent:'#3d8ef8', desc:'Default theme'},
      ].map(t => `
        <div onclick="hlmApplyTheme('${t.id}',this)" style="border-radius:14px;overflow:hidden;cursor:pointer;border:2px solid ${g('ott_visual_theme','studyria')===t.id?'var(--accent)':'var(--glass-border)'};transition:all .2s" class="hlm-theme-card" data-theme="${t.id}">
          <div style="height:52px;background:${t.bg};display:flex;align-items:center;justify-content:center">
            <div style="width:28px;height:4px;border-radius:4px;background:${t.accent}"></div>
          </div>
          <div style="padding:8px 10px;background:var(--surface)">
            <div style="font-size:.78rem;font-weight:700;color:var(--text)">${t.name}</div>
            <div style="font-size:.65rem;color:var(--text2)">${t.desc}</div>
          </div>
        </div>`).join('')}
    </div>
    <div class="hlm-save-bar">
      <button class="btn btn-primary btn-sm" onclick="hlmSaveTheme()">💾 Save Theme</button>
      <span class="hlm-save-msg" id="hlmThemeMsg"></span>
    </div>
  </div>

  <!-- ── LIVE PREVIEW BUTTON ──────────────────────────────────── -->
  <div style="background:linear-gradient(135deg,rgba(245,158,11,0.08),rgba(249,115,22,0.05));border:1px solid rgba(245,158,11,0.25);border-radius:16px;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
    <div>
      <div style="font-weight:700;color:var(--text);margin-bottom:4px">🚀 Live Preview</div>
      <div style="font-size:.78rem;color:var(--text2)">See all discovery sections on the homepage in real-time</div>
    </div>
    <button class="btn btn-primary" onclick="navigate('home');ottRenderDiscovery(true)">
      👁 Preview Homepage
    </button>
  </div>

  <!-- ── SUPABASE SQL NOTE ─────────────────────────────────────── -->
  ${!sb ? `<div style="background:rgba(255,77,109,0.08);border:1px solid rgba(255,77,109,0.25);border-radius:12px;padding:14px 18px;margin-top:16px;font-size:.8rem;color:var(--danger)">⚠️ Supabase not connected — settings saved to localStorage only. Connect Supabase to persist across devices.</div>` : `<div style="background:rgba(16,217,142,0.06);border:1px solid rgba(16,217,142,0.2);border-radius:10px;padding:12px 16px;margin-top:14px;font-size:.75rem;color:var(--text2)">✅ Connected to Supabase — all settings will be saved to <code style="background:var(--surface);padding:1px 5px;border-radius:4px">site_config</code> table with <code style="background:var(--surface);padding:1px 5px;border-radius:4px">ott_*</code> keys.</div>`}
  `;

  // ── Init selected animation button ──────────────────────────────
  window._hlmSelectedAnim = g('ott_animation_speed','normal');
  window._hlmSelectedTheme = g('ott_visual_theme','studyria');
}

// ── SAVE HELPERS ───────────────────────────────────────────────────
window._hlmSelectedAnim = 'normal';
window._hlmSelectedTheme = 'studyria';

function hlmSetAnim(speed, btn) {
  window._hlmSelectedAnim = speed;
  document.querySelectorAll('.hlm-animation-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function hlmApplyTheme(themeId, card) {
  window._hlmSelectedTheme = themeId;
  document.querySelectorAll('.hlm-theme-card').forEach(c => {
    c.style.borderColor = c.dataset.theme === themeId ? 'var(--accent)' : 'var(--glass-border)';
  });
}

async function _hlmSave(pairs) {
  const sb = window.supabaseClient || window._supabase;
  if (sb) {
    try {
      for (const [key, value] of pairs) {
        await sb.from('site_config').upsert({ key, value: String(value) }, { onConflict: 'key' });
      }
      return true;
    } catch(e) { console.warn('hlmSave error:', e); return false; }
  }
  return false;
}

function _hlmFlash(msgId) {
  const el = document.getElementById(msgId);
  if (!el) return;
  el.style.opacity = '1'; el.textContent = '✅ Saved!';
  setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

async function hlmSaveSections() {
  const sectionKeys = [
    'ott_for_you_enabled','ott_continue_enabled','ott_ai_reco_enabled',
    'ott_trending_enabled','ott_popular_enabled','ott_new_arrivals_enabled','ott_recently_added_enabled'
  ];
  const titleKeyMap = {
    'ott_for_you_enabled': 'ott_for_you_title',
    'ott_continue_enabled': 'ott_continue_title',
    'ott_ai_reco_enabled': 'ott_ai_reco_title',
    'ott_trending_enabled': 'ott_trending_title',
    'ott_popular_enabled': 'ott_popular_title',
    'ott_new_arrivals_enabled': 'ott_new_arrivals_title',
    'ott_recently_added_enabled': 'ott_recent_title',
  };
  const pairs = [];
  sectionKeys.forEach(k => {
    const tog = document.getElementById('hlmTog_' + k);
    if (tog) pairs.push([k, tog.classList.contains('on') ? '1' : '0']);
    const titleEl = document.getElementById('hlmTitle_' + k);
    if (titleEl && titleKeyMap[k]) pairs.push([titleKeyMap[k], titleEl.value]);
  });
  await _hlmSave(pairs);
  _hlmFlash('hlmSecMsg');
  // Apply live
  if (typeof ottRenderDiscovery === 'function') ottRenderDiscovery(true);
}

async function hlmSaveFeatured() {
  const cbs = document.querySelectorAll('.ott-featured-cb:checked');
  const ids = Array.from(cbs).map(cb => cb.value);
  await _hlmSave([['ott_featured_pdf_ids', JSON.stringify(ids)]]);
  if (window._ottSettings) window._ottSettings.featured_pdf_ids = ids;
  _hlmFlash('hlmFeatMsg');
  if (typeof ottRenderDiscovery === 'function') ottRenderDiscovery(true);
}

async function hlmSaveCarousel() {
  const autoScroll = document.getElementById('hlmAutoScroll')?.classList.contains('on') ? '1' : '0';
  const interval = document.getElementById('hlmScrollInterval')?.value || '4500';
  await _hlmSave([['ott_auto_scroll', autoScroll], ['ott_auto_scroll_interval', interval]]);
  if (window._ottSettings) {
    window._ottSettings.auto_scroll_enabled = autoScroll === '1';
    window._ottSettings.auto_scroll_interval = parseInt(interval);
  }
  _hlmFlash('hlmCarMsg');
}

async function hlmSaveAnimations() {
  const glow = document.getElementById('hlmGlowToggle')?.classList.contains('on') ? '1' : '0';
  const peek = document.getElementById('hlmPeekToggle')?.classList.contains('on') ? '1' : '0';
  await _hlmSave([
    ['ott_animation_speed', window._hlmSelectedAnim || 'normal'],
    ['ott_glow_effects', glow],
    ['ott_peek_preview', peek],
  ]);
  if (window._ottSettings) window._ottSettings.animation_speed = window._hlmSelectedAnim;
  _hlmFlash('hlmAnimMsg');
}

async function hlmSaveRecoSettings() {
  const aiOn = document.getElementById('hlmAIReco')?.classList.contains('on') ? '1' : '0';
  const contOn = document.getElementById('hlmContinue')?.classList.contains('on') ? '1' : '0';
  await _hlmSave([['ott_ai_reco_enabled', aiOn], ['ott_continue_enabled', contOn]]);
  if (window._ottSettings) {
    window._ottSettings.ai_reco_enabled = aiOn === '1';
    window._ottSettings.continue_reading_enabled = contOn === '1';
  }
  _hlmFlash('hlmRecoMsg');
}

async function hlmSaveTheme() {
  await _hlmSave([['ott_visual_theme', window._hlmSelectedTheme]]);
  _hlmFlash('hlmThemeMsg');
  showToast(`Theme "${window._hlmSelectedTheme}" saved! Refresh homepage to see changes.`, 'success');
}

