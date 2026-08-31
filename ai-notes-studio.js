/* ══════════════════════════════════════════════════════════════════════════
   AI HANDWRITTEN NOTES STUDIO — Studyria
   ══════════════════════════════════════════════════════════════════════════
   Self-contained vanilla JS module. Follows existing Studyria IIFE pattern.
   Dependencies: supabase.js (window.supabaseClient), pdf.js (window.pdfjsLib)
   Payment: Razorpay direct checkout (same key as existing premium-payment.js)
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

/* ── Config ─────────────────────────────────────────────────────────────── */
var CONFIG = {
  FREE_PAGE_LIMIT: 5,
  PRICE_PER_EXTRA_PAGE: 2,      // INR
  MAX_UPLOAD_SIZE: 50 * 1024 * 1024,  // 50MB
  MAX_PAGES: 100,
  OUTPUT_RETENTION_HOURS: 24,
  POLL_INTERVAL_MS: 3000,
  STORAGE_BUCKET: 'ai-notes-temp',
  RZP_KEY: 'rzp_live_SxcnO1cOS2HAJT',
};

/* ── State ──────────────────────────────────────────────────────────────── */
var state = {
  file: null,           // { name, size, type, dataUrl, pageCount }
  jobId: null,
  selectedMode: 'premium',   // quick | premium | detailed
  selectedLanguage: 'auto',  // en | as | auto
  pollTimer: null,
  rzpLock: false,       // prevent double-click payment
};

/* ── Helpers ───────────────────────────────────────────────────────────── */
function _sb() { return window.supabaseClient; }
function _user() {
  try { return _sb().auth.getUser ? null : null; } catch(e) { return null; }
}
async function _currentUser() {
  try {
    var r = await _sb().auth.getUser();
    return r.data && r.data.user ? r.data.user : null;
  } catch(e) { return null; }
}
function _toast(msg, type) {
  if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
}
function _fmtINR(n) { return '₹' + Number(n).toLocaleString('en-IN'); }

/* ── Pricing calculator (client display only — backend verifies) ───────── */
function calcPricing(pageCount) {
  var freePages = Math.min(pageCount, CONFIG.FREE_PAGE_LIMIT);
  var paidPages = Math.max(pageCount - CONFIG.FREE_PAGE_LIMIT, 0);
  var price = paidPages * CONFIG.PRICE_PER_EXTRA_PAGE;
  return { freePages: freePages, paidPages: paidPages, price: price };
}

/* ── File validation ────────────────────────────────────────────────────── */
async function validateFile(file) {
  if (!file) return { ok: false, error: 'No file selected.' };
  
  // Type check
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return { ok: false, error: 'Only PDF files are allowed.' };
  }
  
  // Size check
  if (file.size > CONFIG.MAX_UPLOAD_SIZE) {
    return { ok: false, error: 'File too large. Maximum ' + (CONFIG.MAX_UPLOAD_SIZE / 1024 / 1024) + 'MB.' };
  }
  
  // Magic bytes check
  try {
    var buf = await file.slice(0, 5).arrayBuffer();
    var bytes = new Uint8Array(buf);
    var sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
    if (sig !== '%PDF-') {
      return { ok: false, error: 'Invalid PDF file. The file signature does not match.' };
    }
  } catch(e) {
    return { ok: false, error: 'Could not read file header.' };
  }
  
  return { ok: true };
}

/* ── Page count via pdf.js ──────────────────────────────────────────────── */
async function countPages(file) {
  // Load pdf.js if not already loaded
  if (!window.pdfjsLib) {
    await new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js';
      s.onload = resolve;
      s.onerror = function() { reject(new Error('pdf.js failed to load')); };
      document.head.appendChild(s);
    });
  }
  if (!window.pdfjsLib) throw new Error('pdf.js not available');
  
  var ab = await file.arrayBuffer();
  var pdf = await window.pdfjsLib.getDocument({ data: ab }).promise;
  return pdf.numPages;
}

/* ── Upload to Supabase Storage ──────────────────────────────────────────── */
async function uploadToStorage(file, user) {
  var fileName = 'ai-notes-src/' + user.id + '/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  var { data, error } = await _sb().storage
    .from(CONFIG.STORAGE_BUCKET)
    .upload(fileName, file, { contentType: 'application/pdf', upsert: false });
  
  if (error) throw new Error('Upload failed: ' + error.message);
  return fileName;  // storage path
}

/* ── Razorpay checkout ───────────────────────────────────────────────────── */
async function processPayment(amount, user, jobId) {
  if (state.rzpLock) return null;
  state.rzpLock = true;
  
  // Load SDK
  if (typeof Razorpay === 'undefined') {
    await new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = resolve;
      s.onerror = function() { reject(new Error('Razorpay SDK failed to load')); };
      document.head.appendChild(s);
    });
  }
  
  var paymentResponse = await new Promise(function(resolve, reject) {
    var options = {
      key: CONFIG.RZP_KEY,
      amount: amount * 100,  // paise
      currency: 'INR',
      name: 'Studyria',
      description: 'AI Handwritten Notes — ' + state.file.pageCount + ' pages',
      prefill: {
        email: user.email || '',
        name: (user.user_metadata && user.user_metadata.full_name) || '',
      },
      theme: { color: '#930205' },
      notes: {
        feature: 'ai-notes',
        job_id: jobId || '',
        user_id: user.id,
        amount_inr: String(amount),
        page_count: String(state.file.pageCount),
      },
      handler: function(response) {
        resolve({
          payment_id: response.razorpay_payment_id || '',
          order_id: response.razorpay_order_id || '',
          signature: response.razorpay_signature || '',
        });
      },
      modal: {
        ondismiss: function() { reject(new Error('PAYMENT_CANCELLED')); },
      },
    };
    var rzp = new Razorpay(options);
    rzp.on('payment.failed', function(r) {
      reject(new Error('PAYMENT_FAILED:' + ((r.error && r.error.description) || 'unknown')));
    });
    rzp.open();
  }).catch(function(e) {
    state.rzpLock = false;
    throw e;
  });
  
  state.rzpLock = false;
  return paymentResponse;
}

/* ── Create job in database ─────────────────────────────────────────────── */
async function createJob(user, filePath, pricing) {
  var jobData = {
    user_id: user.id,
    original_filename: state.file.name,
    page_count: state.file.pageCount,
    free_pages: pricing.freePages,
    paid_pages: pricing.paidPages,
    amount: pricing.price,
    currency: 'INR',
    status: pricing.price === 0 ? 'QUEUED' : 'PAYMENT_PENDING',
    conversion_mode: state.selectedMode,
    language: state.selectedLanguage,
    source_storage_path: filePath,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + CONFIG.OUTPUT_RETENTION_HOURS * 3600 * 1000).toISOString(),
  };
  
  var { data, error } = await _sb().from('ai_note_jobs').insert(jobData).select().single();
  if (error) throw new Error('Failed to create job: ' + error.message);
  return data;
}

/* ── Verify payment & update job ────────────────────────────────────────── */
async function verifyPaymentAndUpdate(jobId, paymentResponse) {
  // Check for duplicate payment_id
  var { data: dup } = await _sb().from('ai_note_jobs')
    .select('id').eq('payment_id', paymentResponse.payment_id).neq('id', jobId).maybeSingle();
  
  if (dup) throw new Error('Duplicate payment detected.');
  
  var { error } = await _sb().from('ai_note_jobs').update({
    status: 'PAYMENT_VERIFIED',
    payment_id: paymentResponse.payment_id,
    payment_verified: new Date().toISOString(),
  }).eq('id', jobId);
  
  if (error) throw new Error('Failed to update job: ' + error.message);
}

/* ── Trigger processing ─────────────────────────────────────────────────── */
async function triggerProcessing(jobId) {
  // Try Base44 backend function first
  try {
    var resp = await fetch('https://app.base44.com/api/agents/6a57ae68c5c504767a174e45/functions/aiNotesProcess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    });
    if (resp.ok) return;
  } catch(e) { /* fall through */ }
  
  // Mark as QUEUED — backend will pick it up
  await _sb().from('ai_note_jobs').update({ status: 'QUEUED' }).eq('id', jobId);
}

/* ── Poll job status ────────────────────────────────────────────────────── */
async function pollJobStatus(jobId) {
  var { data, error } = await _sb().from('ai_note_jobs')
    .select('id, status, error_message_safe, output_path, expires_at, completed_at')
    .eq('id', jobId).maybeSingle();
  
  if (error || !data) {
    console.warn('[AI Notes] Poll error:', error);
    return null;
  }
  
  return data;
}

/* ── Download output ────────────────────────────────────────────────────── */
async function downloadOutput(jobId) {
  var { data: job, error } = await _sb().from('ai_note_jobs')
    .select('output_path, status, expires_at')
    .eq('id', jobId).maybeSingle();
  
  if (!job || error) { _toast('Job not found.', 'error'); return; }
  if (job.status !== 'COMPLETED') { _toast('Notes not ready yet.', 'error'); return; }
  
  var now = Date.now();
  if (job.expires_at && new Date(job.expires_at).getTime() < now) {
    _toast('Your file has expired and has been automatically deleted.', 'error');
    return;
  }
  
  // Download from Supabase storage
  var { data, error: dlErr } = await _sb().storage
    .from(CONFIG.STORAGE_BUCKET)
    .download(job.output_path);
  
  if (dlErr || !data) {
    // Try signed URL
    var { data: urlData } = await _sb().storage
      .from(CONFIG.STORAGE_BUCKET)
      .createSignedUrl(job.output_path, 300); // 5 min signed URL
    
    if (urlData && urlData.signedUrl) {
      window.open(urlData.signedUrl, '_blank');
      return;
    }
    _toast('Download failed. File may have been cleaned up.', 'error');
    return;
  }
  
  // Trigger browser download
  var blob = new Blob([data], { type: 'application/pdf' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'studyria-ai-notes-' + jobId.substring(0, 8) + '.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ── Render: Upload Zone ────────────────────────────────────────────────── */
function renderUploadZone(container) {
  container.innerHTML = `
    <div class="ans-upload-zone" id="ansUploadZone">
      <input type="file" accept="application/pdf,.pdf" id="ansFileInput" style="position:absolute;inset:0;opacity:0;cursor:pointer;z-index:2;" />
      <div class="ans-upload-icon">📄</div>
      <div class="ans-upload-label">Drop your PDF here or tap to browse</div>
      <div class="ans-upload-sub">First ${CONFIG.FREE_PAGE_LIMIT} pages FREE · ₹${CONFIG.PRICE_PER_EXTRA_PAGE}/page after</div>
    </div>
    <div id="ansFileInfo" style="display:none;"></div>
  `;
  
  var zone = container.querySelector('#ansUploadZone');
  var input = container.querySelector('#ansFileInput');
  var infoDiv = container.querySelector('#ansFileInfo');
  
  // Drag events
  ['dragover', 'dragenter'].forEach(function(ev) {
    zone.addEventListener(ev, function(e) { e.preventDefault(); zone.classList.add('dragging'); });
  });
  ['dragleave', 'drop'].forEach(function(ev) {
    zone.addEventListener(ev, function(e) { e.preventDefault(); zone.classList.remove('dragging'); });
  });
  zone.addEventListener('drop', function(e) {
    var files = e.dataTransfer.files;
    if (files.length) handleFile(files[0], infoDiv, container);
  });
  input.addEventListener('change', function() {
    if (this.files.length) handleFile(this.files[0], infoDiv, container);
  });
}

/* ── Handle file selection ──────────────────────────────────────────────── */
async function handleFile(file, infoDiv, container) {
  _toast('Checking PDF...');
  
  var validation = await validateFile(file);
  if (!validation.ok) {
    _toast(validation.error, 'error');
    infoDiv.style.display = 'none';
    return;
  }
  
  _toast('Counting pages...');
  try {
    var pageCount = await countPages(file);
  } catch(e) {
    _toast('Could not read PDF. It may be corrupted or password-protected.', 'error');
    return;
  }
  
  if (pageCount > CONFIG.MAX_PAGES) {
    _toast('PDF has ' + pageCount + ' pages. Maximum ' + CONFIG.MAX_PAGES + ' pages allowed.', 'error');
    return;
  }
  
  var pricing = calcPricing(pageCount);
  state.file = { name: file.name, size: file.size, type: file.type, pageCount: pageCount, file: file };
  
  // Render info card
  var fileSizeKB = (file.size / 1024).toFixed(0);
  infoDiv.style.display = 'block';
  infoDiv.innerHTML = `
    <div class="ans-info-card">
      <div class="ans-info-header">
        <div class="ans-info-file">
          <span class="ans-info-filename">${file.name}</span>
          <span class="ans-info-filesize">${fileSizeKB} KB · ${pageCount} pages</span>
        </div>
      </div>
      <div class="ans-pricing-row">
        <div class="ans-pricing-col">
          <span class="ans-pricing-label">🎁 Free pages</span>
          <span class="ans-pricing-value">${pricing.freePages}</span>
        </div>
        <div class="ans-pricing-col">
          <span class="ans-pricing-label">📄 Paid pages</span>
          <span class="ans-pricing-value">${pricing.paidPages} × ₹${CONFIG.PRICE_PER_EXTRA_PAGE}</span>
        </div>
        <div class="ans-pricing-col ans-pricing-total">
          <span class="ans-pricing-label">Total</span>
          <span class="ans-pricing-value">${pricing.price === 0 ? 'FREE' : _fmtINR(pricing.price)}</span>
        </div>
      </div>
      <div class="ans-options-row">
        <div class="ans-option-group">
          <label class="ans-option-label">Mode</label>
          <select id="ansMode" class="ans-select">
            <option value="premium" selected>✍️ Premium Handwritten</option>
            <option value="quick">⚡ Quick Revision</option>
            <option value="detailed">📖 Detailed Study Notes</option>
          </select>
        </div>
        <div class="ans-option-group">
          <label class="ans-option-label">Language</label>
          <select id="ansLang" class="ans-select">
            <option value="auto" selected>Source Language (Auto)</option>
            <option value="en">English</option>
            <option value="as">Assamese</option>
          </select>
        </div>
      </div>
      <button class="ans-action-btn" id="ansActionBtn">
        ${pricing.price === 0 ? '✍️ Generate Free Notes' : 'Continue to Payment · ' + _fmtINR(pricing.price)}
      </button>
    </div>
  `;
  
  // Wire up controls
  var modeSel = infoDiv.querySelector('#ansMode');
  var langSel = infoDiv.querySelector('#ansLang');
  modeSel.addEventListener('change', function() { state.selectedMode = this.value; });
  langSel.addEventListener('change', function() { state.selectedLanguage = this.value; });
  
  var btn = infoDiv.querySelector('#ansActionBtn');
  btn.addEventListener('click', async function() {
    btn.disabled = true;
    btn.textContent = 'Processing...';
    await startConversion(container);
    btn.disabled = false;
  });
}

/* ── Start conversion flow ───────────────────────────────────────────────── */
async function startConversion(container) {
  var user = await _currentUser();
  if (!user) {
    _toast('Please sign in to use AI Handwritten Notes.', 'error');
    if (typeof window.navigate === 'function') window.navigate('login');
    return;
  }
  
  var pricing = calcPricing(state.file.pageCount);
  
  try {
    // 1. Upload to Supabase storage
    _toast('Uploading PDF...');
    var filePath = await uploadToStorage(state.file.file, user);
    
    // 2. Create job
    _toast('Creating job...');
    var job = await createJob(user, filePath, pricing);
    state.jobId = job.id;
    
    // 3. Payment if needed
    if (pricing.price > 0) {
      _toast('Opening payment...');
      var payment = await processPayment(pricing.price, user, job.id);
      if (!payment) { _toast('Payment cancelled.', 'error'); return; }
      
      _toast('Verifying payment...');
      await verifyPaymentAndUpdate(job.id, payment);
    }
    
    // 4. Trigger processing
    _toast('Starting AI processing...');
    await triggerProcessing(job.id);
    
    // 5. Show status view
    renderStatusView(container, job.id);
  } catch(e) {
    console.error('[AI Notes] Conversion error:', e);
    var msg = e.message || 'Unknown error';
    if (msg.startsWith('PAYMENT_CANCELLED')) {
      _toast('Payment cancelled. No charge made.', 'info');
    } else if (msg.startsWith('PAYMENT_FAILED')) {
      _toast('Payment failed: ' + msg.split(':')[1], 'error');
    } else {
      _toast('Error: ' + msg, 'error');
    }
    
    // Re-enable button
    var btn = container.querySelector('#ansActionBtn');
    if (btn) { btn.disabled = false; btn.textContent = pricing.price === 0 ? '✍️ Generate Free Notes' : 'Continue to Payment · ' + _fmtINR(pricing.price); }
  }
}

/* ── Render: Status View ─────────────────────────────────────────────────── */
var STAGE_LABELS = {
  'UPLOADED': 'Upload complete',
  'VALIDATING': 'Validating PDF...',
  'PAYMENT_PENDING': 'Waiting for payment...',
  'PAYMENT_VERIFIED': 'Payment verified!',
  'QUEUED': 'Queued for processing...',
  'EXTRACTING': 'Reading your PDF...',
  'STRUCTURING': 'Organizing topics...',
  'GENERATING': 'Designing handwritten notes...',
  'RENDERING': 'Rendering PDF...',
  'QUALITY_CHECK': 'Checking quality...',
  'COMPLETED': 'Ready!',
  'FAILED': 'Something went wrong.',
  'EXPIRED': 'File expired.',
  'CLEANED': 'File cleaned up.',
};

function renderStatusView(container, jobId) {
  container.innerHTML = `
    <div class="ans-status-view">
      <div class="ans-status-icon" id="ansStatusIcon">⏳</div>
      <div class="ans-status-text" id="ansStatusText">Preparing...</div>
      <div class="ans-progress-track">
        <div class="ans-progress-bar" id="ansProgressBar" style="width:0%"></div>
      </div>
      <div class="ans-status-detail" id="ansStatusDetail"></div>
      <button class="ans-action-btn ans-btn-secondary" id="ansBackBtn" style="margin-top:20px;">← Back to Studio</button>
    </div>
  `;
  
  container.querySelector('#ansBackBtn').addEventListener('click', function() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    renderStudio(container);
  });
  
  // Start polling
  var stages = ['QUEUED', 'EXTRACTING', 'STRUCTURING', 'GENERATING', 'RENDERING', 'QUALITY_CHECK', 'COMPLETED'];
  
  async function checkStatus() {
    var job = await pollJobStatus(jobId);
    if (!job) return;
    
    var statusText = STAGE_LABELS[job.status] || job.status;
    var icon = '⏳';
    if (job.status === 'COMPLETED') icon = '✅';
    else if (job.status === 'FAILED') icon = '❌';
    else if (job.status === 'EXPIRED' || job.status === 'CLEANED') icon = '🗑️';
    
    container.querySelector('#ansStatusIcon').textContent = icon;
    container.querySelector('#ansStatusText').textContent = statusText;
    
    // Progress bar (stage-based, not fake percentage)
    var stageIdx = stages.indexOf(job.status);
    if (stageIdx >= 0) {
      var pct = ((stageIdx + 1) / stages.length) * 100;
      container.querySelector('#ansProgressBar').style.width = pct + '%';
    }
    
    if (job.status === 'COMPLETED') {
      if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
      renderDownloadView(container, job);
    } else if (job.status === 'FAILED' || job.status === 'EXPIRED' || job.status === 'CLEANED') {
      if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
      var detail = container.querySelector('#ansStatusDetail');
      detail.textContent = job.error_message_safe || (job.status === 'EXPIRED' ? 'Your file has expired.' : 'Please try again.');
      
      if (job.status === 'FAILED') {
        var retryBtn = document.createElement('button');
        retryBtn.className = 'ans-action-btn';
        retryBtn.textContent = '🔄 Retry';
        retryBtn.style.marginTop = '16px';
        retryBtn.onclick = function() { renderStudio(container); };
        detail.appendChild(document.createElement('br'));
        detail.appendChild(retryBtn);
      }
    }
  }
  
  checkStatus();
  state.pollTimer = setInterval(checkStatus, CONFIG.POLL_INTERVAL_MS);
}

/* ── Render: Download View ───────────────────────────────────────────────── */
function renderDownloadView(container, job) {
  var expiresAt = new Date(job.expires_at);
  var expiresStr = expiresAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  
  container.innerHTML = `
    <div class="ans-download-view">
      <div class="ans-download-icon">✅</div>
      <h3 class="ans-download-title">Your handwritten notes are ready!</h3>
      <p class="ans-download-sub">Generated from your uploaded PDF · Source securely deleted</p>
      <button class="ans-action-btn" id="ansDownloadBtn">⬇️ Download Notes PDF</button>
      <p class="ans-download-expiry">⏰ Available until: ${expiresStr}</p>
      <p class="ans-download-note">Your file is temporarily available. Please download before it expires.</p>
      <button class="ans-action-btn ans-btn-secondary" id="ansNewBtn" style="margin-top:16px;">+ Convert another PDF</button>
    </div>
  `;
  
  container.querySelector('#ansDownloadBtn').addEventListener('click', function() {
    downloadOutput(job.id);
  });
  container.querySelector('#ansNewBtn').addEventListener('click', function() {
    state.file = null;
    state.jobId = null;
    renderStudio(container);
  });
}

/* ── Render: My AI Notes (history) ───────────────────────────────────────── */
async function renderMyNotes(container) {
  var user = await _currentUser();
  if (!user) {
    container.innerHTML = '<p class="ans-empty">Please sign in to view your AI notes.</p>';
    return;
  }
  
  var { data: jobs, error } = await _sb().from('ai_note_jobs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);
  
  if (error || !jobs || jobs.length === 0) {
    container.innerHTML = '<div class="ans-empty-state"><div class="ans-empty-icon">📝</div><p>No AI notes yet. Upload a PDF to get started!</p></div>';
    return;
  }
  
  var html = '<div class="ans-history-list">';
  jobs.forEach(function(job) {
    var statusBadge = job.status === 'COMPLETED' ? '✅ Completed' :
                       job.status === 'FAILED' ? '❌ Failed' :
                       job.status === 'EXPIRED' || job.status === 'CLEANED' ? '🗑️ Expired' :
                       '⏳ ' + (STAGE_LABELS[job.status] || job.status);
    
    var modeLabel = job.conversion_mode === 'quick' ? 'Quick Revision' :
                    job.conversion_mode === 'detailed' ? 'Detailed Study' : 'Premium Handwritten';
    
    var date = new Date(job.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    var amount = job.amount > 0 ? _fmtINR(job.amount) : 'FREE';
    var expired = job.expires_at && new Date(job.expires_at).getTime() < Date.now();
    
    html += `
      <div class="ans-history-item">
        <div class="ans-history-info">
          <div class="ans-history-name">${job.original_filename}</div>
          <div class="ans-history-meta">${job.page_count} pages · ${modeLabel} · ${amount} · ${date}</div>
          <div class="ans-history-status">${statusBadge}</div>
        </div>
        <div class="ans-history-actions">
          ${job.status === 'COMPLETED' && !expired ? '<button class="ans-history-btn" data-job-id="' + job.id + '">Download</button>' : ''}
          <div class="ans-history-source-note">Source securely deleted</div>
        </div>
      </div>
    `;
  });
  html += '</div>';
  
  container.innerHTML = html;
  
  // Wire download buttons
  container.querySelectorAll('.ans-history-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { downloadOutput(this.dataset.jobId); });
  });
}

/* ── Main render function ───────────────────────────────────────────────── */
function renderStudio(container) {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  state.file = null;
  state.jobId = null;
  
  container.innerHTML = `
    <div class="ans-studio">
      <div class="ans-header">
        <h2 class="ans-title">✍️ AI Handwritten Notes Studio</h2>
        <p class="ans-subtitle">Turn your PDF into beautiful, exam-oriented handwritten-style study notes.</p>
      </div>
      
      <div class="ans-tabs">
        <button class="ans-tab active" data-tab="upload">Upload</button>
        <button class="ans-tab" data-tab="history">My AI Notes</button>
      </div>
      
      <div class="ans-tab-content" id="ansTabContent"></div>
    </div>
  `;
  
  var tabContent = container.querySelector('#ansTabContent');
  var tabs = container.querySelectorAll('.ans-tab');
  
  function switchTab(tabName) {
    tabs.forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tabName); });
    if (tabName === 'upload') renderUploadZone(tabContent);
    else renderMyNotes(tabContent);
  }
  
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() { switchTab(this.dataset.tab); });
  });
  
  switchTab('upload');
}

/* ── Public API ─────────────────────────────────────────────────────────── */
window.AiNotesStudio = {
  render: renderStudio,
  config: CONFIG,
};

/* ── CSS injection ──────────────────────────────────────────────────────── */
var css = `
.ans-studio { max-width: 600px; margin: 0 auto; padding: 16px; }
.ans-header { text-align: center; margin-bottom: 24px; }
.ans-title { font-size: 1.5rem; font-weight: 800; color: var(--accent, #930205); margin: 0 0 8px; }
.ans-subtitle { font-size: .85rem; color: var(--text2, #666); margin: 0; }

.ans-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 2px solid rgba(147,2,5,.1); }
.ans-tab { padding: 10px 20px; border: none; background: none; font-size: .9rem; font-weight: 600; color: var(--text2, #666); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all .2s; }
.ans-tab.active { color: var(--accent, #930205); border-bottom-color: var(--accent, #930205); }

.ans-upload-zone { position: relative; border: 2px dashed rgba(147,2,5,.25); border-radius: 16px; padding: 48px 24px; text-align: center; transition: all .25s; background: rgba(147,2,5,.02); }
.ans-upload-zone:hover, .ans-upload-zone.dragging { border-color: var(--accent,#930205); background: rgba(147,2,5,.05); transform: scale(1.01); }
.ans-upload-icon { font-size: 2.5rem; margin-bottom: 12px; }
.ans-upload-label { font-size: .95rem; font-weight: 700; color: var(--accent,#930205); margin-bottom: 6px; }
.ans-upload-sub { font-size: .75rem; color: var(--text2,#666); }

.ans-info-card { background: var(--glass,rgba(255,255,255,.05)); border: 1px solid var(--glass-border,rgba(0,0,0,.08)); border-radius: 16px; padding: 20px; margin-top: 16px; }
.ans-info-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.ans-info-file { display: flex; flex-direction: column; }
.ans-info-filename { font-weight: 700; font-size: .9rem; word-break: break-all; }
.ans-info-filesize { font-size: .75rem; color: var(--text2,#666); }

.ans-pricing-row { display: flex; gap: 12px; margin-bottom: 16px; }
.ans-pricing-col { flex: 1; text-align: center; padding: 12px; border-radius: 10px; background: rgba(147,2,5,.03); }
.ans-pricing-total { background: rgba(147,2,5,.08); }
.ans-pricing-label { display: block; font-size: .7rem; color: var(--text2,#666); margin-bottom: 4px; }
.ans-pricing-value { display: block; font-size: 1rem; font-weight: 700; color: var(--accent,#930205); }

.ans-options-row { display: flex; gap: 12px; margin-bottom: 16px; }
.ans-option-group { flex: 1; }
.ans-option-label { display: block; font-size: .75rem; font-weight: 600; color: var(--text2,#666); margin-bottom: 6px; }
.ans-select { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--glass-border,rgba(0,0,0,.08)); background: var(--glass,rgba(255,255,255,.05)); color: var(--text,#333); font-size: .85rem; outline: none; }
.ans-select:focus { border-color: var(--accent,#930205); }

.ans-action-btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 12px; background: var(--accent,#930205); color: #fff; font-size: .95rem; font-weight: 700; cursor: pointer; transition: all .2s; }
.ans-action-btn:hover { opacity: .9; transform: translateY(-1px); }
.ans-action-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.ans-btn-secondary { background: transparent; border: 1px solid var(--glass-border,rgba(0,0,0,.08)); color: var(--text2,#666); }

.ans-status-view { text-align: center; padding: 40px 20px; }
.ans-status-icon { font-size: 3rem; margin-bottom: 16px; }
.ans-status-text { font-size: 1.1rem; font-weight: 700; color: var(--accent,#930205); margin-bottom: 20px; }
.ans-progress-track { width: 100%; max-width: 400px; height: 6px; border-radius: 3px; background: rgba(147,2,5,.1); overflow: hidden; margin: 0 auto 16px; }
.ans-progress-bar { height: 100%; border-radius: 3px; background: var(--accent,#930205); transition: width .5s ease; }
.ans-status-detail { font-size: .85rem; color: var(--text2,#666); max-width: 400px; margin: 0 auto; }

.ans-download-view { text-align: center; padding: 40px 20px; }
.ans-download-icon { font-size: 3rem; margin-bottom: 16px; }
.ans-download-title { font-size: 1.2rem; font-weight: 800; color: var(--accent,#930205); margin: 0 0 8px; }
.ans-download-sub { font-size: .8rem; color: var(--text2,#666); margin: 0 0 24px; }
.ans-download-expiry { font-size: .8rem; color: var(--text2,#666); margin: 12px 0 4px; }
.ans-download-note { font-size: .75rem; color: var(--text2,#999); margin: 0 0 8px; }

.ans-empty-state { text-align: center; padding: 40px 20px; }
.ans-empty-icon { font-size: 2.5rem; margin-bottom: 12px; opacity: .5; }
.ans-empty-state p { font-size: .85rem; color: var(--text2,#666); }

.ans-history-list { display: flex; flex-direction: column; gap: 12px; }
.ans-history-item { display: flex; justify-content: space-between; align-items: center; padding: 14px; border-radius: 12px; background: var(--glass,rgba(255,255,255,.05)); border: 1px solid var(--glass-border,rgba(0,0,0,.08)); }
.ans-history-info { flex: 1; min-width: 0; }
.ans-history-name { font-weight: 700; font-size: .85rem; word-break: break-all; margin-bottom: 4px; }
.ans-history-meta { font-size: .72rem; color: var(--text2,#666); margin-bottom: 4px; }
.ans-history-status { font-size: .72rem; }
.ans-history-actions { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.ans-history-btn { padding: 8px 16px; border: none; border-radius: 8px; background: var(--accent,#930205); color: #fff; font-size: .8rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
.ans-history-source-note { font-size: .65rem; color: var(--text2,#999); }

@media (max-width: 480px) {
  .ans-pricing-row { flex-direction: column; }
  .ans-options-row { flex-direction: column; }
  .ans-history-item { flex-direction: column; align-items: flex-start; gap: 8px; }
  .ans-history-actions { width: 100%; flex-direction: row; justify-content: space-between; align-items: center; }
}
`;

var styleEl = document.createElement('style');
styleEl.id = 'ai-notes-studio-css';
styleEl.textContent = css;
if (!document.getElementById('ai-notes-studio-css')) {
  document.head.appendChild(styleEl);
}

})();
