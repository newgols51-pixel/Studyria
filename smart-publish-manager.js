/**
 * ══════════════════════════════════════════════════════════════════════
 * STUDYRIA — SMART PUBLISH MANAGER  v3.0.0
 * ══════════════════════════════════════════════════════════════════════
 *
 * HOW TO USE:
 *   Add this <script> tag at the very END of index.html, just before
 *   </body>, AFTER pdf-classification-refactor.js (if present):
 *
 *     <script src="smart-publish-manager.js"></script>
 *
 * WHAT THIS ADDS:
 *   • Draft Queue — ONLY Draft/Pending/Approved/Rejected/Archived PDFs
 *     → NEVER shows Published PDFs
 *     → After Publish, auto-moves PDFs from Draft Queue → Published Library
 *   • Upload: Single / Multiple / Bulk (100+) / Drag & Drop
 *     → Every upload saved as Draft immediately
 *   • Bulk Actions: Select All, Deselect All, Publish, Approve, Reject,
 *     Archive, Delete
 *   • 15-point pre-publish validation (blocks on failure with exact error)
 *   • AI Suggestions: Category, Badge, Tags, SEO Title, Meta Description,
 *     Selling Price, Slug
 *   • Publish Preview: Total Selected / Ready / Failed / Errors
 *   • Post-Publish Report: Published / Failed / Time Taken
 *   • Lazy Loading + Pagination (supports 1000+ PDFs)
 *   • Mobile Responsive
 *   • Undo Publish (5-minute window)
 *   • Subscriber notification hook via supabase.js
 *
 * BACKWARD COMPAT:
 *   • Does NOT override adminSavePDF, renderAdminPDFs, adminPDFRow
 *   • Only hooks into switchAdminTab — non-breaking
 *   • Uses existing showToast, logAdminActivity, supabaseClient, PDFS
 * ══════════════════════════════════════════════════════════════════════
 */

(function SmartPublishManager(global) {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────
     SECTION 0 — CONSTANTS & STATE
  ───────────────────────────────────────────────────────────────── */

  const SPM_VERSION = '3.0.0';
  const SPM_TAB     = 'smart-publish';
  const UNDO_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const PAGE_SIZE   = 50;             // rows per virtual page

  // Statuses that belong in the Draft Queue (NEVER include 'published')
  const DRAFT_STATUSES = new Set(['draft', 'pending', 'approved', 'rejected', 'archived']);

  // Module state
  const SPM = {
    pdfs:            [],
    filtered:        [],
    page:            0,
    selected:        new Set(),
    validationCache: {},
    undoStack:       [],
    aiCache:         {},
    lastReport:      null,
    loading:         false,
    uploadQueue:     [],
    uploading:       false,
  };

  global._SPM = SPM;

  /* ─────────────────────────────────────────────────────────────────
     SECTION 1 — STYLE INJECTION
  ───────────────────────────────────────────────────────────────── */

  function spmInjectStyles() {
    if (document.getElementById('spm-styles')) return;
    const style = document.createElement('style');
    style.id = 'spm-styles';
    style.textContent = `
/* ── SPM Layout ── */
.spm-wrap { max-width:1300px; animation:dashFadeUp .3s ease both; }
.spm-header { display:flex; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; gap:14px; margin-bottom:20px; }
.spm-header-title { font-family:var(--font-display,inherit); font-size:1.25rem; font-weight:900; background:linear-gradient(135deg,#3d8ef8,#10d98e); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.spm-header-sub { color:var(--text2,#94a3b8); font-size:.8rem; margin-top:3px; }

/* ── Upload Zone ── */
.spm-upload-section { margin-bottom:20px; }
.spm-upload-tabs { display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap; }
.spm-upload-tab { padding:6px 14px; border-radius:8px; font-size:.75rem; font-weight:700; cursor:pointer; border:1px solid var(--glass-border,rgba(255,255,255,.1)); background:rgba(255,255,255,.04); color:var(--text2,#94a3b8); transition:all .18s; font-family:inherit; }
.spm-upload-tab.active { background:linear-gradient(135deg,#3d8ef8,#1d4ed8); color:#fff; border-color:transparent; }
.spm-upload-panel { display:none; }
.spm-upload-panel.active { display:block; }
.spm-dropzone { border:2px dashed rgba(61,142,248,.35); border-radius:14px; padding:40px 20px; text-align:center; cursor:pointer; transition:all .2s; background:rgba(61,142,248,.04); position:relative; overflow:hidden; }
.spm-dropzone.dragover { border-color:#3d8ef8; background:rgba(61,142,248,.12); transform:scale(1.01); }
.spm-dropzone:hover { border-color:rgba(61,142,248,.6); background:rgba(61,142,248,.07); }
.spm-dropzone-icon { font-size:2.5rem; margin-bottom:10px; }
.spm-dropzone-label { font-size:.9rem; font-weight:700; color:var(--text,#e2e8f0); margin-bottom:6px; }
.spm-dropzone-sub { font-size:.75rem; color:var(--text2,#94a3b8); }
.spm-drop-input { position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%; }
.spm-upload-list { margin-top:12px; display:flex; flex-direction:column; gap:6px; max-height:240px; overflow-y:auto; }
.spm-upload-item { display:flex; align-items:center; gap:10px; padding:8px 12px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.06); border-radius:8px; font-size:.78rem; }
.spm-upload-item-name { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.spm-upload-item-size { color:var(--text2,#94a3b8); white-space:nowrap; }
.spm-upload-item-status { font-size:.7rem; font-weight:700; padding:2px 8px; border-radius:12px; white-space:nowrap; }
.spm-ustat-pending   { background:rgba(148,163,184,.12); color:#94a3b8; }
.spm-ustat-uploading { background:rgba(61,142,248,.15); color:#3d8ef8; }
.spm-ustat-done      { background:rgba(16,217,142,.15); color:#10d98e; }
.spm-ustat-error     { background:rgba(239,68,68,.15); color:#ef4444; }
.spm-upload-progress { height:3px; background:rgba(255,255,255,.06); border-radius:3px; margin-top:8px; overflow:hidden; }
.spm-upload-progress-bar { height:100%; background:linear-gradient(90deg,#3d8ef8,#10d98e); transition:width .3s; border-radius:3px; }

/* ── Stats Bar ── */
.spm-stats { display:grid; grid-template-columns:repeat(auto-fill,minmax(110px,1fr)); gap:10px; margin-bottom:18px; }
.spm-stat { background:var(--glass,rgba(255,255,255,.05)); border:1px solid var(--glass-border,rgba(255,255,255,.08)); border-radius:12px; padding:14px 12px; text-align:center; }
.spm-stat-val { font-size:1.4rem; font-weight:900; font-family:var(--font-display,inherit); background:linear-gradient(135deg,#3d8ef8,#10d98e); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.spm-stat-label { font-size:.67rem; color:var(--text2,#94a3b8); text-transform:uppercase; letter-spacing:.05em; margin-top:2px; }

/* ── Toolbar ── */
.spm-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:12px 14px; background:var(--glass,rgba(255,255,255,.05)); border:1px solid var(--glass-border,rgba(255,255,255,.08)); border-radius:12px; margin-bottom:14px; }
.spm-toolbar-left { display:flex; align-items:center; gap:8px; flex:1; min-width:200px; flex-wrap:wrap; }
.spm-toolbar-right { display:flex; align-items:center; gap:5px; flex-wrap:wrap; }
.spm-search { padding:8px 12px; border-radius:8px; border:1px solid var(--glass-border,rgba(255,255,255,.1)); background:rgba(255,255,255,.04); color:var(--text,#e2e8f0); font-size:.83rem; outline:none; width:190px; transition:border .2s; font-family:inherit; }
.spm-search:focus { border-color:var(--accent,#3d8ef8); }
.spm-filter-select { padding:7px 9px; border-radius:8px; border:1px solid var(--glass-border,rgba(255,255,255,.1)); background:rgba(255,255,255,.04); color:var(--text,#e2e8f0); font-size:.78rem; outline:none; cursor:pointer; font-family:inherit; }
.spm-btn { padding:7px 13px; border-radius:8px; font-size:.76rem; font-weight:700; cursor:pointer; border:none; font-family:inherit; transition:all .18s; display:inline-flex; align-items:center; gap:4px; white-space:nowrap; }
.spm-btn:disabled { opacity:.4; cursor:not-allowed; }
.spm-btn-primary { background:linear-gradient(135deg,#3d8ef8,#1d4ed8); color:#fff; }
.spm-btn-primary:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 4px 14px rgba(61,142,248,.35); }
.spm-btn-success { background:linear-gradient(135deg,#10d98e,#059669); color:#fff; }
.spm-btn-success:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 4px 14px rgba(16,217,142,.35); }
.spm-btn-warning { background:linear-gradient(135deg,#f59e0b,#d97706); color:#fff; }
.spm-btn-danger  { background:linear-gradient(135deg,#ef4444,#dc2626); color:#fff; }
.spm-btn-danger:hover:not(:disabled) { transform:translateY(-1px); }
.spm-btn-ghost   { background:rgba(255,255,255,.07); color:var(--text,#e2e8f0); border:1px solid var(--glass-border,rgba(255,255,255,.1)); }
.spm-btn-ghost:hover:not(:disabled) { background:rgba(255,255,255,.12); }
.spm-btn-sm { padding:5px 9px; font-size:.72rem; }
.spm-sel-count { font-size:.75rem; color:var(--text2,#94a3b8); font-weight:600; padding:4px 9px; background:rgba(61,142,248,.1); border-radius:6px; min-width:76px; text-align:center; }

/* ── Queue Notice ── */
.spm-queue-notice { display:flex; align-items:center; gap:10px; padding:10px 14px; background:rgba(16,217,142,.07); border:1px solid rgba(16,217,142,.18); border-radius:10px; font-size:.78rem; color:#10d98e; margin-bottom:12px; }

/* ── Table ── */
.spm-table-card { background:var(--glass,rgba(255,255,255,.05)); border:1px solid var(--glass-border,rgba(255,255,255,.08)); border-radius:14px; overflow:hidden; }
.spm-table-wrap { overflow-x:auto; }
.spm-table { width:100%; border-collapse:collapse; min-width:940px; }
.spm-table th { font-size:.66rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--text2,#94a3b8); padding:10px 13px; background:rgba(61,142,248,.04); border-bottom:1px solid var(--glass-border,rgba(255,255,255,.08)); white-space:nowrap; }
.spm-table td { padding:10px 13px; font-size:.81rem; border-bottom:1px solid rgba(255,255,255,.04); vertical-align:middle; }
.spm-table tr:last-child td { border-bottom:none; }
.spm-table tr:hover td { background:rgba(61,142,248,.03); }
.spm-table tr.spm-row-selected td { background:rgba(61,142,248,.08); }
.spm-cb { width:15px; height:15px; accent-color:var(--accent,#3d8ef8); cursor:pointer; }
.spm-cover { width:30px; height:40px; object-fit:cover; border-radius:4px; border:1px solid var(--glass-border,rgba(255,255,255,.08)); }
.spm-cover-ph { width:30px; height:40px; border-radius:4px; background:linear-gradient(135deg,#1d4ed8,#3d8ef8); display:flex; align-items:center; justify-content:center; font-size:.75rem; }
.spm-status-badge { display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:20px; font-size:.66rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
.spm-badge-draft    { background:rgba(148,163,184,.12); color:#94a3b8; }
.spm-badge-pending  { background:rgba(245,158,11,.15); color:#f59e0b; }
.spm-badge-rejected { background:rgba(239,68,68,.15); color:#ef4444; }
.spm-badge-archived { background:rgba(139,92,246,.15); color:#8b5cf6; }
.spm-badge-approved { background:rgba(6,182,212,.15); color:#06b6d4; }
.spm-badge-published{ background:rgba(16,217,142,.15); color:#10d98e; }
.spm-val-ok   { color:#10d98e; font-size:.73rem; font-weight:700; }
.spm-val-fail { color:#ef4444; font-size:.73rem; font-weight:700; cursor:pointer; text-decoration:underline dotted; }
.spm-val-warn { color:#f59e0b; font-size:.73rem; font-weight:600; cursor:pointer; text-decoration:underline dotted; }
.spm-val-pending { color:#94a3b8; font-size:.73rem; }

/* ── Modal Overlay ── */
.spm-overlay { position:fixed; inset:0; background:rgba(0,0,0,.75); z-index:9000; display:flex; align-items:center; justify-content:center; padding:16px; animation:spmFadeIn .2s ease; }
.spm-modal { background:var(--bg,#0f1117); border:1px solid var(--glass-border,rgba(255,255,255,.12)); border-radius:18px; max-width:620px; width:100%; max-height:90vh; overflow-y:auto; padding:28px; position:relative; animation:spmSlideUp .25s ease; box-shadow:0 25px 60px rgba(0,0,0,.5); }
.spm-modal-lg { max-width:820px; }
.spm-modal-close { position:absolute; top:16px; right:16px; background:rgba(255,255,255,.07); border:none; border-radius:50%; width:32px; height:32px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:var(--text2,#94a3b8); font-size:1rem; transition:all .18s; }
.spm-modal-close:hover { background:rgba(255,255,255,.14); color:var(--text,#e2e8f0); }
.spm-modal-title { font-size:1.05rem; font-weight:800; margin-bottom:6px; }
.spm-modal-sub { font-size:.79rem; color:var(--text2,#94a3b8); margin-bottom:20px; }
.spm-preview-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:18px; }
.spm-preview-card { background:rgba(255,255,255,.04); border:1px solid var(--glass-border,rgba(255,255,255,.08)); border-radius:12px; padding:16px; text-align:center; }
.spm-preview-num { font-size:2rem; font-weight:900; font-family:var(--font-display,inherit); }
.spm-preview-num-ok   { background:linear-gradient(135deg,#10d98e,#059669); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.spm-preview-num-fail { background:linear-gradient(135deg,#ef4444,#dc2626); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.spm-preview-num-info { background:linear-gradient(135deg,#3d8ef8,#1d4ed8); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
.spm-preview-label { font-size:.7rem; color:var(--text2,#94a3b8); text-transform:uppercase; letter-spacing:.05em; margin-top:4px; }

/* ── AI Panel ── */
.spm-ai-panel { background:rgba(61,142,248,.06); border:1px solid rgba(61,142,248,.18); border-radius:12px; padding:16px; margin-bottom:16px; }
.spm-ai-label { font-size:.71rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#3d8ef8; margin-bottom:10px; display:flex; align-items:center; gap:6px; }
.spm-ai-field { margin-bottom:10px; }
.spm-ai-field label { font-size:.72rem; color:var(--text2,#94a3b8); display:block; margin-bottom:3px; }
.spm-ai-input { width:100%; padding:7px 10px; border-radius:7px; border:1px solid rgba(61,142,248,.2); background:rgba(255,255,255,.04); color:var(--text,#e2e8f0); font-size:.79rem; font-family:inherit; outline:none; box-sizing:border-box; }
.spm-ai-input:focus { border-color:#3d8ef8; }
.spm-ai-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }

/* ── Validation error detail ── */
.spm-val-err-item { display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius:8px; margin-bottom:4px; font-size:.78rem; }
.spm-val-err-item.fail { background:rgba(239,68,68,.08); }
.spm-val-err-item.warn { background:rgba(245,158,11,.08); }
.spm-val-err-item.pass { background:rgba(16,217,142,.06); }

/* ── Report ── */
.spm-report-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; margin-bottom:14px; }
.spm-report-card { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.06); border-radius:10px; padding:14px; text-align:center; }
.spm-report-num { font-size:1.8rem; font-weight:900; font-family:var(--font-display,inherit); }
.spm-report-lbl { font-size:.67rem; color:var(--text2,#94a3b8); text-transform:uppercase; letter-spacing:.05em; margin-top:2px; }
.spm-undo-bar { display:flex; align-items:center; gap:10px; padding:12px 16px; background:rgba(245,158,11,.08); border:1px solid rgba(245,158,11,.22); border-radius:10px; font-size:.81rem; margin-top:14px; }
.spm-undo-bar-msg { flex:1; color:var(--text,#e2e8f0); }
.spm-undo-timer { font-weight:700; color:#f59e0b; font-variant-numeric:tabular-nums; }

/* ── Pagination ── */
.spm-pagination { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-top:1px solid rgba(255,255,255,.06); font-size:.76rem; color:var(--text2,#94a3b8); flex-wrap:wrap; gap:8px; }
.spm-pagination-btns { display:flex; gap:5px; }

/* ── Spinner ── */
.spm-spinner { width:14px; height:14px; border:2px solid rgba(255,255,255,.2); border-top-color:#fff; border-radius:50%; animation:spmSpin .7s linear infinite; display:inline-block; }

/* ── Animations ── */
@keyframes spmFadeIn  { from { opacity:0 } to { opacity:1 } }
@keyframes spmSlideUp { from { opacity:0; transform:translateY(20px) } to { opacity:1; transform:translateY(0) } }
@keyframes spmSpin    { to { transform:rotate(360deg) } }

/* ── Section Divider ── */
.spm-section-label { font-size:.7rem; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:var(--text2,#94a3b8); margin-bottom:10px; display:flex; align-items:center; gap:8px; }
.spm-section-label::after { content:''; flex:1; height:1px; background:var(--glass-border,rgba(255,255,255,.08)); }

/* ── Edit Draft Modal ── */
.spm-edit-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:16px; }
.spm-edit-field { display:flex; flex-direction:column; gap:4px; }
.spm-edit-field.full-width { grid-column:1/-1; }
.spm-edit-label { font-size:.71rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--text2,#94a3b8); }
.spm-edit-label .spm-req { color:#ef4444; margin-left:2px; }
.spm-edit-label .spm-opt { color:#94a3b8; font-weight:400; font-size:.65rem; margin-left:4px; }
.spm-edit-input { padding:8px 11px; border-radius:8px; border:1px solid var(--glass-border,rgba(255,255,255,.1)); background:rgba(255,255,255,.04); color:var(--text,#e2e8f0); font-size:.82rem; font-family:inherit; outline:none; transition:border .18s; box-sizing:border-box; width:100%; }
.spm-edit-input:focus { border-color:#3d8ef8; background:rgba(61,142,248,.05); }
.spm-edit-textarea { resize:vertical; min-height:80px; }
.spm-edit-section-head { font-size:.7rem; font-weight:700; text-transform:uppercase; letter-spacing:.08em; color:#3d8ef8; margin:16px 0 10px; display:flex; align-items:center; gap:8px; }
.spm-edit-section-head::after { content:''; flex:1; height:1px; background:rgba(61,142,248,.2); }
.spm-cover-preview-wrap { display:flex; align-items:center; gap:12px; }
.spm-cover-preview-img { width:60px; height:80px; object-fit:cover; border-radius:6px; border:1px solid var(--glass-border,rgba(255,255,255,.1)); flex-shrink:0; }
.spm-cover-preview-ph { width:60px; height:80px; border-radius:6px; background:linear-gradient(135deg,#1d4ed8,#3d8ef8); display:flex; align-items:center; justify-content:center; font-size:1.5rem; flex-shrink:0; }
.spm-draft-saved { display:inline-flex; align-items:center; gap:5px; font-size:.72rem; color:#10d98e; opacity:0; transition:opacity .3s; }
.spm-draft-saved.show { opacity:1; }

/* ── Responsive ── */
@media(max-width:640px){
  .spm-edit-grid { grid-template-columns:1fr; }
  .spm-toolbar { flex-direction:column; align-items:stretch; }
  .spm-toolbar-right { justify-content:flex-start; overflow-x:auto; padding-bottom:4px; }
  .spm-search { width:100%; }
  .spm-preview-grid { grid-template-columns:repeat(2,1fr); }
  .spm-modal { padding:18px; }
  .spm-stats { grid-template-columns:repeat(2,1fr); }
  .spm-ai-grid { grid-template-columns:1fr; }
  .spm-header { flex-direction:column; }
  .spm-upload-tabs { overflow-x:auto; }
  .spm-table { min-width:700px; }
}
    `;
    document.head.appendChild(style);
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 2 — VALIDATION ENGINE (15 checks)
  ───────────────────────────────────────────────────────────────── */

  const VALIDATION_CHECKS = [
    {
      id:'pdf', label:'PDF File', required:true,
      check: p => !!(p.pdf_url || p.file_url || p.download_url || p.megaLink),
      failMsg: 'No PDF file URL attached. Upload a PDF first.',
    },
    {
      id:'cover', label:'Cover Image', required:true,
      check: p => !!(p.cover_url || p.cover_image || p.thumbnail || p.image_url),
      failMsg: 'Cover image is missing. Add a cover before publishing.',
    },
    {
      id:'title', label:'Title', required:true,
      check: p => !!(p.title?.trim()) && p.title.trim().length >= 3,
      failMsg: 'Title is missing or too short (min 3 characters).',
    },
    {
      id:'description', label:'Description', required:true,
      check: p => !!(p.description?.trim() || p.preview?.trim()) &&
                  (p.description || p.preview || '').trim().length >= 10,
      failMsg: 'Description is missing or too short (min 10 characters).',
    },
    {
      id:'category', label:'Category', required:true,
      check: p => !!(p.category?.trim() || p.category_id),
      failMsg: 'Category not set. Assign a category before publishing.',
    },
    {
      id:'price', label:'Selling Price', required:true,
      check: p => p.free === true || p.free === 'true' || p.free === 1 ||
                  (!isNaN(parseFloat(p.price ?? p.selling_price)) &&
                   parseFloat(p.price ?? p.selling_price) >= 0),
      failMsg: 'Selling price is invalid. Set a valid price (or mark as Free).',
    },
    {
      id:'origprice', label:'Original Price', required:false, warn:true,
      check: p => !p.original_price ||
                  parseFloat(p.original_price) >= parseFloat(p.price ?? p.selling_price ?? 0),
      failMsg: 'Original price is lower than selling price.',
    },
    {
      id:'badge', label:'Badge', required:false, warn:true,
      check: p => !!(p.badge?.trim()),
      failMsg: 'No badge set (recommended for discoverability).',
    },
    {
      id:'tags', label:'Tags / Keywords', required:false, warn:true,
      check: p => !!(p.seo_keywords?.trim()) && p.seo_keywords.trim().length > 2,
      failMsg: 'No SEO keywords/tags added.',
    },
    {
      id:'preview', label:'Preview Pages', required:false, warn:true,
      check: p => !!(p.preview_pdf_url || p.preview_url || p.previewUrl),
      failMsg: 'No preview pages attached (recommended).',
    },
    {
      id:'seo', label:'SEO Title', required:false, warn:true,
      check: p => !!(p.seo_title?.trim()) && p.seo_title.trim().length >= 5,
      failMsg: 'SEO title is missing or too short.',
    },
    {
      id:'integrity', label:'File Integrity', required:true,
      check: p => {
        const url = p.pdf_url || p.file_url || '';
        if (!url) return false; // required + file check #1 must pass first
        return url.startsWith('http') && url.includes('.');
      },
      failMsg: 'PDF file URL appears invalid or malformed (must be a valid https URL).',
    },
    {
      id:'metadata', label:'Metadata Completeness', required:false, warn:true,
      check: p => {
        const hasSlug = !!(p.slug?.trim());
        const hasSeoDesc = !!(p.seo_description?.trim() || p.seo_desc?.trim());
        return hasSlug && hasSeoDesc;
      },
      failMsg: 'Slug or SEO description missing — metadata incomplete.',
    },
    {
      id:'dupeTitle', label:'Duplicate Title', required:true, async:true,
      asyncFn: async (p, allPdfs) => {
        const same = allPdfs.filter(x =>
          String(x.id) !== String(p.id) &&
          x.title?.trim().toLowerCase() === p.title?.trim().toLowerCase()
        );
        // Also check published PDFs in the global PDFS array
        const publishedSame = (global.PDFS || []).filter(x =>
          String(x.id) !== String(p.id) &&
          x.title?.trim().toLowerCase() === p.title?.trim().toLowerCase()
        );
        return same.length === 0 && publishedSame.length === 0;
      },
      failMsg: 'A PDF with this exact title already exists in the library.',
    },
    {
      id:'dupePDF', label:'Duplicate PDF URL', required:false, warn:true,
      async:true,
      asyncFn: async (p, allPdfs) => {
        if (!p.pdf_url && !p.file_url) return true;
        const url = p.pdf_url || p.file_url;
        const same = allPdfs.filter(x =>
          String(x.id) !== String(p.id) &&
          ((x.pdf_url || x.file_url) === url)
        );
        const publishedSame = (global.PDFS || []).filter(x =>
          String(x.id) !== String(p.id) &&
          ((x.pdf_url || x.file_url) === url)
        );
        return same.length === 0 && publishedSame.length === 0;
      },
      failMsg: 'Another PDF already uses this same file URL.',
    },
  ];

  async function spmValidate(pdf, allPdfs) {
    const cacheKey = String(pdf.id) + ':' + (pdf.updated_at || '');
    if (SPM.validationCache[cacheKey]) return SPM.validationCache[cacheKey];

    const errors = [];
    let blockingFail = false;

    for (const rule of VALIDATION_CHECKS) {
      let pass = true;
      try {
        pass = rule.async
          ? await rule.asyncFn(pdf, allPdfs || SPM.pdfs)
          : rule.check(pdf);
      } catch(e) { pass = false; }

      const isRequired = rule.required && !rule.warn;
      errors.push({
        id:      rule.id,
        label:   rule.label,
        pass,
        warn:    !!(rule.warn && !pass),
        fail:    !pass && isRequired,
        failMsg: !pass ? rule.failMsg : null,
        msg:     pass ? '✓ OK' : (rule.warn ? '⚠ Recommended' : '✗ Required'),
      });
      if (!pass && isRequired) blockingFail = true;
    }

    const result = { ok: !blockingFail, errors };
    SPM.validationCache[cacheKey] = result;
    // Also store by id for quick invalidation
    SPM.validationCache[String(pdf.id)] = result;
    return result;
  }

  function spmInvalidateCache(id) {
    const key = String(id);
    // Remove any cache entries that start with this id
    Object.keys(SPM.validationCache).forEach(k => {
      if (k === key || k.startsWith(key + ':')) delete SPM.validationCache[k];
    });
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 3 — AUTO GENERATE FIELDS
  ───────────────────────────────────────────────────────────────── */

  function spmGenerateSlug(title) {
    if (typeof generateSlug === 'function') return generateSlug(title);
    return (title || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
  }

  function spmNow() { return new Date().toISOString(); }

  function spmAutoFillFields(pdf) {
    const out = { ...pdf };
    if (!out.slug) out.slug = spmGenerateSlug(pdf.title || '');
    if (!out.published_at) out.published_at = spmNow();
    out.updated_at = spmNow();
    return out;
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 4 — PDF UPLOAD (Single / Multiple / Bulk / Drag-Drop)
  ───────────────────────────────────────────────────────────────── */

  async function spmUploadPDF(file, onProgress) {
    const sb = global.supabaseClient;
    if (!sb) { spmToast('Supabase not connected', 'error'); return null; }

    const safeName = file.name.replace(/[^a-z0-9._-]/gi, '_');
    const path     = `uploads/${Date.now()}_${safeName}`;

    try {
      onProgress?.('uploading');
      let pdf_url = '';

      const { data: storageData, error: storageErr } = await sb.storage
        .from('pdfs')
        .upload(path, file, { cacheControl: '3600', upsert: false });

      if (!storageErr && storageData) {
        const { data: urlData } = sb.storage.from('pdfs').getPublicUrl(path);
        pdf_url = urlData?.publicUrl || '';
      } else {
        console.warn('SPM storage upload skipped:', storageErr?.message);
      }

      const titleFromFile = file.name
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim();

      const payload = {
        title:      titleFromFile || 'Untitled PDF',
        status:     'draft',
        pdf_url:    pdf_url || null,
        file_url:   pdf_url || null,
        created_at: spmNow(),
        updated_at: spmNow(),
      };

      const { data: rowData, error: rowErr } = await sb
        .from('pdfs')
        .insert(payload)
        .select()
        .single();

      if (rowErr) throw rowErr;

      onProgress?.('done');
      return rowData;
    } catch(e) {
      console.warn('SPM upload error:', e);
      onProgress?.('error');
      return null;
    }
  }

  function spmQueueFiles(files) {
    const arr = Array.from(files).filter(
      f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (!arr.length) { spmToast('No PDF files detected', 'warning'); return; }

    arr.forEach(f => SPM.uploadQueue.push({
      file:   f,
      status: 'pending',
      id:     Math.random().toString(36).slice(2),
    }));
    spmRenderUploadList();
    if (!SPM.uploading) spmRunUploadWorker();
  }

  async function spmRunUploadWorker() {
    SPM.uploading = true;
    let successCount = 0;

    while (SPM.uploadQueue.some(q => q.status === 'pending')) {
      const item = SPM.uploadQueue.find(q => q.status === 'pending');
      if (!item) break;
      item.status = 'uploading';
      spmRenderUploadList();

      const row = await spmUploadPDF(item.file, (status) => {
        item.status = status;
        spmRenderUploadList();
      });

      if (row) {
        item.status = 'done';
        successCount++;
        SPM.pdfs.unshift(row);
        spmInvalidateCache(row.id);
      } else {
        item.status = 'error';
      }
      spmRenderUploadList();
    }

    SPM.uploading = false;
    spmRender();
    if (successCount > 0) {
      spmToast(`✅ ${successCount} PDF${successCount > 1 ? 's' : ''} uploaded as Draft`, 'success');
      if (typeof logAdminActivity === 'function')
        logAdminActivity(`${successCount} PDF(s) uploaded as Draft via SPM`, 'blue');
    } else {
      spmToast('Upload failed — check console', 'error');
    }
  }

  function spmRenderUploadList() {
    const el = document.getElementById('spmUploadList');
    if (!el || !SPM.uploadQueue.length) return;

    const done  = SPM.uploadQueue.filter(q => q.status === 'done').length;
    const total = SPM.uploadQueue.length;
    const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

    el.innerHTML = SPM.uploadQueue.slice(-30).map(q => `
      <div class="spm-upload-item">
        <span style="font-size:.9rem">${
          q.status === 'done'      ? '✅' :
          q.status === 'error'     ? '❌' :
          q.status === 'uploading' ? '⏳' : '📄'
        }</span>
        <span class="spm-upload-item-name">${_safeEsc(q.file.name)}</span>
        <span class="spm-upload-item-size">${_fmtSize(q.file.size)}</span>
        <span class="spm-upload-item-status spm-ustat-${q.status}">${q.status}</span>
      </div>`).join('') +
      (total > 1 ? `
        <div class="spm-upload-progress">
          <div class="spm-upload-progress-bar" style="width:${pct}%"></div>
        </div>
        <div style="font-size:.71rem;color:var(--text2,#94a3b8);text-align:right;margin-top:4px">${done}/${total} files</div>
      ` : '');
  }

  function _fmtSize(bytes) {
    if (bytes < 1024)         return bytes + ' B';
    if (bytes < 1024 * 1024)  return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 5 — AI SUGGESTIONS
  ───────────────────────────────────────────────────────────────── */

  async function spmGetAISuggestions(pdf) {
    const cacheKey = String(pdf.id) + ':ai';
    if (SPM.aiCache[cacheKey]) return SPM.aiCache[cacheKey];

    const prompt = `You are Studyria's AI publishing assistant for an Indian student exam prep platform (JEE, NEET, UPSC, ADRE, APSC, Assam focus).

Analyze this PDF metadata and return publishing suggestions.

PDF Metadata:
Title: ${pdf.title || 'Unknown'}
Description: ${(pdf.description || pdf.preview || '').slice(0, 500)}
Category: ${pdf.category || ''}
Current Price: ${pdf.price ?? pdf.selling_price ?? 0}
Original Price: ${pdf.original_price ?? ''}
Author: ${pdf.author || ''}

Return ONLY valid JSON (no markdown, no backticks, no extra text):
{
  "badge": "one of: New|Hot|Trending|Bestseller|Free|Limited|Sale|Premium",
  "category": "best category for Indian exam prep students",
  "tags": "6-8 comma-separated SEO keywords relevant to Indian students",
  "seo_title": "SEO optimized title under 60 chars",
  "meta_description": "compelling meta description under 155 chars",
  "selling_price": 0,
  "slug": "url-friendly-slug-max-60-chars",
  "price_reasoning": "one sentence explanation of suggested price"
}`;

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 600,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!resp.ok) throw new Error(`AI API ${resp.status}`);
      const data = await resp.json();
      const raw  = (data.content || []).map(b => b.text || '').join('');
      const clean = raw.replace(/```json|```/g, '').trim();
      const s = JSON.parse(clean);
      SPM.aiCache[cacheKey] = s;
      return s;
    } catch(e) {
      console.warn('SPM AI failed:', e);
      // Graceful fallback
      return {
        badge:            pdf.free ? 'Free' : 'New',
        category:         pdf.category || '',
        tags:             pdf.seo_keywords || '',
        seo_title:        (pdf.seo_title || pdf.title || '').slice(0, 60),
        meta_description: (pdf.seo_description || pdf.description || '').slice(0, 155),
        selling_price:    pdf.price ?? pdf.selling_price ?? 0,
        slug:             spmGenerateSlug(pdf.title || ''),
        price_reasoning:  'Based on existing price data.',
      };
    }
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 6 — BULK OPERATIONS
  ───────────────────────────────────────────────────────────────── */

  async function spmBulkUpdateStatus(ids, status, label) {
    if (!ids.length) { spmToast('No PDFs selected', 'info'); return 0; }
    const sb = global.supabaseClient;
    if (!sb) { spmToast('Supabase not connected', 'error'); return 0; }

    let success = 0;
    for (const id of ids) {
      try {
        const { error } = await sb
          .from('pdfs')
          .update({ status, updated_at: spmNow() })
          .eq('id', id);
        if (!error) {
          success++;
          spmInvalidateCache(id);
          const p = SPM.pdfs.find(x => String(x.id) === String(id));
          if (p) p.status = status;
        }
      } catch(e) { /* continue */ }
    }

    spmToast(`✅ ${success}/${ids.length} PDFs ${label}`, 'success');
    if (typeof logAdminActivity === 'function')
      logAdminActivity(`Bulk ${label}: ${success} PDFs`, 'blue');
    return success;
  }

  async function spmBulkDelete(ids) {
    if (!ids.length) { spmToast('No PDFs selected', 'info'); return; }
    if (!confirm(`⚠️ Delete ${ids.length} PDF(s) permanently?\n\nThis cannot be undone.`)) return;
    const sb = global.supabaseClient;
    if (!sb) { spmToast('Supabase not connected', 'error'); return; }

    let success = 0;
    for (const id of ids) {
      const { error } = await sb.from('pdfs').delete().eq('id', id);
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
    if (typeof logAdminActivity === 'function')
      logAdminActivity(`Bulk deleted ${success} PDFs`, 'red');
    spmRender();
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 7 — SMART PUBLISH FLOW
  ───────────────────────────────────────────────────────────────── */

  async function spmStartPublish(ids) {
    if (!ids.length) { spmToast('Select at least one PDF', 'info'); return; }

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
    const sb = global.supabaseClient;
    if (!sb) { spmToast('Supabase not connected', 'error'); return; }

    const startTime  = Date.now();
    const undoData   = [];
    const published  = [];
    let   errors     = 0;

    spmShowLoader('Publishing…');

    for (const id of readyIds) {
      const pdf = SPM.pdfs.find(p => String(p.id) === String(id));
      if (!pdf) continue;

      undoData.push({ id, prev: { status: pdf.status, updated_at: pdf.updated_at } });
      const enriched = spmAutoFillFields(pdf);
      const edits    = aiEdits?.[id] || {};

      const payload = {
        status:          'published',
        slug:            edits.slug            || enriched.slug,
        badge:           edits.badge           || pdf.badge           || null,
        seo_title:       edits.seo_title       || pdf.seo_title       || null,
        seo_description: edits.meta_description|| pdf.seo_description || null,
        seo_keywords:    edits.tags            || pdf.seo_keywords    || null,
        selling_price:   edits.selling_price !== undefined
                          ? Number(edits.selling_price)
                          : (pdf.price ?? 0),
        price:           edits.selling_price !== undefined
                          ? Number(edits.selling_price)
                          : (pdf.price ?? 0),
        updated_at:      spmNow(),
        published_at:    enriched.published_at || spmNow(),
      };

      try {
        const { error } = await sb.from('pdfs').update(payload).eq('id', id);
        if (error) throw error;
        Object.assign(pdf, payload);
        published.push({ ...pdf, ...payload });
        spmInvalidateCache(id);
      } catch(e) {
        errors++;
        console.warn('SPM publish error:', id, e);
      }
    }

    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);

    // Push undo entry
    if (undoData.length) {
      SPM.undoStack.push({ ids: readyIds, undoData, timestamp: Date.now() });
      setTimeout(() => {
        SPM.undoStack = SPM.undoStack.filter(x => Date.now() - x.timestamp < UNDO_TTL_MS);
      }, UNDO_TTL_MS + 1000);
    }

    SPM.lastReport = {
      published: published.length,
      errors,
      timeTaken,
      total: readyIds.length,
    };

    // ── Auto-move: remove published PDFs from Draft Queue ──────────
    const publishedIds = new Set(published.map(p => String(p.id)));
    SPM.pdfs = SPM.pdfs.filter(p => !publishedIds.has(String(p.id)));
    SPM.selected.clear();

    // ── Add to global PDFS (Published Library) ─────────────────────
    if (global.PDFS) {
      published.forEach(row => {
        const idx = global.PDFS.findIndex(p => String(p.id) === String(row.id));
        if (idx >= 0) Object.assign(global.PDFS[idx], row);
        else global.PDFS.unshift(row);
      });
    }

    // ── Trigger subscriber notifications via supabase.js hook ──────
    if (typeof global.spmOnPublishSuccess === 'function' && published.length) {
      global.spmOnPublishSuccess(published).catch(() => {});
    }

    // ── Re-render public library if it's currently open ────────────
    if (typeof global.renderLibGrid === 'function') {
      setTimeout(global.renderLibGrid, 300);
    }

    spmHideLoader();
    if (typeof logAdminActivity === 'function')
      logAdminActivity(`Smart Publish: ${published.length} published, ${errors} failed`, 'green');
    spmRender();
    spmShowReport(SPM.lastReport);
  }

  async function spmUndoPublish() {
    const entry = SPM.undoStack[SPM.undoStack.length - 1];
    if (!entry) { spmToast('Nothing to undo', 'info'); return; }
    if (Date.now() - entry.timestamp > UNDO_TTL_MS) {
      spmToast('Undo window expired (5 min limit)', 'info');
      return;
    }
    if (!confirm(`Undo publish for ${entry.ids.length} PDF(s)?\nThey will be set back to Draft.`)) return;

    let undone = 0;
    for (const { id, prev } of entry.undoData) {
      const { error } = await global.supabaseClient.from('pdfs').update({
        status: prev.status || 'draft', updated_at: spmNow(),
      }).eq('id', id);

      if (!error) {
        undone++;
        // Re-fetch the row and add back to draft queue
        try {
          const { data } = await global.supabaseClient
            .from('pdfs').select('*').eq('id', id).single();
          if (data) {
            SPM.pdfs.unshift(data);
            // Remove from global PDFS (published library)
            if (global.PDFS) {
              const idx = global.PDFS.findIndex(p => String(p.id) === String(id));
              if (idx > -1) global.PDFS.splice(idx, 1);
            }
          }
        } catch(_) {}
        spmInvalidateCache(id);
      }
    }

    SPM.undoStack.pop();
    spmToast(`↩ Undone: ${undone} PDFs reverted to Draft`, 'success');
    if (typeof logAdminActivity === 'function')
      logAdminActivity(`Undo Publish: ${undone} PDFs reverted`, 'yellow');
    spmRender();
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 8 — MODALS
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

  async function spmShowValidationDetail(id) {
    const pdf = SPM.pdfs.find(p => String(p.id) === String(id));
    if (!pdf) return;
    spmShowLoader('Validating…');
    const result = await spmValidate(pdf, SPM.pdfs);
    spmHideLoader();

    const rows = result.errors.map(e => `
      <div class="spm-val-err-item ${e.fail ? 'fail' : e.warn ? 'warn' : 'pass'}">
        <span style="font-size:.85rem;flex-shrink:0">${e.fail ? '✗' : e.warn ? '⚠' : '✓'}</span>
        <div style="flex:1">
          <div style="font-weight:700;font-size:.78rem">${_safeEsc(e.label)}</div>
          ${!e.pass && e.failMsg
            ? `<div style="font-size:.72rem;opacity:.8;margin-top:2px">${_safeEsc(e.failMsg)}</div>`
            : ''}
        </div>
        <span style="font-size:.7rem;opacity:.65;white-space:nowrap">${e.msg}</span>
      </div>`).join('');

    spmOpenModal(`
      <div class="spm-modal">
        <button class="spm-modal-close" onclick="window._SPM._closeModal()">✕</button>
        <div class="spm-modal-title">🔍 Validation Report</div>
        <div class="spm-modal-sub">${_safeEsc(pdf.title || 'Untitled')}</div>
        <div>${rows}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap">
          <button class="spm-btn spm-btn-ghost" onclick="window._SPM._closeModal()">Close</button>
          ${result.ok
            ? `<button class="spm-btn spm-btn-success" onclick="window._SPM._publishOne('${id}')">🚀 Publish Now</button>`
            : `<button class="spm-btn spm-btn-primary" onclick="window._SPM._editDraft('${id}')">✏️ Fix &amp; Edit Draft</button>`}
        </div>
      </div>`);
  }

  async function spmShowAISuggest(id) {
    const pdf = SPM.pdfs.find(p => String(p.id) === String(id));
    if (!pdf) return;

    spmOpenModal(`
      <div class="spm-modal">
        <button class="spm-modal-close" onclick="window._SPM._closeModal()">✕</button>
        <div class="spm-modal-title">🤖 AI Suggestions</div>
        <div class="spm-modal-sub">Generating for: <em>${_safeEsc(pdf.title || 'Untitled')}</em></div>
        <div style="text-align:center;padding:30px 0">
          <div class="spm-spinner" style="width:32px;height:32px;border-width:3px"></div>
          <div style="margin-top:10px;font-size:.8rem;color:var(--text2,#94a3b8)">Asking AI…</div>
        </div>
      </div>`);

    const s = await spmGetAISuggestions(pdf);

    spmOpenModal(`
      <div class="spm-modal spm-modal-lg">
        <button class="spm-modal-close" onclick="window._SPM._closeModal()">✕</button>
        <div class="spm-modal-title">🤖 AI Suggestions</div>
        <div class="spm-modal-sub">Review and edit all fields before applying · <em>${_safeEsc(pdf.title || '')}</em></div>
        <div class="spm-ai-panel">
          <div class="spm-ai-label">✨ AI Generated — All fields are editable</div>
          <div class="spm-ai-grid">
            <div class="spm-ai-field">
              <label>Badge</label>
              <select id="spmAiBadge" class="spm-ai-input">
                ${['New','Hot','Trending','Bestseller','Free','Limited','Sale','Premium']
                  .map(b => `<option value="${b}" ${s.badge === b ? 'selected' : ''}>${b}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="spm-ai-field">
              <label>Category</label>
              <input id="spmAiCat" class="spm-ai-input" value="${_safeEsc(s.category || '')}"/>
            </div>
            <div class="spm-ai-field">
              <label>SEO Title <span style="opacity:.5;font-size:.66rem">(max 60 chars)</span></label>
              <input id="spmAiSeoTitle" class="spm-ai-input" maxlength="60" value="${_safeEsc(s.seo_title || '')}"/>
            </div>
            <div class="spm-ai-field">
              <label>Slug</label>
              <input id="spmAiSlug" class="spm-ai-input" value="${_safeEsc(s.slug || '')}"/>
            </div>
            <div class="spm-ai-field">
              <label>Selling Price (₹)</label>
              <input id="spmAiPrice" type="number" min="0" class="spm-ai-input" value="${s.selling_price || 0}"/>
            </div>
            <div class="spm-ai-field" style="align-self:end">
              <label style="opacity:.6">Price Reasoning</label>
              <div style="font-size:.72rem;color:var(--text2,#94a3b8);padding:8px 0">${_safeEsc(s.price_reasoning || '')}</div>
            </div>
          </div>
          <div class="spm-ai-field">
            <label>Tags / Keywords <span style="opacity:.5;font-size:.66rem">(comma separated)</span></label>
            <input id="spmAiTags" class="spm-ai-input" value="${_safeEsc(s.tags || '')}"/>
          </div>
          <div class="spm-ai-field">
            <label>Meta Description <span style="opacity:.5;font-size:.66rem">(max 155 chars)</span></label>
            <textarea id="spmAiMetaDesc" class="spm-ai-input" rows="2" maxlength="155">${_safeEsc(s.meta_description || '')}</textarea>
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="spm-btn spm-btn-ghost" onclick="window._SPM._closeModal()">Discard</button>
          <button class="spm-btn spm-btn-primary" onclick="window._SPM._applyAI('${id}')">✅ Apply &amp; Publish</button>
        </div>
      </div>`);
  }

  function spmShowPublishPreview(reports, readyIds, failedIds) {
    const failedReports = reports.filter(r => !r.result.ok);
    const blockingErrors = reports.flatMap(r => r.result.errors.filter(e => e.fail));

    // Unique blocking errors across all selected PDFs
    const uniqueErrors = [...new Map(blockingErrors.map(e => [e.id, e])).values()];

    const errSection = uniqueErrors.length ? `
      <div style="margin-bottom:14px">
        <div style="font-size:.78rem;font-weight:700;color:#ef4444;margin-bottom:8px">⛔ Blocking Validation Errors</div>
        ${uniqueErrors.map(e => `
          <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:.77rem">
            <span style="color:#ef4444;flex-shrink:0">✗</span>
            <div>
              <strong>${_safeEsc(e.label)}</strong>
              ${e.failMsg ? `<div style="opacity:.75;margin-top:1px;font-size:.72rem">${_safeEsc(e.failMsg)}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>` : '';

    const failedSection = failedReports.length ? `
      <div style="margin-bottom:14px">
        <div style="font-size:.76rem;color:var(--text2,#94a3b8);margin-bottom:6px">
          ✗ Failed PDFs (${failedReports.length}) — fix errors to include:
        </div>
        ${failedReports.map(r => `
          <div style="font-size:.76rem;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)">
            ${_safeEsc(r.pdf.title || 'Untitled')}
          </div>`).join('')}
      </div>` : '';

    spmOpenModal(`
      <div class="spm-modal">
        <button class="spm-modal-close" onclick="window._SPM._closeModal()">✕</button>
        <div class="spm-modal-title">📋 Publish Preview</div>
        <div class="spm-modal-sub">Review validation results before confirming publish</div>
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
        ${errSection}${failedSection}
        ${readyIds.length === 0
          ? `<div style="text-align:center;color:#ef4444;font-size:.83rem;padding:10px 0;border:1px solid rgba(239,68,68,.2);border-radius:10px;background:rgba(239,68,68,.05)">
               ⛔ No valid PDFs to publish. Fix the errors listed above first.
             </div>`
          : ''}
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px">
          <button class="spm-btn spm-btn-ghost" onclick="window._SPM._closeModal()">Cancel</button>
          ${readyIds.length > 0
            ? `<button class="spm-btn spm-btn-success" onclick="window._SPM._confirmPublish(${JSON.stringify(readyIds)})">
                 🚀 Publish ${readyIds.length} PDF${readyIds.length > 1 ? 's' : ''}
               </button>`
            : ''}
        </div>
      </div>`);
  }

  function spmShowReport(report) {
    const undoEntry = SPM.undoStack[SPM.undoStack.length - 1];
    const canUndo   = undoEntry && (Date.now() - undoEntry.timestamp < UNDO_TTL_MS);

    spmOpenModal(`
      <div class="spm-modal">
        <button class="spm-modal-close" onclick="window._SPM._closeModal()">✕</button>
        <div class="spm-modal-title">✅ Publish Report</div>
        <div class="spm-modal-sub">Completed in ${report.timeTaken}s · ${report.total} PDFs processed</div>
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
        ${report.published > 0
          ? `<div style="font-size:.78rem;color:var(--text2,#94a3b8);margin-bottom:14px">
               ✨ ${report.published} PDF${report.published > 1 ? 's' : ''} moved to Published Library automatically
             </div>`
          : ''}
        ${canUndo ? `
          <div class="spm-undo-bar">
            <span class="spm-undo-bar-msg">⏱ Undo window — revert all ${report.published} publish actions</span>
            <span id="spmUndoTimerLabel" class="spm-undo-timer">5:00</span>
            <button class="spm-btn spm-btn-warning spm-btn-sm" onclick="window._SPM._undo()">↩ Undo</button>
          </div>` : ''}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
          <button class="spm-btn spm-btn-ghost" onclick="window._SPM._closeModal()">Close</button>
        </div>
      </div>`);

    if (canUndo) spmStartUndoTimer(undoEntry.timestamp);
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 8B — EDIT DRAFT MODAL
     All fields editable: Cover, Title, Description, Category, Author,
     Language, Original Price, Selling Price, Badge, Tags, SEO Title,
     Meta Description, Preview Pages.
     Saves as Draft. Validation ONLY on Publish.
  ───────────────────────────────────────────────────────────────── */

  const BADGE_OPTIONS = ['','New','Hot','Trending','Bestseller','Free','Limited','Sale','Premium'];
  const LANGUAGE_OPTIONS = ['English','Hindi','Assamese','Bengali','Tamil','Telugu','Kannada','Malayalam','Marathi','Gujarati','Punjabi','Odia','Urdu'];

  async function spmShowEditModal(id) {
    const pdf = SPM.pdfs.find(p => String(p.id) === String(id));
    if (!pdf) return;

    const coverSrc = pdf.cover_url || pdf.cover_image || '';
    const coverPreview = coverSrc
      ? `<img id="spmEditCoverPreview" src="${_safeEsc(coverSrc)}" class="spm-cover-preview-img"
            onerror="this.style.display='none';document.getElementById('spmEditCoverPh').style.display='flex'"/><div id="spmEditCoverPh" class="spm-cover-preview-ph" style="display:none">📄</div>`
      : `<div id="spmEditCoverPh" class="spm-cover-preview-ph">📄</div>`;

    const badgeOpts = BADGE_OPTIONS.map(b =>
      `<option value="${b}" ${(pdf.badge || '') === b ? 'selected' : ''}>${b || '— None —'}</option>`
    ).join('');

    const langOpts = LANGUAGE_OPTIONS.map(l =>
      `<option value="${l}" ${(pdf.language || 'English') === l ? 'selected' : ''}>${l}</option>`
    ).join('');

    spmOpenModal(`
      <div class="spm-modal spm-modal-lg" style="max-width:860px">
        <button class="spm-modal-close" onclick="window._SPM._closeModal()">✕</button>
        <div class="spm-modal-title">✏️ Edit Draft</div>
        <div class="spm-modal-sub" style="display:flex;align-items:center;gap:10px">
          <span>${_safeEsc(pdf.title || 'Untitled PDF')}</span>
          <span class="spm-draft-saved" id="spmDraftSavedMsg">✅ Draft saved</span>
        </div>

        <!-- Cover -->
        <div class="spm-edit-section-head">🖼 Cover Image</div>
        <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:16px">
          <div class="spm-cover-preview-wrap" style="flex-shrink:0">${coverPreview}</div>
          <div style="flex:1">
            <label class="spm-edit-label">Cover Image URL <span class="spm-req">*</span></label>
            <input id="spmEditCoverUrl" class="spm-edit-input" placeholder="https://…/cover.jpg"
              value="${_safeEsc(coverSrc)}"
              oninput="window._SPM._previewCover(this.value)"/>
            <div style="font-size:.7rem;color:var(--text2,#94a3b8);margin-top:5px">Paste a public image URL or Supabase storage URL</div>
          </div>
        </div>

        <!-- Basic Info -->
        <div class="spm-edit-section-head">📝 Basic Information</div>
        <div class="spm-edit-grid">
          <div class="spm-edit-field full-width">
            <label class="spm-edit-label">Title <span class="spm-req">*</span></label>
            <input id="spmEditTitle" class="spm-edit-input" placeholder="PDF title…"
              value="${_safeEsc(pdf.title || '')}"/>
          </div>
          <div class="spm-edit-field">
            <label class="spm-edit-label">Author <span class="spm-opt">(optional)</span></label>
            <input id="spmEditAuthor" class="spm-edit-input" placeholder="Author name…"
              value="${_safeEsc(pdf.author || '')}"/>
          </div>
          <div class="spm-edit-field">
            <label class="spm-edit-label">Language</label>
            <select id="spmEditLanguage" class="spm-edit-input">${langOpts}</select>
          </div>
          <div class="spm-edit-field full-width">
            <label class="spm-edit-label">Description <span class="spm-req">*</span></label>
            <textarea id="spmEditDescription" class="spm-edit-input spm-edit-textarea"
              placeholder="Describe this PDF — what it covers, who it's for…">${_safeEsc(pdf.description || pdf.preview || '')}</textarea>
          </div>
          <div class="spm-edit-field">
            <label class="spm-edit-label">Category <span class="spm-req">*</span></label>
            <input id="spmEditCategory" class="spm-edit-input" placeholder="e.g. JEE, NEET, UPSC…"
              value="${_safeEsc(pdf.category || '')}"/>
          </div>
          <div class="spm-edit-field">
            <label class="spm-edit-label">Badge <span class="spm-opt">(recommended)</span></label>
            <select id="spmEditBadge" class="spm-edit-input">${badgeOpts}</select>
          </div>
        </div>

        <!-- Pricing -->
        <div class="spm-edit-section-head">💰 Pricing</div>
        <div class="spm-edit-grid">
          <div class="spm-edit-field">
            <label class="spm-edit-label">Original Price (₹) <span class="spm-opt">MRP</span></label>
            <input id="spmEditOrigPrice" type="number" min="0" class="spm-edit-input"
              placeholder="0" value="${pdf.original_price ?? ''}"/>
          </div>
          <div class="spm-edit-field">
            <label class="spm-edit-label">Selling Price (₹) <span class="spm-req">*</span></label>
            <input id="spmEditPrice" type="number" min="0" class="spm-edit-input"
              placeholder="0 = Free" value="${pdf.price ?? pdf.selling_price ?? 0}"/>
          </div>
        </div>

        <!-- SEO & Tags -->
        <div class="spm-edit-section-head">🔍 SEO & Tags</div>
        <div class="spm-edit-grid">
          <div class="spm-edit-field full-width">
            <label class="spm-edit-label">Tags / Keywords <span class="spm-opt">comma separated · recommended</span></label>
            <input id="spmEditTags" class="spm-edit-input"
              placeholder="JEE chemistry, organic chemistry notes, NEET prep…"
              value="${_safeEsc(pdf.seo_keywords || '')}"/>
          </div>
          <div class="spm-edit-field full-width">
            <label class="spm-edit-label">SEO Title <span class="spm-opt">max 60 chars · recommended</span></label>
            <input id="spmEditSeoTitle" class="spm-edit-input" maxlength="60"
              placeholder="SEO optimised title…"
              value="${_safeEsc(pdf.seo_title || '')}"/>
          </div>
          <div class="spm-edit-field full-width">
            <label class="spm-edit-label">Meta Description <span class="spm-opt">max 155 chars · recommended</span></label>
            <textarea id="spmEditMetaDesc" class="spm-edit-input spm-edit-textarea" maxlength="155"
              placeholder="Compelling 1–2 sentence description for search engines…"
              rows="2">${_safeEsc(pdf.seo_description || pdf.seo_desc || '')}</textarea>
          </div>
        </div>

        <!-- Preview Pages -->
        <div class="spm-edit-section-head">👁 Preview Pages</div>
        <div class="spm-edit-field" style="margin-bottom:20px">
          <label class="spm-edit-label">Preview PDF URL <span class="spm-opt">recommended</span></label>
          <input id="spmEditPreviewUrl" class="spm-edit-input"
            placeholder="https://…/preview.pdf"
            value="${_safeEsc(pdf.preview_pdf_url || pdf.preview_url || pdf.previewUrl || '')}"/>
          <div style="font-size:.7rem;color:var(--text2,#94a3b8);margin-top:5px">A shorter preview version of the PDF (first few pages)</div>
        </div>

        <!-- Slug -->
        <div class="spm-edit-section-head">🔗 URL Slug</div>
        <div class="spm-edit-field" style="margin-bottom:20px">
          <label class="spm-edit-label">Slug <span class="spm-opt">auto-generated from title if left blank</span></label>
          <input id="spmEditSlug" class="spm-edit-input"
            placeholder="url-friendly-slug"
            value="${_safeEsc(pdf.slug || '')}"/>
        </div>

        <!-- Actions -->
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;border-top:1px solid rgba(255,255,255,.06);padding-top:16px">
          <button class="spm-btn spm-btn-ghost" onclick="window._SPM._closeModal()">Cancel</button>
          <button class="spm-btn spm-btn-ghost" onclick="window._SPM._aiSuggestInEdit('${id}')">🤖 AI Fill</button>
          <button class="spm-btn spm-btn-primary" onclick="window._SPM._saveDraft('${id}')">💾 Save Draft</button>
          <button class="spm-btn spm-btn-success" onclick="window._SPM._saveAndPublish('${id}')">🚀 Save &amp; Publish</button>
        </div>
      </div>`);
  }

  async function spmSaveDraft(id, closeAfter = false) {
    const sb = global.supabaseClient;
    const pdf = SPM.pdfs.find(p => String(p.id) === String(id));
    if (!pdf) return false;

    const title      = document.getElementById('spmEditTitle')?.value.trim()       || pdf.title || '';
    const coverUrl   = document.getElementById('spmEditCoverUrl')?.value.trim()    || '';
    const author     = document.getElementById('spmEditAuthor')?.value.trim()      || '';
    const language   = document.getElementById('spmEditLanguage')?.value           || 'English';
    const description= document.getElementById('spmEditDescription')?.value.trim() || '';
    const category   = document.getElementById('spmEditCategory')?.value.trim()    || '';
    const badge      = document.getElementById('spmEditBadge')?.value              || '';
    const origPrice  = document.getElementById('spmEditOrigPrice')?.value;
    const price      = document.getElementById('spmEditPrice')?.value;
    const tags       = document.getElementById('spmEditTags')?.value.trim()        || '';
    const seoTitle   = document.getElementById('spmEditSeoTitle')?.value.trim()    || '';
    const metaDesc   = document.getElementById('spmEditMetaDesc')?.value.trim()    || '';
    const previewUrl = document.getElementById('spmEditPreviewUrl')?.value.trim()  || '';
    const slug       = document.getElementById('spmEditSlug')?.value.trim()        || spmGenerateSlug(title);

    const sellingPrice = price !== '' && price !== null ? parseFloat(price) : (pdf.price ?? pdf.selling_price ?? 0);
    const originalPrice= origPrice !== '' && origPrice !== null ? parseFloat(origPrice) : (pdf.original_price ?? null);

    const payload = {
      title,
      cover_url:       coverUrl || null,
      cover_image:     coverUrl || null,
      author:          author   || null,
      language,
      description,
      preview:         description,
      category:        category || null,
      badge:           badge    || null,
      original_price:  isNaN(originalPrice) ? null : originalPrice,
      price:           sellingPrice,
      selling_price:   sellingPrice,
      free:            sellingPrice === 0,
      seo_keywords:    tags     || null,
      seo_title:       seoTitle || null,
      seo_description: metaDesc || null,
      preview_pdf_url: previewUrl || null,
      slug:            slug     || null,
      status:          pdf.status || 'draft',
      updated_at:      spmNow(),
    };

    // Update in-memory
    Object.assign(pdf, payload);
    spmInvalidateCache(id);

    // Persist to Supabase if available
    if (sb) {
      try {
        const { error } = await sb.from('pdfs').update(payload).eq('id', id);
        if (error) throw error;
      } catch(e) {
        console.warn('SPM saveDraft error:', e);
        spmToast('⚠ Draft saved locally but DB update failed', 'warning');
        if (closeAfter) { spmCloseModal(); spmRender(); }
        return false;
      }
    }

    // Show saved feedback
    const msg = document.getElementById('spmDraftSavedMsg');
    if (msg) { msg.classList.add('show'); setTimeout(() => msg.classList.remove('show'), 2500); }

    spmRender();
    if (closeAfter) spmCloseModal();
    return true;
  }

  /* Cover URL live preview inside edit modal */
  function spmPreviewCover(url) {
    const img = document.getElementById('spmEditCoverPreview');
    const ph  = document.getElementById('spmEditCoverPh');
    if (!url) {
      if (img) img.style.display = 'none';
      if (ph)  ph.style.display  = 'flex';
      return;
    }
    if (!img) {
      // Create image element dynamically
      const newImg = document.createElement('img');
      newImg.id = 'spmEditCoverPreview';
      newImg.className = 'spm-cover-preview-img';
      newImg.onerror = () => { newImg.style.display='none'; if(ph) ph.style.display='flex'; };
      newImg.onload  = () => { if(ph) ph.style.display='none'; };
      newImg.src = url;
      if (ph) ph.parentNode.insertBefore(newImg, ph);
    } else {
      img.src = url;
      img.style.display = 'block';
      img.onerror = () => { img.style.display='none'; if(ph) ph.style.display='flex'; };
      if (ph) ph.style.display = 'none';
    }
  }

  /* AI fill inside edit modal — fills form fields without closing */
  async function spmAISuggestInEdit(id) {
    const pdf = SPM.pdfs.find(p => String(p.id) === String(id));
    if (!pdf) return;

    // Snapshot current title from the form
    const titleEl = document.getElementById('spmEditTitle');
    if (titleEl?.value) pdf.title = titleEl.value.trim();

    spmToast('🤖 Asking AI…', 'info');
    const s = await spmGetAISuggestions(pdf);

    const set = (elId, val) => { const el = document.getElementById(elId); if (el && val) el.value = val; };
    set('spmEditBadge',    s.badge);
    set('spmEditCategory', s.category);
    set('spmEditSeoTitle', s.seo_title);
    set('spmEditSlug',     s.slug);
    set('spmEditTags',     s.tags);
    const mdEl = document.getElementById('spmEditMetaDesc');
    if (mdEl && s.meta_description) mdEl.value = s.meta_description;
    if (s.selling_price !== undefined) set('spmEditPrice', s.selling_price);
    spmToast('✅ AI suggestions filled — review and save', 'success');
  }



  function spmStartUndoTimer(startTs) {
    const interval = setInterval(() => {
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
      el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }, 1000);
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 10 — LOADER & TOAST
  ───────────────────────────────────────────────────────────────── */

  function spmShowLoader(msg) {
    spmCloseModal();
    const overlay = document.createElement('div');
    overlay.id = 'spmLoaderOverlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9001;' +
      'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px';
    overlay.innerHTML = `
      <div class="spm-spinner" style="width:40px;height:40px;border-width:4px"></div>
      <div style="color:#e2e8f0;font-size:.85rem">${_safeEsc(msg)}</div>`;
    document.body.appendChild(overlay);
  }

  function spmHideLoader() {
    const el = document.getElementById('spmLoaderOverlay');
    if (el) el.remove();
  }

  function spmToast(msg, type) {
    if (typeof showToast === 'function') { showToast(msg, type); return; }
    console.log(`[SPM] ${type}: ${msg}`);
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 11 — DATA LOADING (Draft/Pending/Approved/Rejected/Archived)
     NEVER loads 'published' PDFs — those belong in the public library.
  ───────────────────────────────────────────────────────────────── */

  async function spmLoadPDFs() {
    SPM.loading = true;
    let pdfs = [];

    if (global.supabaseClient) {
      try {
        // Fetch all non-published PDFs with pagination support for 1000+
        const PAGE = 200;
        let page = 0, keepGoing = true;

        while (keepGoing) {
          const from = page * PAGE;
          const to   = from + PAGE - 1;
          const { data, error } = await global.supabaseClient
            .from('pdfs')
            .select('*')
            .not('status', 'eq', 'published')
            .order('created_at', { ascending: false })
            .range(from, to);

          if (error) throw error;
          pdfs = pdfs.concat(data || []);
          keepGoing = (data || []).length === PAGE;
          page++;
          if (page > 20) break; // safety cap: 4000 PDFs
        }
      } catch(e) {
        console.warn('SPM load error:', e);
        // Fallback: filter global PDFS
        if (global.PDFS?.length) {
          pdfs = global.PDFS.filter(p => p.status && DRAFT_STATUSES.has(p.status));
        }
      }
    } else if (global.PDFS?.length) {
      pdfs = global.PDFS.filter(p => p.status && DRAFT_STATUSES.has(p.status));
    }

    // Double-safety: strip any published PDFs that slipped through
    SPM.pdfs    = pdfs.filter(p => p.status !== 'published');
    SPM.loading = false;
    return SPM.pdfs;
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 12 — MAIN RENDER
  ───────────────────────────────────────────────────────────────── */

  async function renderSmartPublish(main) {
    spmInjectStyles();
    SPM.page = 0;
    SPM.selected.clear();
    SPM.uploadQueue = []; // clear stale upload list on re-enter

    main.innerHTML = `
      <div class="spm-wrap">
        <div class="spm-header">
          <div>
            <div class="spm-header-title">⚡ Smart Publish Manager</div>
            <div class="spm-header-sub">Draft Queue · Upload · Validate · AI Suggestions · Bulk Publish · Auto-Move to Library</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${SPM.undoStack.length &&
              (Date.now() - SPM.undoStack[SPM.undoStack.length - 1].timestamp < UNDO_TTL_MS)
              ? `<button class="spm-btn spm-btn-warning spm-btn-sm" onclick="window._SPM._undo()">↩ Undo Last Publish</button>`
              : ''}
            <button class="spm-btn spm-btn-ghost spm-btn-sm" onclick="window._SPM._refresh()">↻ Refresh</button>
          </div>
        </div>

        <!-- ── UPLOAD SECTION ── -->
        <div class="spm-upload-section">
          <div class="spm-section-label">📤 Upload PDFs as Draft</div>
          <div class="spm-upload-tabs">
            <button class="spm-upload-tab active" onclick="window._SPM._switchUploadTab(this,'single')">Single</button>
            <button class="spm-upload-tab" onclick="window._SPM._switchUploadTab(this,'multiple')">Multiple</button>
            <button class="spm-upload-tab" onclick="window._SPM._switchUploadTab(this,'bulk')">Bulk (100+)</button>
            <button class="spm-upload-tab" onclick="window._SPM._switchUploadTab(this,'dragdrop')">Drag &amp; Drop</button>
          </div>

          <!-- Single -->
          <div id="spmUploadPanel_single" class="spm-upload-panel active">
            <div class="spm-dropzone" onclick="document.getElementById('spmFileSingle').click()">
              <div class="spm-dropzone-icon">📄</div>
              <div class="spm-dropzone-label">Select one PDF</div>
              <div class="spm-dropzone-sub">Click to browse · PDF only · Saved as Draft</div>
              <input id="spmFileSingle" type="file" accept=".pdf,application/pdf" class="spm-drop-input"
                onchange="window._SPM._onFileInput(this.files)"/>
            </div>
          </div>

          <!-- Multiple -->
          <div id="spmUploadPanel_multiple" class="spm-upload-panel">
            <div class="spm-dropzone" onclick="document.getElementById('spmFileMultiple').click()">
              <div class="spm-dropzone-icon">📚</div>
              <div class="spm-dropzone-label">Select multiple PDFs</div>
              <div class="spm-dropzone-sub">Hold Ctrl/Cmd to select several · All saved as Draft</div>
              <input id="spmFileMultiple" type="file" accept=".pdf,application/pdf" multiple class="spm-drop-input"
                onchange="window._SPM._onFileInput(this.files)"/>
            </div>
          </div>

          <!-- Bulk -->
          <div id="spmUploadPanel_bulk" class="spm-upload-panel">
            <div class="spm-dropzone" onclick="document.getElementById('spmFileBulk').click()">
              <div class="spm-dropzone-icon">📦</div>
              <div class="spm-dropzone-label">Bulk Upload — 100+ PDFs at once</div>
              <div class="spm-dropzone-sub">Select as many as needed · All saved as Draft · Processed in queue</div>
              <input id="spmFileBulk" type="file" accept=".pdf,application/pdf" multiple class="spm-drop-input"
                onchange="window._SPM._onFileInput(this.files)"/>
            </div>
          </div>

          <!-- Drag & Drop -->
          <div id="spmUploadPanel_dragdrop" class="spm-upload-panel">
            <div id="spmDropZone" class="spm-dropzone"
              ondragover="window._SPM._onDragOver(event)"
              ondragleave="window._SPM._onDragLeave(event)"
              ondrop="window._SPM._onDrop(event)">
              <div class="spm-dropzone-icon">🎯</div>
              <div class="spm-dropzone-label">Drag &amp; Drop PDFs here</div>
              <div class="spm-dropzone-sub">Drop any number of PDF files · All saved as Draft automatically</div>
            </div>
          </div>

          <div id="spmUploadList" class="spm-upload-list"></div>
        </div>

        <!-- ── STATS BAR ── -->
        <div class="spm-stats">
          <div class="spm-stat"><div class="spm-stat-val" id="spmStatDraft">–</div><div class="spm-stat-label">Draft</div></div>
          <div class="spm-stat"><div class="spm-stat-val" id="spmStatPending">–</div><div class="spm-stat-label">Pending</div></div>
          <div class="spm-stat"><div class="spm-stat-val" id="spmStatApproved">–</div><div class="spm-stat-label">Approved</div></div>
          <div class="spm-stat"><div class="spm-stat-val" id="spmStatRejected">–</div><div class="spm-stat-label">Rejected</div></div>
          <div class="spm-stat"><div class="spm-stat-val" id="spmStatArchived">–</div><div class="spm-stat-label">Archived</div></div>
          <div class="spm-stat"><div class="spm-stat-val" id="spmStatTotal">–</div><div class="spm-stat-label">Total</div></div>
          <div class="spm-stat"><div class="spm-stat-val" id="spmStatSelected">0</div><div class="spm-stat-label">Selected</div></div>
        </div>

        <!-- ── TOOLBAR ── -->
        <div class="spm-toolbar">
          <div class="spm-toolbar-left">
            <input class="spm-search" id="spmSearch" placeholder="Search drafts…"
              oninput="window._SPM._search(this.value)"/>
            <select class="spm-filter-select" id="spmStatusFilter"
              onchange="window._SPM._filter()">
              <option value="">All Statuses</option>
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
            <button class="spm-btn spm-btn-success spm-btn-sm" id="spmBulkPublishBtn"
              onclick="window._SPM._bulkPublish()" disabled>🚀 Bulk Publish</button>
            <button class="spm-btn spm-btn-ghost spm-btn-sm" id="spmBulkApproveBtn"
              onclick="window._SPM._bulkApprove()" disabled>✅ Approve</button>
            <button class="spm-btn spm-btn-ghost spm-btn-sm" id="spmBulkRejectBtn"
              onclick="window._SPM._bulkReject()" disabled>✗ Reject</button>
            <button class="spm-btn spm-btn-ghost spm-btn-sm" id="spmBulkArchiveBtn"
              onclick="window._SPM._bulkArchive()" disabled>🗄 Archive</button>
            <button class="spm-btn spm-btn-danger spm-btn-sm" id="spmBulkDeleteBtn"
              onclick="window._SPM._bulkDelete()" disabled>🗑 Delete</button>
          </div>
        </div>

        <!-- ── QUEUE NOTICE ── -->
        <div class="spm-queue-notice">
          <span>📋</span>
          <span><strong>Draft Queue</strong> — Upload PDFs → click <strong>✏️ Edit</strong> to fill metadata → click <strong>🚀</strong> to validate &amp; publish. Validation runs <em>only</em> on Publish. Published PDFs move to the Library automatically.</span>
        </div>
        <div class="spm-table-card">
          <div class="spm-table-wrap">
            <table class="spm-table" id="spmTable">
              <thead>
                <tr>
                  <th><input type="checkbox" class="spm-cb" id="spmSelectAllCb"
                    onchange="window._SPM._toggleAll(this.checked)"/></th>
                  <th>#</th>
                  <th>Cover</th>
                  <th>Title</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Validation Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="spmTableBody">
                <tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text2,#94a3b8)">
                  <div class="spm-spinner" style="margin:0 auto 10px;width:24px;height:24px;border-width:3px"></div>
                  Loading draft PDFs…
                </td></tr>
              </tbody>
            </table>
          </div>
          <div class="spm-pagination" id="spmPagination" style="display:none"></div>
        </div>
      </div>`;

    await spmLoadPDFs();
    spmRender();
  }

  function spmRender() {
    spmUpdateStats();
    spmBuildFiltered();
    spmRenderPage();
    spmUpdateToolbar();
    spmRenderPagination();
  }

  function spmBuildFiltered() {
    const query        = (document.getElementById('spmSearch')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('spmStatusFilter')?.value || '';

    let filtered = SPM.pdfs;

    if (query) {
      filtered = filtered.filter(p =>
        (p.title    || '').toLowerCase().includes(query) ||
        (p.category || '').toLowerCase().includes(query) ||
        (p.author   || '').toLowerCase().includes(query) ||
        (p.badge    || '').toLowerCase().includes(query)
      );
    }
    if (statusFilter) {
      filtered = filtered.filter(p => (p.status || 'draft') === statusFilter);
    }
    SPM.filtered = filtered;
  }

  function spmRenderPage() {
    const tbody = document.getElementById('spmTableBody');
    if (!tbody) return;

    const start = SPM.page * PAGE_SIZE;
    const slice = SPM.filtered.slice(start, start + PAGE_SIZE);

    if (!SPM.filtered.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text2,#94a3b8)">
        ${SPM.pdfs.length === 0
          ? '📭 No draft PDFs in queue. Upload PDFs above to get started.'
          : '🔍 No PDFs match your search/filter.'}
      </td></tr>`;
      return;
    }

    tbody.innerHTML = slice.map((p, i) => spmRow(p, start + i)).join('');
  }

  function spmRenderPagination() {
    const el = document.getElementById('spmPagination');
    if (!el) return;
    const totalPages = Math.ceil(SPM.filtered.length / PAGE_SIZE);
    if (totalPages <= 1) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    const start = SPM.page * PAGE_SIZE + 1;
    const end   = Math.min((SPM.page + 1) * PAGE_SIZE, SPM.filtered.length);
    el.innerHTML = `
      <span>Showing ${start}–${end} of ${SPM.filtered.length} PDFs</span>
      <div class="spm-pagination-btns">
        <button class="spm-btn spm-btn-ghost spm-btn-sm"
          onclick="window._SPM._prevPage()" ${SPM.page === 0 ? 'disabled' : ''}>← Prev</button>
        <span style="padding:0 8px;font-weight:700">${SPM.page + 1} / ${totalPages}</span>
        <button class="spm-btn spm-btn-ghost spm-btn-sm"
          onclick="window._SPM._nextPage()" ${SPM.page >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
      </div>`;
  }

  function spmUpdateStats() {
    const pdfs = SPM.pdfs;
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('spmStatDraft',    pdfs.filter(p => !p.status || p.status === 'draft').length);
    set('spmStatPending',  pdfs.filter(p => p.status === 'pending').length);
    set('spmStatApproved', pdfs.filter(p => p.status === 'approved').length);
    set('spmStatRejected', pdfs.filter(p => p.status === 'rejected').length);
    set('spmStatArchived', pdfs.filter(p => p.status === 'archived').length);
    set('spmStatTotal',    pdfs.length);
    set('spmStatSelected', SPM.selected.size);
  }

  function spmRow(p, i) {
    const id       = String(p.id);
    const selected = SPM.selected.has(id);
    const price    = p.price ?? p.selling_price ?? 0;
    const status   = p.status || 'draft';
    const cached   = SPM.validationCache[id];

    // Validation cell:
    // - Only shows result if admin explicitly ran a check (cached)
    // - Newly uploaded PDFs show neutral "─ Not checked" — NEVER auto-error
    const valCell = cached
      ? (cached.ok
          ? `<span class="spm-val-ok">✓ Ready</span>`
          : `<span class="spm-val-fail" onclick="window._SPM._valDetail('${id}')">
               ✗ ${cached.errors.filter(e => e.fail).length} issue(s)
             </span>`)
      : `<span class="spm-val-pending" style="cursor:default">─ Not checked</span>`;

    const coverHTML = (p.cover_url || p.cover_image)
      ? `<img src="${_safeEsc(p.cover_url || p.cover_image)}"
              class="spm-cover" loading="lazy"
              onerror="this.style.display='none';this.nextSibling.style.display='flex'"/><div class="spm-cover-ph" style="display:none">📄</div>`
      : `<div class="spm-cover-ph">📄</div>`;

    return `<tr id="spmRow_${id}" class="${selected ? 'spm-row-selected' : ''}">
      <td><input type="checkbox" class="spm-cb" ${selected ? 'checked' : ''}
        onchange="window._SPM._toggleRow('${id}',this.checked)"/></td>
      <td style="color:var(--text2,#94a3b8);font-size:.73rem">${i + 1}</td>
      <td>${coverHTML}</td>
      <td>
        <div style="font-size:.81rem;font-weight:600;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
          title="${_safeEsc(p.title || '')}">${_safeEsc(p.title || '—')}</div>
        <div style="font-size:.68rem;color:var(--text2,#94a3b8)">${_safeEsc(p.author || '')}</div>
      </td>
      <td><span style="font-size:.73rem;background:rgba(61,142,248,.1);border-radius:6px;padding:2px 8px">
        ${_safeEsc(p.category || '—')}
      </span></td>
      <td style="font-weight:700;color:var(--accent,#3d8ef8)">
        ${(p.free || price === 0) ? 'Free' : '₹' + price}
      </td>
      <td><span class="spm-status-badge spm-badge-${status}">${status}</span></td>
      <td>${valCell}</td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="spm-btn spm-btn-primary spm-btn-sm"
            onclick="window._SPM._editDraft('${id}')" title="Edit metadata">✏️ Edit</button>
          <button class="spm-btn spm-btn-success spm-btn-sm"
            onclick="window._SPM._publishOne('${id}')" title="Validate &amp; Publish">🚀</button>
          <button class="spm-btn spm-btn-ghost spm-btn-sm"
            onclick="window._SPM._aiSuggest('${id}')" title="AI Suggestions">🤖</button>
        </div>
      </td>
    </tr>`;
  }


  function spmUpdateToolbar() {
    const n = SPM.selected.size;
    const el = document.getElementById('spmSelCount');
    if (el) el.textContent = `${n} selected`;

    const setBtn = (id, enabled) => {
      const b = document.getElementById(id);
      if (b) b.disabled = !enabled;
    };
    setBtn('spmBulkPublishBtn', n > 0);
    setBtn('spmBulkApproveBtn', n > 0);
    setBtn('spmBulkRejectBtn',  n > 0);
    setBtn('spmBulkArchiveBtn', n > 0);
    setBtn('spmBulkDeleteBtn',  n > 0);

    const cb = document.getElementById('spmSelectAllCb');
    if (cb) {
      const vis = spmVisibleIds();
      cb.checked       = vis.length > 0 && vis.every(id => SPM.selected.has(id));
      cb.indeterminate = vis.some(id => SPM.selected.has(id)) && !cb.checked;
    }

    const statEl = document.getElementById('spmStatSelected');
    if (statEl) statEl.textContent = n;
  }

  function spmVisibleIds() {
    return Array.from(document.querySelectorAll('#spmTableBody tr[id^="spmRow_"]'))
      .map(tr => tr.id.replace('spmRow_', ''));
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 13 — PUBLIC API
  ───────────────────────────────────────────────────────────────── */

  Object.assign(SPM, {
    _closeModal: spmCloseModal,

    _refresh: async () => {
      SPM.validationCache = {};
      SPM.uploadQueue     = [];
      SPM.aiCache         = {};
      await spmLoadPDFs();
      spmRender();
      spmToast('Draft queue refreshed', 'info');
    },

    _search: (q) => {
      SPM.page = 0;
      spmBuildFiltered();
      spmRenderPage();
      spmRenderPagination();
      spmUpdateToolbar();
    },
    _filter: () => {
      SPM.page = 0;
      spmBuildFiltered();
      spmRenderPage();
      spmRenderPagination();
      spmUpdateToolbar();
    },

    _prevPage: () => {
      if (SPM.page > 0) { SPM.page--; spmRenderPage(); spmRenderPagination(); }
    },
    _nextPage: () => {
      const totalPages = Math.ceil(SPM.filtered.length / PAGE_SIZE);
      if (SPM.page < totalPages - 1) { SPM.page++; spmRenderPage(); spmRenderPagination(); }
    },

    _selectAll: () => {
      SPM.filtered.forEach(p => SPM.selected.add(String(p.id)));
      spmRenderPage();
      spmUpdateToolbar();
      spmUpdateStats();
    },
    _deselectAll: () => {
      SPM.selected.clear();
      spmRenderPage();
      spmUpdateToolbar();
      spmUpdateStats();
    },

    _toggleAll: (checked) => {
      spmVisibleIds().forEach(id => {
        if (checked) SPM.selected.add(id);
        else SPM.selected.delete(id);
      });
      spmRenderPage();
      spmUpdateToolbar();
      spmUpdateStats();
    },
    _toggleRow: (id, checked) => {
      if (checked) SPM.selected.add(id);
      else SPM.selected.delete(id);
      const row = document.getElementById(`spmRow_${id}`);
      if (row) row.classList.toggle('spm-row-selected', checked);
      spmUpdateToolbar();
      spmUpdateStats();
    },

    _validateOne: async (id) => {
      spmInvalidateCache(id);
      const pdf = SPM.pdfs.find(p => String(p.id) === id);
      if (!pdf) return;
      // Show running indicator
      const cell = document.querySelector(`#spmRow_${id} td:nth-child(8)`);
      if (cell) cell.innerHTML = `<span class="spm-val-pending"><span class="spm-spinner"></span></span>`;

      await spmValidate(pdf, SPM.pdfs);

      if (cell) {
        const cached = SPM.validationCache[id];
        cell.innerHTML = cached
          ? (cached.ok
              ? `<span class="spm-val-ok">✓ Ready</span>`
              : `<span class="spm-val-fail" onclick="window._SPM._valDetail('${id}')">
                   ✗ ${cached.errors.filter(e => e.fail).length} issue(s)
                 </span>`)
          : `<span class="spm-val-pending">─ Not checked</span>`;
      }
    },

    _valDetail:  (id) => spmShowValidationDetail(id),
    _aiSuggest:  (id) => spmShowAISuggest(id),
    _editDraft:  (id) => spmShowEditModal(id),
    _previewCover: (url) => spmPreviewCover(url),
    _aiSuggestInEdit: (id) => spmAISuggestInEdit(id),

    _saveDraft: async (id) => {
      await spmSaveDraft(id, false);
      spmToast('💾 Draft saved', 'success');
    },

    _saveAndPublish: async (id) => {
      const saved = await spmSaveDraft(id, false);
      if (saved !== false) {
        spmCloseModal();
        await spmStartPublish([id]);
      }
    },

    _publishOne: async (id) => {
      spmCloseModal();
      await spmStartPublish([id]);
    },

    _bulkPublish: () => spmStartPublish([...SPM.selected]),

    _bulkApprove: async () => {
      const n = await spmBulkUpdateStatus([...SPM.selected], 'approved', 'approved');
      if (n > 0) { SPM.selected.clear(); spmRender(); }
    },
    _bulkReject: async () => {
      const n = await spmBulkUpdateStatus([...SPM.selected], 'rejected', 'rejected');
      if (n > 0) { SPM.selected.clear(); spmRender(); }
    },
    _bulkArchive: async () => {
      const n = await spmBulkUpdateStatus([...SPM.selected], 'archived', 'archived');
      if (n > 0) { SPM.selected.clear(); spmRender(); }
    },
    _bulkDelete: () => spmBulkDelete([...SPM.selected]),

    _confirmPublish: (readyIds) => {
      spmCloseModal();
      spmExecutePublish(readyIds, {});
    },

    _applyAI: async (id) => {
      const edits = {
        badge:            document.getElementById('spmAiBadge')?.value      || '',
        tags:             document.getElementById('spmAiTags')?.value        || '',
        seo_title:        document.getElementById('spmAiSeoTitle')?.value   || '',
        meta_description: document.getElementById('spmAiMetaDesc')?.value   || '',
        selling_price:    parseFloat(document.getElementById('spmAiPrice')?.value || 0),
        slug:             document.getElementById('spmAiSlug')?.value        || '',
      };
      const catVal = document.getElementById('spmAiCat')?.value || '';
      if (catVal) {
        const pdf = SPM.pdfs.find(p => String(p.id) === id);
        if (pdf && !pdf.category) pdf.category = catVal;
      }
      spmCloseModal();
      await spmExecutePublish([id], { [id]: edits });
    },

    _undo: spmUndoPublish,

    // Upload handlers
    _switchUploadTab: (btn, panel) => {
      document.querySelectorAll('.spm-upload-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.spm-upload-panel').forEach(p => p.classList.remove('active'));
      const target = document.getElementById(`spmUploadPanel_${panel}`);
      if (target) target.classList.add('active');
    },

    _onFileInput: (files) => { if (files?.length) spmQueueFiles(files); },

    _onDragOver: (e) => {
      e.preventDefault();
      const dz = document.getElementById('spmDropZone');
      if (dz) dz.classList.add('dragover');
    },
    _onDragLeave: (e) => {
      const dz = document.getElementById('spmDropZone');
      if (dz) dz.classList.remove('dragover');
    },
    _onDrop: (e) => {
      e.preventDefault();
      const dz = document.getElementById('spmDropZone');
      if (dz) dz.classList.remove('dragover');
      const files = e.dataTransfer?.files;
      if (files?.length) spmQueueFiles(files);
    },
  });

  /* ─────────────────────────────────────────────────────────────────
     SECTION 14 — HOOK INTO switchAdminTab (non-breaking)
  ───────────────────────────────────────────────────────────────── */

  function spmHookSwitchAdminTab() {
    const _prev = global.switchAdminTab;
    global.switchAdminTab = function(tab) {
      if (tab === SPM_TAB) {
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
     SECTION 15 — INJECT SIDEBAR NAV BUTTON (idempotent)
  ───────────────────────────────────────────────────────────────── */

  function spmInjectNavButton() {
    // Already in HTML — just ensure it's wired up
    if (document.querySelector(`.admin-nav-item[data-atab="${SPM_TAB}"]`)) return;
    // Fallback injection if it somehow wasn't in HTML
    const pdfsBtn = document.querySelector('.admin-nav-item[data-atab="add-pdf"]');
    if (!pdfsBtn) return;
    const btn = document.createElement('button');
    btn.className = 'admin-nav-item';
    btn.dataset.atab = SPM_TAB;
    btn.setAttribute('onclick', `switchAdminTab('${SPM_TAB}')`);
    btn.style.cssText =
      'background:linear-gradient(90deg,rgba(61,142,248,.14),rgba(16,217,142,.07));border-left:2px solid #3d8ef8';
    btn.innerHTML = `<span style="font-size:.85rem">⚡</span> Smart Publish`;
    pdfsBtn.insertAdjacentElement('afterend', btn);
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 16 — UTILITY
  ───────────────────────────────────────────────────────────────── */

  function _safeEsc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#x27;');
  }

  /* ─────────────────────────────────────────────────────────────────
     SECTION 17 — INIT
  ───────────────────────────────────────────────────────────────── */

  function spmInit() {
    spmInjectStyles();
    spmHookSwitchAdminTab();
    spmInjectNavButton();

    // Re-inject nav when admin panel opens (via navigate)
    const origNavigate = global.navigate;
    if (typeof origNavigate === 'function' && !global._spmNavigatePatched) {
      global._spmNavigatePatched = true;
      global.navigate = function(page, ...args) {
        origNavigate(page, ...args);
        if (page === 'admin') setTimeout(spmInjectNavButton, 400);
      };
    }

    // MutationObserver to re-inject if admin panel visibility changes
    const adminPanel = document.getElementById('adminPanel');
    if (adminPanel) {
      const obs = new MutationObserver(spmInjectNavButton);
      obs.observe(adminPanel, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    console.log(`[SmartPublishManager] ✅ v${SPM_VERSION} loaded`);
    console.log('[SmartPublishManager] Draft Queue: shows only non-published PDFs');
    console.log('[SmartPublishManager] After Publish: auto-moves to Published Library');
    console.log('[SmartPublishManager] Upload: Single / Multiple / Bulk (100+) / Drag-Drop');
    console.log('[SmartPublishManager] Validation: 15-point pre-publish checks');
    console.log('[SmartPublishManager] AI: Category / Badge / Tags / SEO / Price / Slug');
    console.log('[SmartPublishManager] Bulk: Publish / Approve / Reject / Archive / Delete');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', spmInit);
  } else {
    setTimeout(spmInit, 0);
  }

})(window);
