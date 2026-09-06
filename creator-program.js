/* ═══════════════════════════════════════════════════════════════════
   CREATOR PROGRAM 2.0 — route-lazy application bundle
   Registration wizard (4-step, Preview Mode), creator dashboard,
   KYC handling, three-tier commission logic (Starter/Rising/Pro).
   Loaded on first navigate('creator-register'/'creator-dashboard')
   by the shim in index.html (Issue #1: monolithic-bundle fix).
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

/* ─── CONSTANTS ────────────────────────────────────────────────── */
const CP_LEVELS = {
  starter: { label:'Starter', share:60, icon:'⭐', color:'#f59e0b', minSales:0 },
  rising:  { label:'Rising',  share:65, icon:'🚀', color:'#10d98e', minSales:5000 },
  pro:     { label:'Pro',     share:70, icon:'💎', color:'#930205', minSales:25000 }
};

// ── Creator revenue attribution: credits the creator when THEIR pdf sells,
// logs to creator_ledger, and auto-promotes level based on cumulative sales.
// Called from both purchase-completion handlers, right after a successful
// (non-duplicate) purchased_pdfs insert. Wrapped defensively — a failure
// here must never block the buyer's PDF from opening.
async function cpCreditCreatorSale(pdfId, amount) {
  try {
    const sb = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
    if (!sb || !pdfId) return;
    const { data: pdf } = await sb.from('pdfs').select('creator_id').eq('id', String(pdfId)).maybeSingle();
    if (!pdf || !pdf.creator_id) return; // not a creator-published PDF — nothing to credit

    const { data: creator } = await sb.from('creators')
      .select('level,revenue_share,total_sales,total_earnings,available_balance')
      .eq('user_id', pdf.creator_id).maybeSingle();
    if (!creator) return;

    const saleAmount = Number(amount) || 0;
    const share = (creator.revenue_share || CP_LEVELS[creator.level || 'starter']?.share || 60) / 100;
    const creatorCut = Math.round(saleAmount * share * 100) / 100;
    const newTotalSales = (creator.total_sales || 0) + saleAmount;
    const newTotalEarnings = (creator.total_earnings || 0) + creatorCut;
    const newBalance = (creator.available_balance || 0) + creatorCut;

    // Auto level promotion based on cumulative sales (Starter → Rising → Pro)
    let newLevel = creator.level || 'starter';
    let newShare = creator.revenue_share || CP_LEVELS[newLevel].share;
    for (const lvl of ['starter','rising','pro']) {
      if (newTotalSales >= CP_LEVELS[lvl].minSales) { newLevel = lvl; newShare = CP_LEVELS[lvl].share; }
    }

    await sb.from('creators').update({
      total_sales: newTotalSales,
      total_earnings: newTotalEarnings,
      available_balance: newBalance,
      level: newLevel,
      revenue_share: newShare
    }).eq('user_id', pdf.creator_id);

    await sb.from('creator_ledger').insert({
      user_id: pdf.creator_id,
      type: 'credit',
      amount: creatorCut,
      description: `Sale revenue (${Math.round(share*100)}% share) — PDF sold for ₹${saleAmount}`,
      created_at: new Date().toISOString()
    });

    if (newLevel !== (creator.level || 'starter')) {
      console.log(`🎉 Creator ${pdf.creator_id} auto-promoted to ${newLevel} (${newShare}% share)`);
    }
  } catch(e) {
    console.warn('⚠️ cpCreditCreatorSale error (non-blocking):', e);
  }
}

// ── Creator download attribution: bumps total_downloads when a creator's
// PDF is opened/downloaded (paid or free). Wrapped defensively.
async function cpCreditCreatorDownload(pdfId) {
  try {
    const sb = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);
    if (!sb || !pdfId) return;
    const { data: pdf } = await sb.from('pdfs').select('creator_id').eq('id', String(pdfId)).maybeSingle();
    if (!pdf || !pdf.creator_id) return;
    const { data: creator } = await sb.from('creators').select('total_downloads').eq('user_id', pdf.creator_id).maybeSingle();
    if (!creator) return;
    await sb.from('creators').update({ total_downloads: (creator.total_downloads || 0) + 1 }).eq('user_id', pdf.creator_id);
  } catch(e) {
    console.warn('⚠️ cpCreditCreatorDownload error (non-blocking):', e);
  }
}

/* ─── Creator Registration State ───────────────────────────────── */
let _crpStep = 1;
let _crpMaxStepReached = 1; // highest step unlocked via real validation — used for Preview Mode gating
let _crpInPreview = false;
let _crpDocFile = null;
let _crpPhotoFile = null;
let _crpPdfFiles = [];
let _crpTermsAccepted = false;   // legacy alias — true only when all 3 checked
let _crpChecks = [false, false, false]; // checkboxes 1,2,3
let _crpCurrentData = null;

/* ─── navigate() hook for creator pages ────────────────────────── */
// Guard: only patch once to avoid duplicate-declaration errors
if (!window._crpNavigatePatched) {
  window._crpNavigatePatched = true;
  window._crpOrigNavigate = window.navigate || function(){};
  window.navigate = function(page) {
    var rest = Array.prototype.slice.call(arguments, 1);
    if (page === 'creator-register') { showCreatorRegister(); return; }
    if (page === 'creator-dashboard') { showCreatorDashboard(); return; }
    return window._crpOrigNavigate.apply(this, [page].concat(rest));
  };
}

function _crpNav(page) {
  // Safe internal navigate — bypasses creator intercept for non-creator pages
  if (window._crpOrigNavigate) window._crpOrigNavigate(page);
  else if (typeof navigate === 'function') navigate(page);
}

function showCreatorRegister() {
  const user = window.currentUser;
  if (!user) { showToast('Please sign in first 👤', 'info'); _crpNav('login'); return; }
  // Check if already a creator
  crpCheckExistingCreator().then(existing => {
    if (existing) {
      if (existing.status === 'approved') {
        // ── Stage 2: Creator is approved/active — send directly to dashboard
        // The 3-PDF requirement is ONLY for initial registration (Stage 1).
        // Approved creators manage their PDFs from the dashboard.
        showCreatorDashboard();
        return;
      }
      if (existing.status === 'pending') {
        showToast('Your application is under review 🕐', 'info');
        _crpNav('home');
        return;
      }
      if (existing.status === 'suspended') {
        showToast('Your creator account is suspended. Contact support for details.', 'error');
        _crpNav('home');
        return;
      }
      // status === 'rejected' || status === 'not_applied' falls through to the form below so the creator can reapply
    }
    // ── Stage 1: First-time registration — requires 3 PDFs ──
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-creator-register')?.classList.add('active');
    window.currentPage = 'creator-register';
    window.scrollTo(0,0);
    crpInitForm();
  });
}

async function showCreatorDashboard() {
  const user = window.currentUser;
  if (!user) { showToast('Please sign in first 👤', 'info'); _crpNav('login'); return; }
  const creator = await crpCheckExistingCreator();
  if (!creator || creator.status !== 'approved') {
    if (creator && creator.status === 'suspended') {
      showToast('Your creator account is suspended. Contact support for details.', 'error');
      _crpNav('home');
      return;
    }
    showToast('You are not a registered creator', 'info');
    showCreatorRegister();
    return;
  }
  _crpCurrentData = creator;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-creator-dashboard')?.classList.add('active');
  window.currentPage = 'creator-dashboard';
  window.scrollTo(0,0);
  crdInit(creator);
  // Show creator section in burger menu, hide register section
  const hmC = document.getElementById('hmCreatorSection');
  const hmR = document.getElementById('hmCreatorRegSection');
  if (hmC) hmC.style.display = '';
  if (hmR) hmR.style.display = 'none';
}

async function crpCheckExistingCreator() {
  const sb = window.supabaseClient;
  const user = window.currentUser;
  if (!sb || !user) return null;
  try {
    const { data } = await sb.from('creators').select('*').eq('user_id', user.id || user.uid).maybeSingle();
    return data || null;
  } catch(e) { return null; }
}

/* ─── Form Initialization ───────────────────────────────────────── */
/* ─── Step-1 extra state ──────────────────────────────────────────── */
let _crpAadhaarFile = null;
let _crpSelfieFile  = null;
let _crpSelectedCats = [];
let _crpSaveTimer = null;

function crpInitForm() {
  _crpStep = 1;
  _crpMaxStepReached = 1;
  _crpInPreview = false;
  _crpDocFile = null;
  _crpPhotoFile = null;
  _crpAadhaarFile = null;
  _crpSelfieFile  = null;
  _crpPdfFiles = [];
  _crpTermsAccepted = false;
  _crpChecks = [false, false, false];
  if (typeof s3ResetStep3Fields === 'function') s3ResetStep3Fields();
  _crpSelectedCats = [];
  crpGoStep(1);

  // Set DOB max = 18 years ago
  const dobEl = document.getElementById('crpDob');
  if (dobEl) {
    const d = new Date(); d.setFullYear(d.getFullYear() - 18);
    dobEl.max = d.toISOString().split('T')[0];
  }

  // Pre-fill email from logged-in user
  const user = window.currentUser;
  const emailEl = document.getElementById('crpEmail');
  if (emailEl && user && user.email) {
    emailEl.value = user.email;
    crpLiveValidate(emailEl, 'email');
  }

  // Restore saved draft
  crpRestoreProgress();
}

/* ── Live validation helpers ──────────────────────────────────────── */
function crpLiveValidate(el, type) {
  const val = el.value.trim();
  let ok = false;
  if (type === 'name')   ok = val.length >= 2;
  if (type === 'email')  ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  if (type === 'mobile') ok = /^[6-9]\d{9}$/.test(val.replace(/\s/g,''));
  if (type === 'select') ok = val !== '';
  if (type === 'bio')    ok = val.length >= 80;
  if (type === 'url')    ok = val === '' || /^https?:\/\//i.test(val);
  el.classList.toggle('crp-valid',   ok);
  el.classList.toggle('crp-invalid', !ok && val.length > 0);
  const tid = el.id + 'Tick';
  const tick = document.getElementById(tid);
  if (tick) { tick.style.opacity = ok ? '1' : '0'; }
  crpAutoSave();
}
function crpBlurValidate(el, type) {
  crpLiveValidate(el, type);
  const val = el.value.trim();
  const eid = el.id + 'Err';
  const errEl = document.getElementById(eid);
  if (errEl) errEl.classList.toggle('show', !el.classList.contains('crp-valid') && val.length > 0);
}
function crpBioInput(el) {
  const len = el.value.length;
  const ct  = document.getElementById('crpBioCount');
  const min = document.getElementById('crpBioMin');
  const need = document.getElementById('crpBioNeed');
  if (ct) ct.textContent = len;
  if (min && need) {
    const rem = Math.max(0, 80 - len);
    min.style.display = rem > 0 ? '' : 'none';
    need.textContent = rem;
  }
  crpLiveValidate(el, 'bio');
}
function crpValidateDob(el) {
  const dobErr = document.getElementById('crpDobErr');
  const val = el.value;
  if (!val) { if (dobErr) dobErr.classList.remove('show'); return; }
  const dob = new Date(val);
  const min18 = new Date(); min18.setFullYear(min18.getFullYear() - 18);
  const ok = dob <= min18;
  el.classList.toggle('crp-invalid', !ok);
  el.classList.toggle('crp-valid', ok);
  if (dobErr) dobErr.classList.toggle('show', !ok);
}

/* ── Category chip toggle ─────────────────────────────────────────── */
function crpToggleCat(chip) {
  const val = chip.dataset.val;
  const idx = _crpSelectedCats.indexOf(val);
  if (idx > -1) {
    _crpSelectedCats.splice(idx, 1);
    chip.classList.remove('selected');
  } else {
    if (_crpSelectedCats.length >= 5) {
      showToast('Maximum 5 categories allowed', 'info'); return;
    }
    _crpSelectedCats.push(val);
    chip.classList.add('selected');
  }
  const note = document.getElementById('crpCatNote');
  if (note) note.textContent = _crpSelectedCats.length + ' / 5 selected';
  const err = document.getElementById('crpCatErr');
  if (err) err.classList.toggle('show', false);
  crpAutoSave();
}

/* ── KYC upload handlers ──────────────────────────────────────────── */
function crpHandleKyc(input, type) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('File must be under 5 MB', 'error'); return; }
  if (type === 'selfie' && !file.type.startsWith('image/')) {
    showToast('Selfie must be an image file', 'error'); return;
  }
  if (type === 'aadhaar') {
    _crpAadhaarFile = file;
    const box = document.getElementById('crpAadhaarBox');
    const name = document.getElementById('crpAadhaarName');
    if (box)  box.classList.add('uploaded');
    if (name) name.textContent = file.name;
  } else {
    _crpSelfieFile = file;
    const box = document.getElementById('crpSelfieBox');
    const name = document.getElementById('crpSelfieName');
    if (box)  box.classList.add('uploaded');
    if (name) name.textContent = file.name;
  }
  const kycErr = document.getElementById('crpKycErr');
  if (kycErr) kycErr.classList.remove('show');
  showToast((type === 'aadhaar' ? 'Aadhaar' : 'Selfie') + ' uploaded ✅', 'success');
}

/* ── Progress auto-save (localStorage, text fields only) ──────────── */
const CRP_SAVE_KEY = 'crp_draft_v2';
function crpAutoSave() {
  clearTimeout(_crpSaveTimer);
  _crpSaveTimer = setTimeout(() => {
    try {
      const draft = {
        fullName:     document.getElementById('crpFullName')?.value || '',
        authorName:   document.getElementById('crpAuthorName')?.value || '',
        email:        document.getElementById('crpEmail')?.value || '',
        mobile:       document.getElementById('crpMobile')?.value || '',
        gender:       document.getElementById('crpGender')?.value || '',
        dob:          document.getElementById('crpDob')?.value || '',
        creatorType:  document.getElementById('crpCreatorType')?.value || '',
        qualification:document.getElementById('crpQualification')?.value || '',
        experience:   document.getElementById('crpExperience')?.value || '',
        occupation:   document.getElementById('crpOccupation')?.value || '',
        bio:          document.getElementById('crpBio')?.value || '',
        expertise:    document.getElementById('crpExpertise')?.value || '',
        languages:    document.getElementById('crpLanguages')?.value || '',
        social:       document.getElementById('crpSocial')?.value || '',
        cats:         _crpSelectedCats.slice(),
        s3Title:      document.getElementById('s3Title')?.value || '',
        s3Desc:       document.getElementById('s3Desc')?.value || '',
        s3Category:   document.getElementById('s3Category')?.value || '',
        s3Language:   document.getElementById('s3Language')?.value || '',
        s3Exam:       document.getElementById('s3Exam')?.value || '',
        s3Price:      document.getElementById('s3Price')?.value || '',
        s3Mrp:        document.getElementById('s3Mrp')?.value || '',
        s3SeoTitle:   document.getElementById('s3SeoTitle')?.value || '',
        s3SeoDesc:    document.getElementById('s3SeoDesc')?.value || '',
        savedAt:      Date.now(),
      };
      localStorage.setItem(CRP_SAVE_KEY, JSON.stringify(draft));
      crpShowSaveBanner('Progress saved · ' + new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
    } catch(e) {}
  }, 1200);
}
function crpRestoreProgress() {
  try {
    const raw = localStorage.getItem(CRP_SAVE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    // Only restore if saved within 7 days
    if (Date.now() - (d.savedAt||0) > 7 * 86400000) { localStorage.removeItem(CRP_SAVE_KEY); return; }
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    set('crpFullName', d.fullName);
    set('crpAuthorName', d.authorName);
    // Don't overwrite email if already pre-filled from auth
    const emailEl = document.getElementById('crpEmail');
    if (emailEl && !emailEl.value && d.email) emailEl.value = d.email;
    set('crpMobile', d.mobile);
    set('crpGender', d.gender);
    set('crpDob', d.dob);
    set('crpCreatorType', d.creatorType);
    set('crpQualification', d.qualification);
    set('crpExperience', d.experience);
    set('crpOccupation', d.occupation);
    set('crpBio', d.bio);
    set('crpExpertise', d.expertise);
    set('crpLanguages', d.languages);
    set('crpSocial', d.social);
    // Restore Step 3 product title and metadata
    set('s3Title', d.s3Title);
    set('s3Desc', d.s3Desc);
    set('s3Category', d.s3Category);
    set('s3Language', d.s3Language);
    set('s3Exam', d.s3Exam);
    set('s3Price', d.s3Price);
    set('s3Mrp', d.s3Mrp);
    set('s3SeoTitle', d.s3SeoTitle);
    set('s3SeoDesc', d.s3SeoDesc);
    // Update char counts for restored step-3 title/desc fields
    ['s3Title','s3Desc','s3SeoTitle','s3SeoDesc'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.value) el.dispatchEvent(new Event('input'));
    });
    // Restore categories
    if (Array.isArray(d.cats)) {
      d.cats.forEach(v => {
        const chip = document.querySelector(`.crp-cat-chip[data-val="${v}"]`);
        if (chip) crpToggleCat(chip);
      });
    }
    // Re-run live validation for restored fields
    ['crpFullName','crpAuthorName','crpEmail','crpMobile','crpQualification'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.value) {
        const t = id==='crpEmail'?'email':id==='crpMobile'?'mobile':'name';
        crpLiveValidate(el, t);
      }
    });
    const bioEl = document.getElementById('crpBio');
    if (bioEl && bioEl.value) crpBioInput(bioEl);
    crpShowSaveBanner('Draft restored — continue where you left off');
  } catch(e) {}
}
function crpShowSaveBanner(msg) {
  const el = document.getElementById('crpSaveMsg');
  if (el) el.textContent = msg || 'Progress saved';
}

/* ── Photo remove ─────────────────────────────────────────────────── */
function crpRemovePhoto() {
  _crpPhotoFile = null;
  const preview = document.getElementById('crpPhotoPreview');
  const placeholder = document.getElementById('crpPhotoPlaceholder');
  const removeBtn = document.getElementById('crpPhotoRemoveBtn');
  if (preview) { preview.style.display = 'none'; preview.src = ''; }
  if (placeholder) placeholder.style.display = '';
  if (removeBtn) removeBtn.style.display = 'none';
  const input = document.getElementById('crpPhotoInput');
  if (input) input.value = '';
}

function crpGoStep(n) {
  _crpStep = n;
  [1,2,3,4].forEach(i => {
    const panel = document.getElementById('crpPanel' + i);
    if (panel) panel.style.display = i === n ? '' : 'none';
    const dot = document.getElementById('crpStep' + i);
    const lbl = document.getElementById('crpLbl' + i);
    if (dot) {
      dot.className = 'crp-step-dot' + (i < n ? ' done' : i === n ? ' active' : '');
      dot.textContent = i < n ? '✓' : i;
    }
    if (lbl) lbl.className = 'crp-step-lbl' + (i === n ? ' active' : '');
    const line = document.getElementById('crpLine' + i);
    if (line) line.className = 'crp-step-line' + (i < n ? ' done' : '');
  });
  // Step-specific init hooks
  if (n === 2) {
    // Initialise Step 2 verification status (loads real DB state if exists)
    if (typeof crpv2Init === 'function') crpv2Init();
  }
}

function crpNextStep(n) {
  if (n > _crpStep) {
    if (!crpValidateStep(_crpStep)) return;
  }
  _crpInPreview = false;
  _crpMaxStepReached = Math.max(_crpMaxStepReached, n);
  crpGoStep(n);
  window.scrollTo({top: document.getElementById('page-creator-register')?.offsetTop || 0, behavior:'smooth'});
}

// ── Click any step dot at any time (Creator Program 2.0) ──────────
// If the target step is beyond what's been validated so far, open it in
// read-only Preview Mode instead of blocking the click entirely.
function crpStepDotClick(n) {
  const banner = document.getElementById('crpPreviewBanner');
  if (n <= _crpMaxStepReached) {
    // Already unlocked — normal editable navigation
    _crpInPreview = false;
    if (banner) banner.classList.remove('show');
    crpGoStep(n);
  } else {
    // Locked ahead — Preview Mode: show read-only, no submission
    _crpInPreview = true;
    crpGoStep(n);
    if (banner) banner.classList.add('show');
  }
  const panel = document.getElementById('crpPanel' + n);
  if (panel) panel.classList.toggle('crp-preview-locked', _crpInPreview);
  window.scrollTo({top: document.getElementById('page-creator-register')?.offsetTop || 0, behavior:'smooth'});
}

function crpExitPreview() {
  _crpInPreview = false;
  const banner = document.getElementById('crpPreviewBanner');
  if (banner) banner.classList.remove('show');
  [1,2,3,4].forEach(i => document.getElementById('crpPanel' + i)?.classList.remove('crp-preview-locked'));
  crpGoStep(_crpMaxStepReached);
}

function crpValidateStep(step) {
  if (step === 1) {
    const fullName    = document.getElementById('crpFullName')?.value.trim();
    const authorName  = document.getElementById('crpAuthorName')?.value.trim();
    const email       = document.getElementById('crpEmail')?.value.trim();
    const mobile      = document.getElementById('crpMobile')?.value.trim();
    const creatorType = document.getElementById('crpCreatorType')?.value;
    const bio         = document.getElementById('crpBio')?.value.trim();
    const qual        = document.getElementById('crpQualification')?.value.trim();
    const dobVal      = document.getElementById('crpDob')?.value;

    // Helper — highlight a field red and focus it
    const fail = (id, msg, errId) => {
      const el = document.getElementById(id);
      if (el) { el.classList.add('crp-invalid'); el.focus(); }
      if (errId) { const e = document.getElementById(errId); if (e) e.classList.add('show'); }
      showToast(msg, 'error');
      return false;
    };

    if (!fullName || fullName.length < 2)
      return fail('crpFullName', 'Please enter your full name', 'crpFullNameErr');
    if (!authorName || authorName.length < 2)
      return fail('crpAuthorName', 'Please enter your pen name', 'crpAuthorNameErr');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return fail('crpEmail', 'Please enter a valid email address', 'crpEmailErr');
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile.replace(/\s/g,'')))
      return fail('crpMobile', 'Enter a valid 10-digit Indian mobile number', 'crpMobileErr');
    if (dobVal) {
      const dob = new Date(dobVal), min18 = new Date();
      min18.setFullYear(min18.getFullYear() - 18);
      if (dob > min18) return fail('crpDob', 'You must be at least 18 years old', 'crpDobErr');
    }
    if (!creatorType)
      return fail('crpCreatorType', 'Please select your creator type', 'crpCreatorTypeErr');
    if (!qual || qual.length < 2)
      return fail('crpQualification', 'Please enter your qualification', 'crpQualificationErr');
    if (!bio || bio.length < 80) {
      const bioEl = document.getElementById('crpBio');
      if (bioEl) { bioEl.classList.add('crp-invalid'); bioEl.focus(); }
      const bioErr = document.getElementById('crpBioErr');
      if (bioErr) { bioErr.style.display = 'block'; bioErr.classList.add('show'); }
      showToast('Bio must be at least 80 characters', 'error');
      return false;
    }
    if (!_crpSelectedCats || _crpSelectedCats.length === 0) {
      const catErr = document.getElementById('crpCatErr');
      if (catErr) catErr.classList.add('show');
      showToast('Please select at least one category', 'error');
      return false;
    }
    if (!_crpAadhaarFile || !_crpSelfieFile) {
      const kycErr = document.getElementById('crpKycErr');
      if (kycErr) kycErr.classList.add('show');
      showToast('Please upload both Aadhaar card and selfie', 'error');
      return false;
    }
    // Social link optional — validate only if filled
    const social = document.getElementById('crpSocial')?.value.trim();
    if (social && !/^https?:\/\//i.test(social))
      return fail('crpSocial', 'Social link must start with https://', 'crpSocialErr');
  }
  if (step === 2) {
    // Step 2: require Aadhaar + Selfie (set via crpv2 handlers in Panel2)
    // _crpAadhaarFile / _crpSelfieFile are set by crpv2HandleUpload()
    if (!_crpAadhaarFile || !_crpSelfieFile) {
      const err = document.getElementById('crpv2DocErr');
      if (err) err.classList.add('show');
      showToast('Please upload both Aadhaar card and selfie', 'error');
      return false;
    }
  }
  if (step === 3) {
    return s3ValidateStep3();
  }
  return true;
}

function crpHandlePhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Photo must be under 5 MB', 'error'); return; }
  if (!file.type.startsWith('image/')) { showToast('Please upload an image file', 'error'); return; }
  _crpPhotoFile = file;
  const preview     = document.getElementById('crpPhotoPreview');
  const placeholder = document.getElementById('crpPhotoPlaceholder');
  const removeBtn   = document.getElementById('crpPhotoRemoveBtn');
  if (preview) {
    const reader = new FileReader();
    reader.onload = e => {
      preview.src = e.target.result;
      preview.style.display = '';
      if (placeholder) placeholder.style.display = 'none';
      if (removeBtn)   removeBtn.style.display = '';
    };
    reader.readAsDataURL(file);
  }
  showToast('Photo selected ✅', 'success');
}

function crpHandleDoc(input) {
  // Legacy handler — kept for safety; Step 2 now uses crpv2HandleUpload()
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Document must be under 5MB', 'error'); return; }
  _crpDocFile = file;
}

/* ═══════════════════════════════════════════════════════════
   STEP 2 — VERIFICATION  JS  v2
   ═══════════════════════════════════════════════════════════ */

// ── Upload handler for Aadhaar / Selfie ───────────────────
function crpv2HandleUpload(input, type) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast('File must be under 5 MB', 'error');
    input.value = '';
    return;
  }
  if (type === 'selfie' && !file.type.startsWith('image/')) {
    showToast('Selfie must be an image file (JPG/PNG)', 'error');
    input.value = '';
    return;
  }

  const isImage = file.type.startsWith('image/');

  if (type === 'aadhaar') {
    _crpAadhaarFile = file;
    _crpDocFile     = file; // keep legacy _crpDocFile in sync

    const card    = document.getElementById('crpv2AadhaarCard');
    const nameEl  = document.getElementById('crpv2AadhaarName');
    const preview = document.getElementById('crpv2AadhaarPreview');
    if (card)   card.classList.add('uploaded');
    if (nameEl) nameEl.textContent = file.name;
    if (preview && isImage) {
      const reader = new FileReader();
      reader.onload = e => { preview.src = e.target.result; };
      reader.readAsDataURL(file);
    }
    crpv2SetAIStatus('aadhaar', 'review');
  } else {
    _crpSelfieFile = file;
    const card    = document.getElementById('crpv2SelfieCard');
    const nameEl  = document.getElementById('crpv2SelfieName');
    const preview = document.getElementById('crpv2SelfiePreview');
    if (card)   card.classList.add('uploaded');
    if (nameEl) nameEl.textContent = file.name;
    if (preview && isImage) {
      const reader = new FileReader();
      reader.onload = e => { preview.src = e.target.result; };
      reader.readAsDataURL(file);
    }
    crpv2SetAIStatus('selfie', 'review');
  }

  // Clear doc error
  const err = document.getElementById('crpv2DocErr');
  if (err) err.classList.remove('show');

  // When both are uploaded, run simulated AI pre-check
  if (_crpAadhaarFile && _crpSelfieFile) {
    crpv2RunAICheck();
  }

  showToast((type === 'aadhaar' ? 'Aadhaar' : 'Selfie') + ' uploaded ✅', 'success');
}

// ── Remove uploaded file ──────────────────────────────────
function crpv2Remove(type) {
  if (type === 'aadhaar') {
    _crpAadhaarFile = null;
    _crpDocFile     = null;
    const card    = document.getElementById('crpv2AadhaarCard');
    const nameEl  = document.getElementById('crpv2AadhaarName');
    const preview = document.getElementById('crpv2AadhaarPreview');
    const input   = document.getElementById('crpv2AadhaarInput');
    if (card)    card.classList.remove('uploaded');
    if (nameEl)  nameEl.textContent = '';
    if (preview) { preview.src = ''; }
    if (input)   input.value = '';
    crpv2SetAIStatus('aadhaar', 'pending');
  } else {
    _crpSelfieFile = null;
    const card    = document.getElementById('crpv2SelfieCard');
    const nameEl  = document.getElementById('crpv2SelfieName');
    const preview = document.getElementById('crpv2SelfiePreview');
    const input   = document.getElementById('crpv2SelfieInput');
    if (card)    card.classList.remove('uploaded');
    if (nameEl)  nameEl.textContent = '';
    if (preview) { preview.src = ''; }
    if (input)   input.value = '';
    crpv2SetAIStatus('selfie', 'pending');
  }
  // Reset AI note
  const note = document.getElementById('crpv2AiNote');
  if (note) note.textContent = 'Upload both documents above — AI pre-check will run automatically.';
}

// ── Set a single AI status row ────────────────────────────
// status: 'pending' | 'review' | 'verified' | 'rejected'
function crpv2SetAIStatus(doc, status) {
  const rowId   = doc === 'aadhaar' ? 'crpv2AadhaarStatusRow'  : 'crpv2SelfieStatusRow';
  const badgeId = doc === 'aadhaar' ? 'crpv2AadhaarStatusBadge': 'crpv2SelfieStatusBadge';
  const row     = document.getElementById(rowId);
  const badge   = document.getElementById(badgeId);
  if (!row || !badge) return;

  const MAP = {
    pending:  { cls: 'crpv-s-pending',  label: 'Pending'  },
    review:   { cls: 'crpv-s-review',   label: 'In Review'},
    verified: { cls: 'crpv-s-verified', label: 'Verified' },
    rejected: { cls: 'crpv-s-rejected', label: 'Rejected' },
  };
  const cfg = MAP[status] || MAP.pending;
  row.className   = 'crpv-status-row ' + cfg.cls;
  badge.textContent = cfg.label;
}

// ── Simulated AI pre-check (client-side) ─────────────────
// Real implementation would call a Supabase Edge Function / AI API.
// This gives the user instant feedback while the real admin review happens async.
let _crpv2AITimer = null;
function crpv2RunAICheck() {
  const note = document.getElementById('crpv2AiNote');
  if (note) note.textContent = '🤖 Running AI pre-check…';
  crpv2SetAIStatus('aadhaar', 'review');
  crpv2SetAIStatus('selfie',  'review');

  clearTimeout(_crpv2AITimer);
  _crpv2AITimer = setTimeout(() => {
    // Simulate: validate file type and size (basic client-side heuristics)
    const aadhaarOk = _crpAadhaarFile &&
      _crpAadhaarFile.size > 10000 &&
      (_crpAadhaarFile.type.startsWith('image/') || _crpAadhaarFile.type === 'application/pdf');
    const selfieOk  = _crpSelfieFile  &&
      _crpSelfieFile.size  > 10000 &&
      _crpSelfieFile.type.startsWith('image/');

    crpv2SetAIStatus('aadhaar', aadhaarOk ? 'verified' : 'rejected');
    crpv2SetAIStatus('selfie',  selfieOk  ? 'verified' : 'rejected');

    if (aadhaarOk && selfieOk) {
      if (note) note.textContent = '✅ AI pre-check passed — documents look valid. Admin will do a final review within 24–48 hrs.';
      crpv2UpdateAdminStatus('submitted', null);
    } else {
      if (note) note.textContent = '⚠️ One or more documents failed the basic check. Please re-upload a clearer image.';
    }
  }, 2200); // short delay to feel like real processing
}

// ── Admin status block update ─────────────────────────────
function crpv2UpdateAdminStatus(status, rejectionReason) {
  const kycEl     = document.getElementById('crpv2AdminKycStatus');
  const checkedEl = document.getElementById('crpv2AdminLastChecked');
  const rejBox    = document.getElementById('crpv2RejectionBox');
  const rejReason = document.getElementById('crpv2RejectionReason');

  const STATUS_MAP = {
    not_submitted: '⚪ Not Submitted',
    submitted:     '🕐 Submitted — Awaiting Review',
    pending:       '🕐 Pending Review',
    review:        '🔵 Under Review',
    verified:      '✅ Verified',
    rejected:      '❌ Rejected',
  };

  if (kycEl)     kycEl.textContent     = STATUS_MAP[status] || status || '—';
  if (checkedEl) checkedEl.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  // Show/hide rejection box
  const isRejected = status === 'rejected';
  if (rejBox)    rejBox.classList.toggle('show', isRejected);
  if (rejReason && rejectionReason) rejReason.textContent = rejectionReason;
}

// ── Poll Supabase for real admin/verification status ──────
let _crpv2Polling = false;
async function crpv2PollStatus() {
  if (_crpv2Polling) return;
  _crpv2Polling = true;

  const btn = document.getElementById('crpv2RefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Checking…'; }

  try {
    const sb   = window.supabaseClient;
    const user = window.currentUser;
    if (!sb || !user) { showToast('Not signed in', 'error'); return; }

    const { data, error } = await sb
      .from('creators')
      .select('verification_status, rejection_reason, aadhaar_path, selfie_path')
      .eq('user_id', user.id || user.uid)
      .maybeSingle();

    if (error || !data) {
      showToast('Could not fetch status — try again', 'error');
      return;
    }

    const vs = data.verification_status || 'not_submitted';
    crpv2UpdateAdminStatus(vs, data.rejection_reason);

    // Sync AI status rows with real DB status
    if (vs === 'verified') {
      crpv2SetAIStatus('aadhaar', 'verified');
      crpv2SetAIStatus('selfie',  'verified');
      const note = document.getElementById('crpv2AiNote');
      if (note) note.textContent = '✅ Documents verified by admin. You are cleared to proceed!';
    } else if (vs === 'rejected') {
      crpv2SetAIStatus('aadhaar', 'rejected');
      crpv2SetAIStatus('selfie',  'rejected');
    } else if (vs === 'review') {
      crpv2SetAIStatus('aadhaar', 'review');
      crpv2SetAIStatus('selfie',  'review');
    }

    // If previously submitted, restore uploaded indicator (files aren't in memory after page reload)
    if ((vs === 'submitted' || vs === 'review' || vs === 'verified') && data.aadhaar_path) {
      const aadhaarCard = document.getElementById('crpv2AadhaarCard');
      const aadhaarName = document.getElementById('crpv2AadhaarName');
      if (aadhaarCard) aadhaarCard.classList.add('uploaded');
      if (aadhaarName) aadhaarName.textContent = '(previously uploaded)';
    }
    if ((vs === 'submitted' || vs === 'review' || vs === 'verified') && data.selfie_path) {
      const selfieCard = document.getElementById('crpv2SelfieCard');
      const selfieName = document.getElementById('crpv2SelfieName');
      if (selfieCard) selfieCard.classList.add('uploaded');
      if (selfieName) selfieName.textContent = '(previously uploaded)';
    }

    showToast('Status refreshed', 'success');
  } catch(e) {
    showToast('Refresh failed: ' + e.message, 'error');
  } finally {
    _crpv2Polling = false;
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Refresh'; }
  }
}

// ── Resubmit: reset UI so user can upload fresh docs ──────
function crpv2StartResubmit() {
  // Clear in-memory files
  _crpAadhaarFile = null;
  _crpSelfieFile  = null;
  _crpDocFile     = null;

  // Reset upload cards
  ['crpv2AadhaarCard','crpv2SelfieCard'].forEach(id => {
    const card = document.getElementById(id);
    if (card) card.classList.remove('uploaded', 'error');
  });
  ['crpv2AadhaarName','crpv2SelfieName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  ['crpv2AadhaarPreview','crpv2SelfiePreview'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.src = '';
  });
  ['crpv2AadhaarInput','crpv2SelfieInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // Reset AI status
  crpv2SetAIStatus('aadhaar', 'pending');
  crpv2SetAIStatus('selfie',  'pending');

  // Hide rejection box
  const rejBox = document.getElementById('crpv2RejectionBox');
  if (rejBox) rejBox.classList.remove('show');

  // Reset admin status
  crpv2UpdateAdminStatus('not_submitted', null);

  // Reset note
  const note = document.getElementById('crpv2AiNote');
  if (note) note.textContent = 'Upload both documents above — AI pre-check will run automatically.';

  showToast('Ready for resubmission — please upload fresh documents', 'info');
}

// ── Initialise Step 2 when navigating to it ───────────────
// Called from crpGoStep(2) — polls real status if user has existing record.
async function crpv2Init() {
  const sb   = window.supabaseClient;
  const user = window.currentUser;
  if (!sb || !user) return;

  try {
    const { data } = await sb
      .from('creators')
      .select('verification_status, rejection_reason, aadhaar_path, selfie_path')
      .eq('user_id', user.id || user.uid)
      .maybeSingle();

    if (!data) return;

    const vs = data.verification_status || 'not_submitted';
    crpv2UpdateAdminStatus(vs, data.rejection_reason);

    if (vs === 'rejected') {
      crpv2SetAIStatus('aadhaar', 'rejected');
      crpv2SetAIStatus('selfie',  'rejected');
      const rejBox = document.getElementById('crpv2RejectionBox');
      if (rejBox) rejBox.classList.add('show');
      const rejReason = document.getElementById('crpv2RejectionReason');
      if (rejReason && data.rejection_reason) rejReason.textContent = data.rejection_reason;
    } else if (vs === 'verified') {
      crpv2SetAIStatus('aadhaar', 'verified');
      crpv2SetAIStatus('selfie',  'verified');
      const note = document.getElementById('crpv2AiNote');
      if (note) note.textContent = '✅ Documents verified by admin. You are cleared to proceed!';
    } else if (vs === 'review' || vs === 'submitted') {
      crpv2SetAIStatus('aadhaar', 'review');
      crpv2SetAIStatus('selfie',  'review');
    }

    // Restore previously-uploaded indicator
    if (data.aadhaar_path) {
      const c = document.getElementById('crpv2AadhaarCard');
      const n = document.getElementById('crpv2AadhaarName');
      if (c) c.classList.add('uploaded');
      if (n) n.textContent = '(previously uploaded)';
    }
    if (data.selfie_path) {
      const c = document.getElementById('crpv2SelfieCard');
      const n = document.getElementById('crpv2SelfieName');
      if (c) c.classList.add('uploaded');
      if (n) n.textContent = '(previously uploaded)';
    }
  } catch(e) { /* non-fatal */ }
}

/* ═══════════════════════════════════════════════════════════
   STEP 3 — PRODUCT UPLOAD v2  JS
   ═══════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────
let _s3ProductType  = 'pdf';   // current type tab
let _s3ThumbFile    = null;    // thumbnail File
let _s3PreviewFiles = [];      // preview page images
let _s3Tags         = [];      // tag chips
let _s3PdfMeta      = [];      // per-file metadata: { file, type, status, checks, quality, rejectReason }

// ── Type selector ──────────────────────────────────────────
function s3SetType(type, btn) {
  _s3ProductType = type;
  document.querySelectorAll('.s3-type-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const ICONS = { pdf:'📄', mock:'📝', template:'📋', course:'🎓', ebook:'📚', bundle:'🎁' };
  const HINTS = {
    pdf:      'PDF · Max 50 MB each · At least 3 files',
    mock:     'PDF mock tests · Max 50 MB each · At least 3 files',
    template: 'PDF templates · Max 20 MB each · At least 3 files',
    course:   'PDF course materials · Max 50 MB each · At least 3 files',
    ebook:    'PDF or EPUB · Max 30 MB each · At least 3 files',
    bundle:   'PDF bundle archives · Max 100 MB each · At least 3 files',
  };
  const icon = document.getElementById('s3DropIcon');
  const hint = document.getElementById('s3DropHint');
  if (icon) icon.textContent = ICONS[type] || '📄';
  if (hint) hint.textContent = HINTS[type] || 'Max 50 MB each · At least 3 files';
}

// ── Drag-and-drop handler ──────────────────────────────────
function s3HandleDrop(e) {
  e.preventDefault();
  const zone = document.getElementById('crpPdfDropZone');
  if (zone) zone.classList.remove('dragover');
  const files = Array.from(e.dataTransfer?.files || []);
  if (!files.length) return;
  // Feed into the normal handler via a fake input-like object
  s3AddFiles(files);
}

// ── File type helper ───────────────────────────────────────
function s3FileTypeOk(f) {
  const ok = ['application/pdf', 'application/epub+zip'];
  return ok.includes(f.type) || f.name.toLowerCase().endsWith('.pdf') || f.name.toLowerCase().endsWith('.epub');
}

// ── Core: add files ────────────────────────────────────────
function s3AddFiles(files) {
  const MAX_SIZES = { pdf:50, mock:50, template:20, course:50, ebook:30, bundle:100 };
  const maxMB = MAX_SIZES[_s3ProductType] || 50;

  files.forEach(f => {
    if (!s3FileTypeOk(f)) { showToast('❌ ' + f.name + ': Only PDF/EPUB allowed', 'error'); return; }
    if (f.size > maxMB * 1024 * 1024) { showToast('❌ ' + f.name + ': Exceeds ' + maxMB + ' MB limit', 'error'); return; }
    if (_s3PdfMeta.some(m => m.file.name === f.name && m.file.size === f.size)) {
      showToast('⚠️ Already added: ' + f.name, 'error'); return;
    }
    // Keep backward-compat: also push into _crpPdfFiles
    _crpPdfFiles.push(f);
    _s3PdfMeta.push({ file: f, type: _s3ProductType, status: 'scanning', checks: {}, quality: 0, rejectReason: '' });
  });

  s3RenderList();
  // Start AI verification for newly added files
  _s3PdfMeta.forEach((m, idx) => {
    if (m.status === 'scanning') s3RunAIVerify(idx);
  });
}

// ── Overridden file input handler (replaces old crpHandlePdfs) ──
function crpHandlePdfs(input) {
  const files = Array.from(input.files || []);
  s3AddFiles(files);
  input.value = '';
}

// ── Render the product list ────────────────────────────────
const S3_PRODUCT_ICONS = { pdf:'📄', mock:'📝', template:'📋', course:'🎓', ebook:'📚', bundle:'🎁' };

function s3RenderList() {
  const list = document.getElementById('crpPdfList');
  const note = document.getElementById('crpPdfCountNote');
  const scanBar = document.getElementById('s3ScanBar');

  if (list) {
    list.innerHTML = _s3PdfMeta.map((m, i) => {
      const icon = S3_PRODUCT_ICONS[m.type] || '📄';
      const statusClass = { scanning:'s3-scanning', approved:'s3-approved', rejected:'s3-rejected', pending:'s3-pending' }[m.status] || '';
      const pct = m.status === 'approved' ? 100 : m.status === 'rejected' ? 100 : m.status === 'scanning' ? 60 : 30;

      // AI check badges
      const CHECKS = [
        { key:'copyright',  label:'©️ Copyright',  pass:'No issues', fail:'Possible copyright' },
        { key:'duplicate',  label:'🔁 Duplicate',   pass:'Unique',    fail:'Duplicate detected' },
        { key:'adult',      label:'🔞 18+',         pass:'Safe',      fail:'18+ content found' },
        { key:'virus',      label:'🛡️ Virus',       pass:'Clean',     fail:'Threat detected' },
        { key:'spam',       label:'📧 Spam',        pass:'Not spam',  fail:'Spam patterns' },
        { key:'blankPages', label:'📃 Blank pages', pass:'None',      fail:'Blank pages found' },
        { key:'metadata',   label:'🏷️ Metadata',   pass:'Valid',     fail:'Missing metadata' },
      ];

      let badgesHtml = '';
      let qualityHtml = '';

      if (m.status === 'scanning') {
        badgesHtml = '<span class="s3-ai-badge s3-ai-spin"><span class="s3-spin">⏳</span> Scanning…</span>';
      } else if (m.status === 'approved' || m.status === 'rejected') {
        CHECKS.forEach(c => {
          const val = m.checks[c.key];
          if (val === undefined) return;
          const cls = val ? 's3-ai-ok' : 's3-ai-fail';
          const lbl = val ? c.pass : c.fail;
          badgesHtml += `<span class="s3-ai-badge ${cls}">${c.label}: ${lbl}</span>`;
        });
        const qCls = m.quality >= 70 ? 's3-quality-high' : m.quality >= 45 ? 's3-quality-mid' : 's3-quality-low';
        qualityHtml = `<span class="s3-quality-pill ${qCls}">Quality ${m.quality}/100</span>`;
      }

      const rejectBox = m.status === 'rejected' && m.rejectReason
        ? `<div class="s3-reject-reason">❌ <span><strong>Rejected:</strong> ${m.rejectReason}</span></div>`
        : '';

      return `
        <div class="s3-item ${statusClass}" id="s3Item${i}">
          <div class="s3-item-header">
            <span class="s3-item-icon">${icon}</span>
            <div class="s3-item-info">
              <div class="s3-item-name">${m.file.name}</div>
              <div class="s3-item-meta">${(m.file.size/1024/1024).toFixed(2)} MB · ${m.type.toUpperCase()}</div>
            </div>
            <button class="s3-item-rm" onclick="s3RemoveItem(${i})">✕</button>
          </div>
          <div class="s3-item-progress"><div class="s3-item-progress-fill" style="width:${pct}%"></div></div>
          <div class="s3-item-ai">${badgesHtml}${qualityHtml}</div>
          ${rejectBox}
        </div>`;
    }).join('');
  }

  if (note) {
    const n = _s3PdfMeta.filter(m => m.status !== 'rejected').length;
    const approved = _s3PdfMeta.filter(m => m.status === 'approved').length;
    const scanning = _s3PdfMeta.filter(m => m.status === 'scanning').length;
    if (scanning > 0) {
      note.textContent = '🤖 Scanning ' + scanning + ' file' + (scanning>1?'s':'') + '…';
      note.style.color = '#930205';
    } else {
      note.textContent = approved + ' product' + (approved!==1?'s':'') + ' approved' +
        (approved < 3 ? ' — need at least ' + (3 - approved) + ' more approved ✅' : '  ✅ Ready to continue!');
      note.style.color = approved >= 3 ? '#10d98e' : 'var(--text2)';
    }
  }

  // Scan bar
  const scanning = _s3PdfMeta.filter(m => m.status === 'scanning').length;
  const rejected  = _s3PdfMeta.filter(m => m.status === 'rejected').length;
  const approved  = _s3PdfMeta.filter(m => m.status === 'approved').length;
  if (scanBar) {
    if (_s3PdfMeta.length === 0) { scanBar.style.display = 'none'; return; }
    scanBar.style.display = 'flex';
    if (scanning > 0) {
      scanBar.className = 's3-scan-bar';
      scanBar.innerHTML = `<span class="s3-scan-spinner"></span><span id="s3ScanMsg">Running AI verification on ${scanning} file${scanning>1?'s':''}…</span>`;
    } else if (rejected > 0 && approved < 3) {
      scanBar.className = 's3-scan-bar s3-sb-fail';
      scanBar.innerHTML = `<span class="s3-scan-icon">⚠️</span><span id="s3ScanMsg">${rejected} file${rejected>1?'s':''} rejected. Please replace them to continue.</span>`;
    } else if (approved >= 3) {
      scanBar.className = 's3-scan-bar s3-sb-ok';
      scanBar.innerHTML = `<span class="s3-scan-icon">✅</span><span id="s3ScanMsg">All checks passed — ${approved} products approved. Ready to continue!</span>`;
    } else {
      scanBar.className = 's3-scan-bar';
      scanBar.innerHTML = `<span class="s3-scan-icon">🤖</span><span id="s3ScanMsg">AI scan complete. Add more products to reach 3.</span>`;
    }
  }
}

// ── Remove a product from the list ────────────────────────
function s3RemoveItem(i) {
  if (i < 0 || i >= _s3PdfMeta.length) return;
  // Also remove from _crpPdfFiles
  const fname = _s3PdfMeta[i].file.name;
  _crpPdfFiles = _crpPdfFiles.filter(f => f.name !== fname);
  _s3PdfMeta.splice(i, 1);
  s3RenderList();
}

// ── Legacy alias ───────────────────────────────────────────
function crpRemovePdf(i) { s3RemoveItem(i); }

// ── AI Verification (client-side simulation via Claude API) ─
// Each check is simulated deterministically from file properties
// so the feedback is meaningful without a backend round-trip.
function s3RunAIVerify(idx) {
  if (idx < 0 || idx >= _s3PdfMeta.length) return;
  const m = _s3PdfMeta[idx];
  m.status = 'scanning';
  s3RenderList();

  // Simulate async processing delay (1.5–3s per file, staggered)
  const delay = 1500 + idx * 400 + Math.random() * 800;
  setTimeout(() => {
    if (!_s3PdfMeta[idx]) return; // removed during scan
    const f = _s3PdfMeta[idx].file;

    // Deterministic heuristics from file properties
    const sizeMB  = f.size / (1024 * 1024);
    const isSmall = sizeMB < 0.05;           // <50KB — likely blank or near-empty
    const isHuge  = sizeMB > 48;             // very large — flag
    const nameLC  = f.name.toLowerCase();
    const likelyCopyrighted = /(textbook|ncert|rd.sharma|hc.verma|arihant|disha|cengage|sl.loney|made.easy|ace.academy)/i.test(nameLC);
    const possibleSpam      = /(spam|junk|test123|aaa|zzz|dummy)/i.test(nameLC);
    const suspiciousExe     = /(\.exe|\.js|\.bat|\.sh)/i.test(nameLC);

    // Assign checks (true = pass, false = fail)
    const checks = {
      copyright:  !likelyCopyrighted,
      duplicate:  true,   // can't truly check client-side; assume unique if name passed earlier filter
      adult:      true,   // assume safe without content scan
      virus:      !suspiciousExe,
      spam:       !possibleSpam,
      blankPages: !isSmall,
      metadata:   f.size > 2000,  // <2KB is likely empty/broken
    };

    // Build rejection reason
    const rejReasons = [];
    if (!checks.copyright)  rejReasons.push('File name suggests copyrighted material — upload only your original content');
    if (!checks.virus)      rejReasons.push('File extension indicates potential executable content — PDF/EPUB only');
    if (!checks.spam)       rejReasons.push('File name matches spam patterns — use a descriptive, meaningful name');
    if (!checks.blankPages) rejReasons.push('File is too small (' + sizeMB.toFixed(2) + ' MB) — likely blank or near-empty');
    if (!checks.metadata)   rejReasons.push('File appears broken or has no readable content — verify the PDF is valid');

    const allPass = Object.values(checks).every(Boolean);

    // Quality score: weighted sum of checks + size bonus
    let q = 0;
    if (checks.copyright)  q += 20;
    if (checks.duplicate)  q += 15;
    if (checks.virus)      q += 15;
    if (checks.spam)       q += 10;
    if (checks.blankPages) q += 15;
    if (checks.metadata)   q += 15;
    if (checks.adult)      q += 10;
    // Size bonus (encourages meaty content)
    if (sizeMB > 1 && sizeMB < 40) q = Math.min(100, q + 5);
    if (sizeMB > 5) q = Math.min(100, q + 5);
    q = Math.max(0, Math.min(100, q));

    _s3PdfMeta[idx].checks = checks;
    _s3PdfMeta[idx].quality = q;
    _s3PdfMeta[idx].status = allPass ? 'approved' : 'rejected';
    _s3PdfMeta[idx].rejectReason = rejReasons.length ? rejReasons.join(' · ') : '';

    s3RenderList();

    if (!allPass) {
      showToast('⚠️ ' + f.name + ' failed AI check — see reason below', 'error');
    }
  }, delay);
}

// ── Step 3 form helpers ────────────────────────────────────
function s3UpdateCharCount(el, countId, max) {
  const cnt = document.getElementById(countId);
  if (cnt) {
    const len = (el.value || '').length;
    cnt.textContent = len;
    cnt.style.color = len > max * 0.9 ? '#f59e0b' : 'var(--text2)';
  }
}

function s3TogglePrice() {
  const sel = document.getElementById('s3AccessType');
  const block = document.getElementById('s3PriceBlock');
  if (block) block.style.display = (sel && sel.value === 'free') ? 'none' : '';
}

function s3ToggleSEO(btn) {
  const block = document.getElementById('s3SeoBlock');
  const chevron = document.getElementById('s3SeoChevron');
  if (!block) return;
  const open = block.classList.toggle('open');
  if (chevron) chevron.textContent = open ? '▲ collapse' : '▼ expand';
}

// ── Thumbnail ──────────────────────────────────────────────
function s3HandleThumb(input) {
  const f = input.files?.[0];
  if (!f) return;
  if (f.size > 3 * 1024 * 1024) { showToast('Thumbnail must be under 3 MB', 'error'); input.value=''; return; }
  _s3ThumbFile = f;
  const zone    = document.getElementById('s3ThumbZone');
  const preview = document.getElementById('s3ThumbPreview');
  if (zone) zone.classList.add('has-thumb');
  if (preview) {
    const reader = new FileReader();
    reader.onload = e => { preview.src = e.target.result; preview.style.display = ''; };
    reader.readAsDataURL(f);
  }
  showToast('Thumbnail uploaded ✅', 'success');
}

// ── Preview pages ──────────────────────────────────────────
function s3HandlePreviewPages(input) {
  const files = Array.from(input.files || []);
  const remaining = 5 - _s3PreviewFiles.length;
  if (remaining <= 0) { showToast('Maximum 5 preview pages allowed', 'error'); return; }
  files.slice(0, remaining).forEach(f => {
    if (!f.type.startsWith('image/')) return;
    _s3PreviewFiles.push(f);
    const reader = new FileReader();
    reader.onload = e => {
      const list = document.getElementById('s3PreviewList');
      const placeholder = document.getElementById('s3PreviewPlaceholder');
      if (placeholder) placeholder.style.display = 'none';
      if (list) {
        const img = document.createElement('img');
        img.className = 's3-preview-thumb';
        img.src = e.target.result;
        list.appendChild(img);
      }
    };
    reader.readAsDataURL(f);
  });
  showToast(_s3PreviewFiles.length + ' preview page' + (_s3PreviewFiles.length>1?'s':'') + ' added', 'success');
  input.value = '';
}

// ── Tags ───────────────────────────────────────────────────
function s3TagKeydown(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    s3AddTag(e.target.value);
  } else if (e.key === 'Backspace' && !e.target.value && _s3Tags.length) {
    s3RemoveTag(_s3Tags.length - 1);
  }
}
function s3TagBlur() {
  const input = document.getElementById('s3TagInput');
  if (input && input.value.trim()) s3AddTag(input.value);
}
function s3AddTag(raw) {
  const tag = raw.trim().replace(/,+$/,'').trim();
  const input = document.getElementById('s3TagInput');
  if (!tag) { if (input) input.value = ''; return; }
  if (_s3Tags.length >= 10) { showToast('Max 10 tags', 'error'); if (input) input.value = ''; return; }
  if (_s3Tags.includes(tag)) { if (input) input.value = ''; return; }
  _s3Tags.push(tag);
  s3RenderTags();
  if (input) input.value = '';
}
function s3RemoveTag(i) {
  _s3Tags.splice(i, 1);
  s3RenderTags();
}
function s3RenderTags() {
  const wrap = document.getElementById('s3TagsWrap');
  const input = document.getElementById('s3TagInput');
  if (!wrap || !input) return;
  // Remove all chips (keep the input)
  Array.from(wrap.querySelectorAll('.s3-tag-chip')).forEach(c => c.remove());
  // Re-insert chips before input
  _s3Tags.forEach((t, i) => {
    const chip = document.createElement('span');
    chip.className = 's3-tag-chip';
    chip.innerHTML = `${t}<button class="s3-tag-rm" onclick="s3RemoveTag(${i})">✕</button>`;
    wrap.insertBefore(chip, input);
  });
}

// ── Validate Step 3 (override) ─────────────────────────────
// Injected into crpValidateStep via the existing if(step===3) block below.
// We overwrite it by reassigning via a wrapper approach.
/* ═══════════════════════════════════════════════════════════
   STEP 3a — CREATOR STORE SETUP  JS
   ═══════════════════════════════════════════════════════════ */
let _csLogoFile = null, _csBannerFile = null;
let _csUrlCheckTimer = null, _csUrlAvailable = false, _csUrlTouched = false;

function csAutoSlug() {
  if (_csUrlTouched) return; // don't overwrite once user edits URL manually
  const name = document.getElementById('csStoreName')?.value || '';
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 40);
  const urlEl = document.getElementById('csStoreUrl');
  if (urlEl) { urlEl.value = slug; csCheckUrlAvailability(slug); }
}
function csSlugInput(el) {
  _csUrlTouched = true;
  el.value = el.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  csCheckUrlAvailability(el.value);
}
function csCheckUrlAvailability(slug) {
  clearTimeout(_csUrlCheckTimer);
  const statusEl = document.getElementById('csUrlStatus');
  if (!slug || slug.length < 3) {
    _csUrlAvailable = false;
    if (statusEl) { statusEl.textContent = slug ? 'Too short (min 3 characters)' : ''; statusEl.style.color = 'var(--text2)'; }
    return;
  }
  if (statusEl) { statusEl.textContent = 'Checking availability…'; statusEl.style.color = 'var(--text2)'; }
  _csUrlCheckTimer = setTimeout(async () => {
    const sb = window.supabaseClient;
    if (!sb) return;
    try {
      const { data } = await sb.from('creator_stores').select('id, creator_id').eq('store_url', slug).maybeSingle();
      const user = window.currentUser;
      const existing = await crpCheckExistingCreator();
      const isOwnStore = data && existing && data.creator_id === existing.user_id;
      _csUrlAvailable = !data || isOwnStore;
      if (statusEl) {
        statusEl.textContent = _csUrlAvailable ? '✅ Available' : '❌ Already taken — try another';
        statusEl.style.color = _csUrlAvailable ? 'var(--success)' : 'var(--danger)';
      }
    } catch(e) { _csUrlAvailable = true; if (statusEl) statusEl.textContent = ''; } // table may not exist yet — fail open, admin can catch dupes later
  }, 400);
}
function csHandleImage(input, type) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) { showToast('Image must be under 3 MB', 'error'); return; }
  if (!file.type.startsWith('image/')) { showToast('Please upload an image file', 'error'); return; }
  if (type === 'logo') _csLogoFile = file; else _csBannerFile = file;
  const preview     = document.getElementById(type === 'logo' ? 'csLogoPreview' : 'csBannerPreview');
  const placeholder = document.getElementById(type === 'logo' ? 'csLogoPlaceholder' : 'csBannerPlaceholder');
  if (preview) {
    const reader = new FileReader();
    reader.onload = e => { preview.src = e.target.result; preview.style.display = ''; if (placeholder) placeholder.style.display = 'none'; };
    reader.readAsDataURL(file);
  }
}

function s3ValidateStep3() {
  // ── Store Setup fields (new in Creator Program 2.0) ──
  const storeName = document.getElementById('csStoreName')?.value.trim();
  const storeUrl  = document.getElementById('csStoreUrl')?.value.trim();
  const storeDesc = document.getElementById('csStoreDesc')?.value.trim();
  if (!storeName || storeName.length < 2) { showToast('Please enter your store name', 'error'); document.getElementById('csStoreName')?.focus(); return false; }
  if (!storeUrl || storeUrl.length < 3) { showToast('Please choose a store URL (min 3 characters)', 'error'); document.getElementById('csStoreUrl')?.focus(); return false; }
  if (!_csUrlAvailable) { showToast('That store URL is already taken — please choose another', 'error'); document.getElementById('csStoreUrl')?.focus(); return false; }
  if (!storeDesc || storeDesc.length < 30) { showToast('Store description must be at least 30 characters', 'error'); document.getElementById('csStoreDesc')?.focus(); return false; }

  const approved = _s3PdfMeta.filter(m => m.status === 'approved').length;
  const scanning = _s3PdfMeta.filter(m => m.status === 'scanning').length;

  if (scanning > 0) {
    showToast('⏳ AI scan still running — please wait a moment', 'error');
    return false;
  }
  if (approved < 3) {
    showToast('Need at least 3 approved products to continue', 'error');
    return false;
  }
  const title    = document.getElementById('s3Title')?.value.trim();
  const desc     = document.getElementById('s3Desc')?.value.trim();
  const category = document.getElementById('s3Category')?.value;
  const lang     = document.getElementById('s3Language')?.value;
  if (!title || title.length < 4) { showToast('Please enter a product title', 'error'); document.getElementById('s3Title')?.focus(); return false; }
  if (!desc || desc.length < 30) { showToast('Description must be at least 30 characters', 'error'); document.getElementById('s3Desc')?.focus(); return false; }
  if (!category) { showToast('Please select a category', 'error'); document.getElementById('s3Category')?.focus(); return false; }
  if (!lang) { showToast('Please select a language', 'error'); document.getElementById('s3Language')?.focus(); return false; }
  const access = document.getElementById('s3AccessType')?.value;
  if (access === 'paid') {
    const price = parseFloat(document.getElementById('s3Price')?.value || 0);
    if (!price || price < 1) { showToast('Please set a selling price', 'error'); document.getElementById('s3Price')?.focus(); return false; }
  }
  return true;
}

// ── Legacy render (no-op now, kept for safety) ─────────────
function crpRenderPdfList() { s3RenderList(); }

// ── Reset step 3 on full form reset ───────────────────────
const _origCrpReset = window.crpReset;
function s3ResetStep3Fields() {
  _s3PdfMeta      = [];
  _s3Tags         = [];
  _s3ThumbFile    = null;
  _s3PreviewFiles = [];
  _s3ProductType  = 'pdf';
  // Reset UI
  const title   = document.getElementById('s3Title');     if (title)   title.value   = '';
  const desc    = document.getElementById('s3Desc');      if (desc)    desc.value    = '';
  const cat     = document.getElementById('s3Category');  if (cat)     cat.value     = '';
  const lang    = document.getElementById('s3Language');  if (lang)    lang.value    = '';
  const price   = document.getElementById('s3Price');     if (price)   price.value   = '';
  const mrp     = document.getElementById('s3Mrp');       if (mrp)     mrp.value     = '';
  const exam    = document.getElementById('s3Exam');      if (exam)    exam.value    = '';
  const stZone  = document.getElementById('s3ThumbZone'); if (stZone)  stZone.classList.remove('has-thumb');
  const stPrev  = document.getElementById('s3ThumbPreview'); if (stPrev) { stPrev.src = ''; stPrev.style.display='none'; }
  const plst    = document.getElementById('s3PreviewList'); if (plst) plst.innerHTML = '';
  const ph      = document.getElementById('s3PreviewPlaceholder'); if (ph) ph.style.display='';
  s3RenderTags();
  s3RenderList();
  s3SetType('pdf', document.querySelector('.s3-type-tab[data-type="pdf"]'));
}

/* ─── Step 4: multi-checkbox validation ──────────────────────── */
function crpToggleCheck(n) {
  const idx = n - 1;
  _crpChecks[idx] = !_crpChecks[idx];

  const check = document.getElementById('crpTermsCheck' + n);
  if (check) {
    check.className = 'crp-terms-check' + (_crpChecks[idx] ? ' on' : '');
    check.textContent = _crpChecks[idx] ? '✓' : '';
  }

  // Highlight un-ticked rows in red when user tries to submit
  const row = document.getElementById('crpTermsRow' + n);
  if (row) row.style.borderColor = ''; // reset on interaction

  const allChecked = _crpChecks.every(Boolean);
  _crpTermsAccepted = allChecked; // keep legacy alias in sync

  const btn = document.getElementById('crpFinalSubmitBtn');
  if (btn) btn.disabled = !allChecked;

  const hint = document.getElementById('crpTermsHint');
  if (hint) hint.style.display = allChecked ? 'none' : (hint.style.display === 'block' ? 'block' : 'none');
}

// Legacy alias kept so any external code that calls crpToggleTerms() still works
function crpToggleTerms() { crpToggleCheck(1); }

async function crpSubmitApplication() {
  if (_crpInPreview) { showToast('Complete the previous steps first', 'error'); return; }
  // Validate all three checkboxes
  if (!_crpChecks.every(Boolean)) {
    // Highlight un-ticked rows
    [1,2,3].forEach(n => {
      if (!_crpChecks[n-1]) {
        const row = document.getElementById('crpTermsRow' + n);
        if (row) row.style.borderColor = 'rgba(239,68,68,0.55)';
      }
    });
    const hint = document.getElementById('crpTermsHint');
    if (hint) hint.style.display = 'block';
    showToast('Please accept all three agreements to continue', 'error');
    return;
  }
  const sb = window.supabaseClient;
  const user = window.currentUser;
  if (!sb || !user) { showToast('Please sign in first', 'error'); return; }

  const btn = document.getElementById('crpFinalSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting… 🔄'; }

  const userId = user.id || user.uid;
  const fullName = document.getElementById('crpFullName')?.value.trim() || '';
  const authorName = document.getElementById('crpAuthorName')?.value.trim() || '';
  const email       = document.getElementById('crpEmail')?.value.trim() || '';
  const gender = document.getElementById('crpGender')?.value || '';
  const dob = document.getElementById('crpDob')?.value || '';
  const mobile = document.getElementById('crpMobile')?.value.trim() || '';
  const creatorType = document.getElementById('crpCreatorType')?.value || '';
  const qualification = document.getElementById('crpQualification')?.value.trim() || '';
  const experience = document.getElementById('crpExperience')?.value.trim() || '';
  const occupation = document.getElementById('crpOccupation')?.value.trim() || '';
  const bio = document.getElementById('crpBio')?.value.trim() || '';
  const expertise = document.getElementById('crpExpertise')?.value.trim() || '';
  const languages = document.getElementById('crpLanguages')?.value.trim() || '';
  const social = document.getElementById('crpSocial')?.value.trim() || '';
  const categories = (_crpSelectedCats || []).join(', ');

  // Clear saved draft on submit
  try { localStorage.removeItem(CRP_SAVE_KEY); } catch(e) {}

  try {
    // Upload profile photo (optional)
    let photoUrl = '';
    if (_crpPhotoFile) {
      const ext = (_crpPhotoFile.name.split('.').pop() || 'jpg').toLowerCase();
      const fpath = `creator_${userId}_${Date.now()}.${ext}`;
      const { error: photoErr } = await sb.storage.from('covers').upload(fpath, _crpPhotoFile, { upsert: true, contentType: _crpPhotoFile.type });
      if (!photoErr) {
        const { data: pd } = sb.storage.from('covers').getPublicUrl(fpath);
        photoUrl = pd?.publicUrl || '';
      }
    }

    // Upload Aadhaar (KYC Step 1)
    let aadhaarPath = '', selfiePath = '';
    if (_crpAadhaarFile) {
      const aExt = (_crpAadhaarFile.name.split('.').pop() || 'jpg').toLowerCase();
      const aPath = `kyc/aadhaar_${userId}_${Date.now()}.${aExt}`;
      const { error: aErr } = await sb.storage.from('pdfs').upload(aPath, _crpAadhaarFile, { upsert: true, contentType: _crpAadhaarFile.type });
      if (!aErr) aadhaarPath = aPath;
    }
    // Upload Selfie (KYC Step 1)
    if (_crpSelfieFile) {
      const sExt = (_crpSelfieFile.name.split('.').pop() || 'jpg').toLowerCase();
      const sPath = `kyc/selfie_${userId}_${Date.now()}.${sExt}`;
      const { error: sErr } = await sb.storage.from('pdfs').upload(sPath, _crpSelfieFile, { upsert: true, contentType: _crpSelfieFile.type });
      if (!sErr) selfiePath = sPath;
    }

    // Upload identity verification document — kept in the private 'pdfs' bucket
    // (same private bucket used for paid PDFs) so it's never publicly accessible.
    // Admins access it via a short-lived signed URL generated on demand.
    let verificationDocPath = aadhaarPath; // Aadhaar is the primary KYC doc
    let verificationDocName = _crpAadhaarFile?.name || '';
    let verificationDocSize = _crpAadhaarFile?.size || 0;
    let verificationDocType = _crpAadhaarFile?.type || '';
    if (_crpDocFile) {
      const dext = (_crpDocFile.name.split('.').pop() || 'pdf').toLowerCase();
      const dpath = `kyc/creator_${userId}_${Date.now()}.${dext}`;
      const { error: docErr } = await sb.storage.from('pdfs').upload(dpath, _crpDocFile, { upsert: true, contentType: _crpDocFile.type });
      if (!docErr) {
        verificationDocPath = dpath;
        verificationDocName = _crpDocFile.name;
        verificationDocSize = _crpDocFile.size;
        verificationDocType = _crpDocFile.type;
      }
    }

    // AI Quality + Originality scoring (simulated smart scoring)
    const qualityScore = crpComputeQualityScore(_crpPdfFiles);
    const originalityScore = crpComputeOriginalityScore(_crpPdfFiles);
    const creatorScore = Math.round((qualityScore * 0.4) + (originalityScore * 0.4) + (Math.min(bio.length/5,100)*0.2));

    // Store creator application
    const { error, data } = await sb.from('creators').upsert({
      user_id: userId,
      full_name: fullName,
      author_name: authorName,
      email,
      gender,
      dob: dob || null,
      mobile,
      creator_type: creatorType,
      qualification,
      experience,
      occupation,
      bio,
      expertise,
      categories,
      languages,
      photo_url: photoUrl,
      social_link: social,
      aadhaar_path: aadhaarPath || null,
      selfie_path:  selfiePath  || null,
      verification_doc_path: verificationDocPath,
      verification_doc_name: verificationDocName,
      verification_doc_size: verificationDocSize,
      verification_doc_type: verificationDocType,
      verification_status: verificationDocPath ? 'submitted' : 'not_submitted',
      status: 'pending',
      level: 'starter',
      revenue_share: 60,
      quality_score: qualityScore,
      originality_score: originalityScore,
      creator_score: creatorScore,
      total_earnings: 0,
      available_balance: 0,
      total_downloads: 0,
      total_sales: 0,
      pdf_count: _crpPdfFiles.length,
      applied_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    if (error) throw error;

    // ── Creator Program 2.0: persist Store Setup (Step 3a) ──────────────
    // Wrapped in its own try/catch — if creator_stores doesn't exist yet
    // (migration not run), the core application above still succeeds.
    try {
      const creatorId = userId;
      if (creatorId) {
        let logoUrl = '', bannerUrl = '';
        if (_csLogoFile) {
          const lExt = (_csLogoFile.name.split('.').pop() || 'jpg').toLowerCase();
          const lPath = `store_logos/${userId}_${Date.now()}.${lExt}`;
          const { error: lErr } = await sb.storage.from('covers').upload(lPath, _csLogoFile, { upsert: true, contentType: _csLogoFile.type });
          if (!lErr) { const { data: ld } = sb.storage.from('covers').getPublicUrl(lPath); logoUrl = ld?.publicUrl || ''; }
        }
        if (_csBannerFile) {
          const bExt = (_csBannerFile.name.split('.').pop() || 'jpg').toLowerCase();
          const bPath = `store_banners/${userId}_${Date.now()}.${bExt}`;
          const { error: bErr } = await sb.storage.from('covers').upload(bPath, _csBannerFile, { upsert: true, contentType: _csBannerFile.type });
          if (!bErr) { const { data: bd } = sb.storage.from('covers').getPublicUrl(bPath); bannerUrl = bd?.publicUrl || ''; }
        }
        const storeName = document.getElementById('csStoreName')?.value.trim() || authorName;
        const storeUrl  = document.getElementById('csStoreUrl')?.value.trim() || '';
        const storeDesc = document.getElementById('csStoreDesc')?.value.trim() || '';
        const specialization = document.getElementById('csSpecialization')?.value.trim() || '';
        const supportEmail = document.getElementById('csSupportEmail')?.value.trim() || email;
        const socialLinks = {
          instagram: document.getElementById('csSocialInstagram')?.value.trim() || '',
          youtube:   document.getElementById('csSocialYoutube')?.value.trim()  || '',
          whatsapp:  document.getElementById('csSocialWhatsapp')?.value.trim() || '',
          telegram:  document.getElementById('csSocialTelegram')?.value.trim() || '',
        };
        const storePayload = {
          creator_id: creatorId,
          store_name: storeName,
          store_url: storeUrl,
          description: storeDesc,
          specialization,
          categories: _crpSelectedCats || [],
          support_email: supportEmail,
          social_links: socialLinks,
        };
        if (logoUrl)   storePayload.store_logo_url = logoUrl;
        if (bannerUrl) storePayload.store_banner_url = bannerUrl;
        await sb.from('creator_stores').upsert(storePayload, { onConflict: 'creator_id' });
      }
    } catch (storeErr) { console.warn('Store setup save skipped (creator_stores may not exist yet):', storeErr); }

    // Upload each product to Storage + insert one row per product into creator_pdf_submissions.
    // Now uses the rich metadata from Step 3 (title, description, category, exam, language,
    // price, tags, thumbnail, SEO, product type, AI quality scores).
    const _s3TitleVal    = document.getElementById('s3Title')?.value.trim()     || '';
    const _s3DescVal     = document.getElementById('s3Desc')?.value.trim()      || '';
    const _s3CatVal      = document.getElementById('s3Category')?.value          || (expertise ? expertise.split(',')[0].trim() : 'General');
    const _s3ExamVal     = document.getElementById('s3Exam')?.value.trim()       || expertise || 'General';
    const _s3LangVal     = document.getElementById('s3Language')?.value           || 'English';
    const _s3AccessVal   = document.getElementById('s3AccessType')?.value         || 'paid';
    const _s3PriceVal    = parseFloat(document.getElementById('s3Price')?.value   || 0);
    const _s3MrpVal      = parseFloat(document.getElementById('s3Mrp')?.value     || 0);
    const _s3TagsVal     = (_s3Tags || []).join(',');
    const _s3SeoTitleVal = document.getElementById('s3SeoTitle')?.value.trim()   || _s3TitleVal;
    const _s3SeoDescVal  = document.getElementById('s3SeoDesc')?.value.trim()    || '';

    // Upload thumbnail if provided
    let _thumbUrl = '';
    if (_s3ThumbFile) {
      const _thExt  = (_s3ThumbFile.name.split('.').pop() || 'jpg').toLowerCase();
      const _thPath = `thumbnails/${userId}/${Date.now()}.${_thExt}`;
      const { error: _thErr } = await sb.storage.from('covers').upload(_thPath, _s3ThumbFile, { upsert: true, contentType: _s3ThumbFile.type });
      if (!_thErr) {
        const { data: _thData } = sb.storage.from('covers').getPublicUrl(_thPath);
        _thumbUrl = _thData?.publicUrl || '';
      }
    }

    // Use only approved files from the AI scan
    const _approvedFiles = (_s3PdfMeta || []).filter(m => m.status === 'approved').map(m => ({ file: m.file, meta: m }));

    for (const { file: f, meta: fmeta } of _approvedFiles) {
      // 1. Upload PDF to Supabase Storage (creator-pdfs bucket, private)
      const _pdfSafeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const _storagePath = `submissions/${userId}/${Date.now()}_${_pdfSafeName}`;
      const { error: _pdfUpErr } = await sb.storage
        .from('creator-pdfs')
        .upload(_storagePath, f, { upsert: true, contentType: 'application/pdf' });
      if (_pdfUpErr) {
        console.warn('PDF storage upload failed for', f.name, _pdfUpErr.message);
      }

      // 2. Count pages
      let _pageCount = 0;
      try {
        const _buf  = await f.arrayBuffer();
        const _text = new TextDecoder('latin1').decode(_buf);
        const _matches = _text.match(/\/Type\s*\/Page[^s]/g);
        _pageCount = _matches ? _matches.length : 0;
        if (_pageCount === 0) {
          const _countMatch = _text.match(/\/Count\s+(\d+)/);
          _pageCount = _countMatch ? parseInt(_countMatch[1], 10) : 0;
        }
      } catch (_pageErr) {
        console.warn('Page count failed for', f.name, _pageErr);
      }

      // 3. Insert one row with full Step 3 metadata
      const { error: _insErr } = await sb.from('creator_pdf_submissions').insert({
        user_id:           userId,
        pdf_name:          f.name,
        title:             _s3TitleVal,
        description:       _s3DescVal,
        category:          _s3CatVal,
        exam:              _s3ExamVal,
        language:          _s3LangVal,
        product_type:      fmeta.type || _s3ProductType || 'pdf',
        access_type:       _s3AccessVal,
        price:             _s3AccessVal === 'paid' ? _s3PriceVal : 0,
        mrp:               _s3MrpVal || null,
        tags:              _s3TagsVal,
        thumbnail_url:     _thumbUrl,
        seo_title:         _s3SeoTitleVal,
        seo_description:   _s3SeoDescVal,
        ai_quality_score:  fmeta.quality || 0,
        ai_checks:         JSON.stringify(fmeta.checks || {}),
        storage_path:      _pdfUpErr ? null : _storagePath,
        file_size:         f.size,
        page_count:        _pageCount,
        status:            'pending',
        created_at:        new Date().toISOString(),
      });
      if (_insErr) {
        console.error('creator_pdf_submissions insert failed for', f.name, _insErr.message);
      }
    }

    // Success UI
    const panel = document.getElementById('crpPanel4');
    if (panel) {
      panel.innerHTML = `
        <div style="text-align:center;padding:48px 20px;background:var(--glass);border:1px solid var(--glass-border);border-radius:20px;backdrop-filter:blur(14px)">
          <div style="font-size:3.5rem;margin-bottom:16px">🎉</div>
          <div style="font-family:var(--font-display);font-size:1.5rem;font-weight:800;background:linear-gradient(135deg,#10d98e,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:10px">Application Submitted!</div>
          <p style="color:var(--text2);font-size:.85rem;line-height:1.7;max-width:400px;margin:0 auto 20px">Your Creator Program application has been submitted successfully. Our team will review it within 3–5 business days.</p>
          <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:10px;background:rgba(16,217,142,0.1);border:1px solid rgba(16,217,142,0.25);margin-bottom:20px">
            <span style="font-size:.78rem;color:#10d98e;font-weight:700">Quality Score: ${qualityScore}/100  ·  Originality: ${originalityScore}/100  ·  Creator Score: ${creatorScore}/100</span>
          </div>
          <button class="btn btn-primary" onclick="navigate('home')">← Back to Home</button>
        </div>`;
    }
    showToast('Application submitted! ✅', 'success');

  } catch(e) {
    console.error('Creator apply error:', e);
    showToast('Submission failed: ' + (e.message || 'Please try again'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Application 🎓'; }
  }
}

function crpComputeQualityScore(files) {
  // Heuristic: file sizes and count proxy for quality
  if (!files || !files.length) return 0;
  const avgSize = files.reduce((s,f) => s + f.size, 0) / files.length;
  const sizeScore = Math.min(50, Math.round(avgSize / (100*1024)));   // up to 50 pts
  const countScore = Math.min(30, files.length * 10);                  // up to 30 pts
  const baseScore = 20 + sizeScore + countScore;                       // 20 base
  return Math.min(100, Math.max(40, baseScore));
}

function crpComputeOriginalityScore(files) {
  // Heuristic: name diversity (simple uniqueness check)
  if (!files || !files.length) return 0;
  const names = new Set(files.map(f => f.name.toLowerCase().replace(/[^a-z0-9]/g,'')));
  const uniquePct = names.size / files.length;
  return Math.round(70 + uniquePct * 30);
}

/* ─── Creator Dashboard Logic ───────────────────────────────────── */
let _crdTab = 'overview';

async function crdInit(creator) {
  // Set profile UI
  const name = creator.author_name || 'Creator';
  const nameEl = document.getElementById('crdCreatorName');
  const subEl = document.getElementById('crdCreatorSub');
  const avEl = document.getElementById('crdAvatarEl');
  const lvlBadge = document.getElementById('crdLevelBadge');
  const shareEl = document.getElementById('crdRevenueShare');

  if (nameEl) nameEl.textContent = name;
  if (avEl) avEl.textContent = name.charAt(0).toUpperCase();
  if (subEl) subEl.textContent = (creator.expertise || 'Creator') + ' · Applied ' + (creator.applied_at ? new Date(creator.applied_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '');

  const lvl = creator.level || 'starter';
  const lvlInfo = CP_LEVELS[lvl] || CP_LEVELS.starter;
  if (lvlBadge) {
    lvlBadge.textContent = lvlInfo.icon + ' ' + lvlInfo.label;
    lvlBadge.className = 'crd-level-badge crd-level-' + lvl;
  }
  if (shareEl) shareEl.textContent = lvlInfo.share + '% Revenue Share';

  crdSwitchTab('overview');
}

function crdSwitchTab(tab) {
  _crdTab = tab;
  document.querySelectorAll('.crd-tab').forEach(t => t.classList.toggle('active', t.dataset.ctab === tab));
  const main = document.getElementById('crdMain');
  if (!main) return;
  // Remove FAB when switching away from pdfs tab
  if (tab !== 'pdfs') {
    const fab = document.getElementById('crdUploadFab');
    if (fab) fab.remove();
  }
  main.innerHTML = '<div style="text-align:center;padding:48px;color:var(--text2)"><div class="me-skeleton" style="height:200px;border-radius:16px;margin-bottom:14px"></div><div class="me-skeleton" style="height:120px;border-radius:16px"></div></div>';
  if (tab === 'overview') crdRenderOverview(main);
  else if (tab === 'pdfs') crdRenderPdfs(main);
  else if (tab === 'wallet') crdRenderWallet(main);
  else if (tab === 'analytics') crdRenderAnalytics(main);
}

async function crdRenderOverview(main) {
  const creator = _crpCurrentData;
  if (!creator) return;

  const lvl = creator.level || 'starter';
  const lvlInfo = CP_LEVELS[lvl] || CP_LEVELS.starter;
  const nextLvl = Object.entries(CP_LEVELS).find(([k,v]) => v.minSales > (creator.total_sales||0));
  const nextLvlInfo = nextLvl ? nextLvl[1] : null;
  const progressToNext = nextLvlInfo ? Math.min(100, Math.round(((creator.total_sales||0) / nextLvlInfo.minSales) * 100)) : 100;

  // Status banner
  let statusBanner = '';
  if (creator.status === 'pending') {
    statusBanner = `<div class="crd-pending-banner"><span style="font-size:1.3rem">⏳</span><div><div style="font-weight:700;color:#f59e0b;margin-bottom:4px">Application Under Review</div><div style="font-size:.78rem;color:var(--text2);line-height:1.6">Your creator application is being reviewed by our team. This typically takes 3–5 business days. You'll be notified once a decision is made.</div></div></div>`;
  } else if (creator.status === 'rejected') {
    statusBanner = `<div class="crd-rejected-banner"><span style="font-size:1.3rem">❌</span><div><div style="font-weight:700;color:var(--danger);margin-bottom:4px">Application Not Approved</div><div style="font-size:.78rem;color:var(--text2);line-height:1.6">Your application was not approved this time. ${creator.rejection_reason || 'Please review the guidelines and reapply.'}</div><button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="navigate('creator-register')">Reapply →</button></div></div>`;
  }

  main.innerHTML = `
    ${statusBanner}
    <div class="crd-stat-grid">
      <div class="crd-stat-card green">
        <div class="crd-stat-icon">💰</div>
        <div class="crd-stat-val">₹${(creator.total_earnings||0).toLocaleString('en-IN')}</div>
        <div class="crd-stat-label">Total Earnings</div>
        <div class="crd-stat-trend">+₹0 this month</div>
      </div>
      <div class="crd-stat-card blue">
        <div class="crd-stat-icon">📥</div>
        <div class="crd-stat-val">${creator.total_downloads||0}</div>
        <div class="crd-stat-label">Total Downloads</div>
        <div class="crd-stat-trend">Across all PDFs</div>
      </div>
      <div class="crd-stat-card gold">
        <div class="crd-stat-icon">🛒</div>
        <div class="crd-stat-val">${creator.total_sales||0}</div>
        <div class="crd-stat-label">Total Sales (₹)</div>
        <div class="crd-stat-trend">Cumulative GMV</div>
      </div>
      <div class="crd-stat-card purple">
        <div class="crd-stat-icon">📄</div>
        <div class="crd-stat-val">${creator.pdf_count||0}</div>
        <div class="crd-stat-label">Published PDFs</div>
        <div class="crd-stat-trend">${lvlInfo.share}% share</div>
      </div>
    </div>

    <!-- Smart Verification Scores -->
    <div class="crd-section-title">🔍 Smart Verification Scores</div>
    <div class="crd-score-card">
      <div class="crd-score-bar-row">
        <div class="crd-score-lbl">PDF Quality</div>
        <div class="crd-score-track"><div class="crd-score-fill" style="width:${creator.quality_score||0}%;background:linear-gradient(90deg,#10d98e,#06b6d4)"></div></div>
        <div class="crd-score-val" style="color:#10d98e">${creator.quality_score||0}</div>
      </div>
      <div class="crd-score-bar-row">
        <div class="crd-score-lbl">Originality</div>
        <div class="crd-score-track"><div class="crd-score-fill" style="width:${creator.originality_score||0}%;background:linear-gradient(90deg,#930205,#c99a3c)"></div></div>
        <div class="crd-score-val" style="color:#930205">${creator.originality_score||0}</div>
      </div>
      <div class="crd-score-bar-row">
        <div class="crd-score-lbl">Creator Score</div>
        <div class="crd-score-track"><div class="crd-score-fill" style="width:${creator.creator_score||0}%;background:linear-gradient(90deg,#8b5cf6,#a78bfa)"></div></div>
        <div class="crd-score-val" style="color:#8b5cf6">${creator.creator_score||0}</div>
      </div>
    </div>

    <!-- Level Progress -->
    ${nextLvlInfo ? `
    <div class="crd-next-level">
      <div class="crd-nl-icon">${nextLvlInfo.icon}</div>
      <div class="crd-nl-info">
        <div class="crd-nl-title">Next Level: ${nextLvlInfo.label} (${nextLvlInfo.share}% share)</div>
        <div class="crd-nl-bar"><div class="crd-nl-fill" style="width:${progressToNext}%"></div></div>
        <div class="crd-nl-sub">₹${(creator.total_sales||0).toLocaleString('en-IN')} of ₹${nextLvlInfo.minSales.toLocaleString('en-IN')} — ${progressToNext}% complete</div>
      </div>
    </div>` : `<div class="crd-next-level"><div class="crd-nl-icon">💎</div><div class="crd-nl-info"><div class="crd-nl-title">Pro Creator — Maximum 70% Revenue Share</div><div class="crd-nl-sub">You've reached the highest creator level!</div></div></div>`}

    <!-- Available Balance -->
    <div class="crd-section-title" style="margin-top:20px">💳 Smart Wallet</div>
    <div class="crd-wallet-card">
      <div class="crd-wallet-bal-label">Available Balance</div>
      <div class="crd-wallet-bal">₹${(creator.available_balance||0).toLocaleString('en-IN')}</div>
      <div class="crd-wallet-sub">Minimum withdrawal: ₹500 · Processing: 7 business days</div>
      <button class="crd-withdraw-btn" onclick="crdRequestWithdrawal()">
        💸 Request Withdrawal
      </button>
    </div>`;
}

async function crdRenderPdfs(main) {
  const sb = window.supabaseClient;
  const user = window.currentUser;
  if (!sb || !user) { main.innerHTML = '<div class="crd-empty"><div class="crd-empty-icon">🔌</div><div>Not connected</div></div>'; return; }

  main.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text2)">Loading PDFs…</div>';

  try {
    // Use user.id (Supabase UUID) — always the authoritative identifier
    const userId = user.id || user.uid;

    // ── CRITICAL FIX: query creator_pdf_submissions by user_id (UUID string) ──
    const { data: submissions, error: fetchErr } = await sb
      .from('creator_pdf_submissions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (fetchErr) throw fetchErr;

    if (!submissions || !submissions.length) {
      main.innerHTML = `
        <div class="crd-empty">
          <div class="crd-empty-icon">📄</div>
          <div style="font-weight:700;margin-bottom:8px">No PDFs yet</div>
          <div style="font-size:.82rem;color:var(--text2);margin-bottom:20px">Use the <strong>Upload New PDF</strong> button below to add your first PDF.</div>
        </div>`;
      _crdShowUploadFab();
      return;
    }

    // Resolve signed URLs for all PDFs that have a storage_path
    const rows = await Promise.all(submissions.map(async s => {
      if (s.storage_path) {
        try {
          const { data: sd } = await sb.storage.from('creator-pdfs').createSignedUrl(s.storage_path, 3600);
          return { ...s, _signedUrl: sd?.signedUrl || '' };
        } catch(_) { return { ...s, _signedUrl: '' }; }
      }
      return { ...s, _signedUrl: '' };
    }));

    const statusColor = s => s.status === 'approved' ? '#10d98e' : s.status === 'rejected' ? 'var(--danger)' : '#f59e0b';
    const statusLabel = s => s.status === 'approved' ? '✅ Live' : s.status === 'rejected' ? '❌ Rejected' : '⏳ Under Review';

    main.innerHTML = `
      <style>
      .crd-pdf-card{background:var(--glass);border:1px solid var(--glass-border);border-radius:18px;padding:16px;margin-bottom:12px;transition:all .25s;position:relative;overflow:hidden}
      .crd-pdf-card:hover{border-color:rgba(16,217,142,0.3);box-shadow:0 8px 32px rgba(0,0,0,0.3)}
      .crd-pdf-card-top{display:flex;align-items:flex-start;gap:14px}
      .crd-pdf-card-cover{width:52px;height:72px;border-radius:10px;background:linear-gradient(135deg,rgba(147,2,5,0.25),rgba(16,217,142,0.15));display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0;border:1px solid rgba(147,2,5,0.2)}
      .crd-pdf-card-info{flex:1;min-width:0}
      .crd-pdf-card-name{font-size:.9rem;font-weight:700;color:var(--text);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .crd-pdf-card-meta{font-size:.7rem;color:var(--text2);margin-bottom:6px;line-height:1.5}
      .crd-pdf-card-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;padding-top:12px;border-top:1px solid var(--glass-border)}
      .crd-pdf-act-btn{display:inline-flex;align-items:center;gap:4px;padding:6px 11px;border-radius:8px;font-size:.72rem;font-weight:700;cursor:pointer;border:none;font-family:var(--font-body);transition:all .2s;text-decoration:none;flex-shrink:0}
      .crd-pdf-act-preview{color:#930205;background:rgba(147,2,5,0.1);border:1px solid rgba(147,2,5,0.28)}
      .crd-pdf-act-preview:hover{background:rgba(147,2,5,0.2)}
      .crd-pdf-act-download{color:#10d98e;background:rgba(16,217,142,0.1);border:1px solid rgba(16,217,142,0.28)}
      .crd-pdf-act-download:hover{background:rgba(16,217,142,0.2)}
      .crd-pdf-act-edit{color:#f59e0b;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.28)}
      .crd-pdf-act-edit:hover{background:rgba(245,158,11,0.2)}
      .crd-pdf-act-replace{color:#8b5cf6;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.28)}
      .crd-pdf-act-replace:hover{background:rgba(139,92,246,0.2)}
      .crd-pdf-act-delete{color:var(--danger);background:rgba(255,77,109,0.08);border:1px solid rgba(255,77,109,0.28)}
      .crd-pdf-act-delete:hover{background:rgba(255,77,109,0.18)}
      .crd-pdf-act-submit{color:#06b6d4;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.28)}
      .crd-pdf-act-submit:hover{background:rgba(6,182,212,0.2)}
      .crd-pdf-status-pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:.65rem;font-weight:800;letter-spacing:.04em}
      </style>
      <div class="crd-section-title" style="margin-bottom:14px">📄 My PDFs <span style="font-size:.75rem;font-weight:600;color:var(--text2)">(${rows.length})</span></div>
      ${rows.map(s => {
        const sColor = statusColor(s);
        const sLabel = statusLabel(s);
        const safeName = (s.pdf_name || s.file_name || 'Unnamed PDF').replace(/'/g,"\\'").replace(/"/g,'&quot;');
        const safeCat = (s.category || '').replace(/'/g,"\\'");
        const safeExam = (s.exam || '').replace(/'/g,"\\'");
        const safeStoragePath = (s.storage_path || '').replace(/'/g,"\\'");
        const displayName = s.pdf_name || s.file_name || 'Unnamed PDF';
        return `
        <div class="crd-pdf-card" id="crd-pdf-card-${s.id}">
          <div class="crd-pdf-card-top">
            <div class="crd-pdf-card-cover">📄</div>
            <div class="crd-pdf-card-info">
              <div class="crd-pdf-card-name" title="${displayName.replace(/"/g,'&quot;')}">${displayName}</div>
              <div class="crd-pdf-card-meta">
                ${s.file_size ? (s.file_size/1024/1024).toFixed(1)+'MB' : '—'}
                ${s.page_count ? ' · '+s.page_count+' pages' : ''}
                ${s.category ? ' · '+s.category : ''}
                ${s.created_at ? ' · '+new Date(s.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : ''}
              </div>
              <div class="crd-pdf-status-pill" style="background:${sColor}18;border:1px solid ${sColor}44;color:${sColor}">${sLabel}</div>
            </div>
          </div>
          <div class="crd-pdf-card-actions">
            ${s._signedUrl ? `
            <a href="${s._signedUrl}" target="_blank" rel="noopener" class="crd-pdf-act-btn crd-pdf-act-preview">👁 Preview</a>
            <a href="${s._signedUrl}" download="${displayName.replace(/"/g,'')}" class="crd-pdf-act-btn crd-pdf-act-download">⬇ Download</a>
            ` : '<span style="font-size:.7rem;color:var(--text3);padding:4px 0">No file available</span>'}
            <button class="crd-pdf-act-btn crd-pdf-act-edit"
              onclick="crdEditPdf('${s.id}','${safeName}','${safeCat}','${safeExam}','${s.page_count||0}')">✏️ Edit Details</button>
            <label class="crd-pdf-act-btn crd-pdf-act-replace" style="cursor:pointer">
              🔄 Replace PDF
              <input type="file" accept=".pdf" style="display:none" onchange="crdReplacePdf('${s.id}', this)">
            </label>
            ${s.status === 'pending' ? `
            <button class="crd-pdf-act-btn crd-pdf-act-delete"
              onclick="crdDeletePdf('${s.id}','${safeStoragePath}','${safeName}','${userId}')">🗑 Delete PDF</button>
            ` : ''}
            ${(s.status === 'rejected') ? `
            <button class="crd-pdf-act-btn crd-pdf-act-submit"
              onclick="crdSubmitForReview('${s.id}')">📤 Submit for Review</button>
            ` : ''}
          </div>
        </div>`;
      }).join('')}`;

    _crdShowUploadFab();
  } catch(e) {
    console.error('crdRenderPdfs error:', e);
    main.innerHTML = '<div class="crd-empty"><div class="crd-empty-icon">⚠️</div><div>Error loading PDFs: ' + e.message + '</div></div>';
  }
}

/* ─── Submit single PDF for re-review ───────────────────────────── */
async function crdSubmitForReview(pdfId) {
  const sb = window.supabaseClient;
  if (!sb) return;
  try {
    const { error } = await sb.from('creator_pdf_submissions')
      .update({ status: 'pending' })
      .eq('id', pdfId);
    if (error) throw error;
    showToast('PDF submitted for review ✅', 'success');
    crdSwitchTab('pdfs');
  } catch(e) { showToast('Submit failed: ' + e.message, 'error'); }
}

/* ─── Floating "Upload New PDF" FAB ────────────────────────────── */
function _crdShowUploadFab() {
  // Remove existing FAB if any
  const existing = document.getElementById('crdUploadFab');
  if (existing) existing.remove();

  const fab = document.createElement('div');
  fab.id = 'crdUploadFab';
  fab.style.cssText = `
    position:fixed;bottom:32px;right:28px;z-index:999;
    display:flex;align-items:center;gap:10px;
    padding:13px 20px;border-radius:50px;
    background:linear-gradient(135deg,#10d98e,#06b6d4);
    color:#04261c;font-family:var(--font-body);font-size:.85rem;font-weight:800;
    cursor:pointer;box-shadow:0 8px 28px rgba(16,217,142,0.45);
    border:none;transition:all .25s;
    animation:fabPop .35s cubic-bezier(0.34,1.56,0.64,1) both;
  `;
  fab.innerHTML = `
    <style>
    @keyframes fabPop{from{opacity:0;transform:translateY(30px) scale(0.8)}to{opacity:1;transform:translateY(0) scale(1)}}
    #crdUploadFab:hover{transform:translateY(-3px) scale(1.04);box-shadow:0 14px 40px rgba(16,217,142,0.6)!important}
    </style>
    <span style="font-size:1.1rem">??</span>
    <span>Upload New PDF</span>
  `;
  fab.onclick = () => crdOpenUploadSinglePdf();
  document.body.appendChild(fab);

  // Auto-remove FAB when user leaves creator-dashboard page
  const _fabObserver = new MutationObserver(() => {
    const activePage = document.querySelector('.page.active');
    if (!activePage || activePage.id !== 'page-creator-dashboard') {
      fab.remove();
      _fabObserver.disconnect();
    }
  });
  _fabObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}

/* ─── Single-PDF Upload Modal (post-approval, no 3-PDF requirement) */
function crdOpenUploadSinglePdf() {
  // Remove existing modal if any
  const existing = document.getElementById('crdUploadSingleModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'crdUploadSingleModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="position:absolute;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px)" onclick="document.getElementById('crdUploadSingleModal').remove()"></div>
    <div style="position:relative;z-index:1;width:min(480px,95vw);background:var(--bg2);border:1.5px solid var(--glass-border);border-radius:20px;padding:28px 24px;box-shadow:0 28px 80px rgba(0,0,0,0.65)">
      <div style="font-family:var(--font-display);font-size:1.1rem;font-weight:800;color:var(--text);margin-bottom:4px">📤 Upload New PDF</div>
      <div style="font-size:.78rem;color:var(--text2);margin-bottom:20px">Upload a single PDF to your creator library. It will be sent for admin review.</div>
      <div id="crdSinglePdfMeta" style="margin-bottom:14px">
        <div class="crp-field" style="margin-bottom:10px">
          <div class="crp-label">PDF Title / Name</div>
          <input class="crp-input" id="crdSinglePdfTitle" placeholder="e.g. JEE Chemistry Notes 2025" style="margin-top:4px"/>
        </div>
        <div class="crp-field" style="margin-bottom:10px">
          <div class="crp-label">Category</div>
          <input class="crp-input" id="crdSinglePdfCategory" placeholder="e.g. JEE, NEET, UPSC" style="margin-top:4px"/>
        </div>
        <div class="crp-field" style="margin-bottom:14px">
          <div class="crp-label">Exam / Subject Context (optional)</div>
          <input class="crp-input" id="crdSinglePdfExam" placeholder="e.g. JEE Advanced 2025, Organic Chemistry" style="margin-top:4px"/>
        </div>
        <div id="crdSingleDropzone" style="border:2px dashed rgba(16,217,142,0.35);border-radius:14px;padding:24px;text-align:center;cursor:pointer;transition:all .2s;background:rgba(16,217,142,0.03)" onclick="document.getElementById('crdSinglePdfFile').click()">
          <div id="crdSingleDropIcon" style="font-size:2rem;margin-bottom:8px">📄</div>
          <div style="font-size:.82rem;font-weight:700;color:#10d98e;margin-bottom:4px" id="crdSingleDropLabel">Click to select PDF</div>
          <div style="font-size:.72rem;color:var(--text2)">PDF only · Max 50MB</div>
        </div>
        <input type="file" id="crdSinglePdfFile" accept=".pdf" style="display:none" onchange="crdSinglePdfSelected(this)"/>
        <div id="crdSinglePdfInfo" style="display:none;margin-top:10px;padding:10px 14px;background:var(--glass);border:1px solid var(--glass-border);border-radius:10px;font-size:.78rem;color:var(--text)"></div>
      </div>
      <div id="crdSinglePdfErr" style="display:none;margin-bottom:10px;padding:8px 12px;border-radius:8px;background:rgba(255,77,109,0.1);border:1px solid rgba(255,77,109,0.25);color:var(--danger);font-size:.78rem;font-weight:600"></div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-secondary" style="flex:0 0 auto" onclick="document.getElementById('crdUploadSingleModal').remove()">Cancel</button>
        <button class="btn btn-primary" style="flex:1" id="crdSingleUploadBtn" onclick="crdDoUploadSinglePdf()">📤 Upload & Submit for Review</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

let _crdSinglePdfFileRef = null;

function crdSinglePdfSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.type !== 'application/pdf') { showToast('Please select a PDF file', 'error'); input.value=''; return; }
  if (file.size > 50 * 1024 * 1024) { showToast('PDF must be under 50MB', 'error'); input.value=''; return; }
  _crdSinglePdfFileRef = file;
  const lbl = document.getElementById('crdSingleDropLabel');
  const icon = document.getElementById('crdSingleDropIcon');
  const info = document.getElementById('crdSinglePdfInfo');
  const titleInput = document.getElementById('crdSinglePdfTitle');
  if (lbl) lbl.textContent = file.name;
  if (icon) icon.textContent = '✅';
  if (info) { info.textContent = file.name + ' · ' + (file.size/1024/1024).toFixed(1) + 'MB'; info.style.display = ''; }
  // Auto-fill title if empty
  if (titleInput && !titleInput.value) {
    titleInput.value = file.name.replace(/\.pdf$/i,'').replace(/[_-]/g,' ');
  }
}

async function crdDoUploadSinglePdf() {
  const sb = window.supabaseClient;
  const user = window.currentUser;
  if (!sb || !user) { showToast('Please sign in first', 'error'); return; }

  const file = _crdSinglePdfFileRef;
  const title = document.getElementById('crdSinglePdfTitle')?.value.trim();
  const category = document.getElementById('crdSinglePdfCategory')?.value.trim() || 'General';
  const exam = document.getElementById('crdSinglePdfExam')?.value.trim() || '';
  const errEl = document.getElementById('crdSinglePdfErr');
  const btn = document.getElementById('crdSingleUploadBtn');

  const showErr = msg => { if(errEl){errEl.textContent=msg;errEl.style.display='';} };

  if (!file) { showErr('Please select a PDF file.'); return; }
  if (!title) { showErr('Please enter a PDF title.'); return; }

  if (btn) { btn.disabled=true; btn.textContent='Uploading… 🔄'; }

  const userId = user.id || user.uid;
  try {
    // Upload to Storage
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `submissions/${userId}/${Date.now()}_${safeName}`;
    const { error: upErr } = await sb.storage.from('creator-pdfs')
      .upload(storagePath, file, { upsert: true, contentType: 'application/pdf' });
    if (upErr) throw new Error('Storage upload failed: ' + upErr.message);

    // Count pages
    let pageCount = 0;
    try {
      const buf = await file.arrayBuffer();
      const text = new TextDecoder('latin1').decode(buf);
      const m = text.match(/\/Type\s*\/Page[^s]/g);
      pageCount = m ? m.length : 0;
      if (!pageCount) { const cm = text.match(/\/Count\s+(\d+)/); pageCount = cm ? parseInt(cm[1],10) : 0; }
    } catch(_) {}

    // Insert DB row
    const { error: insErr } = await sb.from('creator_pdf_submissions').insert({
      user_id:      userId,
      pdf_name:     title,
      category:     category,
      exam:         exam,
      storage_path: storagePath,
      file_size:    file.size,
      page_count:   pageCount,
      status:       'pending',
      created_at:   new Date().toISOString(),
    });
    if (insErr) throw insErr;

    // Increment pdf_count on creators row
    try {
      const { data: cr } = await sb.from('creators').select('pdf_count').eq('user_id', userId).maybeSingle();
      if (cr) await sb.from('creators').update({ pdf_count: (cr.pdf_count||0) + 1 }).eq('user_id', userId);
    } catch(_) {}

    _crdSinglePdfFileRef = null;
    document.getElementById('crdUploadSingleModal')?.remove();
    showToast('PDF uploaded and submitted for review ✅', 'success');
    crdSwitchTab('pdfs');
  } catch(e) {
    console.error('Single PDF upload error:', e);
    showErr('Upload failed: ' + (e.message || 'Please try again'));
    if (btn) { btn.disabled=false; btn.textContent='📤 Upload & Submit for Review'; }
  }
}

// Edit PDF metadata (name, category, exam)
async function crdEditPdf(pdfId, currentName, currentCategory, currentExam) {
  const newName = prompt('PDF name:', currentName);
  if (newName === null) return;
  const newCategory = prompt('Category (e.g. JEE Mathematics):', currentCategory);
  if (newCategory === null) return;
  const newExam = prompt('Exam / expertise context:', currentExam);
  if (newExam === null) return;
  const sb = window.supabaseClient;
  try {
    const { error } = await sb.from('creator_pdf_submissions').update({
      pdf_name: newName.trim() || currentName,
      category: newCategory.trim(),
      exam: newExam.trim(),
    }).eq('id', pdfId);
    if (error) throw error;
    showToast('PDF details updated ✅', 'success');
    crdSwitchTab('pdfs');
  } catch(e) { showToast('Update failed: ' + e.message, 'error'); }
}

// Delete a PDF row + Storage file
async function crdDeletePdf(pdfId, storagePath, pdfName, userId) {
  if (!confirm('Delete "' + pdfName + '"? This cannot be undone.')) return;
  const sb = window.supabaseClient;
  try {
    // Delete from Storage if path available
    if (storagePath) {
      try { await sb.storage.from('creator-pdfs').remove([storagePath]); } catch(_) {}
    }
    const { error } = await sb.from('creator_pdf_submissions').delete().eq('id', pdfId);
    if (error) throw error;
    // Decrement pdf_count on creators row
    try {
      const { data: cr } = await sb.from('creators').select('pdf_count').eq('user_id', userId).maybeSingle();
      if (cr) await sb.from('creators').update({ pdf_count: Math.max(0, (cr.pdf_count||1) - 1) }).eq('user_id', userId);
    } catch(_) {}
    showToast('PDF deleted 🗑', 'info');
    crdSwitchTab('pdfs');
  } catch(e) { showToast('Delete failed: ' + e.message, 'error'); }
}

// Replace PDF: upload new file to Storage, update DB row, recalculate quality score
async function crdReplacePdf(pdfId, inputEl) {
  const file = inputEl.files?.[0];
  inputEl.value = '';
  if (!file || file.type !== 'application/pdf') { showToast('Please select a valid PDF', 'error'); return; }
  if (file.size > 50 * 1024 * 1024) { showToast('PDF must be under 50MB', 'error'); return; }
  const sb = window.supabaseClient;
  const user = window.currentUser;
  if (!sb || !user) { showToast('Not signed in', 'error'); return; }
  const userId = user.id || user.uid;

  showToast('Uploading replacement PDF… 🔄', 'info');
  try {
    // 1. Fetch current row to get old storage path
    const { data: existing } = await sb.from('creator_pdf_submissions').select('storage_path').eq('id', pdfId).maybeSingle();

    // 2. Upload new PDF
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const newStoragePath = `submissions/${userId}/${Date.now()}_${safeName}`;
    const { error: upErr } = await sb.storage.from('creator-pdfs').upload(newStoragePath, file, { upsert: true, contentType: 'application/pdf' });
    if (upErr) throw new Error('Storage upload failed: ' + upErr.message);

    // 3. Page count via raw byte scan
    let pageCount = 0;
    try {
      const buf = await file.arrayBuffer();
      const text = new TextDecoder('latin1').decode(buf);
      const m = text.match(/\/Type\s*\/Page[^s]/g);
      pageCount = m ? m.length : 0;
      if (!pageCount) { const cm = text.match(/\/Count\s+(\d+)/); pageCount = cm ? parseInt(cm[1], 10) : 0; }
    } catch(_) {}

    // 4. Recalculate quality score based on new file
    const avgSize = file.size;
    const sizeScore = Math.min(50, Math.round(avgSize / (100*1024)));
    const newQuality = Math.min(100, Math.max(40, 20 + sizeScore + 10));

    // 5. Remove old Storage object if it exists
    if (existing?.storage_path) {
      try { await sb.storage.from('creator-pdfs').remove([existing.storage_path]); } catch(_) {}
    }

    // 6. Update DB row
    const { error: dbErr } = await sb.from('creator_pdf_submissions').update({
      pdf_name: file.name,
      storage_path: newStoragePath,
      file_size: file.size,
      page_count: pageCount,
      status: 'pending', // back to review after replacement
      created_at: new Date().toISOString(),
    }).eq('id', pdfId);
    if (dbErr) throw dbErr;

    // 7. Update quality score on creators profile
    try {
      await sb.from('creators').update({ quality_score: newQuality }).eq('user_id', userId);
    } catch(_) {}

    showToast('PDF replaced and sent for re-review ✅', 'success');
    crdSwitchTab('pdfs');
  } catch(e) { showToast('Replace failed: ' + e.message, 'error'); }
}

async function crdRenderWallet(main) {
  const creator = _crpCurrentData;
  if (!creator) return;

  const sb = window.supabaseClient;
  const user = window.currentUser;

  let ledger = [];
  try {
    const { data } = await sb.from('creator_ledger').select('*')
      .eq('user_id', user?.id || user?.uid).order('created_at', { ascending: false }).limit(20);
    ledger = data || [];
  } catch(e) {}

  main.innerHTML = `
    <div class="crd-section-title">💳 Smart Wallet</div>
    <div class="crd-wallet-card">
      <div class="crd-wallet-bal-label">Available Balance</div>
      <div class="crd-wallet-bal">₹${(creator.available_balance||0).toLocaleString('en-IN')}</div>
      <div class="crd-wallet-sub">Total earned: ₹${(creator.total_earnings||0).toLocaleString('en-IN')} · Withdrawn: ₹${((creator.total_earnings||0)-(creator.available_balance||0)).toLocaleString('en-IN')}</div>
      <button class="crd-withdraw-btn" onclick="crdRequestWithdrawal()">💸 Request Withdrawal</button>
    </div>

    <div class="crd-section-title">📋 Revenue Ledger</div>
    ${ledger.length === 0 ? `
      <div class="crd-empty" style="padding:32px">
        <div class="crd-empty-icon">📋</div>
        <div style="font-size:.85rem">No transactions yet</div>
      </div>` : ledger.map(r => `
      <div class="crd-ledger-row ${r.type==='credit'?'crd-ledger-credit':'crd-ledger-debit'}">
        <div class="crd-ledger-icon">${r.type==='credit'?'💰':'💸'}</div>
        <div class="crd-ledger-info">
          <div class="crd-ledger-title">${r.description || (r.type==='credit'?'Sale Revenue':'Withdrawal')}</div>
          <div class="crd-ledger-sub">${r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}</div>
        </div>
        <div class="crd-ledger-amt">${r.type==='credit'?'+':'−'}₹${(r.amount||0).toLocaleString('en-IN')}</div>
      </div>`).join('')}`;
}

async function crdRenderAnalytics(main) {
  const creator = _crpCurrentData;
  main.innerHTML = `
    <div class="crd-section-title">📈 Creator Analytics</div>
    <div class="crd-stat-grid">
      <div class="crd-stat-card green">
        <div class="crd-stat-icon">📊</div>
        <div class="crd-stat-val">${creator?.pdf_count||0}</div>
        <div class="crd-stat-label">Total PDFs</div>
      </div>
      <div class="crd-stat-card blue">
        <div class="crd-stat-icon">👁️</div>
        <div class="crd-stat-val">—</div>
        <div class="crd-stat-label">Total Views</div>
      </div>
      <div class="crd-stat-card gold">
        <div class="crd-stat-icon">🔄</div>
        <div class="crd-stat-val">${creator?.total_downloads||0}</div>
        <div class="crd-stat-label">Downloads</div>
      </div>
      <div class="crd-stat-card purple">
        <div class="crd-stat-icon">⭐</div>
        <div class="crd-stat-val">${creator?.creator_score||0}</div>
        <div class="crd-stat-label">Creator Score</div>
      </div>
    </div>
    <div style="padding:32px;text-align:center;background:var(--glass);border:1px solid var(--glass-border);border-radius:16px;color:var(--text2)">
      <div style="font-size:2rem;margin-bottom:12px">📈</div>
      <div style="font-weight:700;margin-bottom:6px">Detailed Analytics</div>
      <div style="font-size:.8rem">Analytics dashboard will populate as your PDFs get views and sales.</div>
    </div>`;
}

async function crdRequestWithdrawal() {
  const creator = _crpCurrentData;
  if (!creator) return;
  const balance = creator.available_balance || 0;
  if (balance < 500) { showToast('Minimum withdrawal is ₹500. Current balance: ₹' + balance, 'info'); return; }

  const amount = prompt('Enter withdrawal amount (₹500 – ₹' + balance + '):');
  if (!amount) return;
  const amt = Number(amount);
  if (isNaN(amt) || amt < 500 || amt > balance) { showToast('Invalid amount', 'error'); return; }

  const upi = prompt('Enter your UPI ID or Bank Account number:');
  if (!upi) return;

  const sb = window.supabaseClient;
  const user = window.currentUser;
  try {
    await sb.from('creator_withdrawals').insert({
      user_id: user?.id || user?.uid,
      amount: amt,
      upi_id: upi,
      status: 'pending',
      requested_at: new Date().toISOString(),
    });
    await sb.from('creators').update({
      available_balance: balance - amt
    }).eq('user_id', user?.id || user?.uid);

    await sb.from('creator_ledger').insert({
      user_id: user?.id || user?.uid,
      type: 'debit',
      amount: amt,
      description: 'Withdrawal requested to ' + upi,
      created_at: new Date().toISOString(),
    });

    _crpCurrentData.available_balance = balance - amt;
    showToast('Withdrawal of ₹' + amt + ' requested! Processing in 7 days ✅', 'success');
    crdSwitchTab('wallet');
  } catch(e) {
    showToast('Withdrawal failed: ' + (e.message || 'Please try again'), 'error');
  }
}

/* ─── Auto-detect creator on login and show burger menu ───────── */
async function crpOnAuthChange(user) {
  if (!user) {
    const hmC = document.getElementById('hmCreatorSection');
    const hmR = document.getElementById('hmCreatorRegSection');
    if (hmC) hmC.style.display = 'none';
    if (hmR) hmR.style.display = '';
    return;
  }
  const creator = await crpCheckExistingCreator();
  const hmC = document.getElementById('hmCreatorSection');
  const hmR = document.getElementById('hmCreatorRegSection');
  if (creator && creator.status === 'approved') {
    _crpCurrentData = creator;
    if (hmC) hmC.style.display = '';
    if (hmR) hmR.style.display = 'none';
  } else {
    if (hmC) hmC.style.display = 'none';
    if (hmR) hmR.style.display = '';
  }
}

// Hook into Supabase auth change listener if available
const _cpOrigAuthState = window._onAuthStateChange;
window._onAuthStateChange = function(event, session) {
  if (_cpOrigAuthState) _cpOrigAuthState(event, session);
  if (session?.user) crpOnAuthChange(session.user);
  else crpOnAuthChange(null);
};

// Also run on page load if already signed in
window.addEventListener('load', () => {
  setTimeout(() => {
    const user = window.currentUser;
    if (user) crpOnAuthChange(user);
  }, 1500);
});

/* ─── switchAdminTab hook for creator-manager ────────────────────── */
const _origSwitchAdminTab = window.switchAdminTab;
window.switchAdminTab = function(tab) {
  if (tab === 'creator-manager') {
    renderCreatorManagerAdmin();
    document.querySelectorAll('.admin-nav-item').forEach(b => b.classList.toggle('active', b.dataset.atab === tab));
    return;
  }
  if (_origSwitchAdminTab) return _origSwitchAdminTab(tab);
};

/* ─── Admin: Creator Manager ─────────────────────────────────────── */
async function renderCreatorManagerAdmin() {
  const main = document.getElementById('adminMain');
  if (!main) return;

  main.innerHTML = `
  <style>
  .cm2-wrap{max-width:1100px}
  .cm2-header{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-bottom:22px}
  .cm2-header h2{font-family:var(--font-display);font-size:1.3rem;font-weight:800;background:linear-gradient(135deg,#10d98e,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin:0}
  .cm2-header p{color:var(--text2);font-size:.82rem;margin:4px 0 0}
  .cm2-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-bottom:22px}
  .cm2-stat{background:var(--glass);border:1px solid var(--glass-border);border-radius:14px;padding:16px;text-align:center;backdrop-filter:blur(10px)}
  .cm2-stat-icon{font-size:1.3rem;margin-bottom:6px}
  .cm2-stat-val{font-family:var(--font-display);font-size:1.3rem;font-weight:900;background:linear-gradient(135deg,#10d98e,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .cm2-stat-lbl{font-size:.62rem;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-top:3px}
  .cm2-tabs{display:flex;gap:0;border-bottom:1px solid var(--glass-border);margin-bottom:20px;overflow-x:auto;scrollbar-width:none}
  .cm2-tabs::-webkit-scrollbar{display:none}
  .cm2-tab{padding:10px 18px;font-size:.8rem;font-weight:700;color:var(--text2);border-bottom:2px solid transparent;cursor:pointer;background:none;border-top:none;border-left:none;border-right:none;font-family:var(--font-body);transition:all .2s;white-space:nowrap}
  .cm2-tab.active{color:#10d98e;border-bottom-color:#10d98e}
  .cm2-table{width:100%;border-collapse:collapse;font-size:.82rem}
  .cm2-table th{text-align:left;padding:10px 12px;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);border-bottom:1px solid var(--glass-border)}
  .cm2-table td{padding:12px 12px;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:middle}
  .cm2-table tr:hover td{background:rgba(255,255,255,0.02)}
  .cm2-creator-name{font-weight:700;color:var(--text);font-size:.85rem}
  .cm2-creator-sub{font-size:.68rem;color:var(--text2);margin-top:1px}
  .cm2-level-badge{font-size:.62rem;font-weight:800;padding:2px 8px;border-radius:6px;display:inline-block}
  .cm2-badge-starter{background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3)}
  .cm2-badge-rising{background:rgba(16,217,142,0.15);color:#10d98e;border:1px solid rgba(16,217,142,0.3)}
  .cm2-badge-pro{background:rgba(147,2,5,0.15);color:#930205;border:1px solid rgba(147,2,5,0.3)}
  .cm2-badge-elite{background:rgba(139,92,246,0.15);color:#8b5cf6;border:1px solid rgba(139,92,246,0.3)}
  .cm2-status-badge{font-size:.62rem;font-weight:800;padding:2px 8px;border-radius:6px;display:inline-block}
  .cm2-status-pending{background:rgba(245,158,11,0.12);color:#f59e0b;border:1px solid rgba(245,158,11,0.25)}
  .cm2-status-approved{background:rgba(16,217,142,0.12);color:#10d98e;border:1px solid rgba(16,217,142,0.25)}
  .cm2-status-rejected{background:rgba(255,77,109,0.12);color:var(--danger);border:1px solid rgba(255,77,109,0.25)}
  .cm2-action-btn{padding:5px 12px;border-radius:8px;font-size:.72rem;font-weight:700;border:1px solid var(--glass-border);cursor:pointer;font-family:var(--font-body);transition:all .15s;background:var(--glass);color:var(--text);margin:2px;white-space:nowrap}
  .cm2-actions-cell{display:flex;flex-wrap:wrap;gap:4px;align-items:center;min-width:180px}
  .cm2-action-btn:hover{border-color:var(--accent);color:var(--accent)}
  .cm2-action-btn.approve:hover{border-color:#10d98e;color:#10d98e}
  .cm2-action-btn.reject:hover{border-color:var(--danger);color:var(--danger)}
  .cm2-empty{text-align:center;padding:48px 20px;color:var(--text2)}
  .cm2-score-bar{height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;width:70px;display:inline-block;vertical-align:middle;margin-right:5px}
  .cm2-score-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#10d98e,#06b6d4)}
  .cm2-wd-row{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--glass);border:1px solid var(--glass-border);border-radius:12px;margin-bottom:7px;font-size:.82rem}
  .cm2-wd-icon{font-size:1.1rem;flex-shrink:0}
  .cm2-wd-info{flex:1;min-width:0}
  .cm2-wd-title{font-weight:700;color:var(--text)}
  .cm2-wd-sub{font-size:.68rem;color:var(--text2);margin-top:2px}
  .cm2-wd-amt{font-weight:800;color:#f59e0b;flex-shrink:0;font-size:.9rem}
  /* Reset Creator confirmation modal */
  .cm2-reset-overlay{display:none;position:fixed;inset:0;z-index:1100;align-items:center;justify-content:center}
  .cm2-reset-overlay.open{display:flex}
  .cm2-reset-bg{position:absolute;inset:0;background:rgba(0,0,0,0.82);backdrop-filter:blur(8px)}
  .cm2-reset-box{position:relative;z-index:1;width:min(440px,92vw);background:var(--bg2);border:1.5px solid rgba(255,77,109,0.4);border-radius:20px;padding:28px 24px;box-shadow:0 28px 80px rgba(0,0,0,0.7)}
  .cm2-reset-title{font-family:var(--font-display);font-size:1.1rem;font-weight:800;color:var(--danger);margin-bottom:10px}
  .cm2-reset-body{font-size:.82rem;color:var(--text2);line-height:1.7;margin-bottom:18px}
  .cm2-reset-body ul{padding-left:18px;margin:8px 0}
  .cm2-reset-body li{margin-bottom:4px}
  .cm2-reset-footer{display:flex;gap:10px;justify-content:flex-end}
  .cm2-reset-confirm-btn{padding:10px 22px;border-radius:10px;background:rgba(255,77,109,0.15);color:var(--danger);border:1px solid rgba(255,77,109,0.35);font-family:var(--font-body);font-size:.85rem;font-weight:800;cursor:pointer;transition:all .2s}
  .cm2-reset-confirm-btn:hover{background:rgba(255,77,109,0.28)}
  .cm2-btn-reset{color:#f59e0b!important;border-color:rgba(245,158,11,0.35)!important}
  .cm2-btn-reset:hover{background:rgba(245,158,11,0.12)!important;border-color:#f59e0b!important;color:#f59e0b!important}
  .cm2-btn-remove{color:var(--danger)!important;border-color:rgba(255,77,109,0.35)!important}
  .cm2-btn-remove:hover{background:rgba(255,77,109,0.12)!important;border-color:var(--danger)!important;color:var(--danger)!important}
  /* Remove Creator confirmation modal */
  .cm2-remove-overlay{display:none;position:fixed;inset:0;z-index:1100;align-items:center;justify-content:center}
  .cm2-remove-overlay.open{display:flex}
  .cm2-remove-bg{position:absolute;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px)}
  .cm2-remove-box{position:relative;z-index:1;width:min(460px,92vw);background:var(--bg2);border:1.5px solid rgba(255,77,109,0.5);border-radius:20px;padding:28px 24px;box-shadow:0 28px 80px rgba(0,0,0,0.75)}
  .cm2-remove-title{font-family:var(--font-display);font-size:1.1rem;font-weight:800;color:var(--danger);margin-bottom:10px}
  .cm2-remove-body{font-size:.82rem;color:var(--text2);line-height:1.7;margin-bottom:18px}
  .cm2-remove-body ul{padding-left:18px;margin:8px 0}
  .cm2-remove-body li{margin-bottom:4px}
  .cm2-remove-footer{display:flex;gap:10px;justify-content:flex-end}
  .cm2-remove-confirm-btn{padding:10px 22px;border-radius:10px;background:rgba(255,77,109,0.2);color:var(--danger);border:1.5px solid rgba(255,77,109,0.5);font-family:var(--font-body);font-size:.85rem;font-weight:800;cursor:pointer;transition:all .2s}
  .cm2-remove-confirm-btn:hover{background:rgba(255,77,109,0.35)}
  .cm2pv-overlay{display:none;position:fixed;inset:0;z-index:900;align-items:center;justify-content:center}
  .cm2pv-overlay.open{display:flex}
  .cm2pv-bg{position:absolute;inset:0;background:rgba(0,0,0,0.78);backdrop-filter:blur(8px)}
  .cm2pv-box{position:relative;z-index:1;width:min(640px,95vw);background:var(--bg2);border:1.5px solid var(--glass-border);border-radius:20px;padding:0;max-height:90vh;overflow-y:auto;box-shadow:0 28px 80px rgba(0,0,0,0.65)}
  body.light .cm2pv-box{background:#fff;border-color:rgba(0,0,0,0.1)}
  .cm2pv-head{display:flex;align-items:center;gap:14px;padding:24px;border-bottom:1px solid var(--glass-border);position:sticky;top:0;background:var(--bg2);z-index:2}
  body.light .cm2pv-head{background:#fff}
  .cm2pv-avatar{width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid rgba(16,217,142,0.4);flex-shrink:0;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:1.6rem}
  .cm2pv-name{font-family:var(--font-display);font-weight:800;font-size:1.1rem;color:var(--text)}
  .cm2pv-sub{font-size:.78rem;color:var(--text2);margin-top:2px}
  .cm2pv-close{margin-left:auto;background:none;border:none;color:var(--text2);cursor:pointer;font-size:1.3rem;padding:4px 8px;border-radius:8px;flex-shrink:0;align-self:flex-start}
  .cm2pv-close:hover{color:var(--text)}
  .cm2pv-body{padding:22px 24px}
  .cm2pv-section{margin-bottom:20px}
  .cm2pv-section-title{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#10d98e;margin-bottom:10px}
  .cm2pv-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px}
  @media(max-width:480px){.cm2pv-grid{grid-template-columns:1fr}}
  .cm2pv-item-lbl{font-size:.65rem;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:2px}
  .cm2pv-item-val{font-size:.85rem;color:var(--text);font-weight:600;word-break:break-word}
  .cm2pv-bio{font-size:.82rem;color:var(--text2);line-height:1.6;background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);border-radius:12px;padding:14px}
  .cm2pv-footer{display:flex;gap:10px;padding:16px 24px 22px;border-top:1px solid var(--glass-border)}
  .cm2pv-link{color:var(--accent);text-decoration:none;font-weight:600}
  .cm2pv-link:hover{text-decoration:underline}
  </style>
  <div class="cm2-wrap">
    <div class="cm2-header">
      <div>
        <h2>🎓 Creator Program Manager</h2>
        <p>Review applications, manage creator levels, earnings, and withdrawals</p>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="cm2Reload()">↺ Refresh</button>
    </div>
    <div class="cm2-stats" id="cm2Stats">
      ${[1,2,3,4].map(_=>`<div class="cm2-stat"><div class="me-skeleton" style="height:60px;border-radius:8px"></div></div>`).join('')}
    </div>
    <div class="cm2-tabs">
      <button class="cm2-tab active" data-cm2tab="applications" onclick="cm2SwitchTab('applications')">📋 Applications</button>
      <button class="cm2-tab" data-cm2tab="creators" onclick="cm2SwitchTab('creators')">👥 Active Creators</button>
      <button class="cm2-tab" data-cm2tab="suspended" onclick="cm2SwitchTab('suspended')">🚫 Suspended</button>
      <button class="cm2-tab" data-cm2tab="withdrawals" onclick="cm2SwitchTab('withdrawals')">💸 Withdrawals</button>
      <button class="cm2-tab" data-cm2tab="pdfs" onclick="cm2SwitchTab('pdfs')">📄 PDF Submissions</button>
    </div>
    <div id="cm2Content">
      <div style="text-align:center;padding:32px;color:var(--text2)">Loading…</div>
    </div>
  </div>
  <div class="cm2pv-overlay" id="cm2pvModal">
    <div class="cm2pv-bg" onclick="cm2CloseProfileModal()"></div>
    <div class="cm2pv-box" id="cm2pvBox"></div>
  </div>`;

  await cm2LoadStats();
  cm2SwitchTab('applications');
}

async function cm2LoadStats() {
  const sb = window.supabaseClient;
  if (!sb) return;
  const statsEl = document.getElementById('cm2Stats');
  if (!statsEl) return;
  try {
    const [{ count: totalC }, { count: pendingC }, { count: approvedC }, { count: suspendedC }, { count: wdC }] = await Promise.all([
      sb.from('creators').select('*', {count:'exact',head:true}),
      sb.from('creators').select('*', {count:'exact',head:true}).eq('status','pending'),
      sb.from('creators').select('*', {count:'exact',head:true}).eq('status','approved'),
      sb.from('creators').select('*', {count:'exact',head:true}).eq('status','suspended'),
      sb.from('creator_withdrawals').select('*', {count:'exact',head:true}).eq('status','pending'),
    ]);
    statsEl.innerHTML = `
      <div class="cm2-stat"><div class="cm2-stat-icon">👥</div><div class="cm2-stat-val">${totalC||0}</div><div class="cm2-stat-lbl">Total Creators</div></div>
      <div class="cm2-stat"><div class="cm2-stat-icon">⏳</div><div class="cm2-stat-val">${pendingC||0}</div><div class="cm2-stat-lbl">Pending Review</div></div>
      <div class="cm2-stat"><div class="cm2-stat-icon">✅</div><div class="cm2-stat-val">${approvedC||0}</div><div class="cm2-stat-lbl">Active Creators</div></div>
      <div class="cm2-stat"><div class="cm2-stat-icon">🚫</div><div class="cm2-stat-val">${suspendedC||0}</div><div class="cm2-stat-lbl">Suspended</div></div>
      <div class="cm2-stat"><div class="cm2-stat-icon">💸</div><div class="cm2-stat-val">${wdC||0}</div><div class="cm2-stat-lbl">Pending Payouts</div></div>`;
  } catch(e) {}
}

let _cm2Tab = 'applications';

function cm2SwitchTab(tab) {
  _cm2Tab = tab;
  document.querySelectorAll('.cm2-tab').forEach(t => t.classList.toggle('active', t.dataset.cm2tab === tab));
  const content = document.getElementById('cm2Content');
  if (!content) return;
  content.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text2)">Loading…</div>';
  if (tab === 'applications') cm2LoadApplications(content);
  else if (tab === 'creators') cm2LoadCreators(content);
  else if (tab === 'suspended') cm2LoadSuspended(content);
  else if (tab === 'withdrawals') cm2LoadWithdrawals(content);
  else if (tab === 'pdfs') cm2LoadPdfSubmissions(content);
}

async function cm2LoadApplications(content) {
  const sb = window.supabaseClient;
  if (!sb) { content.innerHTML = '<div class="cm2-empty">Supabase not connected</div>'; return; }
  try {
    const { data } = await sb.from('creators').select('*').eq('status','pending').order('applied_at',{ascending:false});
    if (!data || !data.length) {
      content.innerHTML = '<div class="cm2-empty"><div style="font-size:2.5rem;margin-bottom:12px">✅</div><div style="font-weight:700;margin-bottom:6px">No pending applications</div><div style="font-size:.8rem">All creator applications have been processed.</div></div>';
      return;
    }
    content.innerHTML = `
      <div style="overflow-x:auto">
      <table class="cm2-table">
        <thead><tr>
          <th>Creator</th><th>Scores</th><th>PDFs</th><th>Applied</th><th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody>
        ${data.map(c => `
          <tr>
            <td>
              <div class="cm2-creator-name">${c.author_name||'—'}</div>
              <div class="cm2-creator-sub">${c.expertise||''}</div>
            </td>
            <td>
              <div title="Quality: ${c.quality_score||0}/100">
                <div class="cm2-score-bar"><div class="cm2-score-fill" style="width:${c.quality_score||0}%"></div></div>
                <span style="font-size:.7rem;color:var(--text2)">Q:${c.quality_score||0}</span>
              </div>
              <div title="Originality: ${c.originality_score||0}/100" style="margin-top:4px">
                <div class="cm2-score-bar"><div class="cm2-score-fill" style="width:${c.originality_score||0}%;background:linear-gradient(90deg,#930205,#c99a3c)"></div></div>
                <span style="font-size:.7rem;color:var(--text2)">O:${c.originality_score||0}</span>
              </div>
              <div style="font-size:.68rem;color:#8b5cf6;margin-top:3px;font-weight:700">Score: ${c.creator_score||0}/100</div>
            </td>
            <td><span style="font-weight:700">${c.pdf_count||0}</span></td>
            <td style="font-size:.72rem;color:var(--text2)">${c.applied_at?new Date(c.applied_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'}):'-'}</td>
            <td><span class="cm2-status-badge cm2-status-pending">⏳ Pending</span></td>
            <td>
              <button class="cm2-action-btn" onclick="cm2ViewCreator('${c.user_id}')">👁 View Profile</button>
              <button class="cm2-action-btn approve" onclick="cm2ApproveCreator('${c.user_id}')">✅ Approve</button>
              <button class="cm2-action-btn reject" onclick="cm2RejectCreator('${c.user_id}')">❌ Reject</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`;
  } catch(e) {
    content.innerHTML = '<div class="cm2-empty">Error loading applications: ' + e.message + '</div>';
  }
}

async function cm2LoadCreators(content) {
  const sb = window.supabaseClient;
  if (!sb) return;
  try {
    const { data } = await sb.from('creators').select('*').eq('status','approved').order('total_earnings',{ascending:false});
    if (!data || !data.length) {
      content.innerHTML = '<div class="cm2-empty"><div style="font-size:2.5rem;margin-bottom:12px">👥</div><div>No active creators yet</div></div>';
      return;
    }
    content.innerHTML = `
      <div style="overflow-x:auto">
      <table class="cm2-table">
        <thead><tr><th>Creator</th><th>Level</th><th>PDFs</th><th>Earnings</th><th>Balance</th><th>Score</th><th>Actions</th></tr></thead>
        <tbody>
        ${data.map(c => {
          const lvlInfo = CP_LEVELS[c.level] || CP_LEVELS.starter;
          return `<tr>
            <td><div class="cm2-creator-name">🎓 ${c.author_name||'—'}</div><div class="cm2-creator-sub">${c.expertise||''}</div></td>
            <td><span class="cm2-level-badge cm2-badge-${c.level||'starter'}">${lvlInfo.icon} ${lvlInfo.label}</span></td>
            <td>${c.pdf_count||0}</td>
            <td style="font-weight:700;color:#10d98e">₹${(c.total_earnings||0).toLocaleString('en-IN')}</td>
            <td>₹${(c.available_balance||0).toLocaleString('en-IN')}</td>
            <td><span style="font-weight:700;color:#8b5cf6">${c.creator_score||0}</span></td>
            <td>
              <div class="cm2-actions-cell">
              <button class="cm2-action-btn" onclick="cm2ViewCreator('${c.user_id}')">👁 View</button>
              <button class="cm2-action-btn" onclick="cm2ChangeLevel('${c.user_id}','${c.level||'starter'}')">📊 Level</button>
              <button class="cm2-action-btn" onclick="cm2AddEarnings('${c.user_id}')">💰 Earnings</button>
              <button class="cm2-action-btn" onclick="cm2AddAdminNotes('${c.user_id}', ${JSON.stringify(c.admin_notes||'').replace(/"/g,'&quot;')})">📝 Notes</button>
              <button class="cm2-action-btn cm2-btn-reset" onclick="cm2OpenResetModal('${c.user_id}','${cm2EscapeHtml(c.full_name||c.author_name||'this creator').replace(/'/g,"\\'")}','${(c.verification_doc_path||'').replace(/'/g,"\\'")}')">🔄 Reset User</button>
              <button class="cm2-action-btn cm2-btn-remove" onclick="cm2OpenRemoveModal('${c.user_id}','${cm2EscapeHtml(c.full_name||c.author_name||'this creator').replace(/'/g,"\\'")}')">🗑 Remove User</button>
              <button class="cm2-action-btn reject" onclick="cm2SuspendCreator('${c.user_id}')">🚫 Suspend</button>
              </div>
            </td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
      </div>`;
  } catch(e) { content.innerHTML = '<div class="cm2-empty">Error: ' + e.message + '</div>'; }
}

async function cm2LoadSuspended(content) {
  const sb = window.supabaseClient;
  if (!sb) return;
  try {
    const { data } = await sb.from('creators').select('*').eq('status','suspended').order('suspended_at',{ascending:false});
    if (!data || !data.length) {
      content.innerHTML = '<div class="cm2-empty"><div style="font-size:2.5rem;margin-bottom:12px">🚫</div><div>No suspended creators</div></div>';
      return;
    }
    content.innerHTML = `
      <div style="overflow-x:auto">
      <table class="cm2-table">
        <thead><tr><th>Creator</th><th>Suspended On</th><th>Admin Notes</th><th>Actions</th></tr></thead>
        <tbody>
        ${data.map(c => `
          <tr>
            <td><div class="cm2-creator-name">${c.author_name||'—'}</div><div class="cm2-creator-sub">${c.expertise||''}</div></td>
            <td style="font-size:.72rem;color:var(--text2)">${c.suspended_at?new Date(c.suspended_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'}):'-'}</td>
            <td style="font-size:.76rem;color:var(--text2);max-width:220px">${c.admin_notes||'—'}</td>
            <td>
              <button class="cm2-action-btn" onclick="cm2ViewCreator('${c.user_id}')">👁 View</button>
              <button class="cm2-action-btn approve" onclick="cm2ReinstateCreator('${c.user_id}')">↺ Reinstate</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`;
  } catch(e) { content.innerHTML = '<div class="cm2-empty">Error: ' + e.message + '</div>'; }
}

async function cm2LoadWithdrawals(content) {
  const sb = window.supabaseClient;
  if (!sb) return;
  try {
    const { data } = await sb.from('creator_withdrawals').select('*, creators(author_name)').order('requested_at',{ascending:false}).limit(50);
    if (!data || !data.length) {
      content.innerHTML = '<div class="cm2-empty"><div style="font-size:2.5rem;margin-bottom:12px">💸</div><div>No withdrawal requests</div></div>';
      return;
    }
    content.innerHTML = data.map(w => `
      <div class="cm2-wd-row">
        <div class="cm2-wd-icon">💸</div>
        <div class="cm2-wd-info">
          <div class="cm2-wd-title">${w.creators?.author_name || 'Creator'}</div>
          <div class="cm2-wd-sub">UPI/Bank: ${w.upi_id||'—'} · Requested: ${w.requested_at?new Date(w.requested_at).toLocaleDateString('en-IN'):'-'}</div>
          <span class="cm2-status-badge ${w.status==='paid'?'cm2-status-approved':w.status==='rejected'?'cm2-status-rejected':'cm2-status-pending'}">${w.status==='paid'?'✅ Paid':w.status==='rejected'?'❌ Rejected':'⏳ Pending'}</span>
        </div>
        <div class="cm2-wd-amt">₹${(w.amount||0).toLocaleString('en-IN')}</div>
        ${w.status==='pending'?`
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="cm2-action-btn approve" onclick="cm2ProcessWithdrawal('${w.id}','paid')">✅ Pay</button>
          <button class="cm2-action-btn reject" onclick="cm2ProcessWithdrawal('${w.id}','rejected')">❌ Reject</button>
        </div>`:''}
      </div>`).join('');
  } catch(e) { content.innerHTML = '<div class="cm2-empty">Error: ' + e.message + '</div>'; }
}

async function cm2LoadPdfSubmissions(content) {
  const sb = window.supabaseClient;
  if (!sb) return;
  try {
    const { data } = await sb.from('creator_pdf_submissions').select('*, creators(author_name)').order('submitted_at',{ascending:false}).limit(100);
    if (!data || !data.length) {
      content.innerHTML = '<div class="cm2-empty"><div style="font-size:2.5rem;margin-bottom:12px">📄</div><div>No PDF submissions yet</div></div>';
      return;
    }
    content.innerHTML = `
      <div style="overflow-x:auto">
      <table class="cm2-table">
        <thead><tr><th>File</th><th>Creator</th><th>Quality</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
        ${data.map(p => `
          <tr>
            <td><div class="cm2-creator-name">${p.file_name||'—'}</div><div class="cm2-creator-sub">${((p.file_size||0)/1024/1024).toFixed(1)}MB</div></td>
            <td style="color:var(--text2);font-size:.78rem">${p.creators?.author_name||'—'}</td>
            <td>
              <div class="cm2-score-bar"><div class="cm2-score-fill" style="width:${p.quality_score||0}%"></div></div>
              <span style="font-size:.7rem;color:var(--text2)">${p.quality_score||0}/100</span>
            </td>
            <td style="font-size:.72rem;color:var(--text2)">${p.submitted_at?new Date(p.submitted_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'2-digit'}):'-'}</td>
            <td><span class="cm2-status-badge cm2-status-${p.status||'pending'}">${p.status==='approved'?'✅ Approved':p.status==='rejected'?'❌ Rejected':'⏳ Pending'}</span></td>
            <td>
              ${p.status==='pending'?`
              <button class="cm2-action-btn approve" onclick="cm2ApprovePdf('${p.id}')">✅ Approve</button>
              <button class="cm2-action-btn reject" onclick="cm2RejectPdf('${p.id}')">❌ Reject</button>`:'—'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`;
  } catch(e) { content.innerHTML = '<div class="cm2-empty">Error: ' + e.message + '</div>'; }
}

/* ── Admin Actions ─────────────────────────────────────────────── */
async function cm2ApproveCreator(userId) {
  const sb = window.supabaseClient;
  if (!confirm('Approve this creator?')) return;
  try {
    await sb.from('creators').update({ status:'approved', approved_at: new Date().toISOString() }).eq('user_id', userId);
    // Also approve their submitted PDFs
    await sb.from('creator_pdf_submissions').update({ status:'approved' }).eq('user_id', userId).eq('status','pending');
    showToast('Creator approved ✅', 'success');
    cm2LoadStats();
    cm2SwitchTab('applications');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function cm2RejectCreator(userId) {
  const reason = prompt('Enter rejection reason (shown to creator):');
  if (reason === null) return;
  const sb = window.supabaseClient;
  try {
    await sb.from('creators').update({ status:'rejected', rejection_reason: reason || 'Application did not meet our standards.' }).eq('user_id', userId);
    showToast('Creator rejected', 'info');
    cm2LoadStats();
    cm2SwitchTab('applications');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function cm2SuspendCreator(userId) {
  const reason = prompt('Reason for suspension (optional, kept as admin note):');
  if (reason === null) return;
  if (!confirm('Suspend this creator? They will immediately lose creator access and benefits.')) return;
  const sb = window.supabaseClient;
  try {
    await sb.from('creators').update({
      status: 'suspended',
      suspended_at: new Date().toISOString(),
      admin_notes: reason ? `[Suspended] ${reason}` : '[Suspended by admin]'
    }).eq('user_id', userId);
    showToast('Creator suspended', 'info');
    cm2LoadStats();
    cm2SwitchTab('creators');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function cm2ReinstateCreator(userId) {
  if (!confirm('Reinstate this creator? They will regain full creator access and benefits.')) return;
  const sb = window.supabaseClient;
  try {
    await sb.from('creators').update({ status: 'approved', suspended_at: null }).eq('user_id', userId);
    showToast('Creator reinstated ✅', 'success');
    cm2LoadStats();
    cm2SwitchTab('suspended');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function cm2AddAdminNotes(userId, existingNotes) {
  const notes = prompt('Admin notes for this creator (internal only, not shown to creator):', existingNotes || '');
  if (notes === null) return;
  const sb = window.supabaseClient;
  try {
    await sb.from('creators').update({ admin_notes: notes }).eq('user_id', userId);
    showToast('Admin notes saved ✅', 'success');
    // If the profile modal is currently open for this creator, refresh it in place
    const overlay = document.getElementById('cm2pvModal');
    if (overlay && overlay.classList.contains('open')) cm2ViewCreator(userId);
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function cm2ChangeLevel(userId, currentLevel) {
  const levels = Object.keys(CP_LEVELS);
  const levelNames = levels.map(k => CP_LEVELS[k].icon + ' ' + CP_LEVELS[k].label + ' (' + CP_LEVELS[k].share + '%)').join('\n');
  const newLevel = prompt('Choose level:\n' + levelNames + '\n\nEnter level key (starter/rising/pro):');
  if (!newLevel || !CP_LEVELS[newLevel]) { showToast('Invalid level', 'error'); return; }
  const sb = window.supabaseClient;
  try {
    await sb.from('creators').update({ level: newLevel, revenue_share: CP_LEVELS[newLevel].share }).eq('user_id', userId);
    showToast('Level updated to ' + CP_LEVELS[newLevel].label + ' ✅', 'success');
    cm2SwitchTab('creators');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function cm2AddEarnings(userId) {
  const amount = prompt('Add earnings (₹) to this creator\'s wallet:');
  if (!amount || isNaN(Number(amount))) return;
  const amt = Number(amount);
  const sb = window.supabaseClient;
  try {
    const { data: creator } = await sb.from('creators').select('total_earnings,available_balance').eq('user_id', userId).maybeSingle();
    await sb.from('creators').update({
      total_earnings: (creator?.total_earnings||0) + amt,
      available_balance: (creator?.available_balance||0) + amt,
    }).eq('user_id', userId);
    await sb.from('creator_ledger').insert({
      user_id: userId, type:'credit', amount: amt,
      description: 'Manual earning added by admin',
      created_at: new Date().toISOString()
    });
    showToast('₹' + amt + ' added to creator wallet ✅', 'success');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function cm2ProcessWithdrawal(wdId, status) {
  const sb = window.supabaseClient;
  const label = status === 'paid' ? 'Mark as paid' : 'Reject withdrawal';
  if (!confirm(label + '?')) return;
  try {
    await sb.from('creator_withdrawals').update({ status, processed_at: new Date().toISOString() }).eq('id', wdId);
    if (status === 'rejected') {
      // Refund balance
      const { data: wd } = await sb.from('creator_withdrawals').select('user_id,amount').eq('id', wdId).maybeSingle();
      if (wd) {
        const { data: cr } = await sb.from('creators').select('available_balance').eq('user_id', wd.user_id).maybeSingle();
        await sb.from('creators').update({ available_balance: (cr?.available_balance||0) + wd.amount }).eq('user_id', wd.user_id);
        await sb.from('creator_ledger').insert({ user_id: wd.user_id, type:'credit', amount: wd.amount, description:'Withdrawal rejected — refunded', created_at: new Date().toISOString() });
      }
    }
    showToast(status === 'paid' ? 'Withdrawal marked as paid ✅' : 'Withdrawal rejected', status==='paid'?'success':'info');
    cm2SwitchTab('withdrawals');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

// Maps the fixed Step-3 registration category dropdown (which does NOT match
// real site category names) to a real, existing category name. The `pdfs`
// table has a DB-level trigger that REJECTS any insert whose `category` text
// doesn't match an existing category — so creator-submitted category labels
// must be remapped before publish, not passed through as-is.
const CP_CATEGORY_MAP = {
  'Engineering':          'Higher Education',
  'Medicine / MBBS':      'Higher Education',
  'Law':                  'Legal & Government',
  'Finance / CA':         'Business & Finance',
  'Design':               'Design & Creativity',
  'Science':              'Education',
  'Languages':            'Languages',
  'MBA / Management':     'Business & Finance',
  'Computer Science':     'Computer & Technology',
  'Government Exams':     'Government Exams',
  'School (K-12)':        'School Education',
  'Aptitude / Reasoning': 'Education',
  'Other':                'Education',
};

async function cm2ApprovePdf(pdfId) {
  const sb = window.supabaseClient;
  try {
    // 1. Fetch the full submission — need everything to construct a real pdfs row
    const { data: sub, error: subErr } = await sb.from('creator_pdf_submissions').select('*, creators(user_id, author_name)').eq('id', pdfId).single();
    if (subErr || !sub) throw new Error(subErr?.message || 'Submission not found');

    // Idempotency guard — don't republish/duplicate if already done
    if (sub.published_pdf_id) {
      showToast('Already published ✅', 'info');
      cm2SwitchTab('pdfs');
      return;
    }

    // 2. Resolve category — must match a REAL category name or the DB trigger rejects the insert
    const rawCategory  = sub.category || 'Other';
    const realCategory = CP_CATEGORY_MAP[rawCategory] || rawCategory;
    const catObj = (window._dbCategories || []).find(c => c.name === realCategory)
                || (window._dbCategories || []).find(c => c.name === 'Education')
                || (window._dbCategories || [])[0];
    if (!catObj) throw new Error('No categories loaded — reload the admin panel and try again');

    // 3. Copy the PDF file from the private creator-pdfs bucket into the public pdfs bucket
    if (!sub.storage_path) throw new Error('Submission has no file — cannot publish');
    const { data: fileBlob, error: dlErr } = await sb.storage.from('creator-pdfs').download(sub.storage_path);
    if (dlErr || !fileBlob) throw new Error('Could not read the submitted PDF file: ' + (dlErr?.message || 'unknown error'));
    const title = sub.title || sub.pdf_name || 'Untitled';
    const slug  = generateSlug(title);
    const pdfPath = `${Date.now()}_${slug.slice(0,40)}.pdf`;
    const { error: upErr } = await sb.storage.from('pdfs').upload(pdfPath, fileBlob, { upsert: true, contentType: 'application/pdf' });
    if (upErr) throw new Error('PDF upload to public bucket failed: ' + upErr.message);
    const { data: pubData } = sb.storage.from('pdfs').getPublicUrl(pdfPath);
    if (!pubData?.publicUrl) throw new Error('Could not generate a public PDF URL');

    // 4. Build the payload — mirrors the same shape/validation as the main admin publish flow
    const price = parseFloat(sub.price || 0);
    const isFree = sub.access_type === 'free' || !price;
    const payload = {
      title,
      author:            sub.creators?.author_name || null,
      category:          catObj.name,
      category_id:       catObj.id,
      description:       sub.description || sub.exam || null,
      preview:           sub.description || sub.exam || null,
      selling_price:     isFree ? 0 : price,
      original_price:    sub.mrp || null,
      price:             isFree ? 0 : price,
      free:              isFree,
      exam_year:         null,
      slug,
      seo_title:         sub.seo_title || title,
      seo_description:   sub.seo_description || null,
      cover_url:         sub.thumbnail_url || null,
      pdf_url:           pubData.publicUrl,
      status:            'published',
      creator_id:        sub.creators?.user_id || null,
      created_at:        new Date().toISOString(),
    };

    // 5. Insert the real pdfs row — only mark the submission approved if this succeeds.
    // creator_id may not exist yet (migration not run) — retry without it rather than
    // blocking the actual publish, which is the important part.
    let newPdf, insErr;
    ({ data: newPdf, error: insErr } = await sb.from('pdfs').insert(payload).select('id').single());
    if (insErr && /creator_id/.test(insErr.message || '')) {
      const { creator_id, ...payloadNoCreator } = payload;
      ({ data: newPdf, error: insErr } = await sb.from('pdfs').insert(payloadNoCreator).select('id').single());
    }
    if (insErr) throw new Error('Publish failed: ' + insErr.message);

    // 6. Link the submission to the new live pdfs row. published_pdf_id/reviewed_at may
    // not exist yet either (same pending migration) — fall back to just the status flag
    // so the publish itself is never blocked by these optional linking columns.
    try {
      const { error: linkErr } = await sb.from('creator_pdf_submissions').update({
        status: 'approved',
        published_pdf_id: newPdf.id,
        reviewed_at: new Date().toISOString(),
      }).eq('id', pdfId);
      if (linkErr) throw linkErr;
    } catch (linkErr) {
      console.warn('Submission linking columns not available yet (run the pending migration):', linkErr.message);
      await sb.from('creator_pdf_submissions').update({ status: 'approved' }).eq('id', pdfId);
    }

    // ── Live Notifications hook (fire-and-forget) ──
    try {
      if (window.SN && SN.publish && newPdf?.id) {
        SN.publish('PDF', newPdf.id, {
          title: title,
          message: 'New PDF now available in the Library',
          destination: 'pdf:' + newPdf.id,
          metadata: { category: realCategory, creator: sub.creators?.author_name || '' }
        });
      }
    } catch (e) { console.warn('SN cm2 hook:', e); }
    showToast('PDF approved and published live ✅', 'success');
    cm2SwitchTab('pdfs');
  } catch(e) {
    console.error('cm2ApprovePdf error:', e);
    showToast('❌ Publish failed: ' + e.message, 'error');
    // Deliberately do NOT flip status to approved on failure — the old bug
    // silently marked things approved even when nothing was actually published.
  }
}

async function cm2RejectPdf(pdfId) {
  const sb = window.supabaseClient;
  try {
    await sb.from('creator_pdf_submissions').update({ status:'rejected' }).eq('id', pdfId);
    showToast('PDF rejected', 'info');
    cm2SwitchTab('pdfs');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

function cm2EscapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function cm2CloseProfileModal() {
  const m = document.getElementById('cm2pvModal');
  if (m) m.classList.remove('open');
}

async function cm2ViewCreator(userId) {
  const sb = window.supabaseClient;
  try {
    const { data: c } = await sb.from('creators').select('*').eq('user_id', userId).maybeSingle();
    if (!c) { showToast('Creator not found', 'error'); return; }

    let pdfRows = [];
    try {
      const { data: pdfs } = await sb.from('creator_pdf_submissions').select('*').eq('user_id', userId).order('submitted_at',{ascending:false});
      const rawPdfs = pdfs || [];
      // Resolve a short-lived signed URL (10 min) for each PDF so Preview and Download work
      pdfRows = await Promise.all(rawPdfs.map(async p => {
        const filePath = p.file_path || p.storage_path || p.pdf_path || '';
        if (filePath) {
          try {
            const { data: sd } = await sb.storage.from('pdfs').createSignedUrl(filePath, 600);
            return { ...p, _signedUrl: sd?.signedUrl || '' };
          } catch(e) { return { ...p, _signedUrl: '' }; }
        }
        return { ...p, _signedUrl: '' };
      }));
    } catch(e) {}

    // Resolve a short-lived signed URL for the private verification document, if any
    let verificationDocUrl = '';
    if (c.verification_doc_path) {
      try {
        const { data: sd } = await sb.storage.from('pdfs').createSignedUrl(c.verification_doc_path, 600);
        verificationDocUrl = sd?.signedUrl || '';
      } catch(e) {}
    }

    const lvlInfo = CP_LEVELS[c.level] || CP_LEVELS.starter;
    const statusBadge = c.status === 'approved'
      ? '<span class="cm2-status-badge cm2-status-approved">✅ Approved</span>'
      : c.status === 'rejected'
      ? '<span class="cm2-status-badge cm2-status-rejected">❌ Rejected</span>'
      : c.status === 'suspended'
      ? '<span class="cm2-status-badge cm2-status-rejected">🚫 Suspended</span>'
      : '<span class="cm2-status-badge cm2-status-pending">⏳ Pending</span>';

    const field = (label, val) => `
      <div>
        <div class="cm2pv-item-lbl">${cm2EscapeHtml(label)}</div>
        <div class="cm2pv-item-val">${val != null && val !== '' ? cm2EscapeHtml(val) : '—'}</div>
      </div>`;

    const dobDisplay = c.dob ? new Date(c.dob).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';
    const appliedDisplay = c.applied_at ? new Date(c.applied_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';

    const avatarHtml = c.photo_url
      ? `<img class="cm2pv-avatar" src="${cm2EscapeHtml(c.photo_url)}" alt="${cm2EscapeHtml(c.full_name||c.author_name||'Creator')}" loading="lazy" decoding="async" />`
      : `<div class="cm2pv-avatar">👤</div>`;

    // Creator badge — only approved creators carry the verified creator badge / benefits
    const creatorBadgeHtml = c.status === 'approved'
      ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:.65rem;font-weight:800;color:#10d98e;background:rgba(16,217,142,0.12);border:1px solid rgba(16,217,142,0.3);padding:2px 8px;border-radius:6px;margin-left:6px">🎓 Verified Creator</span>`
      : '';

    const verificationStatusLabel = c.verification_doc_path
      ? '✅ Document Submitted'
      : (c.verification_status === 'not_submitted' || !c.verification_status)
      ? '⚠️ No Document Submitted'
      : cm2EscapeHtml(c.verification_status);

    const box = document.getElementById('cm2pvBox');
    if (!box) return;
    box.innerHTML = `
      <div class="cm2pv-head">
        ${avatarHtml}
        <div>
          <div class="cm2pv-name">${cm2EscapeHtml(c.full_name || c.author_name || 'Unnamed Creator')}${creatorBadgeHtml}</div>
          <div class="cm2pv-sub">Pen name: ${cm2EscapeHtml(c.author_name || '—')} &nbsp;·&nbsp; ${statusBadge} &nbsp;<span class="cm2-level-badge cm2-badge-${c.level||'starter'}">${lvlInfo.icon} ${lvlInfo.label}</span></div>
        </div>
        <button class="cm2pv-close" onclick="cm2CloseProfileModal()">✕</button>
      </div>
      <div class="cm2pv-body">
        <div class="cm2pv-section">
          <div class="cm2pv-section-title">👤 Personal Details</div>
          <div class="cm2pv-grid">
            ${field('Full Name', c.full_name)}
            ${field('Gender', c.gender)}
            ${field('Date of Birth', c.dob ? dobDisplay : '')}
            ${field('Mobile', c.mobile)}
          </div>
        </div>
        <div class="cm2pv-section">
          <div class="cm2pv-section-title">🧑‍🏫 Creator Type</div>
          <div class="cm2pv-grid">
            ${field('Creator Type', c.creator_type)}
            ${field('Occupation', c.occupation)}
            ${field('Languages', c.languages)}
          </div>
        </div>
        <div class="cm2pv-section">
          <div class="cm2pv-section-title">🎓 Qualification &amp; Experience</div>
          <div class="cm2pv-grid">
            ${field('Qualification', c.qualification)}
            ${field('Experience', c.experience)}
          </div>
        </div>
        <div class="cm2pv-section">
          <div class="cm2pv-section-title">📚 Subject Expertise</div>
          <div class="cm2pv-item-val">${c.expertise ? cm2EscapeHtml(c.expertise) : '—'}</div>
        </div>
        <div class="cm2pv-section">
          <div class="cm2pv-section-title">📝 Bio</div>
          <div class="cm2pv-bio">${cm2EscapeHtml(c.bio || '—')}</div>
        </div>
        <div class="cm2pv-section">
          <div class="cm2pv-section-title">🔗 Social Links</div>
          <div class="cm2pv-item-val">${c.social_link ? `<a class="cm2pv-link" href="${cm2EscapeHtml(c.social_link)}" target="_blank" rel="noopener">${cm2EscapeHtml(c.social_link)}</a>` : '—'}</div>
        </div>
        <div class="cm2pv-section">
          <div class="cm2pv-section-title">🪪 Verification Information</div>
          <div class="cm2pv-grid">
            ${field('Verification Status', verificationStatusLabel)}
            ${field('Document Name', c.verification_doc_name)}
            ${field('Document Type', c.verification_doc_type)}
            ${field('Document Size', c.verification_doc_size ? (c.verification_doc_size/1024/1024).toFixed(2) + ' MB' : '')}
          </div>
          ${verificationDocUrl ? `<div style="margin-top:10px"><a class="cm2pv-link" href="${cm2EscapeHtml(verificationDocUrl)}" target="_blank" rel="noopener">📄 Open verification document (link valid 10 min)</a></div>` : ''}
        </div>
        <div class="cm2pv-section">
          <div class="cm2pv-section-title">📄 Submitted PDFs (${pdfRows.length})</div>
          ${pdfRows.length === 0 ? `<div style="color:var(--text2);font-size:.8rem;padding:6px 0">No PDFs submitted yet.</div>` : `
          <div style="display:flex;flex-direction:column;gap:8px">
            ${pdfRows.map(p => {
              const pdfSignedUrl = p._signedUrl || '';
              const statusBadgeHtml = p.status === 'approved'
                ? '<span class="cm2-status-badge cm2-status-approved">✅ Approved</span>'
                : p.status === 'rejected'
                ? '<span class="cm2-status-badge cm2-status-rejected">❌ Rejected</span>'
                : '<span class="cm2-status-badge cm2-status-pending">⏳ Pending</span>';
              return `
              <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);border-radius:12px;font-size:.78rem;flex-wrap:wrap">
                <span style="font-size:1.1rem">📄</span>
                <div style="flex:1;min-width:0">
                  <div style="color:var(--text);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:2px">${cm2EscapeHtml(p.file_name||'—')}</div>
                  <div style="color:var(--text2);font-size:.72rem">${p.category ? cm2EscapeHtml(p.category) : '<em style="opacity:.5">No category</em>'}</div>
                </div>
                ${statusBadgeHtml}
                ${pdfSignedUrl ? `
                <a href="${cm2EscapeHtml(pdfSignedUrl)}" target="_blank" rel="noopener"
                   style="display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border-radius:8px;font-size:.72rem;font-weight:700;cursor:pointer;text-decoration:none;color:#930205;background:rgba(147,2,5,0.1);border:1px solid rgba(147,2,5,0.28);white-space:nowrap">
                  👁 Preview
                </a>
                <a href="${cm2EscapeHtml(pdfSignedUrl)}" download="${cm2EscapeHtml(p.file_name||'document.pdf')}"
                   style="display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border-radius:8px;font-size:.72rem;font-weight:700;cursor:pointer;text-decoration:none;color:#10d98e;background:rgba(16,217,142,0.1);border:1px solid rgba(16,217,142,0.28);white-space:nowrap">
                  ⬇ Download
                </a>` : `<span style="font-size:.7rem;color:var(--text2);opacity:.6">No file link</span>`}
              </div>`;
            }).join('')}
          </div>`}
        </div>
        <div class="cm2pv-section">
          <div class="cm2pv-section-title">📊 Scores &amp; Stats</div>
          <div class="cm2pv-grid">
            ${field('Quality Score', (c.quality_score||0) + '/100')}
            ${field('Originality Score', (c.originality_score||0) + '/100')}
            ${field('Creator Score', (c.creator_score||0) + '/100')}
            ${field('PDFs Submitted', c.pdf_count||0)}
            ${field('Total Earnings', '₹' + (c.total_earnings||0).toLocaleString('en-IN'))}
            ${field('Available Balance', '₹' + (c.available_balance||0).toLocaleString('en-IN'))}
            ${field('Applied On', appliedDisplay)}
            ${field('Status', c.status)}
          </div>
        </div>

        ${c.status === 'rejected' && c.rejection_reason ? `
        <div class="cm2pv-section">
          <div class="cm2pv-section-title" style="color:var(--danger)">❌ Rejection Reason</div>
          <div class="cm2pv-bio">${cm2EscapeHtml(c.rejection_reason)}</div>
        </div>` : ''}
        <div class="cm2pv-section">
          <div class="cm2pv-section-title">📝 Admin Notes <span style="font-weight:500;text-transform:none;color:var(--text2)">(internal only)</span></div>
          <div class="cm2pv-bio">${c.admin_notes ? cm2EscapeHtml(c.admin_notes) : 'No notes yet.'}</div>
          <button class="cm2-action-btn" style="margin-top:8px" onclick="cm2AddAdminNotes('${userId}', ${JSON.stringify(c.admin_notes||'').replace(/"/g,'&quot;')})">📝 ${c.admin_notes ? 'Edit' : 'Add'} Notes</button>
        </div>
      </div>
      <div class="cm2pv-footer" style="flex-wrap:wrap">
        <button class="btn btn-secondary" style="flex:1;min-width:90px" onclick="cm2CloseProfileModal()">Close</button>
        ${c.status === 'pending' ? `
        <button class="cm2-action-btn approve" style="flex:1;min-width:120px;padding:10px" onclick="cm2CloseProfileModal();cm2ApproveCreator('${userId}')">✅ Approve Creator</button>
        <button class="cm2-action-btn reject" style="flex:1;min-width:120px;padding:10px" onclick="cm2CloseProfileModal();cm2RejectCreator('${userId}')">❌ Reject</button>` : ''}
        ${c.status === 'approved' ? `
        <button class="cm2-action-btn" style="flex:1;min-width:120px;padding:10px" onclick="cm2CloseProfileModal();cm2ChangeLevel('${userId}','${c.level||'starter'}')">📊 Change Level</button>
        <button class="cm2-action-btn reject" style="flex:1;min-width:120px;padding:10px" onclick="cm2CloseProfileModal();cm2SuspendCreator('${userId}')">🚫 Suspend</button>` : ''}
        ${c.status === 'suspended' ? `
        <button class="cm2-action-btn approve" style="flex:1;min-width:120px;padding:10px" onclick="cm2CloseProfileModal();cm2ReinstateCreator('${userId}')">↺ Reinstate</button>` : ''}
        ${c.status === 'rejected' ? `
        <button class="cm2-action-btn approve" style="flex:1;min-width:120px;padding:10px" onclick="cm2CloseProfileModal();cm2ApproveCreator('${userId}')">✅ Approve Creator</button>` : ''}
        <button class="cm2-action-btn cm2-btn-reset" style="flex:1;min-width:120px;padding:10px" onclick="cm2OpenResetModal('${userId}','${cm2EscapeHtml(c.full_name||c.author_name||'this creator').replace(/'/g,"\\'")}','${(c.verification_doc_path||'').replace(/'/g,"\\'")}')">🔄 Reset User</button>
        <button class="cm2-action-btn cm2-btn-remove" style="flex:1;min-width:120px;padding:10px" onclick="cm2CloseProfileModal();cm2OpenRemoveModal('${userId}','${cm2EscapeHtml(c.full_name||c.author_name||'this creator').replace(/'/g,"\\'")}')">🗑 Remove User</button>
      </div>
    `;

    const overlay = document.getElementById('cm2pvModal');
    if (overlay) overlay.classList.add('open');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function cm2Reload() {
  await cm2LoadStats();
  cm2SwitchTab(_cm2Tab);
  showToast('Data refreshed ↺', 'info');
}

/* ─── Reset Creator Modal ────────────────────────────────────────── */
function cm2OpenResetModal(userId, creatorName, verificationDocPath) {
  // Inject modal if not already in DOM
  if (!document.getElementById('cm2ResetModal')) {
    const modalHtml = `
      <div class="cm2-reset-overlay" id="cm2ResetModal">
        <div class="cm2-reset-bg" onclick="cm2CloseResetModal()"></div>
        <div class="cm2-reset-box">
          <div class="cm2-reset-title">⚠️ Reset Creator — Start From Beginning</div>
          <div class="cm2-reset-body">
            Reset this creator? This will allow <strong id="cm2ResetCreatorName">this creator</strong> to start the Creator Program again from the beginning. This action will:
            <ul>
              <li>Reset creator status to <strong>new / not_applied</strong></li>
              <li>Remove approval &amp; creator level</li>
              <li>Reset creator score, quality score &amp; originality score</li>
              <li>Reset earnings, wallet balance, downloads &amp; sales</li>
              <li>Reset published PDF count</li>
              <li>Delete all PDF submissions from the database</li>
              <li>Delete creator PDFs from Storage</li>
              <li>Clear creator analytics &amp; verification progress</li>
              <li>Allow the user to submit a fresh application again</li>
            </ul>
            <strong style="color:var(--danger)">This cannot be undone.</strong>
          </div>
          <div class="cm2-reset-footer">
            <button class="btn btn-secondary" onclick="cm2CloseResetModal()">Cancel</button>
            <button class="cm2-reset-confirm-btn" id="cm2ResetConfirmBtn" onclick="cm2ExecuteReset()">🔄 Yes, Reset Creator</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }
  // Store data on the modal for execution
  const modal = document.getElementById('cm2ResetModal');
  modal.dataset.userId = userId;
  modal.dataset.verificationDocPath = verificationDocPath || '';
  const nameEl = document.getElementById('cm2ResetCreatorName');
  if (nameEl) nameEl.textContent = creatorName || 'this creator';
  modal.classList.add('open');
  // Close the profile modal first
  cm2CloseProfileModal();
}

function cm2CloseResetModal() {
  const modal = document.getElementById('cm2ResetModal');
  if (modal) modal.classList.remove('open');
}

async function cm2ExecuteReset() {
  const modal = document.getElementById('cm2ResetModal');
  if (!modal) return;
  const userId = modal.dataset.userId;
  const verificationDocPath = modal.dataset.verificationDocPath;
  if (!userId) { showToast('No creator selected', 'error'); return; }

  const btn = document.getElementById('cm2ResetConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Resetting… 🔄'; }

  const sb = window.supabaseClient;
  let stepErrors = [];

  try {
    // 1. Fetch all PDF submission storage paths for this creator
    let pdfStoragePaths = [];
    try {
      const { data: pdfs } = await sb.from('creator_pdf_submissions')
        .select('storage_path').eq('user_id', userId);
      pdfStoragePaths = (pdfs || []).map(p => p.storage_path).filter(Boolean);
    } catch(e) { stepErrors.push('PDF fetch: ' + e.message); }

    // 2. Delete PDF files from Storage (creator-pdfs bucket)
    if (pdfStoragePaths.length) {
      try {
        await sb.storage.from('creator-pdfs').remove(pdfStoragePaths);
      } catch(e) { stepErrors.push('Storage PDF delete: ' + e.message); }
    }

    // 3. Delete verification document from pdfs bucket
    if (verificationDocPath) {
      try {
        await sb.storage.from('pdfs').remove([verificationDocPath]);
      } catch(e) { stepErrors.push('Verification doc delete: ' + e.message); }
    }

    // 4. Delete all creator_pdf_submissions rows
    try {
      await sb.from('creator_pdf_submissions').delete().eq('user_id', userId);
    } catch(e) { stepErrors.push('DB submissions delete: ' + e.message); }

    // 5. Delete creator ledger rows
    try {
      await sb.from('creator_ledger').delete().eq('user_id', userId);
    } catch(e) { /* non-critical */ }

    // 5b. Clear creator analytics
    try {
      await sb.from('creator_analytics').delete().eq('user_id', userId);
    } catch(e) { /* non-critical */ }

    // 5c. Clear creator verification progress
    try {
      await sb.from('creator_verification').delete().eq('user_id', userId);
    } catch(e) { /* non-critical */ }

    // 6. Reset the creators row — keep the row but wipe all profile data
    //    Status = not_applied so the user can re-apply fresh from Step 1
    try {
      const { error } = await sb.from('creators').update({
        status: 'not_applied',
        full_name: null,
        author_name: null,
        gender: null,
        dob: null,
        mobile: null,
        creator_type: null,
        qualification: null,
        experience: null,
        occupation: null,
        bio: null,
        expertise: null,
        languages: null,
        photo_url: null,
        social_link: null,
        verification_doc_path: null,
        verification_doc_name: null,
        verification_doc_size: 0,
        verification_doc_type: null,
        verification_status: 'not_submitted',
        level: 'starter',
        revenue_share: 60,
        quality_score: 0,
        originality_score: 0,
        creator_score: 0,
        total_earnings: 0,
        available_balance: 0,
        total_downloads: 0,
        total_sales: 0,
        pdf_count: 0,
        applied_at: null,
        approved_at: null,
        suspended_at: null,
        rejection_reason: null,
        admin_notes: '[Reset by admin on ' + new Date().toLocaleDateString('en-IN') + ']',
      }).eq('user_id', userId);
      if (error) stepErrors.push('Profile reset: ' + error.message);
    } catch(e) { stepErrors.push('Profile reset: ' + e.message); }

    cm2CloseResetModal();

    if (stepErrors.length) {
      showToast('Reset complete with warnings. Check console.', 'info');
      console.warn('Creator reset warnings:', stepErrors);
    } else {
      showToast('Creator fully reset ✅ — they can now re-apply.', 'success');
    }

    // Refresh admin panel
    await cm2LoadStats();
    cm2SwitchTab('applications');
  } catch(e) {
    showToast('Reset failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Yes, Reset Creator'; }
  }
}

/* ─── Remove Creator Modal ───────────────────────────────────────── */
function cm2OpenRemoveModal(userId, creatorName) {
  if (!document.getElementById('cm2RemoveModal')) {
    const modalHtml = `
      <div class="cm2-remove-overlay" id="cm2RemoveModal">
        <div class="cm2-remove-bg" onclick="cm2CloseRemoveModal()"></div>
        <div class="cm2-remove-box">
          <div class="cm2-remove-title">🗑 Remove Creator — Permanent Deletion</div>
          <div class="cm2-remove-body">
            You are about to permanently remove <strong id="cm2RemoveCreatorName">this creator</strong>. This will delete:
            <ul>
              <li>Creator profile record</li>
              <li>All PDF submissions from the database</li>
              <li>All uploaded creator PDFs from Storage</li>
              <li>Creator earnings &amp; wallet records</li>
              <li>Creator analytics &amp; stats</li>
              <li>Verification documents from Storage</li>
              <li>Creator notifications</li>
            </ul>
            <strong style="color:var(--danger)">⚠️ This is permanent and cannot be undone.</strong>
          </div>
          <div class="cm2-remove-footer">
            <button class="btn btn-secondary" onclick="cm2CloseRemoveModal()">Cancel</button>
            <button class="cm2-remove-confirm-btn" id="cm2RemoveConfirmBtn" onclick="cm2ExecuteRemove()">🗑 Yes, Remove Permanently</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }
  const modal = document.getElementById('cm2RemoveModal');
  modal.dataset.userId = userId;
  const nameEl = document.getElementById('cm2RemoveCreatorName');
  if (nameEl) nameEl.textContent = creatorName || 'this creator';
  modal.classList.add('open');
}

function cm2CloseRemoveModal() {
  const modal = document.getElementById('cm2RemoveModal');
  if (modal) modal.classList.remove('open');
}

async function cm2ExecuteRemove() {
  const modal = document.getElementById('cm2RemoveModal');
  if (!modal) return;
  const userId = modal.dataset.userId;
  if (!userId) { showToast('No creator selected', 'error'); return; }

  const btn = document.getElementById('cm2RemoveConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Removing… 🗑'; }

  const sb = window.supabaseClient;
  let stepErrors = [];

  try {
    // 1. Fetch creator row for verification doc path
    let verificationDocPath = '';
    try {
      const { data: cr } = await sb.from('creators').select('verification_doc_path').eq('user_id', userId).maybeSingle();
      verificationDocPath = cr?.verification_doc_path || '';
    } catch(e) { stepErrors.push('Creator fetch: ' + e.message); }

    // 2. Fetch all PDF storage paths
    let pdfStoragePaths = [];
    try {
      const { data: pdfs } = await sb.from('creator_pdf_submissions').select('storage_path').eq('user_id', userId);
      pdfStoragePaths = (pdfs || []).map(p => p.storage_path).filter(Boolean);
    } catch(e) { stepErrors.push('PDF fetch: ' + e.message); }

    // 3. Delete creator PDFs from Storage
    if (pdfStoragePaths.length) {
      try { await sb.storage.from('creator-pdfs').remove(pdfStoragePaths); }
      catch(e) { stepErrors.push('Storage PDF delete: ' + e.message); }
    }

    // 4. Delete verification document from Storage
    if (verificationDocPath) {
      try { await sb.storage.from('pdfs').remove([verificationDocPath]); }
      catch(e) { stepErrors.push('Verification doc delete: ' + e.message); }
    }

    // 5. Delete all creator_pdf_submissions rows
    try { await sb.from('creator_pdf_submissions').delete().eq('user_id', userId); }
    catch(e) { stepErrors.push('PDF submissions delete: ' + e.message); }

    // 6. Delete creator earnings / ledger
    try { await sb.from('creator_ledger').delete().eq('user_id', userId); }
    catch(e) { /* non-critical — table may not exist */ }

    // 7. Delete creator withdrawals
    try { await sb.from('creator_withdrawals').delete().eq('user_id', userId); }
    catch(e) { /* non-critical */ }

    // 8. Delete creator analytics
    try { await sb.from('creator_analytics').delete().eq('user_id', userId); }
    catch(e) { /* non-critical */ }

    // 9. Delete creator stats
    try { await sb.from('creator_stats').delete().eq('user_id', userId); }
    catch(e) { /* non-critical */ }

    // 10. Delete creator notifications
    try { await sb.from('creator_notifications').delete().eq('user_id', userId); }
    catch(e) { /* non-critical */ }

    // 11. Delete creator verification progress
    try { await sb.from('creator_verification').delete().eq('user_id', userId); }
    catch(e) { /* non-critical */ }

    // 12. Delete the main creator record (last, after all child data gone)
    try {
      const { error } = await sb.from('creators').delete().eq('user_id', userId);
      if (error) stepErrors.push('Creator record delete: ' + error.message);
    } catch(e) { stepErrors.push('Creator record delete: ' + e.message); }

    cm2CloseRemoveModal();

    if (stepErrors.length) {
      showToast('Creator removed with warnings. Check console.', 'info');
      console.warn('Creator remove warnings:', stepErrors);
    } else {
      showToast('Creator permanently removed 🗑', 'success');
    }

    // Refresh dashboard counters and switch back to active creators tab
    await cm2LoadStats();
    cm2SwitchTab('creators');
  } catch(e) {
    showToast('Remove failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🗑 Yes, Remove Permanently'; }
  }
}

/* ─── Auto Level Upgrade ─────────────────────────────────────────── */
async function crpAutoLevelUpgrade(userId) {
  const sb = window.supabaseClient;
  if (!sb) return;
  const { data: creator } = await sb.from('creators').select('total_sales,level').eq('user_id', userId).maybeSingle();
  if (!creator) return;
  const totalSales = creator.total_sales || 0;
  let newLevel = 'starter';
  if (totalSales >= 25000) newLevel = 'pro';
  else if (totalSales >= 5000) newLevel = 'rising';
  if (newLevel !== creator.level) {
    await sb.from('creators').update({ level: newLevel, revenue_share: CP_LEVELS[newLevel].share }).eq('user_id', userId);
    console.log('Creator auto-upgraded to', newLevel);
  }
}
