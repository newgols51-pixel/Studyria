/**
 * ══════════════════════════════════════════════════════════════════════
 * STUDYRIA — SMART PUBLISH MANAGER  v1.0.0
 * ══════════════════════════════════════════════════════════════════════
 *
 * HOW TO USE:
 *   Add this <script> tag at the very END of index.html, just before
 *   </body>, AFTER pdf-classification-refactor.js (if present):
 *
 *     <script src="smart-publish-manager.js"></script>
 *
 * WHAT THIS ADDS (non-breaking — all existing features intact):
 *   • Smart Publish tab in Admin sidebar ("smart-publish")
 *   • Multi-select / Select All / Bulk operations on PDF table
 *   • 17-point validation engine before any publish
 *   • AI suggestions for Badge, Category, Tags, SEO, Price
 *   • Auto-generate Product ID, Slug, Publish Date, Last Updated
 *   • Publish Preview modal (total / ready / failed / errors)
 *   • Post-publish report (published / failed / time taken)
 *   • Undo Publish within 5-minute window
 *
 * BACKWARD COMPAT:
 *   • Does NOT override adminSavePDF, renderAdminPDFs, adminPDFRow
 *   • Only adds new functions / tab / hook into switchAdminTab
 *   • Uses existing showToast, logAdminActivity, supabaseClient, PDFS
 * ══════════════════════════════════════════════════════════════════════
 */

(function SmartPublishManager(global) {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────
     SECTION 0 — CONSTANTS & STATE
  ───────────────────────────────────────────────────────────────── */

  const SPM_VERSION = '1.0.0';
  const SPM_TAB     = 'smart-publish';
  const UNDO_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Module state
  const SPM = {
    pdfs:            [],   // full list loaded from Supabase
    selected:        new Set(), // selected PDF IDs
    validationCache: {},   // id → { ok, errors }
    undoStack:       [],   // { ids, prevPayload, timestamp }
    aiCache:         {},   // id → ai suggestions
    lastReport:      null, // last publish report
    loading:         false,
  };

  global._SPM = SPM; // expose for debugging

  /* ─────────────────────────────────────────────────────────────────
     SECTION 1 — STYLE INJECTION
  ───────────────────────────────────────────────────────────────── */

  function spmInjectStyles() {
    if (document.getElementById('spm-styles')) return;
    const style = document.createElement('style');
    style.id = 'spm-styles';
    style.textContent = `
/* ── SPM Layout ── */
.spm-wrap { max-width:1200px; animation: dashFadeUp .3s ease both; }
.spm-header { display:flex; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; gap:14px; margin-bottom:20px; }
.spm-header-title { font-family:var(--font-display,inherit); font-size:1.25rem; font-weight:900; background:linear-gradient(135deg,#3d8ef8,#10d98e); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.spm-header-sub { color:var(--text2,#94a3b8); font-size:.8rem; margin-top:3px; }

/* ── Stats Bar ── */
.spm-stats { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:10px; margin-bottom:18px; }
.spm-stat { background:var(--glass,rgba(255,255,255,.05)); border:1px solid var(--glass-border,rgba(255,255,255,.08)); border-radius:12px; padding:14px 12px; text-align:center; }
.spm-stat-val { font-size:1.4rem; font-weight:900; font-family:var(--font-display,inherit); background:linear-gradient(135deg,#3d8ef8,#10d98e); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.spm-stat-label { font-size:.68rem; color:var(--text2,#94a3b8); text-transform:uppercase; letter-spacing:.05em; margin-top:2px; }

/* ── Toolbar ── */
.spm-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:14px 16px; background:var(--glass,rgba(255,255,255,.05)); border:1px solid var(--glass-border,rgba(255,255,255,.08)); border-radius:12px; margin-bottom:14px; }
.spm-toolbar-left { display:flex; align-items:center; gap:8px; flex:1; min-width:200px; }
.spm-toolbar-right { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.spm-search { padding:8px 12px; border-radius:8px; border:1px solid var(--glass-border,rgba(255,255,255,.1)); background:rgba(255,255,255,.04); color:var(--text,#e2e8f0); font-size:.83rem; outline:none; width:200px; transition:border .2s; font-family:inherit; }
.spm-search:focus { border-color:var(--accent,#3d8ef8); }
.spm-filter-select { padding:7px 10px; border-radius:8px; border:1px solid var(--glass-border,rgba(255,255,255,.1)); background:rgba(255,255,255,.04); color:var(--text,#e2e8f0); font-size:.8rem; outline:none; cursor:pointer; font-family:inherit; }
.spm-btn { padding:7px 14px; border-radius:8px; font-size:.78rem; font-weight:700; cursor:pointer; border:none; font-family:inherit; transition:all .18s; display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
.spm-btn:disabled { opacity:.45; cursor:not-allowed; }
.spm-btn-primary { background:linear-gradient(135deg,#3d8ef8,#1d4ed8); color:#fff; }
.spm-btn-primary:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 4px 15px rgba(61,142,248,.35); }
.spm-btn-success { background:linear-gradient(135deg,#10d98e,#059669); color:#fff; }
.spm-btn-success:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 4px 15px rgba(16,217,142,.35); }
.spm-btn-warning { background:linear-gradient(135deg,#f59e0b,#d97706); color:#fff; }
.spm-btn-danger  { background:linear-gradient(135deg,#ef4444,#dc2626); color:#fff; }
.spm-btn-danger:hover:not(:disabled) { transform:translateY(-1px); }
.spm-btn-ghost   { background:rgba(255,255,255,.07); color:var(--text,#e2e8f0); border:1px solid var(--glass-border,rgba(255,255,255,.1)); }
.spm-btn-ghost:hover:not(:disabled) { background:rgba(255,255,255,.12); }
.spm-btn-sm { padding:5px 10px; font-size:.73rem; }
.spm-sel-count { font-size:.78rem; color:var(--text2,#94a3b8); font-weight:600; padding:4px 10px; background:rgba(61,142,248,.1); border-radius:6px; min-width:80px; text-align:center; }

/* ── Table ── */
.spm-table-card { background:var(--glass,rgba(255,255,255,.05)); border:1px solid var(--glass-border,rgba(255,255,255,.08)); border-radius:14px; overflow:hidden; }
.spm-table-wrap { overflow-x:auto; }
.spm-table { width:100%; border-collapse:collapse; min-width:900px; }
.spm-table th { font-size:.68rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--text2,#94a3b8); padding:11px 14px; background:rgba(61,142,248,.04); border-bottom:1px solid var(--glass-border,rgba(255,255,255,.08)); white-space:nowrap; }
.spm-table td { padding:11px 14px; font-size:.82rem; border-bottom:1px solid rgba(255,255,255,.04); vertical-align:middle; }
.spm-table tr:last-child td { border-bottom:none; }
.spm-table tr:hover td { background:rgba(61,142,248,.03); }
.spm-table tr.spm-row-selected td { background:rgba(61,142,248,.08); }
.spm-cb { width:16px; height:16px; accent-color:var(--accent,#3d8ef8); cursor:pointer; }
.spm-cover { width:32px; height:42px; object-fit:cover; border-radius:4px; border:1px solid var(--glass-border,rgba(255,255,255,.08)); }
.spm-cover-ph { width:32px; height:42px; border-radius:4px; background:linear-gradient(135deg,#1d4ed8,#3d8ef8); display:flex; align-items:center; justify-content:center; font-size:.8rem; }
.spm-status-badge { display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:20px; font-size:.68rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
.spm-badge-published { background:rgba(16,217,142,.15); color:#10d98e; }
.spm-badge-draft     { background:rgba(148,163,184,.12); color:#94a3b8; }
.spm-badge-pending   { background:rgba(245,158,11,.15); color:#f59e0b; }
.spm-badge-rejected  { background:rgba(239,68,68,.15); color:#ef4444; }
.spm-badge-archived  { background:rgba(139,92,246,.15); color:#8b5cf6; }
.spm-badge-approved  { background:rgba(6,182,212,.15); color:#06b6d4; }
.spm-val-ok   { color:#10d98e; font-size:.75rem; font-weight:700; }
.spm-val-fail { color:#ef4444; font-size:.75rem; font-weight:700; cursor:pointer; text-decoration:underline dotted; }
.spm-val-pending { color:#94a3b8; font-size:.75rem; }

/* ── Validation Error List ── */
.spm-err-list { list-style:none; padding:0; margin:0; }
.spm-err-list li { display:flex; align-items:flex-start; gap:6px; padding:5px 0; font-size:.78rem; color:var(--text,#e2e8f0); border-bottom:1px solid rgba(255,255,255,.04); }
.spm-err-list li:last-child { border-bottom:none; }
.spm-err-icon { font-size:.75rem; margin-top:1px; flex-shrink:0; }
.spm-err-pass { color:#10d98e; }
.spm-err-fail { color:#ef4444; }
.spm-err-warn { color:#f59e0b; }

/* ── Modal Overlay ── */
.spm-overlay { position:fixed; inset:0; background:rgba(0,0,0,.72); z-index:9000; display:flex; align-items:center; justify-content:center; padding:16px; animation:spmFadeIn .2s ease; }
.spm-modal { background:var(--bg,#0f1117); border:1px solid var(--glass-border,rgba(255,255,255,.12)); border-radius:18px; max-width:600px; width:100%; max-height:90vh; overflow-y:auto; padding:28px; position:relative; animation:spmSlideUp .25s ease; box-shadow:0 25px 60px rgba(0,0,0,.5); }
.spm-modal-lg { max-width:800px; }
.spm-modal-close { position:absolute; top:16px; right:16px; background:rgba(255,255,255,.07); border:none; border-radius:50%; width:32px; height:32px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--text2,#94a3b8); font-size:1rem; transition:all .18s; }
.spm-modal-close:hover { background:rgba(255,255,255,.14); color:var(--text,#e2e8f0); }
.spm-modal-title { font-size:1.05rem; font-weight:800; margin-bottom:6px; }
.spm-modal-sub { font-size:.8rem; color:var(--text2,#94a3b8); margin-bottom:20px; }
.spm-preview-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:20px; }
.spm-preview-card { background:rgba(255,255,255,.04); border:1px solid var(--glass-border,rgba(255,255,255,.08)); border-radius:12px; padding:16px; text-align:center; }
.spm-preview-num { font-size:2rem; font-weight:900; font-family:var(--font-display,inherit); }
.spm-preview-num-ok   { background:linear-gradient(135deg,#10d98e,#059669); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.spm-preview-num-fail { background:linear-gradient(135deg,#ef4444,#dc2626); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.spm-preview-num-info { background:linear-gradient(135deg,#3d8ef8,#1d4ed8); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.spm-preview-label { font-size:.72rem; color:var(--text2,#94a3b8); text-transform:uppercase; letter-spacing:.05em; margin-top:4px; }

/* ── AI Panel ── */
.spm-ai-panel { background:rgba(61,142,248,.06); border:1px solid rgba(61,142,248,.18); border-radius:12px; padding:16px; margin-bottom:16px; }
.spm-ai-label { font-size:.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#3d8ef8; margin-bottom:10px; display:flex; align-items:center; gap:6px; }
.spm-ai-field { margin-bottom:10px; }
.spm-ai-field label { font-size:.73rem; color:var(--text2,#94a3b8); display:block; margin-bottom:3px; }
.spm-ai-input { width:100%; padding:7px 10px; border-radius:7px; border:1px solid rgba(61,142,248,.2); background:rgba(255,255,255,.04); color:var(--text,#e2e8f0); font-size:.8rem; font-family:inherit; outline:none; box-sizing:border-box; }
.spm-ai-input:focus { border-color:#3d8ef8; }

/* ── Report ── */
.spm-report { background:var(--glass,rgba(255,255,255,.05)); border:1px solid var(--glass-border,rgba(255,255,255,.08)); border-radius:14px; padding:20px; margin-top:16px; }
.spm-report-title { font-weight:800; font-size:.95rem; margin-bottom:14px; display:flex; align-items:center; gap:8px; }
.spm-report-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; margin-bottom:14px; }
.spm-report-card { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.06); border-radius:10px; padding:14px; text-align:center; }
.spm-report-num { font-size:1.8rem; font-weight:900; font-family:var(--font-display,inherit); }
.spm-report-lbl { font-size:.68rem; color:var(--text2,#94a3b8); text-transform:uppercase; letter-spacing:.05em; margin-top:2px; }
.spm-undo-bar { display:flex; align-items:center; gap:10px; padding:12px 16px; background:rgba(245,158,11,.1); border:1px solid rgba(245,158,11,.25); border-radius:10px; font-size:.82rem; }
.spm-undo-bar-msg { flex:1; color:var(--text,#e2e8f0); }
.spm-undo-timer { font-weight:700; color:#f59e0b; font-variant-numeric:tabular-nums; }

/* ── Spinner ── */
.spm-spinner { width:14px; height:14px; border:2px solid rgba(255,255,255,.2); border-top-color:#fff; border-radius:50%; animation:spmSpin .7s linear infinite; display:inline-block; }

/* ── Validation Detail Tooltip ── */
.spm-val-tooltip { position:absolute; background:var(--bg,#0f1117); border:1px solid var(--glass-border,rgba(255,255,255,.12)); border-radius:10px; padding:12px 14px; font-size:.75rem; z-index:200; min-width:200px; max-width:280px; box-shadow:0 8px 24px rgba(0,0,0,.4); pointer-events:none; }

/* ── Animations ── */
@keyframes spmFadeIn  { from { opacity:0 } to { opacity:1 } }
@keyframes spmSlideUp { from { opacity:0; transform:translateY(20px) } to { opacity:1; transform:translateY(0) } }
@keyframes spmSpin    { to { transform:rotate(360deg) } }

/* ── Responsive ── */
@media(max-width:600px) {
  .spm-toolbar { flex-direction:column; align-items:stretch; }
  .spm-toolbar-right { justify-content:flex-start; }
  .spm-search { width:100%; }
  .spm-preview-grid { grid-template-columns:repeat(2,1fr); }
  .spm-modal { padding:18px; }
  .spm-stats { grid-template-columns:repeat(2,1fr); }
}
    `;
    document.head.appendChild(style);
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 2 — VALIDATION ENGINE (17 checks)
  ───────────────────────────────────────────────────────────────── */

  const VALIDATION_CHECKS = [
    { id:'pdf',         label:'PDF File',        required:true,  check: p => !!(p.pdf_url || p.file_url || p.download_url || p.megaLink) },
    { id:'cover',       label:'Cover Image',     required:true,  check: p => !!(p.cover_url || p.cover_image || p.thumbnail || p.image_url) },
    { id:'title',       label:'Title',           required:true,  check: p => !!(p.title?.trim()) && p.title.trim().length >= 3 },
    { id:'description', label:'Description',     required:false, check: p => !!(p.description?.trim() || p.preview?.trim()) && (p.description||p.preview||'').trim().length >= 10 },
    { id:'category',    label:'Category',        required:true,  check: p => !!(p.category?.trim() || p.category_id) },
    { id:'price',       label:'Selling Price',   required:false, check: p => p.free || (!isNaN(parseFloat(p.price ?? p.selling_price)) && parseFloat(p.price ?? p.selling_price) >= 0) },
    { id:'origprice',   label:'Original Price',  required:false, check: p => !p.original_price || parseFloat(p.original_price) >= parseFloat(p.price ?? p.selling_price ?? 0) },
    { id:'badge',       label:'Badge',           required:false, warn: true, check: p => !!(p.badge?.trim() || p.tag?.trim()) },
    { id:'preview',     label:'Preview Pages',   required:false, warn: true, check: p => !!(p.preview_pdf_url || p.preview_url || p.previewUrl) },
    { id:'tags',        label:'Tags / Keywords', required:false, warn: true, check: p => !!(p.seo_keywords?.trim()) && p.seo_keywords.trim().length > 2 },
    { id:'seo',         label:'SEO Title',       required:false, warn: true, check: p => !!(p.seo_title?.trim()) && p.seo_title.trim().length >= 5 },
    { id:'slug',        label:'Slug',            required:false, check: p => !!(p.slug?.trim()) },
    { id:'dupeTitle',   label:'Duplicate Title', required:true,  async: true, asyncFn: async (p, allPdfs) => {
        const same = allPdfs.filter(x => String(x.id) !== String(p.id) && x.title?.trim().toLowerCase() === p.title?.trim().toLowerCase());
        return same.length === 0;
      }
    },
    { id:'dupePDF',     label:'Duplicate PDF',   required:false, warn:true, async:true, asyncFn: async (p, allPdfs) => {
        if (!p.pdf_url) return true;
        const same = allPdfs.filter(x => String(x.id) !== String(p.id) && (x.pdf_url || x.file_url) === (p.pdf_url || p.file_url));
        return same.length === 0;
      }
    },
    { id:'copyright',   label:'Copyright Risk',  required:false, warn:true, check: p => {
        const title = (p.title||'').toLowerCase();
        const flagged = ['ncert','cbse official','government of india','upsc official'];
        return !flagged.some(f => title.includes(f));
      }
    },
    { id:'adult',       label:'18+ Content',     required:true,  check: p => {
        const text = ((p.title||'') + ' ' + (p.description||'') + ' ' + (p.seo_keywords||'')).toLowerCase();
        const adultKeywords = ['adult only','18+','explicit','nsfw','erotic'];
        return !adultKeywords.some(k => text.includes(k));
      }
    },
    { id:'integrity',   label:'File Integrity',  required:true,  check: p => {
        const url = p.pdf_url || p.file_url || '';
        return !url || url.startsWith('http') && url.includes('.');
      }
    },
  ];

  /**
   * Run all validation checks for a PDF object.
   * Returns { ok: bool, errors: [{id, label, pass, warn, msg}] }
   */
  async function spmValidate(pdf, allPdfs) {
    if (SPM.validationCache[pdf.id]) return SPM.validationCache[pdf.id];

    const errors = [];
    let blockingFail = false;

    for (const rule of VALIDATION_CHECKS) {
      let pass = true;
      try {
        if (rule.async) {
          pass = await rule.asyncFn(pdf, allPdfs || SPM.pdfs);
        } else {
          pass = rule.check(pdf);
        }
      } catch(e) {
        pass = false;
      }

      const isRequired = rule.required && !rule.warn;
      errors.push({
        id:    rule.id,
        label: rule.label,
        pass,
        warn:  rule.warn && !pass,
        fail:  !pass && isRequired,
        msg:   pass ? '✓ OK' : (rule.warn ? '⚠ Recommended' : '✗ Required'),
      });

      if (!pass && isRequired) blockingFail = true;
    }

    const result = { ok: !blockingFail, errors };
    SPM.validationCache[pdf.id] = result;
    return result;
  }

  /** Invalidate cache for a PDF ID */
  function spmInvalidateCache(id) {
    delete SPM.validationCache[id];
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 3 — AUTO GENERATE FIELDS
  ───────────────────────────────────────────────────────────────── */

  function spmGenerateProductId(pdf) {
    const prefix = 'SPM';
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2,5).toUpperCase();
    return `${prefix}-${ts}-${rand}`;
  }

  function spmGenerateSlug(title) {
    if (typeof generateSlug === 'function') return generateSlug(title);
    return (title||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);
  }

  function spmNow() { return new Date().toISOString(); }

  function spmAutoFillFields(pdf) {
    const out = { ...pdf };
    if (!out.product_id) out.product_id = spmGenerateProductId(pdf);
    if (!out.slug)       out.slug       = spmGenerateSlug(pdf.title || '');
    if (!out.published_at) out.published_at = spmNow();
    out.updated_at = spmNow();
    return out;
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 4 — AI SUGGESTIONS (via Anthropic API)
  ───────────────────────────────────────────────────────────────── */

  async function spmGetAISuggestions(pdf) {
    if (SPM.aiCache[pdf.id]) return SPM.aiCache[pdf.id];

    const prompt = `You are Studyria's AI publishing assistant. Given the following PDF metadata, provide smart suggestions.

PDF Data:
Title: ${pdf.title || 'Unknown'}
Description: ${pdf.description || pdf.preview || ''}
Category: ${pdf.category || ''}
Current Price: ${pdf.price ?? pdf.selling_price ?? 0}
Original Price: ${pdf.original_price ?? ''}

Respond ONLY with a valid JSON object (no markdown, no backticks) with exactly these keys:
{
  "badge": "one of: New, Hot, Trending, Bestseller, Free, Limited, Sale, Premium",
  "category": "suggested category name",
  "tags": "5-8 comma-separated keywords",
  "seo_title": "SEO optimized title under 60 chars",
  "meta_description": "meta description under 160 chars",
  "selling_price": number,
  "price_reasoning": "one sentence on why"
}`;

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!resp.ok) throw new Error(`AI API error: ${resp.status}`);
      const data = await resp.json();
      const raw = (data.content || []).map(b => b.text || '').join('');
      const clean = raw.replace(/```json|```/g,'').trim();
      const suggestions = JSON.parse(clean);
      SPM.aiCache[pdf.id] = suggestions;
      return suggestions;
    } catch(e) {
      console.warn('SPM AI suggestions failed:', e);
      // Return graceful fallback
      return {
        badge: pdf.free ? 'Free' : 'New',
        category: pdf.category || '',
        tags: (pdf.seo_keywords || ''),
        seo_title: (pdf.seo_title || pdf.title || '').slice(0,60),
        meta_description: (pdf.seo_description || pdf.description || '').slice(0,160),
        selling_price: pdf.price ?? pdf.selling_price ?? 0,
        price_reasoning: 'Based on existing price.',
      };
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 5 — BULK OPERATIONS
  ───────────────────────────────────────────────────────────────── */

  async function spmBulkUpdateStatus(ids, status, label) {
    if (!ids.length) { spmToast('No PDFs selected', 'info'); return 0; }
    if (!global.supabaseClient) { spmToast('Supabase not connected', 'error'); return 0; }

    let success = 0;
    for (const id of ids) {
      try {
        const { error } = await global.supabaseClient.from('pdfs').update({
          status, updated_at: spmNow()
        }).eq('id', id);
        if (!error) {
          success++;
          spmInvalidateCache(id);
        }
      } catch(e) { /* continue */ }
    }

    // Refresh local array
    ids.forEach(id => {
      const p = SPM.pdfs.find(x => String(x.id) === String(id));
      if (p) p.status = status;
      const wp = (global.PDFS||[]).find(x => String(x.id) === String(id));
      if (wp) wp.status = status;
    });

    spmToast(`✅ ${success}/${ids.length} PDFs ${label}`, 'success');
    if (typeof logAdminActivity === 'function') logAdminActivity(`Bulk ${label}: ${success} PDFs`, 'blue');
    return success;
  }

  async function spmBulkDelete(ids) {
    if (!ids.length) { spmToast('No PDFs selected', 'info'); return; }
    if (!confirm(`Delete ${ids.length} PDF(s) permanently? This cannot be undone.`)) return;
    if (!global.supabaseClient) { spmToast('Supabase not connected', 'error'); return; }

    let success = 0;
    for (const id of ids) {
      const { error } = await global.supabaseClient.from('pdfs').delete().eq('id', id);
      if (!error) {
        success++;
        SPM.pdfs = SPM.pdfs.filter(p => String(p.id) !== String(id));
        if (global.PDFS) {
          const idx = global.PDFS.findIndex(p => String(p.id) === String(id));
          if (idx > -1) global.PDFS.splice(idx, 1);
        }
        spmInvalidateCache(id);
      }
    }
    SPM.selected.clear();
    spmToast(`🗑 ${success} PDF(s) deleted`, success > 0 ? 'info' : 'error');
    if (typeof logAdminActivity === 'function') logAdminActivity(`Bulk deleted ${success} PDFs`, 'red');
    spmRender();
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 6 — SMART PUBLISH FLOW (single + bulk)
  ───────────────────────────────────────────────────────────────── */

  /**
   * Run validation on all selected PDFs, then show a preview modal.
   * On confirm → actually publish.
   */
  async function spmStartPublish(ids) {
    if (!ids.length) { spmToast('Select at least one PDF', 'info'); return; }

    // Show progress overlay
    spmShowLoader('Validating PDFs…');

    const ready   = [];
    const failed  = [];
    const reports = [];

    for (const id of ids) {
      const pdf = SPM.pdfs.find(p => String(p.id) === String(id));
      if (!pdf) continue;
      const result = await spmValidate(pdf, SPM.pdfs);
      reports.push({ pdf, result });
      if (result.ok) ready.push(id);
      else failed.push(id);
    }

    spmHideLoader();
    spmShowPublishPreview(reports, ready, failed);
  }

  async function spmExecutePublish(readyIds, aiEdits) {
    if (!readyIds.length) { spmToast('No valid PDFs to publish', 'info'); return; }
    if (!global.supabaseClient) { spmToast('Supabase not connected', 'error'); return; }

    const startTime = Date.now();
    const undoData  = [];
    let published   = 0;
    let errors      = 0;

    spmShowLoader('Publishing…');

    for (const id of readyIds) {
      const pdf = SPM.pdfs.find(p => String(p.id) === String(id));
      if (!pdf) continue;

      // Save undo snapshot
      undoData.push({ id, prev: { status: pdf.status, updated_at: pdf.updated_at } });

      // Auto-fill missing fields
      const enriched = spmAutoFillFields(pdf);

      // Apply admin AI edits
      const edits = aiEdits?.[id] || {};

      const payload = {
        status:          'published',
        slug:            edits.slug            || enriched.slug,
        badge:           edits.badge           || enriched.badge || pdf.badge || null,
        seo_title:       edits.seo_title       || enriched.seo_title || pdf.seo_title || null,
        seo_description: edits.meta_description|| enriched.seo_description || pdf.seo_description || null,
        seo_keywords:    edits.tags            || enriched.seo_keywords || pdf.seo_keywords || null,
        selling_price:   edits.selling_price !== undefined ? Number(edits.selling_price) : (enriched.selling_price ?? pdf.price ?? 0),
        price:           edits.selling_price !== undefined ? Number(edits.selling_price) : (enriched.price ?? pdf.price ?? 0),
        updated_at:      spmNow(),
        published_at:    enriched.published_at || spmNow(),
      };

      try {
        const { error } = await global.supabaseClient.from('pdfs').update(payload).eq('id', id);
        if (error) throw error;
        Object.assign(pdf, payload);
        const wp = (global.PDFS||[]).find(x => String(x.id) === String(id));
        if (wp) Object.assign(wp, payload);
        published++;
        spmInvalidateCache(id);
      } catch(e) {
        errors++;
        console.warn('SPM publish error:', id, e);
      }
    }

    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);

    // Push to undo stack
    if (undoData.length) {
      SPM.undoStack.push({ ids: readyIds, undoData, timestamp: Date.now() });
      setTimeout(() => { SPM.undoStack = SPM.undoStack.filter(x => Date.now() - x.timestamp < UNDO_TTL_MS); }, UNDO_TTL_MS + 1000);
    }

    SPM.lastReport = { published, errors, timeTaken, total: readyIds.length };

    spmHideLoader();
    SPM.selected.clear();

    if (typeof logAdminActivity === 'function') logAdminActivity(`Smart Publish: ${published} published, ${errors} failed`, 'green');
    spmRender();
    spmShowReport(SPM.lastReport);
  }

  async function spmUndoPublish() {
    const entry = SPM.undoStack[SPM.undoStack.length - 1];
    if (!entry) { spmToast('Nothing to undo', 'info'); return; }
    if (Date.now() - entry.timestamp > UNDO_TTL_MS) { spmToast('Undo window expired', 'info'); return; }
    if (!confirm(`Undo publish for ${entry.ids.length} PDF(s)?`)) return;

    let undone = 0;
    for (const { id, prev } of entry.undoData) {
      const { error } = await global.supabaseClient.from('pdfs').update({ status: prev.status || 'draft', updated_at: spmNow() }).eq('id', id);
      if (!error) {
        undone++;
        const p = SPM.pdfs.find(x => String(x.id) === String(id));
        if (p) p.status = prev.status || 'draft';
        spmInvalidateCache(id);
      }
    }
    SPM.undoStack.pop();
    spmToast(`↩ Undone: ${undone} PDFs reverted`, 'success');
    if (typeof logAdminActivity === 'function') logAdminActivity(`Undo Publish: ${undone} PDFs reverted`, 'yellow');
    spmRender();
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 7 — MODALS
  ───────────────────────────────────────────────────────────────── */

  function spmCloseModal() {
    const el = document.getElementById('spmModalOverlay');
    if (el) el.remove();
  }

  function spmOpenModal(html) {
    spmCloseModal();
    const overlay = document.createElement('div');
    overlay.id = 'spmModalOverlay';
    overlay.className = 'spm-overlay';
    overlay.innerHTML = html;
    overlay.addEventListener('click', e => { if (e.target === overlay) spmCloseModal(); });
    document.body.appendChild(overlay);
  }

  /** Validation detail modal for a single PDF */
  async function spmShowValidationDetail(id) {
    const pdf = SPM.pdfs.find(p => String(p.id) === String(id));
    if (!pdf) return;
    spmShowLoader('Validating…');
    const result = await spmValidate(pdf, SPM.pdfs);
    spmHideLoader();

    const rows = result.errors.map(e => `
      <li>
        <span class="spm-err-icon">${e.fail ? '✗' : e.warn ? '⚠' : '✓'}</span>
        <span style="flex:1">
          <strong>${_safeEsc(e.label)}</strong>
          <span style="float:right;font-size:.72rem;opacity:.7">${e.msg}</span>
        </span>
      </li>`).join('');

    spmOpenModal(`
      <div class="spm-modal">
        <button class="spm-modal-close" onclick="window._SPM._closeModal()">✕</button>
        <div class="spm-modal-title">Validation Report</div>
        <div class="spm-modal-sub">${_safeEsc(pdf.title || 'Untitled')}</div>
        <ul class="spm-err-list">${rows}</ul>
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
          <button class="spm-btn spm-btn-ghost" onclick="window._SPM._closeModal()">Close</button>
          ${result.ok ? `<button class="spm-btn spm-btn-success" onclick="window._SPM._publishOne('${id}')">🚀 Publish</button>` : ''}
        </div>
      </div>`);
  }

  /** AI Suggestions modal */
  async function spmShowAISuggest(id) {
    const pdf = SPM.pdfs.find(p => String(p.id) === String(id));
    if (!pdf) return;

    spmOpenModal(`
      <div class="spm-modal">
        <button class="spm-modal-close" onclick="window._SPM._closeModal()">✕</button>
        <div class="spm-modal-title">🤖 AI Suggestions</div>
        <div class="spm-modal-sub">Fetching suggestions for: ${_safeEsc(pdf.title || 'Untitled')}</div>
        <div style="text-align:center;padding:30px 0"><div class="spm-spinner" style="width:30px;height:30px;border-width:3px"></div></div>
      </div>`);

    const s = await spmGetAISuggestions(pdf);

    spmOpenModal(`
      <div class="spm-modal">
        <button class="spm-modal-close" onclick="window._SPM._closeModal()">✕</button>
        <div class="spm-modal-title">🤖 AI Suggestions</div>
        <div class="spm-modal-sub">Review and edit before applying · ${_safeEsc(pdf.title || '')}</div>
        <div class="spm-ai-panel">
          <div class="spm-ai-label">✨ AI Generated</div>
          <div class="spm-ai-field"><label>Badge</label><input id="spmAiBadge" class="spm-ai-input" value="${_safeEsc(s.badge||'')}"/></div>
          <div class="spm-ai-field"><label>Category</label><input id="spmAiCat" class="spm-ai-input" value="${_safeEsc(s.category||'')}"/></div>
          <div class="spm-ai-field"><label>Tags / Keywords</label><input id="spmAiTags" class="spm-ai-input" value="${_safeEsc(s.tags||'')}"/></div>
          <div class="spm-ai-field"><label>SEO Title</label><input id="spmAiSeoTitle" class="spm-ai-input" value="${_safeEsc(s.seo_title||'')}"/></div>
          <div class="spm-ai-field"><label>Meta Description</label><textarea id="spmAiMetaDesc" class="spm-ai-input" rows="2">${_safeEsc(s.meta_description||'')}</textarea></div>
          <div class="spm-ai-field"><label>Selling Price (₹)</label><input id="spmAiPrice" type="number" class="spm-ai-input" value="${s.selling_price||0}"/></div>
          <div style="font-size:.72rem;color:var(--text2,#94a3b8);margin-top:4px">💡 ${_safeEsc(s.price_reasoning||'')}</div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="spm-btn spm-btn-ghost" onclick="window._SPM._closeModal()">Discard</button>
          <button class="spm-btn spm-btn-primary" onclick="window._SPM._applyAI('${id}')">✅ Apply & Publish</button>
        </div>
      </div>`);
  }

  /** Publish Preview Modal (bulk) */
  function spmShowPublishPreview(reports, readyIds, failedIds) {
    const totalErrors = reports.flatMap(r => r.result.errors.filter(e => e.fail));
    const errSummary  = totalErrors.length ? `
      <div style="margin-bottom:14px">
        <div style="font-size:.8rem;font-weight:700;color:#ef4444;margin-bottom:8px">Blocking Errors (${totalErrors.length})</div>
        <ul class="spm-err-list">${totalErrors.slice(0,10).map(e=>`<li><span class="spm-err-icon">✗</span>${_safeEsc(e.label)}</li>`).join('')}</ul>
      </div>` : '';

    const failedList = failedIds.length ? `
      <div style="margin-bottom:14px">
        <div style="font-size:.8rem;color:var(--text2,#94a3b8);margin-bottom:6px">Failed PDFs (${failedIds.length}) — click Validate for details</div>
        ${reports.filter(r => !r.result.ok).map(r=>`<div style="font-size:.78rem;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04)">${_safeEsc(r.pdf.title||'Untitled')}</div>`).join('')}
      </div>` : '';

    spmOpenModal(`
      <div class="spm-modal">
        <button class="spm-modal-close" onclick="window._SPM._closeModal()">✕</button>
        <div class="spm-modal-title">Publish Preview</div>
        <div class="spm-modal-sub">Review before confirming publish</div>
        <div class="spm-preview-grid">
          <div class="spm-preview-card">
            <div class="spm-preview-num spm-preview-num-info">${reports.length}</div>
            <div class="spm-preview-label">Total Selected</div>
          </div>
          <div class="spm-preview-card">
            <div class="spm-preview-num spm-preview-num-ok">${readyIds.length}</div>
            <div class="spm-preview-label">Ready</div>
          </div>
          <div class="spm-preview-card">
            <div class="spm-preview-num spm-preview-num-fail">${failedIds.length}</div>
            <div class="spm-preview-label">Failed</div>
          </div>
        </div>
        ${errSummary}${failedList}
        ${readyIds.length === 0 ? '<div style="text-align:center;color:#ef4444;font-size:.85rem;margin-bottom:16px">No valid PDFs to publish. Fix errors first.</div>' : ''}
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="spm-btn spm-btn-ghost" onclick="window._SPM._closeModal()">Cancel</button>
          ${readyIds.length > 0 ? `<button class="spm-btn spm-btn-success" onclick="window._SPM._confirmPublish(${JSON.stringify(readyIds)})">🚀 Publish ${readyIds.length} PDF${readyIds.length>1?'s':''}</button>` : ''}
        </div>
      </div>`);
  }

  /** Post-publish report */
  function spmShowReport(report) {
    const undoEntry = SPM.undoStack[SPM.undoStack.length-1];
    const canUndo   = undoEntry && (Date.now() - undoEntry.timestamp < UNDO_TTL_MS);

    spmOpenModal(`
      <div class="spm-modal">
        <button class="spm-modal-close" onclick="window._SPM._closeModal()">✕</button>
        <div class="spm-modal-title">✅ Publish Report</div>
        <div class="spm-modal-sub">Completed in ${report.timeTaken}s</div>
        <div class="spm-report-grid">
          <div class="spm-report-card">
            <div class="spm-report-num" style="color:#10d98e">${report.published}</div>
            <div class="spm-report-lbl">Published</div>
          </div>
          <div class="spm-report-card">
            <div class="spm-report-num" style="color:#ef4444">${report.errors}</div>
            <div class="spm-report-lbl">Failed</div>
          </div>
          <div class="spm-report-card">
            <div class="spm-report-num" style="color:#3d8ef8">${report.timeTaken}s</div>
            <div class="spm-report-lbl">Time Taken</div>
          </div>
        </div>
        ${canUndo ? `
        <div class="spm-undo-bar">
          <span class="spm-undo-bar-msg">⏱ Undo window active</span>
          <span id="spmUndoTimerLabel" class="spm-undo-timer">5:00</span>
          <button class="spm-btn spm-btn-warning spm-btn-sm" onclick="window._SPM._undo()">↩ Undo</button>
        </div>` : ''}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="spm-btn spm-btn-ghost" onclick="window._SPM._closeModal()">Close</button>
        </div>
      </div>`);

    if (canUndo) spmStartUndoTimer(undoEntry.timestamp);
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 8 — UNDO TIMER
  ───────────────────────────────────────────────────────────────── */

  function spmStartUndoTimer(startTs) {
    let interval = setInterval(() => {
      const remaining = UNDO_TTL_MS - (Date.now() - startTs);
      const el = document.getElementById('spmUndoTimerLabel');
      if (!el) { clearInterval(interval); return; }
      if (remaining <= 0) {
        clearInterval(interval);
        el.textContent = 'Expired';
        const btn = el.nextElementSibling;
        if (btn) btn.disabled = true;
        return;
      }
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
    }, 1000);
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 9 — LOADER
  ───────────────────────────────────────────────────────────────── */

  function spmShowLoader(msg) {
    spmCloseModal();
    const overlay = document.createElement('div');
    overlay.id = 'spmLoaderOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9001;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px';
    overlay.innerHTML = `<div class="spm-spinner" style="width:40px;height:40px;border-width:4px"></div><div style="color:#e2e8f0;font-size:.85rem">${_safeEsc(msg)}</div>`;
    document.body.appendChild(overlay);
  }

  function spmHideLoader() {
    const el = document.getElementById('spmLoaderOverlay');
    if (el) el.remove();
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 10 — TOAST (delegates to existing showToast if available)
  ───────────────────────────────────────────────────────────────── */

  function spmToast(msg, type) {
    if (typeof showToast === 'function') { showToast(msg, type); return; }
    console.log(`[SPM] ${type}: ${msg}`);
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 11 — DATA LOADING
  ───────────────────────────────────────────────────────────────── */

  async function spmLoadPDFs() {
    SPM.loading = true;
    let pdfs = [];

    if (global.supabaseClient) {
      try {
        const { data } = await global.supabaseClient
          .from('pdfs').select('*').order('created_at', { ascending: false });
        if (data?.length) pdfs = data;
      } catch(e) { console.warn('SPM load error:', e); }
    }

    if (!pdfs.length && global.PDFS?.length) pdfs = [...global.PDFS];

    SPM.pdfs    = pdfs;
    SPM.loading = false;
    return pdfs;
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 12 — MAIN RENDER
  ───────────────────────────────────────────────────────────────── */

  async function renderSmartPublish(main) {
    spmInjectStyles();

    main.innerHTML = `
      <div class="spm-wrap">
        <div class="spm-header">
          <div>
            <div class="spm-header-title">⚡ Smart Publish Manager</div>
            <div class="spm-header-sub">Validate · Bulk Publish · AI Suggestions · Undo</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="spm-btn spm-btn-ghost spm-btn-sm" onclick="window._SPM._refresh()">↻ Refresh</button>
            ${SPM.undoStack.length && (Date.now()-SPM.undoStack[SPM.undoStack.length-1].timestamp < UNDO_TTL_MS)
              ? `<button class="spm-btn spm-btn-warning spm-btn-sm" onclick="window._SPM._undo()">↩ Undo Last Publish</button>` : ''}
          </div>
        </div>
        <div id="spmStatsBar" class="spm-stats">
          <div class="spm-stat"><div class="spm-stat-val" id="spmStatTotal">–</div><div class="spm-stat-label">Total PDFs</div></div>
          <div class="spm-stat"><div class="spm-stat-val" id="spmStatPublished">–</div><div class="spm-stat-label">Published</div></div>
          <div class="spm-stat"><div class="spm-stat-val" id="spmStatDraft">–</div><div class="spm-stat-label">Draft/Pending</div></div>
          <div class="spm-stat"><div class="spm-stat-val" id="spmStatSelected">0</div><div class="spm-stat-label">Selected</div></div>
        </div>
        <div class="spm-toolbar">
          <div class="spm-toolbar-left">
            <input class="spm-search" id="spmSearch" placeholder="Search PDFs…" oninput="window._SPM._search(this.value)" />
            <select class="spm-filter-select" id="spmStatusFilter" onchange="window._SPM._filter()">
              <option value="">All Statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div class="spm-toolbar-right">
            <button class="spm-btn spm-btn-ghost spm-btn-sm" onclick="window._SPM._selectAll()">☑ Select All</button>
            <button class="spm-btn spm-btn-ghost spm-btn-sm" onclick="window._SPM._deselectAll()">☐ Deselect</button>
            <span class="spm-sel-count" id="spmSelCount">0 selected</span>
            <button class="spm-btn spm-btn-primary spm-btn-sm" id="spmBulkPublishBtn" onclick="window._SPM._bulkPublish()" disabled>🚀 Publish</button>
            <button class="spm-btn spm-btn-ghost spm-btn-sm" id="spmBulkApproveBtn" onclick="window._SPM._bulkApprove()" disabled>✅ Approve</button>
            <button class="spm-btn spm-btn-ghost spm-btn-sm" id="spmBulkRejectBtn" onclick="window._SPM._bulkReject()" disabled>✗ Reject</button>
            <button class="spm-btn spm-btn-ghost spm-btn-sm" id="spmBulkArchiveBtn" onclick="window._SPM._bulkArchive()" disabled>🗄 Archive</button>
            <button class="spm-btn spm-btn-danger spm-btn-sm" id="spmBulkDeleteBtn" onclick="window._SPM._bulkDelete()" disabled>🗑 Delete</button>
          </div>
        </div>
        <div class="spm-table-card">
          <div class="spm-table-wrap">
            <table class="spm-table" id="spmTable">
              <thead>
                <tr>
                  <th><input type="checkbox" class="spm-cb" id="spmSelectAllCb" onchange="window._SPM._toggleAll(this.checked)" /></th>
                  <th>#</th>
                  <th>Cover</th>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Validation</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="spmTableBody">
                <tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text2,#94a3b8)">Loading PDFs…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>`;

    // Load data asynchronously
    await spmLoadPDFs();
    spmRender();
  }

  /** Re-render only the table body and stats (no full page re-paint) */
  function spmRender() {
    spmUpdateStats();
    spmRenderTable();
    spmUpdateToolbar();
  }

  function spmUpdateStats() {
    const total     = SPM.pdfs.length;
    const published = SPM.pdfs.filter(p => p.status === 'published').length;
    const draft     = SPM.pdfs.filter(p => !p.status || p.status === 'draft' || p.status === 'pending').length;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('spmStatTotal', total);
    set('spmStatPublished', published);
    set('spmStatDraft', draft);
    set('spmStatSelected', SPM.selected.size);
  }

  function spmRenderTable(query, statusFilter) {
    const tbody = document.getElementById('spmTableBody');
    if (!tbody) return;

    query       = query       ?? (document.getElementById('spmSearch')?.value       || '');
    statusFilter= statusFilter ?? (document.getElementById('spmStatusFilter')?.value || '');

    let filtered = SPM.pdfs;
    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter(p =>
        (p.title||'').toLowerCase().includes(q) ||
        (p.category||'').toLowerCase().includes(q) ||
        (p.author||'').toLowerCase().includes(q)
      );
    }
    if (statusFilter) {
      filtered = filtered.filter(p => (p.status||'draft') === statusFilter);
    }

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text2,#94a3b8)">No PDFs found</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((p, i) => spmRow(p, i)).join('');
  }

  function spmRow(p, i) {
    const id       = String(p.id);
    const selected = SPM.selected.has(id);
    const price    = p.price ?? p.selling_price ?? 0;
    const status   = p.status || 'draft';
    const cached   = SPM.validationCache[id];

    const valCell = cached
      ? (cached.ok
          ? `<span class="spm-val-ok">✓ Valid</span>`
          : `<span class="spm-val-fail" onclick="window._SPM._valDetail('${id}')">✗ ${cached.errors.filter(e=>e.fail).length} error(s)</span>`)
      : `<span class="spm-val-pending" onclick="window._SPM._validateOne('${id}')" style="cursor:pointer">Run →</span>`;

    const coverHTML = p.cover_url || p.cover_image
      ? `<img src="${_safeEsc(p.cover_url||p.cover_image)}" class="spm-cover" loading="lazy" decoding="async" />`
      : `<div class="spm-cover-ph">📄</div>`;

    return `<tr id="spmRow_${id}" class="${selected ? 'spm-row-selected' : ''}">
      <td><input type="checkbox" class="spm-cb" ${selected?'checked':''} onchange="window._SPM._toggleRow('${id}',this.checked)" /></td>
      <td style="color:var(--text2,#94a3b8);font-size:.75rem">${i+1}</td>
      <td>${coverHTML}</td>
      <td>
        <div style="font-size:.82rem;font-weight:600;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_safeEsc(p.title||'—')}</div>
        <div style="font-size:.7rem;color:var(--text2,#94a3b8)">${_safeEsc(p.author||'')}</div>
      </td>
      <td><span style="font-size:.75rem;background:rgba(61,142,248,.1);border-radius:6px;padding:2px 8px">${_safeEsc(p.category||'—')}</span></td>
      <td style="font-weight:700;color:var(--accent,#3d8ef8)">${p.free || price===0 ? 'Free' : '₹'+price}</td>
      <td><span class="spm-status-badge spm-badge-${status}">${status}</span></td>
      <td>${valCell}</td>
      <td>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          <button class="spm-btn spm-btn-ghost spm-btn-sm" onclick="window._SPM._validateOne('${id}')" title="Validate">🔍</button>
          <button class="spm-btn spm-btn-ghost spm-btn-sm" onclick="window._SPM._aiSuggest('${id}')" title="AI Suggest">🤖</button>
          <button class="spm-btn spm-btn-success spm-btn-sm" onclick="window._SPM._publishOne('${id}')" title="Publish">🚀</button>
        </div>
      </td>
    </tr>`;
  }

  function spmUpdateToolbar() {
    const n = SPM.selected.size;
    const el = document.getElementById('spmSelCount');
    if (el) el.textContent = `${n} selected`;
    const set = (id, val) => { const b = document.getElementById(id); if (b) b.disabled = !val; };
    set('spmBulkPublishBtn', n > 0);
    set('spmBulkApproveBtn', n > 0);
    set('spmBulkRejectBtn', n > 0);
    set('spmBulkArchiveBtn', n > 0);
    set('spmBulkDeleteBtn', n > 0);
    const cb = document.getElementById('spmSelectAllCb');
    if (cb) {
      const visibleIds = spmVisibleIds();
      cb.checked = visibleIds.length > 0 && visibleIds.every(id => SPM.selected.has(id));
      cb.indeterminate = visibleIds.some(id => SPM.selected.has(id)) && !cb.checked;
    }
    const statEl = document.getElementById('spmStatSelected');
    if (statEl) statEl.textContent = n;
  }

  function spmVisibleIds() {
    return Array.from(document.querySelectorAll('#spmTableBody tr[id^="spmRow_"]'))
      .map(tr => tr.id.replace('spmRow_',''));
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 13 — PUBLIC API (bound to _SPM for onclick access)
  ───────────────────────────────────────────────────────────────── */

  Object.assign(SPM, {
    _closeModal:    spmCloseModal,
    _refresh:       async () => { SPM.validationCache = {}; await spmLoadPDFs(); spmRender(); spmToast('Refreshed', 'info'); },
    _search:        (q) => { spmRenderTable(q); spmUpdateToolbar(); },
    _filter:        ()  => { spmRenderTable(); spmUpdateToolbar(); },
    _selectAll:     ()  => { spmVisibleIds().forEach(id => SPM.selected.add(id)); spmRenderTable(); spmUpdateToolbar(); },
    _deselectAll:   ()  => { SPM.selected.clear(); spmRenderTable(); spmUpdateToolbar(); },
    _toggleAll:     (checked) => {
      spmVisibleIds().forEach(id => { if (checked) SPM.selected.add(id); else SPM.selected.delete(id); });
      spmRenderTable();
      spmUpdateToolbar();
    },
    _toggleRow:     (id, checked) => {
      if (checked) SPM.selected.add(id); else SPM.selected.delete(id);
      const row = document.getElementById(`spmRow_${id}`);
      if (row) row.classList.toggle('spm-row-selected', checked);
      spmUpdateToolbar();
    },
    _validateOne:   async (id) => {
      spmInvalidateCache(id);
      const pdf = SPM.pdfs.find(p => String(p.id) === id);
      if (!pdf) return;
      await spmValidate(pdf, SPM.pdfs);
      // Update just this row's validation cell
      const valCell = document.querySelector(`#spmRow_${id} td:nth-child(8)`);
      if (valCell) {
        const cached = SPM.validationCache[id];
        valCell.innerHTML = cached
          ? (cached.ok ? `<span class="spm-val-ok">✓ Valid</span>` : `<span class="spm-val-fail" onclick="window._SPM._valDetail('${id}')">✗ ${cached.errors.filter(e=>e.fail).length} error(s)</span>`)
          : `<span class="spm-val-pending">—</span>`;
      }
    },
    _valDetail:     (id) => spmShowValidationDetail(id),
    _aiSuggest:     (id) => spmShowAISuggest(id),
    _publishOne:    async (id) => {
      spmCloseModal();
      await spmStartPublish([id]);
    },
    _bulkPublish:   () => spmStartPublish([...SPM.selected]),
    _bulkApprove:   async () => { await spmBulkUpdateStatus([...SPM.selected], 'approved', 'approved'); spmRender(); },
    _bulkReject:    async () => { await spmBulkUpdateStatus([...SPM.selected], 'rejected', 'rejected'); spmRender(); },
    _bulkArchive:   async () => { await spmBulkUpdateStatus([...SPM.selected], 'archived', 'archived'); spmRender(); },
    _bulkDelete:    () => spmBulkDelete([...SPM.selected]),
    _confirmPublish:(readyIds) => {
      spmCloseModal();
      spmExecutePublish(readyIds, {});
    },
    _applyAI:       async (id) => {
      const edits = {
        badge:            document.getElementById('spmAiBadge')?.value    || '',
        tags:             document.getElementById('spmAiTags')?.value     || '',
        seo_title:        document.getElementById('spmAiSeoTitle')?.value || '',
        meta_description: document.getElementById('spmAiMetaDesc')?.value || '',
        selling_price:    parseFloat(document.getElementById('spmAiPrice')?.value || 0),
      };
      const catVal = document.getElementById('spmAiCat')?.value || '';
      if (catVal) {
        const pdf = SPM.pdfs.find(p => String(p.id) === id);
        if (pdf && !pdf.category) { pdf.category = catVal; }
      }
      spmCloseModal();
      await spmExecutePublish([id], { [id]: edits });
    },
    _undo:          spmUndoPublish,
  });

  /* ─────────────────────────────────────────────────────────────────
     SECTION 14 — HOOK INTO switchAdminTab (non-breaking override)
  ───────────────────────────────────────────────────────────────── */

  function spmHookSwitchAdminTab() {
    // Stack on top of any existing overrides (creator-manager etc.)
    const _prev = global.switchAdminTab;
    global.switchAdminTab = function(tab) {
      if (tab === SPM_TAB) {
        // Activate nav highlight
        document.querySelectorAll('.admin-nav-item[data-atab]')
          .forEach(b => b.classList.toggle('active', b.dataset.atab === tab));
        const bc = document.getElementById('adminBreadcrumb');
        if (bc) bc.textContent = '⚡ Smart Publish Manager';
        const main = document.getElementById('adminMain');
        if (main) renderSmartPublish(main);
        return;
      }
      if (_prev) return _prev(tab);
    };
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 15 — INJECT SIDEBAR NAV BUTTON
  ───────────────────────────────────────────────────────────────── */

  function spmInjectNavButton() {
    // Only inject once
    if (document.querySelector(`.admin-nav-item[data-atab="${SPM_TAB}"]`)) return;

    // Find a good insertion point — after the existing pdfs tab
    const pdfsBtn = document.querySelector('.admin-nav-item[data-atab="pdfs"]');
    if (!pdfsBtn) return;

    const btn = document.createElement('button');
    btn.className = 'admin-nav-item';
    btn.dataset.atab = SPM_TAB;
    btn.setAttribute('onclick', `switchAdminTab('${SPM_TAB}')`);
    btn.style.cssText = 'background:linear-gradient(90deg,rgba(61,142,248,0.14),rgba(16,217,142,0.07));border-left:2px solid #3d8ef8';
    btn.innerHTML = `<span style="font-size:.85rem">⚡</span> Smart Publish`;

    pdfsBtn.insertAdjacentElement('afterend', btn);

    // Also add to tabNames if accessible
    if (global.switchAdminTab?.tabNames) {
      global.switchAdminTab.tabNames[SPM_TAB] = '⚡ Smart Publish Manager';
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 16 — UTILITY HELPERS
  ───────────────────────────────────────────────────────────────── */

  function _safeEsc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#x27;');
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 17 — INIT
  ───────────────────────────────────────────────────────────────── */

  function spmInit() {
    spmInjectStyles();
    spmHookSwitchAdminTab();
    spmInjectNavButton();

    // Re-inject nav button if admin panel is opened later
    const origNavigate = global.navigate;
    if (typeof origNavigate === 'function' && !global._spmNavigatePatched) {
      global._spmNavigatePatched = true;
      global.navigate = function(page, ...args) {
        origNavigate(page, ...args);
        if (page === 'admin') {
          // Defer until admin panel renders
          setTimeout(spmInjectNavButton, 400);
        }
      };
    }

    // Also watch for adminPanel becoming visible (via MutationObserver)
    const adminPanel = document.getElementById('adminPanel');
    if (adminPanel) {
      const obs = new MutationObserver(() => { spmInjectNavButton(); });
      obs.observe(adminPanel, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    console.log(`[SmartPublishManager] ✅ v${SPM_VERSION} loaded`);
    console.log('[SmartPublishManager] Tab: "smart-publish"');
    console.log('[SmartPublishManager] Features: 17-point validation, AI suggestions, bulk ops, undo publish');
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', spmInit);
  } else {
    setTimeout(spmInit, 0);
  }

})(window);
