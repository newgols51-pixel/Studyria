/**
 * ══════════════════════════════════════════════════════════════════════
 * premium-edit-pdf-ui.js — Studyria
 * Premium Glassmorphism Edit PDF Dashboard
 * ══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS DOES:
 *   1. Replaces sbpOpenEditor() with a full-featured glassmorphism dashboard
 *   2. Floating labels, modern cards, sticky Save bar
 *   3. Live cover preview + live SEO preview
 *   4. Premium pricing card with discount badge
 *   5. Copyable auto-generated fields
 *   6. Cascading dropdowns: Category → Subcategory → Academic Level →
 *      Stream → Semester/Class → Subject
 *   7. Each dropdown: ▼ Select | ➕ Add | ✏️ Edit | 🗑 Delete | 🔄 Refresh
 *   8. Full Supabase CRUD + realtime updates + searchable dropdowns
 *   9. sbpEditorSave() and sbpEditorLive() remain unchanged in behaviour
 *  10. Save Draft / Publish functions entirely unchanged
 *
 * LOAD ORDER: index.html → supabase.js → smart-batch-publisher.js
 *             → pdf-classification-refactor.js → THIS FILE
 * ══════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────────────── */
  const sb = () => window.supabaseClient || window.supabase;
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const slug = s => (s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  function showToast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type);
    else console.log('[PEP]', msg);
  }

  /* ── Classification table definitions ───────────────────────────── */
  const LEVELS = [
    { id: 'pepCat',      table: 'categories',     label: 'Category',       required: true,  parentField: null,               parentSelect: null         },
    { id: 'pepSubcat',   table: 'subcategories',  label: 'Subcategory',    required: false, parentField: 'category_id',      parentSelect: 'pepCat'     },
    { id: 'pepAcadLevel',table: 'academic_levels',label: 'Academic Level', required: false, parentField: 'subcategory_id',   parentSelect: 'pepSubcat'  },
    { id: 'pepStream',   table: 'streams',        label: 'Stream',         required: false, parentField: 'academic_level_id',parentSelect: 'pepAcadLevel'},
    { id: 'pepSemester', table: 'semester_classes',label:'Semester/Class', required: false, parentField: 'stream_id',        parentSelect: 'pepStream'  },
    { id: 'pepSubject',  table: 'subjects',       label: 'Subject',        required: false, parentField: 'semester_class_id',parentSelect: 'pepSemester'},
  ];

  /* ── Supabase CRUD for classification tables ─────────────────────── */
  async function dbFetchOptions(table, parentField, parentId) {
    const client = sb();
    if (!client) return [];
    try {
      let q = client.from(table).select('id,name,slug').order('sort_order').order('name');
      if (parentField && parentId) q = q.eq(parentField, parentId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('[PEP] dbFetchOptions', table, e);
      return [];
    }
  }

  async function dbCreateOption(table, name, parentField, parentId) {
    const client = sb();
    if (!client) return null;
    const payload = {
      name: name.trim(),
      slug: slug(name.trim()),
      sort_order: 0,
    };
    if (parentField && parentId) payload[parentField] = parentId;
    try {
      const { data, error } = await client.from(table).insert(payload).select().single();
      if (error) throw error;
      return data;
    } catch (e) {
      showToast('Create failed: ' + e.message, 'error');
      return null;
    }
  }

  async function dbUpdateOption(table, id, name) {
    const client = sb();
    if (!client) return false;
    try {
      const { error } = await client.from(table).update({ name: name.trim(), slug: slug(name.trim()) }).eq('id', id);
      if (error) throw error;
      return true;
    } catch (e) {
      showToast('Update failed: ' + e.message, 'error');
      return false;
    }
  }

  async function dbDeleteOption(table, id) {
    const client = sb();
    if (!client) return false;
    try {
      const { error } = await client.from(table).delete().eq('id', id);
      if (error) throw error;
      return true;
    } catch (e) {
      showToast('Delete failed: ' + e.message, 'error');
      return false;
    }
  }

  /* ── Get selected ID from a <select> ────────────────────────────── */
  function getSelectId(selectId) {
    const el = document.getElementById(selectId);
    if (!el) return null;
    const selected = el.options[el.selectedIndex];
    return selected?.dataset?.id || null;
  }

  /* ── Build a classification <select> with data ───────────────────── */
  function buildSelectOptions(selectEl, data, currentName, emptyLabel) {
    const prev = getSelectId(selectEl.id);
    selectEl.innerHTML = `<option value="">— ${emptyLabel} —</option>` +
      data.map(r => {
        const sel = (r.name === currentName) ? 'selected' : '';
        return `<option value="${esc(r.name)}" data-id="${r.id}" ${sel}>${esc(r.name)}</option>`;
      }).join('');
    // Restore by ID if possible (more reliable than name)
    if (prev) {
      const match = data.find(r => r.id === prev);
      if (match) selectEl.value = match.name;
    }
  }

  /* ── Render the searchable select filter ────────────────────────── */
  function addSearchFilter(selectEl) {
    const existing = selectEl.parentElement.querySelector('.pep-ddl-search');
    if (existing) return; // already added
    const inp = document.createElement('input');
    inp.className = 'pep-ddl-search';
    inp.placeholder = '🔍 Search…';
    inp.style.display = 'none';
    selectEl.parentElement.insertBefore(inp, selectEl);
    selectEl.addEventListener('focus', () => {
      inp.style.display = 'block';
      inp.focus();
    });
    inp.addEventListener('blur', () => {
      setTimeout(() => { inp.style.display = 'none'; inp.value = ''; filterSelect(selectEl, ''); }, 200);
    });
    inp.addEventListener('input', () => filterSelect(selectEl, inp.value));
  }

  function filterSelect(selectEl, q) {
    const lower = q.toLowerCase();
    Array.from(selectEl.options).forEach(opt => {
      if (!opt.value) return; // keep placeholder
      opt.hidden = lower && !opt.text.toLowerCase().includes(lower);
    });
  }

  /* ── Build one classification row (select + action buttons) ─────── */
  function buildClassifRow(lvl, options, currentName) {
    const wrap = document.getElementById('pepClassifWrap_' + lvl.id);
    if (!wrap) return;
    const selectEl = document.getElementById(lvl.id);
    if (!selectEl) return;
    buildSelectOptions(selectEl, options, currentName, `Select ${lvl.label}`);
    addSearchFilter(selectEl);
    // Wire up action buttons
    _wireActionBtns(lvl, options);
    _updateCascadeBelow(lvl);
    _updateClassifPath();
  }

  /* ── Wire action buttons ────────────────────────────────────────── */
  function _wireActionBtns(lvl, options) {
    const addBtn = document.getElementById('pepAdd_' + lvl.id);
    const editBtn = document.getElementById('pepEdit_' + lvl.id);
    const delBtn = document.getElementById('pepDel_' + lvl.id);
    const refreshBtn = document.getElementById('pepRefresh_' + lvl.id);

    if (addBtn) addBtn.onclick = () => pepShowAddModal(lvl);
    if (editBtn) editBtn.onclick = () => {
      const sel = document.getElementById(lvl.id);
      const id = getSelectId(lvl.id);
      const name = sel?.value;
      if (!id || !name) { showToast('Select an item to edit first', 'info'); return; }
      pepShowEditModal(lvl, id, name);
    };
    if (delBtn) delBtn.onclick = () => {
      const sel = document.getElementById(lvl.id);
      const id = getSelectId(lvl.id);
      const name = sel?.value;
      if (!id || !name) { showToast('Select an item to delete first', 'info'); return; }
      pepShowDeleteModal(lvl, id, name);
    };
    if (refreshBtn) refreshBtn.onclick = () => pepRefreshLevel(lvl, true);
  }

  /* ── Refresh a single cascade level ────────────────────────────── */
  async function pepRefreshLevel(lvl, toast) {
    const parentId = lvl.parentSelect ? getSelectId(lvl.parentSelect) : null;
    if (lvl.parentSelect && !parentId) {
      // No parent selected — show empty
      const selectEl = document.getElementById(lvl.id);
      if (selectEl) buildSelectOptions(selectEl, [], '', `Select ${lvl.level}`);
      _updateClassifPath();
      return;
    }
    const data = await dbFetchOptions(lvl.table, lvl.parentField, parentId);
    const currentName = document.getElementById(lvl.id)?.value || '';
    buildClassifRow(lvl, data, currentName);
    if (toast) showToast(`✅ ${lvl.label} refreshed`, 'success');
  }

  /* ── Cascade: reset all levels below index ──────────────────────── */
  async function pepCascadeFrom(idx) {
    for (let i = idx + 1; i < LEVELS.length; i++) {
      const lvl = LEVELS[i];
      const parentId = lvl.parentSelect ? getSelectId(lvl.parentSelect) : null;
      if (!parentId) {
        const selectEl = document.getElementById(lvl.id);
        if (selectEl) buildSelectOptions(selectEl, [], '', `Select ${lvl.label}`);
      } else {
        const data = await dbFetchOptions(lvl.table, lvl.parentField, parentId);
        const currentName = document.getElementById(lvl.id)?.value || '';
        buildClassifRow(lvl, data, currentName);
      }
    }
    _updateClassifPath();
    _updateLivePreview();
  }

  function _updateCascadeBelow(lvl) {
    const idx = LEVELS.indexOf(lvl);
    // Update edit/delete button states based on current selection
    const id = getSelectId(lvl.id);
    const editBtn = document.getElementById('pepEdit_' + lvl.id);
    const delBtn = document.getElementById('pepDel_' + lvl.id);
    if (editBtn) editBtn.classList.toggle('disabled', !id);
    if (delBtn) delBtn.classList.toggle('disabled', !id);
  }

  /* ── Update classification path display ────────────────────────── */
  function _updateClassifPath() {
    const pathEl = document.getElementById('pepClassifPath');
    if (!pathEl) return;
    const parts = LEVELS
      .map(lvl => document.getElementById(lvl.id)?.value)
      .filter(v => v && v !== '' && !v.startsWith('—'));
    if (!parts.length) {
      pathEl.innerHTML = `<span class="pep-classif-empty">No classification selected</span>`;
    } else {
      pathEl.innerHTML = parts.map((p, i) =>
        `<span class="pep-classif-crumb">${esc(p)}</span>${i < parts.length - 1 ? '<span class="pep-classif-sep">›</span>' : ''}`
      ).join('');
    }
    _updateLivePreview();
  }

  /* ── Modals: Add / Edit / Delete ────────────────────────────────── */
  function pepShowModal(html) {
    const existing = document.getElementById('pepModalOverlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'pepModalOverlay';
    overlay.className = 'pep-modal-overlay';
    overlay.innerHTML = `<div class="pep-modal-bg" onclick="document.getElementById('pepModalOverlay').remove()"></div>
      <div class="pep-modal-box">${html}</div>`;
    document.body.appendChild(overlay);
  }

  function pepShowAddModal(lvl) {
    pepShowModal(`
      <div class="pep-modal-header">
        <div class="pep-modal-title">➕ Add ${esc(lvl.label)}</div>
        <button class="pep-modal-close" onclick="document.getElementById('pepModalOverlay').remove()">✕</button>
      </div>
      <div class="pep-field">
        <label class="pep-field-label" style="position:relative;top:auto;left:auto;font-size:.78rem;font-weight:700;display:block;margin-bottom:6px">Name <span class="pep-req">*</span></label>
        <input id="pepModalInput" class="pep-input" placeholder="Enter ${esc(lvl.label)} name" autofocus/>
      </div>
      <div class="pep-modal-actions">
        <button class="pep-modal-confirm" onclick="pepConfirmAdd('${lvl.id}')">Create</button>
        <button class="pep-modal-cancel" onclick="document.getElementById('pepModalOverlay').remove()">Cancel</button>
      </div>`);
    setTimeout(() => document.getElementById('pepModalInput')?.focus(), 80);
  }

  window.pepConfirmAdd = async function(levelId) {
    const name = document.getElementById('pepModalInput')?.value?.trim();
    if (!name) { showToast('Name is required', 'error'); return; }
    const lvl = LEVELS.find(l => l.id === levelId);
    if (!lvl) return;
    const parentId = lvl.parentSelect ? getSelectId(lvl.parentSelect) : null;
    const btn = document.querySelector('.pep-modal-confirm');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="pep-spinner"></span>'; }
    const item = await dbCreateOption(lvl.table, name, lvl.parentField, parentId);
    document.getElementById('pepModalOverlay')?.remove();
    if (item) {
      showToast(`✅ "${name}" added!`, 'success');
      await pepRefreshLevel(lvl, false);
      const selectEl = document.getElementById(lvl.id);
      if (selectEl) { selectEl.value = item.name; }
      _updateClassifPath();
      _pepEditorLiveSync();
    }
  };

  function pepShowEditModal(lvl, id, name) {
    pepShowModal(`
      <div class="pep-modal-header">
        <div class="pep-modal-title">✏️ Edit ${esc(lvl.label)}</div>
        <button class="pep-modal-close" onclick="document.getElementById('pepModalOverlay').remove()">✕</button>
      </div>
      <div class="pep-field">
        <label class="pep-field-label" style="position:relative;top:auto;left:auto;font-size:.78rem;font-weight:700;display:block;margin-bottom:6px">Name <span class="pep-req">*</span></label>
        <input id="pepModalInput" class="pep-input" value="${esc(name)}" autofocus/>
      </div>
      <div class="pep-modal-actions">
        <button class="pep-modal-confirm" onclick="pepConfirmEdit('${lvl.id}','${id}')">Save Changes</button>
        <button class="pep-modal-cancel" onclick="document.getElementById('pepModalOverlay').remove()">Cancel</button>
      </div>`);
    setTimeout(() => document.getElementById('pepModalInput')?.focus(), 80);
  }

  window.pepConfirmEdit = async function(levelId, id) {
    const name = document.getElementById('pepModalInput')?.value?.trim();
    if (!name) { showToast('Name is required', 'error'); return; }
    const lvl = LEVELS.find(l => l.id === levelId);
    if (!lvl) return;
    const btn = document.querySelector('.pep-modal-confirm');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="pep-spinner"></span>'; }
    const ok = await dbUpdateOption(lvl.table, id, name);
    document.getElementById('pepModalOverlay')?.remove();
    if (ok) {
      showToast(`✅ "${name}" updated!`, 'success');
      await pepRefreshLevel(lvl, false);
      _updateClassifPath();
      _pepEditorLiveSync();
    }
  };

  function pepShowDeleteModal(lvl, id, name) {
    pepShowModal(`
      <div class="pep-modal-header">
        <div class="pep-modal-title">🗑️ Delete ${esc(lvl.label)}</div>
        <button class="pep-modal-close" onclick="document.getElementById('pepModalOverlay').remove()">✕</button>
      </div>
      <div style="font-size:.84rem;color:var(--text2);margin-bottom:6px;line-height:1.5">
        Are you sure you want to delete <strong style="color:var(--text)">"${esc(name)}"</strong>?<br>
        <span style="font-size:.72rem;color:#ff8fa8">This may affect existing PDFs in this category.</span>
      </div>
      <div class="pep-modal-actions">
        <button class="pep-modal-confirm danger" onclick="pepConfirmDelete('${lvl.id}','${id}','${esc(name)}')">Delete</button>
        <button class="pep-modal-cancel" onclick="document.getElementById('pepModalOverlay').remove()">Cancel</button>
      </div>`);
  }

  window.pepConfirmDelete = async function(levelId, id, name) {
    const lvl = LEVELS.find(l => l.id === levelId);
    if (!lvl) return;
    const btn = document.querySelector('.pep-modal-confirm');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="pep-spinner"></span>'; }
    const ok = await dbDeleteOption(lvl.table, id);
    document.getElementById('pepModalOverlay')?.remove();
    if (ok) {
      showToast(`🗑️ "${name}" deleted`, 'info');
      await pepRefreshLevel(lvl, false);
      _updateClassifPath();
      _pepEditorLiveSync();
    }
  };

  /* ── Copy to clipboard ───────────────────────────────────────────── */
  window.pepCopyField = function(fieldId, btnId) {
    const el = document.getElementById(fieldId);
    if (!el) return;
    const text = el.textContent || el.value || '';
    navigator.clipboard?.writeText(text).then(() => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.textContent = '✓';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = '⎘'; btn.classList.remove('copied'); }, 1800);
      }
      showToast('Copied!', 'success');
    }).catch(() => showToast('Copy failed', 'error'));
  };

  /* ── Update live preview panel ───────────────────────────────────── */
  function _updateLivePreview() {
    // Cover preview
    const coverImg = document.getElementById('pepCoverPreviewImg');
    const coverWrap = document.getElementById('pepCoverPreviewWrap');
    const coverEmpty = document.getElementById('pepCoverEmpty');
    const item = window._sbp?.queue?.find(x => x.id === window._sbp?.editingId);
    const src = item?.coverThumb || item?.coverUrl || '';
    if (coverImg) {
      if (src) {
        coverImg.src = src;
        coverImg.style.display = 'block';
        if (coverEmpty) coverEmpty.style.display = 'none';
        if (coverWrap) coverWrap.classList.add('has-cover');
      } else {
        coverImg.style.display = 'none';
        if (coverEmpty) coverEmpty.style.display = 'flex';
        if (coverWrap) coverWrap.classList.remove('has-cover');
      }
    }

    // Mini card
    const titleEl = document.getElementById('pepMiniTitle');
    const metaEl = document.getElementById('pepMiniMeta');
    const classifEl = document.getElementById('pepMiniClassif');
    const priceEl = document.getElementById('pepMiniPrice');
    const badgeEl = document.getElementById('pepMiniBadge');
    const miniImg = document.getElementById('pepMiniImg');

    const title = document.getElementById('sbeTitle')?.value || document.getElementById('pepTitle')?.value || 'PDF Title';
    const author = document.getElementById('sbeAuthor')?.value || document.getElementById('pepAuthor')?.value || '';
    const cat = document.getElementById('pepCat')?.value || document.getElementById('sbeCat')?.value || '';
    const badge = document.getElementById('sbeBadge')?.value || '';
    const sellPr = parseFloat(document.getElementById('sbeSellPrice')?.value || document.getElementById('pepSellPrice')?.value || '0');
    const origPr = parseFloat(document.getElementById('sbeOrigPrice')?.value || document.getElementById('pepOrigPrice')?.value || '0');
    const isFree = document.getElementById('sbeFree')?.checked || document.getElementById('pepFree')?.checked;

    if (titleEl) titleEl.textContent = title;
    if (metaEl) metaEl.textContent = [author, cat].filter(Boolean).join(' · ');
    if (miniImg && src) { miniImg.src = src; miniImg.style.display = 'block'; }

    const parts = LEVELS.map(lvl => document.getElementById(lvl.id)?.value).filter(v => v && v.trim());
    if (classifEl) classifEl.textContent = parts.join(' › ') || '';

    if (badgeEl) { badgeEl.textContent = badge || ''; badgeEl.style.display = badge ? '' : 'none'; }
    if (priceEl) {
      if (isFree) {
        priceEl.innerHTML = `<span class="pep-mini-card-price-free">FREE</span>`;
      } else {
        priceEl.innerHTML = `<span class="pep-mini-card-price-curr">₹${sellPr||0}</span>${origPr > sellPr ? `<span class="pep-mini-card-price-orig">₹${origPr}</span>` : ''}`;
      }
    }

    // SEO preview
    _updateSEOPreview();

    // Pricing
    _updatePricingCard();

    // Auto fields
    _updateAutoFields();
  }

  function _updateSEOPreview() {
    const seoTitleEl = document.getElementById('pepSeoPreviewTitle');
    const seoDescEl = document.getElementById('pepSeoPreviewDesc');
    const seoUrlEl = document.getElementById('pepSeoPreviewUrl');

    const title = document.getElementById('sbeSeoTitle')?.value || document.getElementById('pepSeoTitle')?.value || '';
    const desc = document.getElementById('sbeSeoDesc')?.value || document.getElementById('pepSeoDesc')?.value || '';
    const slugVal = document.getElementById('pepAutoSlug')?.textContent || document.getElementById('pepSlugDisplay')?.textContent || '';
    const siteDomain = 'studyria.qzz.io';

    if (seoUrlEl) seoUrlEl.textContent = `${siteDomain}/pdf/${slugVal || 'your-pdf-slug'}`;
    if (seoTitleEl) seoTitleEl.textContent = title || 'PDF Title — Studyria';
    if (seoDescEl) seoDescEl.textContent = desc || 'Description will appear here in Google search results.';

    // Char counters
    const tCount = document.getElementById('pepSeoTitleCount');
    const dCount = document.getElementById('pepSeoDescCount');
    if (tCount) {
      const len = title.length;
      tCount.textContent = `${len}/60 chars`;
      tCount.className = 'pep-char-count ' + (len === 0 ? '' : len <= 60 ? 'good' : 'over');
    }
    if (dCount) {
      const len = desc.length;
      dCount.textContent = `${len}/160 chars`;
      dCount.className = 'pep-char-count ' + (len === 0 ? '' : len <= 160 ? 'good' : 'over');
    }
  }

  function _updatePricingCard() {
    const sell = parseFloat(document.getElementById('sbeSellPrice')?.value || document.getElementById('pepSellPrice')?.value || '0');
    const orig = parseFloat(document.getElementById('sbeOrigPrice')?.value || document.getElementById('pepOrigPrice')?.value || '0');
    const isFree = document.getElementById('sbeFree')?.checked || document.getElementById('pepFree')?.checked;

    const priceDisp = document.getElementById('pepPriceDisplay');
    const discBadge = document.getElementById('pepDiscountBadge');
    if (!priceDisp) return;

    if (isFree) {
      priceDisp.innerHTML = `<span class="pep-price-free-badge">FREE</span>`;
      if (discBadge) { discBadge.textContent = '100% OFF'; discBadge.style.display = 'flex'; }
    } else {
      priceDisp.innerHTML = `<span class="pep-price-sell">₹${sell || 0}</span>${orig > sell ? `<span class="pep-price-orig">₹${orig}</span>` : ''}`;
      if (discBadge && orig > sell && orig > 0) {
        const pct = Math.round((orig - sell) / orig * 100);
        discBadge.textContent = `${pct}% OFF`;
        discBadge.style.display = 'flex';
      } else if (discBadge) {
        discBadge.style.display = 'none';
      }
    }
  }

  function _updateAutoFields() {
    const item = window._sbp?.queue?.find(x => x.id === window._sbp?.editingId);
    if (!item) return;
    const pidEl = document.getElementById('pepAutoProductId');
    const slugEl = document.getElementById('pepAutoSlug');
    const dateEl = document.getElementById('pepAutoDate');
    if (pidEl) pidEl.textContent = item.productId || '—';
    if (slugEl) {
      const title = document.getElementById('sbeTitle')?.value || item.title || '';
      const computedSlug = (typeof window.sbpSlug === 'function' ? window.sbpSlug(title) : slug(title)) || item.slug || '—';
      slugEl.textContent = computedSlug;
    }
    if (dateEl) dateEl.textContent = item.publishDate ? new Date(item.publishDate).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' }) : '—';
  }

  /* ── Sync premium editor values back to original sbp item ───────── */
  function _pepEditorLiveSync() {
    const id = window._sbp?.editingId;
    if (!id) return;
    const item = window._sbp?.queue?.find(x => x.id === id);
    if (!item) return;

    // Map premium inputs → item (mirrors sbpEditorLive for the new fields)
    const g = eid => document.getElementById(eid)?.value ?? '';

    // Cascading classification
    item.category     = g('pepCat')       || g('sbeCat') || item.category     || '';
    item.subcategory  = g('pepSubcat')     || '';
    item.academicLevel= g('pepAcadLevel')  || '';
    item.stream       = g('pepStream')     || '';
    item.semesterClass= g('pepSemester')   || '';
    item.subject      = g('pepSubject')    || '';

    // Store IDs too (for Supabase FK columns)
    item.categoryId      = getSelectId('pepCat')       || null;
    item.subcategoryId   = getSelectId('pepSubcat')    || null;
    item.academicLevelId = getSelectId('pepAcadLevel') || null;
    item.streamId        = getSelectId('pepStream')    || null;
    item.semesterClassId = getSelectId('pepSemester')  || null;
    item.subjectId       = getSelectId('pepSubject')   || null;

    // Also update sbeCat select to stay in sync with the save pipeline
    const sbeCatEl = document.getElementById('sbeCat');
    if (sbeCatEl && item.category) sbeCatEl.value = item.category;

    // Trigger original live sync (title, seo, price, etc.)
    if (typeof window._sbpOrigEditorLive === 'function') window._sbpOrigEditorLive();
    else if (typeof window.sbpEditorLive === 'function') window.sbpEditorLive();

    _updateLivePreview();
  }

  /* ── Patch sbpEditorLive to also call our sync ───────────────────── */
  const _origSbpEditorLive = window.sbpEditorLive;
  window._sbpOrigEditorLive = _origSbpEditorLive;
  window.sbpEditorLive = function () {
    if (_origSbpEditorLive) _origSbpEditorLive();
    _updateLivePreview();
  };

  /* ── Patch sbpEditorSave to persist new fields ───────────────────── */
  const _origSbpEditorSave = window.sbpEditorSave;
  window.sbpEditorSave = function () {
    _pepEditorLiveSync();
    if (_origSbpEditorSave) _origSbpEditorSave();
  };

  /* ── Build classification section HTML ───────────────────────────── */
  function buildClassifSectionHTML() {
    return `
    <div class="pep-card" style="margin-bottom:16px">
      <div class="pep-card-header">
        <div class="pep-card-icon purple">📚</div>
        <div>
          <div class="pep-card-title">Classification</div>
          <div class="pep-card-subtitle">Cascade from Category down to Subject</div>
        </div>
        <span class="pep-card-badge required">Required: Category</span>
      </div>

      ${LEVELS.map((lvl, i) => `
      <div id="pepClassifWrap_${lvl.id}" style="margin-bottom:${i < LEVELS.length-1 ? '14px' : '0'}">
        <label style="font-size:.73rem;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:5px">
          ${lvl.label}${lvl.required ? ' <span style="color:#ff4d6d">*</span>' : ' <span style="font-size:.6rem;color:var(--text3);text-transform:none;font-weight:500">(optional)</span>'}
        </label>
        <div style="position:relative">
          <select class="pep-select" id="${lvl.id}"
            onchange="window._pepClassifChange && window._pepClassifChange(${i})">
            <option value="">— Select ${lvl.label} —</option>
          </select>
        </div>
        <div class="pep-select-actions">
          <button class="pep-select-action-btn" id="pepAdd_${lvl.id}" title="Add new ${lvl.label}">➕ Add</button>
          <button class="pep-select-action-btn edit disabled" id="pepEdit_${lvl.id}" title="Edit selected">✏️ Edit</button>
          <button class="pep-select-action-btn del disabled" id="pepDel_${lvl.id}" title="Delete selected">🗑️ Delete</button>
          <button class="pep-select-action-btn refresh" id="pepRefresh_${lvl.id}" title="Refresh from DB">🔄</button>
        </div>
      </div>`).join('')}

      <div class="pep-classif-path" id="pepClassifPath" style="margin-top:14px">
        <span class="pep-classif-empty">No classification selected</span>
      </div>
    </div>`;
  }

  /* ── Main: Build the premium editor HTML ─────────────────────────── */
  function buildPremiumEditorHTML(item) {
    const catOptions = (window._dbCategories || [])
      .map(c => `<option value="${esc(c.name)}" data-id="${c.id}" ${item.category===c.name?'selected':''}>${esc(c.name)}</option>`)
      .join('') || ['School Education','Higher Education','Government Exams','Engineering','Medicine','Law','Finance','CS & Technology','Design','Science','Commerce','Agriculture','Architecture','Pharmacy','Nursing']
        .map(c => `<option value="${c}" ${item.category===c?'selected':''}>${c}</option>`).join('');

    const badges = ['Bestseller','New Arrival','Hot','Trending','Editor\'s Choice','Top Rated','Most Downloaded','IIT Expert','IIM Expert','Premium','Verified','Staff Pick','Limited Edition','Exclusive','Must Have','Exam Ready','Quick Revision','Comprehensive','Updated 2025','Gold Standard','Platinum','Silver','Bronze','Featured'];

    const errors = typeof sbpValidate === 'function' ? sbpValidate(item, true) : [];

    const isFree = item.free || item.sellingPrice == 0;
    const sell = item.sellingPrice || '';
    const orig = item.originalPrice || '';

    return `
<div class="pep-shell" id="pepShell">

  <!-- ── LEFT: Edit Form ─────────────────────────────────────────── -->
  <div class="pep-form-col">

    <!-- Validation Banner -->
    ${errors.length ? `
    <div class="pep-validation-banner error" id="pepValidationBanner">
      <div class="pep-vb-title">⚠️ ${errors.length} issue${errors.length>1?'s':''} to fix before publishing:</div>
      ${errors.map(e=>`<div class="pep-vb-item">• ${esc(e)}</div>`).join('')}
    </div>` : `
    <div class="pep-validation-banner success" id="pepValidationBanner">
      ✅ All required fields complete — Ready to publish!
    </div>`}

    <!-- ── Core Details ─────────────────────────────────────────── -->
    <div class="pep-card" style="margin-bottom:16px">
      <div class="pep-card-header">
        <div class="pep-card-icon blue">📄</div>
        <div>
          <div class="pep-card-title">Core Details</div>
          <div class="pep-card-subtitle">Title, author, description</div>
        </div>
      </div>

      <!-- Cover Upload -->
      <div style="margin-bottom:18px">
        <label style="font-size:.73rem;font-weight:800;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Cover Image <span style="color:#ff4d6d">*</span></label>
        <div class="pep-cover-upload-zone" onclick="document.getElementById('pepCoverFileInput').click()"
          style="border:2px dashed ${item.coverFile||item.coverThumb||item.coverUrl?'rgba(16,217,142,0.4)':'rgba(255,255,255,0.12)'};border-radius:10px;padding:14px;text-align:center;cursor:pointer;background:rgba(255,255,255,0.02);transition:all .2s">
          <input type="file" id="pepCoverFileInput" accept="image/*" style="display:none" onchange="window._pepHandleCoverChange(this)"/>
          ${item.coverThumb||item.coverUrl
            ? `<img src="${item.coverThumb||item.coverUrl}" style="max-height:90px;border-radius:8px;max-width:100%;object-fit:contain"/>
               <div style="font-size:.7rem;color:var(--success);margin-top:5px;font-weight:700">✅ Cover ready · Click to change</div>`
            : `<div style="font-size:2rem">🖼️</div><div style="font-size:.75rem;color:var(--text2);font-weight:600">Click to upload cover image</div>`
          }
        </div>
      </div>

      <!-- PDF File Status -->
      <div style="margin-bottom:18px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 13px">
        <div style="font-size:.68rem;font-weight:800;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">PDF File</div>
        ${item.pdfFile
          ? `<div style="font-size:.82rem;font-weight:700;color:var(--text)">📄 ${esc(item.pdfFile.name)}</div>
             <div style="font-size:.7rem;color:var(--text2)">${typeof sbpFormatSize==='function'?sbpFormatSize(item.pdfFile.size):''}</div>`
          : `<div style="font-size:.78rem;color:#ff4d6d;font-weight:600">⚠️ No PDF file attached</div>`
        }
      </div>

      <!-- Title -->
      <div class="pep-field has-value">
        <label class="pep-field-label">Title <span class="pep-req">*</span></label>
        <input class="pep-input" id="sbeTitle" value="${esc(item.title||'')}" placeholder="PDF Title"
          oninput="window.sbpEditorLive && sbpEditorLive()"/>
      </div>

      <!-- Description -->
      <div class="pep-field ${item.description?'has-value':''}">
        <label class="pep-field-label">Description <span class="pep-req">*</span></label>
        <textarea class="pep-textarea" id="sbeDesc" rows="3" placeholder="Brief description of the PDF content…"
          oninput="window.sbpEditorLive && sbpEditorLive()">${esc(item.description||'')}</textarea>
      </div>

      <!-- Author + Badge row -->
      <div class="pep-field-row">
        <div class="pep-field ${item.author?'has-value':''}">
          <label class="pep-field-label">Author</label>
          <input class="pep-input" id="sbeAuthor" value="${esc(item.author||'')}" placeholder="Author / Board"
            oninput="window.sbpEditorLive && sbpEditorLive()"/>
        </div>
        <div class="pep-field ${item.badge?'has-value':''}">
          <label class="pep-field-label">Badge</label>
          <select class="pep-select" id="sbeBadge" onchange="window.sbpEditorLive && sbpEditorLive()">
            <option value="">— No Badge —</option>
            ${badges.map(b=>`<option value="${b}" ${item.badge===b?'selected':''}>${b}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <!-- ── Classification Cascade ──────────────────────────────────── -->
    ${buildClassifSectionHTML()}

    <!-- ── SEO ─────────────────────────────────────────────────────── -->
    <div class="pep-card" style="margin-bottom:16px">
      <div class="pep-card-header">
        <div class="pep-card-icon green">🔍</div>
        <div>
          <div class="pep-card-title">SEO</div>
          <div class="pep-card-subtitle">Title, description & keywords</div>
        </div>
        <button onclick="window._pepAutoSEO && _pepAutoSEO()" style="font-size:.68rem;padding:4px 11px;border-radius:8px;border:1px solid rgba(16,217,142,0.3);background:rgba(16,217,142,0.1);color:var(--success);cursor:pointer;font-family:var(--font-body);font-weight:700">✨ Auto</button>
      </div>

      <div class="pep-field ${item.seoTitle?'has-value':''}">
        <label class="pep-field-label">SEO Title <span class="pep-req">*</span></label>
        <input class="pep-input" id="sbeSeoTitle" value="${esc(item.seoTitle||'')}" placeholder="SEO Title (50-60 chars)"
          oninput="window.sbpEditorLive && sbpEditorLive()"/>
        <div class="pep-char-count" id="pepSeoTitleCount">0/60 chars</div>
      </div>

      <div class="pep-field ${item.seoDesc?'has-value':''}">
        <label class="pep-field-label">Meta Description <span class="pep-req">*</span></label>
        <textarea class="pep-textarea" id="sbeSeoDesc" rows="2" placeholder="Meta description (150-160 chars)"
          oninput="window.sbpEditorLive && sbpEditorLive()">${esc(item.seoDesc||'')}</textarea>
        <div class="pep-char-count" id="pepSeoDescCount">0/160 chars</div>
      </div>

      <div class="pep-field ${item.keywords?'has-value':''}">
        <label class="pep-field-label">Keywords <span class="pep-req">*</span></label>
        <input class="pep-input" id="sbeKeywords" value="${esc(item.keywords||'')}" placeholder="keyword1, keyword2, keyword3"
          oninput="window.sbpEditorLive && sbpEditorLive()"/>
      </div>

      <!-- Live SEO Preview -->
      <div class="pep-seo-label">Google Preview</div>
      <div class="pep-seo-preview">
        <div class="pep-seo-preview-url" id="pepSeoPreviewUrl">studyria.qzz.io/pdf/your-slug</div>
        <div class="pep-seo-preview-title" id="pepSeoPreviewTitle">PDF Title — Studyria</div>
        <div class="pep-seo-preview-desc" id="pepSeoPreviewDesc">Description will appear here in Google search results.</div>
      </div>
    </div>

    <!-- ── Pricing ─────────────────────────────────────────────────── -->
    <div class="pep-card" style="margin-bottom:16px">
      <div class="pep-card-header">
        <div class="pep-card-icon orange">💰</div>
        <div>
          <div class="pep-card-title">Pricing</div>
          <div class="pep-card-subtitle">Set original & selling price</div>
        </div>
      </div>

      <div class="pep-pricing-card">
        <div class="pep-discount-badge" id="pepDiscountBadge" style="display:none">0% OFF</div>
        <div class="pep-price-display" id="pepPriceDisplay">
          <span class="pep-price-sell">₹${sell||0}</span>
        </div>
        <div class="pep-field-row" style="margin-bottom:14px">
          <div class="pep-field ${orig?'has-value':''}">
            <label class="pep-field-label">Original Price (₹)</label>
            <input class="pep-input" id="sbeOrigPrice" type="number" min="0" value="${orig}" placeholder="499"
              oninput="window.sbpEditorLive && sbpEditorLive()"/>
          </div>
          <div class="pep-field ${sell?'has-value':''}">
            <label class="pep-field-label">Selling Price (₹) <span class="pep-req">*</span></label>
            <input class="pep-input" id="sbeSellPrice" type="number" min="0" value="${sell}" placeholder="299"
              oninput="window.sbpEditorLive && sbpEditorLive()"/>
          </div>
        </div>
        <div class="pep-free-toggle" onclick="window._pepToggleFree && _pepToggleFree()">
          <div class="pep-toggle-switch ${isFree?'on':''}" id="pepFreeToggle"></div>
          <div>
            <div class="pep-toggle-label">Mark as FREE</div>
            <div style="font-size:.65rem;color:var(--text3)">Set selling price to ₹0</div>
          </div>
          <input type="checkbox" id="sbeFree" ${isFree?'checked':''} style="display:none" onchange="window.sbpEditorLive && sbpEditorLive()"/>
        </div>
      </div>
    </div>

    <!-- ── Preview Pages ───────────────────────────────────────────── -->
    <div class="pep-card" style="margin-bottom:16px">
      <div class="pep-card-header">
        <div class="pep-card-icon blue">👁️</div>
        <div>
          <div class="pep-card-title">Preview Pages</div>
          <div class="pep-card-subtitle">Pages accessible without purchase</div>
        </div>
      </div>
      <div class="pep-field ${item.previewPages?'has-value':''}">
        <label class="pep-field-label">Preview Range</label>
        <input class="pep-input" id="sbePreview" value="${esc(item.previewPages||'')}" placeholder="e.g. 1-5"
          oninput="window.sbpEditorLive && sbpEditorLive()"/>
        <div class="pep-hint">Enter page range like "1-5" or "1,2,3"</div>
      </div>
    </div>

    <!-- ── Auto-Generated Fields (copyable) ──────────────────────── -->
    <div class="pep-card" style="margin-bottom:80px">
      <div class="pep-card-header">
        <div class="pep-card-icon purple">🔑</div>
        <div>
          <div class="pep-card-title">Auto-Generated Fields</div>
          <div class="pep-card-subtitle">Read-only · click ⎘ to copy</div>
        </div>
      </div>
      <div class="pep-autofields-box">
        <div class="pep-af-row">
          <span class="pep-af-label">Product ID</span>
          <div class="pep-copyable" style="flex:1">
            <div class="pep-copyable-value" id="pepAutoProductId">${esc(item.productId||'—')}</div>
            <button class="pep-copy-btn" id="pepCopyPid" onclick="pepCopyField('pepAutoProductId','pepCopyPid')" title="Copy">⎘</button>
          </div>
        </div>
        <div class="pep-af-row">
          <span class="pep-af-label">Slug</span>
          <div class="pep-copyable" style="flex:1">
            <div class="pep-copyable-value" id="pepAutoSlug">${esc(item.slug||'—')}</div>
            <button class="pep-copy-btn" id="pepCopySlug" onclick="pepCopyField('pepAutoSlug','pepCopySlug')" title="Copy">⎘</button>
          </div>
        </div>
        <div class="pep-af-row">
          <span class="pep-af-label">Publish Date</span>
          <div class="pep-copyable" style="flex:1">
            <div class="pep-copyable-value" id="pepAutoDate">${item.publishDate ? new Date(item.publishDate).toLocaleDateString('en-IN') : '—'}</div>
            <button class="pep-copy-btn" id="pepCopyDate" onclick="pepCopyField('pepAutoDate','pepCopyDate')" title="Copy">⎘</button>
          </div>
        </div>
      </div>
    </div>

  </div><!-- /pep-form-col -->

  <!-- ── RIGHT: Live Preview Column ─────────────────────────────── -->
  <div class="pep-preview-col">

    <!-- Cover Preview -->
    <div class="pep-card">
      <div class="pep-card-header" style="margin-bottom:14px">
        <div class="pep-card-icon blue">🖼️</div>
        <div class="pep-card-title">Live Cover Preview</div>
      </div>
      <div class="pep-cover-preview ${item.coverThumb||item.coverUrl?'has-cover':''}"
        id="pepCoverPreviewWrap"
        onclick="document.getElementById('pepCoverFileInput')?.click()"
        title="Click to change cover">
        <img id="pepCoverPreviewImg" src="${item.coverThumb||item.coverUrl||''}" style="${item.coverThumb||item.coverUrl?'':'display:none'}"/>
        <div class="pep-cover-overlay">
          <div class="pep-cover-overlay-inner">
            <div>📷</div>
            <span>Change Cover</span>
          </div>
        </div>
        <div class="pep-cover-empty" id="pepCoverEmpty" style="${item.coverThumb||item.coverUrl?'display:none':''}">
          <div class="pep-cover-empty-icon">🖼️</div>
          <div class="pep-cover-empty-text">No cover uploaded</div>
        </div>
      </div>
    </div>

    <!-- PDF Mini Card Preview -->
    <div class="pep-card">
      <div class="pep-card-header" style="margin-bottom:14px">
        <div class="pep-card-icon green">📋</div>
        <div class="pep-card-title">Card Preview</div>
      </div>
      <div class="pep-mini-card">
        <div class="pep-mini-card-img">
          ${item.coverThumb||item.coverUrl ? `<img id="pepMiniImg" src="${item.coverThumb||item.coverUrl}" style="width:100%;height:100%;object-fit:cover"/>` : `<div id="pepMiniImg" style="width:100%;height:100%;background:linear-gradient(135deg,rgba(61,142,248,0.1),rgba(139,92,246,0.1))"></div>`}
          <div class="pep-mini-card-badge" id="pepMiniBadge" style="display:${item.badge?'':'none'}">${esc(item.badge||'')}</div>
        </div>
        <div class="pep-mini-card-body">
          <div class="pep-mini-card-title" id="pepMiniTitle">${esc(item.title||'PDF Title')}</div>
          <div class="pep-mini-card-meta" id="pepMiniMeta">${esc([item.author,item.category].filter(Boolean).join(' · '))}</div>
          <div class="pep-mini-card-classif" id="pepMiniClassif"></div>
          <div class="pep-mini-card-price" id="pepMiniPrice">
            ${isFree ? `<span class="pep-mini-card-price-free">FREE</span>` : `<span class="pep-mini-card-price-curr">₹${sell||0}</span>`}
          </div>
        </div>
      </div>
    </div>

    <!-- SEO Readiness Score -->
    <div class="pep-card">
      <div class="pep-card-header" style="margin-bottom:12px">
        <div class="pep-card-icon green">📊</div>
        <div class="pep-card-title">Completeness</div>
      </div>
      <div id="pepCompletenessBar" style="font-size:.72rem;color:var(--text2)">Loading…</div>
    </div>

  </div><!-- /pep-preview-col -->

</div><!-- /pep-shell -->

<!-- ── Sticky Save Bar ───────────────────────────────────────────── -->
<div class="pep-sticky-bar">
  <div class="pep-status-indicator">
    <div class="pep-status-dot"></div>
    <span id="pepSaveStatus">Auto-saving…</span>
  </div>
  <button class="pep-draft-btn" onclick="window._pepSaveDraft && _pepSaveDraft()" id="pepDraftBtn">
    💾 Save Draft
  </button>
  <button class="pep-save-btn" onclick="window._pepPublish && _pepPublish()" id="pepPublishBtn">
    🚀 Publish
  </button>
</div>`;
  }

  /* ── Cover change handler ────────────────────────────────────────── */
  window._pepHandleCoverChange = function(input) {
    const file = input.files[0];
    if (!file) return;
    const id = window._sbp?.editingId;
    if (!id) return;
    if (typeof window.sbpSetCover === 'function') window.sbpSetCover(id, file);
    // Update previews locally
    const reader = new FileReader();
    reader.onload = e => {
      const src = e.target.result;
      const prevImg = document.getElementById('pepCoverPreviewImg');
      const miniImg = document.getElementById('pepMiniImg');
      const coverEmpty = document.getElementById('pepCoverEmpty');
      const wrap = document.getElementById('pepCoverPreviewWrap');
      if (prevImg) { prevImg.src = src; prevImg.style.display = 'block'; }
      if (miniImg && miniImg.tagName === 'IMG') miniImg.src = src;
      if (coverEmpty) coverEmpty.style.display = 'none';
      if (wrap) { wrap.classList.add('has-cover'); wrap.style.borderStyle = 'solid'; wrap.style.borderColor = 'rgba(16,217,142,0.4)'; }
      // Update upload zone too
      const zone = document.querySelector('.pep-cover-upload-zone');
      if (zone) {
        zone.style.borderColor = 'rgba(16,217,142,0.4)';
        zone.innerHTML = `<input type="file" id="pepCoverFileInput" accept="image/*" style="display:none" onchange="window._pepHandleCoverChange(this)"/>
          <img src="${src}" style="max-height:90px;border-radius:8px;max-width:100%;object-fit:contain"/>
          <div style="font-size:.7rem;color:var(--success);margin-top:5px;font-weight:700">✅ Cover ready · Click to change</div>`;
      }
    };
    reader.readAsDataURL(file);
  };

  /* ── Free toggle ─────────────────────────────────────────────────── */
  window._pepToggleFree = function() {
    const cb = document.getElementById('sbeFree');
    const toggle = document.getElementById('pepFreeToggle');
    if (!cb) return;
    cb.checked = !cb.checked;
    if (toggle) toggle.classList.toggle('on', cb.checked);
    if (typeof window.sbpEditorLive === 'function') window.sbpEditorLive();
  };

  /* ── Auto SEO ─────────────────────────────────────────────────────── */
  window._pepAutoSEO = function() {
    if (typeof window.sbpEditorAutoSEO === 'function') {
      window.sbpEditorAutoSEO();
    } else {
      // Fallback
      const title = document.getElementById('sbeTitle')?.value || '';
      const cat = document.getElementById('pepCat')?.value || document.getElementById('sbeCat')?.value || '';
      if (typeof window.autoGenerateSEO === 'function') {
        const seo = window.autoGenerateSEO(title, cat, '', '');
        if (document.getElementById('sbeSeoTitle')) document.getElementById('sbeSeoTitle').value = (seo.seoTitle||'').slice(0,60);
        if (document.getElementById('sbeSeoDesc'))  document.getElementById('sbeSeoDesc').value  = (seo.desc||'').slice(0,160);
        if (document.getElementById('sbeKeywords')) document.getElementById('sbeKeywords').value = seo.keywords||'';
      }
    }
    if (typeof window.sbpEditorLive === 'function') window.sbpEditorLive();
  };

  /* ── Save Draft / Publish wrappers ───────────────────────────────── */
  window._pepSaveDraft = function() {
    _pepEditorLiveSync();
    window._spmSaveAsDraft = true;
    if (typeof window.sbpEditorSave === 'function') window.sbpEditorSave();
    const statusEl = document.getElementById('pepSaveStatus');
    if (statusEl) { statusEl.textContent = '✅ Saved as draft'; setTimeout(() => { statusEl.textContent = 'Auto-saving…'; }, 2000); }
  };

  window._pepPublish = function() {
    _pepEditorLiveSync();
    window._spmSaveAsDraft = false;
    if (typeof window.sbpEditorSave === 'function') window.sbpEditorSave();
    const statusEl = document.getElementById('pepSaveStatus');
    if (statusEl) { statusEl.textContent = '🚀 Published!'; }
  };

  /* ── Completeness indicator ──────────────────────────────────────── */
  function updateCompleteness() {
    const el = document.getElementById('pepCompletenessBar');
    if (!el) return;
    const checks = [
      { label: 'Title', ok: !!(document.getElementById('sbeTitle')?.value?.trim()) },
      { label: 'Description', ok: !!(document.getElementById('sbeDesc')?.value?.trim()) },
      { label: 'Category', ok: !!(document.getElementById('pepCat')?.value || document.getElementById('sbeCat')?.value) },
      { label: 'Cover', ok: !!(window._sbp?.queue?.find(x=>x.id===window._sbp?.editingId)?.coverThumb || window._sbp?.queue?.find(x=>x.id===window._sbp?.editingId)?.coverUrl) },
      { label: 'SEO Title', ok: !!(document.getElementById('sbeSeoTitle')?.value?.trim()) },
      { label: 'Meta Desc', ok: !!(document.getElementById('sbeSeoDesc')?.value?.trim()) },
      { label: 'Keywords', ok: !!(document.getElementById('sbeKeywords')?.value?.trim()) },
      { label: 'Price', ok: !!(document.getElementById('sbeSellPrice')?.value || document.getElementById('sbeFree')?.checked) },
    ];
    const done = checks.filter(c => c.ok).length;
    const pct = Math.round(done / checks.length * 100);
    const color = pct < 50 ? '#ff4d6d' : pct < 80 ? '#f59e0b' : '#10d98e';
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-weight:800;font-size:.78rem;color:${color}">${pct}% Complete</span>
        <span style="font-size:.68rem;color:var(--text3)">${done}/${checks.length} fields</span>
      </div>
      <div style="height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin-bottom:10px">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;transition:width .4s ease"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 10px">
        ${checks.map(c=>`<div style="font-size:.65rem;display:flex;align-items:center;gap:4px;color:${c.ok?'var(--text2)':'#ff8fa8'}">
          <span style="font-size:.6rem">${c.ok?'✅':'⭕'}</span>${c.label}
        </div>`).join('')}
      </div>`;
  }

  /* ── Cascade onchange handler ────────────────────────────────────── */
  window._pepClassifChange = async function(idx) {
    const lvl = LEVELS[idx];
    if (!lvl) return;
    _updateCascadeBelow(lvl);
    // Reset all below this level and re-fetch
    for (let i = idx + 1; i < LEVELS.length; i++) {
      const child = LEVELS[i];
      const selectEl = document.getElementById(child.id);
      if (selectEl) buildSelectOptions(selectEl, [], '', `Select ${child.label}`);
    }
    // Fetch direct children
    if (idx + 1 < LEVELS.length) {
      await pepCascadeFrom(idx);
    }
    _updateClassifPath();
    _pepEditorLiveSync();
    updateCompleteness();
  };

  /* ── MAIN: Override sbpOpenEditor ────────────────────────────────── */
  const _origSbpOpenEditor = window.sbpOpenEditor;

  window.sbpOpenEditor = async function(id) {
    window._sbp = window._sbp || {};
    window._sbp.editingId = id;
    const item = window._sbp.queue?.find(x => x.id === id);
    if (!item) { if (_origSbpOpenEditor) _origSbpOpenEditor(id); return; }

    const isMobile = window.innerWidth <= 900;
    const panel = isMobile
      ? document.getElementById('sbpMobileEditorBody')
      : document.getElementById('sbpEditorPanel');
    if (!panel) { if (_origSbpOpenEditor) _origSbpOpenEditor(id); return; }

    // Inject HTML
    panel.innerHTML = buildPremiumEditorHTML(item);

    // Show panel / modal
    if (isMobile) {
      const modal = document.getElementById('sbpMobileEditorModal');
      if (modal) { modal.classList.add('open'); modal.scrollTop = 0; }
    } else {
      panel.style.display = '';
      const ph = document.getElementById('sbpEditorPlaceholder');
      if (ph) ph.style.display = 'none';
    }

    // Load categories into Category dropdown from DB
    if (!window._dbCategories?.length) {
      const client = sb();
      if (client) {
        try {
          const { data } = await client.from('categories').select('id,name').order('sort_order').order('name');
          if (data?.length) window._dbCategories = data;
        } catch (_) {}
      }
    }

    // Load categories into pepCat
    const catEl = document.getElementById('pepCat');
    if (catEl && window._dbCategories?.length) {
      const currentCat = item.category || '';
      catEl.innerHTML = `<option value="">— Select Category —</option>` +
        window._dbCategories.map(c => `<option value="${esc(c.name)}" data-id="${c.id}" ${c.name===currentCat?'selected':''}>${esc(c.name)}</option>`).join('');
    }

    // Keep sbeCat hidden-synced
    const sbeCatEl = document.getElementById('sbeCat');
    if (sbeCatEl && item.category) sbeCatEl.value = item.category;

    // Wire category actions
    const catLvl = LEVELS[0];
    _wireActionBtns(catLvl, window._dbCategories || []);

    // If item has existing classification, load cascade
    if (item.categoryId || item.category) {
      const catIdToUse = item.categoryId || (() => {
        const found = (window._dbCategories||[]).find(c => c.name === item.category);
        return found?.id;
      })();

      if (catIdToUse) {
        // Load subcategories
        const subs = await dbFetchOptions('subcategories', 'category_id', catIdToUse);
        const subEl = document.getElementById('pepSubcat');
        if (subEl) buildSelectOptions(subEl, subs, item.subcategory || '', 'Select Subcategory');
        _wireActionBtns(LEVELS[1], subs);

        if (item.subcategoryId || item.subcategory) {
          const subIdToUse = item.subcategoryId || subs.find(s => s.name === item.subcategory)?.id;
          if (subIdToUse) {
            const lvls = await dbFetchOptions('academic_levels', 'subcategory_id', subIdToUse);
            const lvlEl = document.getElementById('pepAcadLevel');
            if (lvlEl) buildSelectOptions(lvlEl, lvls, item.academicLevel || '', 'Select Academic Level');
            _wireActionBtns(LEVELS[2], lvls);

            if (item.academicLevelId || item.academicLevel) {
              const alvlId = item.academicLevelId || lvls.find(l => l.name === item.academicLevel)?.id;
              if (alvlId) {
                const streams = await dbFetchOptions('streams', 'academic_level_id', alvlId);
                const stEl = document.getElementById('pepStream');
                if (stEl) buildSelectOptions(stEl, streams, item.stream || '', 'Select Stream');
                _wireActionBtns(LEVELS[3], streams);

                if (item.streamId || item.stream) {
                  const stId = item.streamId || streams.find(s => s.name === item.stream)?.id;
                  if (stId) {
                    const sems = await dbFetchOptions('semester_classes', 'stream_id', stId);
                    const semEl = document.getElementById('pepSemester');
                    if (semEl) buildSelectOptions(semEl, sems, item.semesterClass || '', 'Select Semester/Class');
                    _wireActionBtns(LEVELS[4], sems);

                    if (item.semesterClassId || item.semesterClass) {
                      const semId = item.semesterClassId || sems.find(s => s.name === item.semesterClass)?.id;
                      if (semId) {
                        const subjects = await dbFetchOptions('subjects', 'semester_class_id', semId);
                        const subjEl = document.getElementById('pepSubject');
                        if (subjEl) buildSelectOptions(subjEl, subjects, item.subject || '', 'Select Subject');
                        _wireActionBtns(LEVELS[5], subjects);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      // Wire all levels with empty options but functional add buttons
      LEVELS.slice(1).forEach(lvl => _wireActionBtns(lvl, []));
    }

    // Wire category select onchange
    if (catEl) catEl.onchange = () => window._pepClassifChange(0);

    // Initial renders
    _updateClassifPath();
    _updateLivePreview();
    updateCompleteness();

    // Auto-update completeness on any input
    panel.addEventListener('input', () => { updateCompleteness(); _updateLivePreview(); }, { passive: true });
    panel.addEventListener('change', () => { updateCompleteness(); _updateLivePreview(); }, { passive: true });
  };

  console.log('[PremiumEditPDFUI] ✅ Loaded — sbpOpenEditor upgraded to premium glassmorphism dashboard');

})();
