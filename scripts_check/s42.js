
// ── OPEN PDF AND TRACK last_opened_at ────────────────────────────────────
async function openAndTrack(pdfId) {
  // Open the PDF (same flow as downloadPDF which checks purchase)
  await downloadPDF(pdfId);
  // trackReadingSession is already called inside downloadPDF/buyPDF flow,
  // but we also ensure last_opened_at is updated via our extended tracker.
}

// ── DOWNLOAD WITH TRACKING (download_count increment) ────────────────────
async function triggerPDFDownloadTracked(pdfId) {
  await triggerPDFDownload(pdfId);
  // incrementDownloadCount is already called inside triggerPDFDownload now
}

// ── PURCHASE HISTORY ────────────────────────────────────────────────────
async function showPurchaseHistory() {
  const modal = document.getElementById('purchaseHistoryModal');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  const body = document.getElementById('phModalBody');
  const summary = document.getElementById('phModalSummary');
  const totalValEl = document.getElementById('phTotalVal');
  body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text2)">Loading…</div>';
  summary.style.display = 'none';

  // Fetch fresh from DB
  window._dashCache = null;
  const stats = await _fetchDashStats();
  if (!stats || !stats.purchasedPdfs.length) {
    body.innerHTML = `<div style="text-align:center;padding:48px 20px">
      <div style="font-size:2.5rem;margin-bottom:12px">📭</div>
      <div style="color:var(--text2);font-weight:600">No purchases yet</div>
    </div>`;
    return;
  }

  const rawPurchases = stats.rawPurchases || [];

  body.innerHTML = stats.purchasedPdfs.map((p, i) => {
    const raw = rawPurchases[i] || {};
    const cover = p.cover_image || p.coverImage || p.thumbnail || p.image || '';
    const paidAmt = raw.amount !== null && raw.amount !== undefined && Number(raw.amount) > 0
      ? Number(raw.amount)
      : Number(p.price || 0);
    const amountStr = p.free ? 'Free' : `₹${paidAmt.toLocaleString('en-IN')}`;
    const dateStr = p._purchaseDate ? new Date(p._purchaseDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : 'No data available';
    const paymentId = raw.payment_id || 'No data available';
    const orderId = raw.id || 'No data available';
    const status = raw.status || 'No data available';
    const statusLabel = status === 'paid' ? '✓ Paid' : (status !== 'No data available' ? status : 'No data available');
    return `
    <div class="ph-row">
      <div class="ph-cover">
        ${cover ? `<img src="${cover}" alt="${p.title}" onerror="this.style.display='none'" loading="lazy" decoding="async">` : '📄'}
      </div>
      <div class="ph-info">
        <div class="ph-title">${p.title}</div>
        <div class="ph-date">📅 ${dateStr} · ${p.category || 'Study Material'}</div>
        <div style="font-size:.68rem;color:var(--text2);margin-top:3px">
          <span style="opacity:.7">Payment ID:</span> <span style="font-family:monospace;font-size:.7rem">${paymentId}</span>
        </div>
        <div style="font-size:.68rem;color:var(--text2);margin-top:1px">
          <span style="opacity:.7">Order ID:</span> <span style="font-family:monospace;font-size:.7rem">${orderId}</span>
        </div>
      </div>
      <div class="ph-right">
        <div class="ph-amount">${amountStr}</div>
        <div class="ph-status">${statusLabel}</div>
      </div>
    </div>`;
  }).join('');

  totalValEl.textContent = `₹${stats.totalSpent.toLocaleString('en-IN')}`;
  summary.style.display = 'flex';
}

function closePurchaseHistory() {
  document.getElementById('purchaseHistoryModal').classList.remove('open');
  document.body.style.overflow = '';
}

// ── READING ANALYTICS ────────────────────────────────────────────────────
async function showReadingAnalytics() {
  const modal = document.getElementById('readingAnalyticsModal');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  const body = document.getElementById('readingAnalyticsBody');
  body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text2)">Loading…</div>';

  const client = window.supabaseClient;
  const user = window.currentUser;
  const _userId = user?.id || user?.uid;

  // Fetch from reading_sessions (hours) + pdf_analytics (per-PDF stats)
  let totalSeconds = 0, openedCount = 0, totalMinRead = 0;
  let analyticsRows = [];

  const stats = window._dashCache || await _fetchDashStats();
  totalSeconds = stats ? stats.hoursRead * 3600 : 0;

  if (client && _userId) {
    try {
      // Aggregate pdf_analytics for this user
      const { data: aRows } = await client
        .from('pdf_analytics')
        .select('pdf_id, opened_count, download_count, last_opened_at, first_opened_at, total_read_time_minutes')
        .eq('user_id', _userId);
      analyticsRows = aRows || [];
      openedCount = analyticsRows.reduce((s, r) => s + (r.opened_count || 0), 0);
      totalMinRead = analyticsRows.reduce((s, r) => s + (r.total_read_time_minutes || 0), 0);
    } catch(e) { console.warn('⚠️ pdf_analytics aggregate error:', e); }
  }

  const hours = stats ? stats.hoursRead : (totalMinRead > 0 ? (totalMinRead / 60).toFixed(1) : 0);
  const count = stats ? stats.purchasedCount : 0;
  const totalDlCount = analyticsRows.reduce((s,r) => s + (r.download_count||0), 0);

  if (!stats && analyticsRows.length === 0) {
    body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2)">No data available</div>`;
    return;
  }

  body.innerHTML = `
    <div class="ra-stat-row">
      <div class="ra-stat-icon">⏱️</div>
      <div class="ra-stat-info">
        <div class="ra-stat-val">${hours}h</div>
        <div class="ra-stat-lbl">Total Reading Time</div>
      </div>
    </div>
    <div class="ra-stat-row">
      <div class="ra-stat-icon">📖</div>
      <div class="ra-stat-info">
        <div class="ra-stat-val">${count > 0 ? count : 'No data available'}</div>
        <div class="ra-stat-lbl">PDFs in Library</div>
      </div>
    </div>
    <div class="ra-stat-row">
      <div class="ra-stat-icon">👁️</div>
      <div class="ra-stat-info">
        <div class="ra-stat-val">${openedCount > 0 ? openedCount : 'No data available'}</div>
        <div class="ra-stat-lbl">Total Opens</div>
      </div>
    </div>
    <div class="ra-stat-row">
      <div class="ra-stat-icon">⬇️</div>
      <div class="ra-stat-info">
        <div class="ra-stat-val">${totalDlCount > 0 ? totalDlCount : 'No data available'}</div>
        <div class="ra-stat-lbl">Total Downloads</div>
      </div>
    </div>
    <div class="ra-stat-row">
      <div class="ra-stat-icon">📅</div>
      <div class="ra-stat-info">
        <div class="ra-stat-val">${count > 0 ? Math.round((Number(hours) * 60) / Math.max(count,1)) + ' min' : 'No data available'}</div>
        <div class="ra-stat-lbl">Avg. per PDF</div>
      </div>
    </div>
    <div style="margin-top:14px;padding:14px;background:rgba(61,142,248,0.06);border-radius:12px;border:1px solid rgba(61,142,248,0.12);font-size:.82rem;color:var(--text2);text-align:center">
      Reading sessions are tracked when you open PDFs from your library.
    </div>`;
}

// ── RECENTLY OPENED ──────────────────────────────────────────────────────
async function showRecentlyOpened() {
  const modal = document.getElementById('recentlyOpenedModal');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  const body = document.getElementById('recentlyOpenedBody');
  body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text2)">Loading…</div>';

  const client = window.supabaseClient;
  const user = window.currentUser;
  const _userId = user?.id || user?.uid;

  const stats = window._dashCache || await _fetchDashStats();
  if (!stats || !stats.purchasedPdfs.length) {
    body.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--text2)">
      <div style="font-size:2.5rem;margin-bottom:10px">📭</div>
      <div>No PDFs purchased yet.</div>
      <button class="btn btn-primary" style="margin-top:16px" onclick="document.getElementById('recentlyOpenedModal').classList.remove('open');navigate('library')">Browse Library</button>
    </div>`;
    return;
  }

  // Fetch pdf_analytics sorted by last_opened_at descending
  let analyticsMap = {};
  if (client && _userId) {
    try {
      const { data: aRows } = await client
        .from('pdf_analytics')
        .select('pdf_id, last_opened_at, opened_count')
        .eq('user_id', _userId)
        .order('last_opened_at', { ascending: false });
      (aRows || []).forEach(r => { analyticsMap[r.pdf_id] = r; });
    } catch(e) {}
  }

  // Sort purchased PDFs by last_opened_at (most recent first), never-opened last
  const sorted = [...stats.purchasedPdfs].sort((a, b) => {
    const ta = analyticsMap[String(a.id)]?.last_opened_at || null;
    const tb = analyticsMap[String(b.id)]?.last_opened_at || null;
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return new Date(tb) - new Date(ta);
  });

  body.innerHTML = sorted.slice(0, 8).map(p => {
    const cover = p.cover_image || p.coverImage || p.thumbnail || p.image || '';
    const analytics = analyticsMap[String(p.id)] || {};
    const lastOpened = analytics.last_opened_at ? _formatRelativeDate(analytics.last_opened_at) : 'Never opened';
    const openCount = analytics.opened_count;
    const openLabel = openCount !== undefined && openCount !== null
      ? `Opened ${openCount} time${openCount === 1 ? '' : 's'}`
      : 'No data available';
    return `
    <div class="ra-list-item">
      <div class="ra-list-cover">
        ${cover ? `<img src="${cover}" alt="${p.title}" onerror="this.style.display='none'" loading="lazy" decoding="async">` : '📄'}
      </div>
      <div class="ra-list-info">
        <div class="ra-list-title">${p.title}</div>
        <div class="ra-list-sub">Last Opened: ${lastOpened} · ${openLabel}</div>
      </div>
      <button class="lib-btn-open" style="flex:0 0 auto;padding:7px 12px;font-size:.75rem" onclick="openAndTrack('${p.id}')">Open</button>
    </div>`;
  }).join('');
}

// ── LEARNING ACTIVITY ────────────────────────────────────────────────────
async function showLearningActivity() {
  const modal = document.getElementById('learningActivityModal');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  const body = document.getElementById('learningActivityBody');
  body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text2)">Loading…</div>';

  const client = window.supabaseClient;
  const user = window.currentUser;
  const _userId = user?.id || user?.uid;
  const stats = window._dashCache || await _fetchDashStats();

  // Calculate real streak from reading_sessions: count distinct days opened
  let streakVal = 'No data available';
  let distinctDays = 0;
  if (client && _userId) {
    try {
      const { data: sessions } = await client
        .from('reading_sessions')
        .select('opened_at')
        .eq('user_id', _userId)
        .order('opened_at', { ascending: false });
      if (sessions && sessions.length > 0) {
        // Get distinct calendar days
        const days = new Set(sessions.map(s => s.opened_at?.slice(0,10)).filter(Boolean));
        distinctDays = days.size;
        // Calculate current streak: consecutive days ending today/yesterday
        const daysList = [...days].sort().reverse();
        let streak = 0;
        let prev = null;
        for (const d of daysList) {
          const dt = new Date(d);
          if (prev === null) {
            const today = new Date(); today.setHours(0,0,0,0);
            const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
            if (dt >= yesterday) { streak = 1; prev = dt; }
            else break;
          } else {
            const prevDay = new Date(prev); prevDay.setDate(prevDay.getDate()-1);
            if (dt.toDateString() === prevDay.toDateString()) { streak++; prev = dt; }
            else break;
          }
        }
        streakVal = streak > 0 ? streak + ' Days' : 'No data available';
      }
    } catch(e) {}
  }

  body.innerHTML = `
    <div class="ra-stat-row">
      <div class="ra-stat-icon">🔥</div>
      <div class="ra-stat-info">
        <div class="ra-stat-val">${streakVal}</div>
        <div class="ra-stat-lbl">Current Streak</div>
      </div>
    </div>
    <div class="ra-stat-row">
      <div class="ra-stat-icon">📅</div>
      <div class="ra-stat-info">
        <div class="ra-stat-val">${distinctDays > 0 ? distinctDays : 'No data available'}</div>
        <div class="ra-stat-lbl">Days Active</div>
      </div>
    </div>
    <div class="ra-stat-row">
      <div class="ra-stat-icon">📚</div>
      <div class="ra-stat-info">
        <div class="ra-stat-val">${stats ? stats.purchasedCount : 'No data available'}</div>
        <div class="ra-stat-lbl">PDFs Purchased</div>
      </div>
    </div>
    <div class="ra-stat-row">
      <div class="ra-stat-icon">⏱️</div>
      <div class="ra-stat-info">
        <div class="ra-stat-val">${stats ? stats.hoursRead + 'h' : 'No data available'}</div>
        <div class="ra-stat-lbl">Total Study Time</div>
      </div>
    </div>
    <div style="margin-top:14px;padding:14px;background:rgba(245,158,11,0.06);border-radius:12px;border:1px solid rgba(245,158,11,0.15);font-size:.82rem;color:var(--text2);text-align:center">
      🔥 Keep your streak alive — open a PDF today!
    </div>`;

  // Update the lcStreak element in dashboard overview with real value
  const streakEl = document.getElementById('lcStreak');
  if (streakEl && typeof streakVal === 'string' && streakVal !== 'No data available') {
    streakEl.textContent = streakVal.replace(' Days','');
  }
}

// ── PROGRESS DASHBOARD ───────────────────────────────────────────────────
async function showProgressDashboard() {
  const modal = document.getElementById('progressDashModal');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  const body = document.getElementById('progressDashBody');
  body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text2)">Loading…</div>';

  const client = window.supabaseClient;
  const user = window.currentUser;
  const _userId = user?.id || user?.uid;
  const stats = window._dashCache || await _fetchDashStats();
  const count = stats ? stats.purchasedCount : 0;

  // Count how many purchased PDFs have been opened (have an analytics row with opened_count > 0)
  let openedPdfs = 0;
  let totalReadMinutes = 0;
  if (client && _userId && count > 0) {
    try {
      const { data: aRows } = await client
        .from('pdf_analytics')
        .select('pdf_id, opened_count, total_read_time_minutes')
        .eq('user_id', _userId)
        .gt('opened_count', 0);
      openedPdfs = (aRows || []).length;
      totalReadMinutes = (aRows || []).reduce((s,r) => s + (r.total_read_time_minutes||0), 0);
    } catch(e) {}
  }

  const completion = count > 0 ? Math.round((openedPdfs / count) * 100) : 0;

  body.innerHTML = `
    <div class="ra-stat-row">
      <div class="ra-stat-icon">🎯</div>
      <div class="ra-stat-info">
        <div class="ra-stat-val">${count > 0 ? completion + '%' : 'No data available'}</div>
        <div class="ra-stat-lbl">Completion Rate (PDFs Opened)</div>
      </div>
    </div>
    <div class="ra-stat-row">
      <div class="ra-stat-icon">📖</div>
      <div class="ra-stat-info">
        <div class="ra-stat-val">${count > 0 ? count : 'No data available'}</div>
        <div class="ra-stat-lbl">Collection Size</div>
      </div>
    </div>
    <div class="ra-stat-row">
      <div class="ra-stat-icon">✅</div>
      <div class="ra-stat-info">
        <div class="ra-stat-val">${openedPdfs > 0 ? openedPdfs : (count > 0 ? 0 : 'No data available')}</div>
        <div class="ra-stat-lbl">PDFs Opened</div>
      </div>
    </div>
    <div class="ra-stat-row">
      <div class="ra-stat-icon">⏱️</div>
      <div class="ra-stat-info">
        <div class="ra-stat-val">${stats ? stats.hoursRead + 'h' : 'No data available'}</div>
        <div class="ra-stat-lbl">Hours Read</div>
      </div>
    </div>
    <div style="margin-top:6px">
      <div style="font-size:.75rem;color:var(--text2);margin-bottom:6px;font-weight:600">PROGRESS</div>
      <div style="height:10px;background:var(--glass-border);border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${Math.min(completion,100)}%;background:var(--grad-primary);border-radius:6px;transition:width .8s ease"></div>
      </div>
    </div>`;

  // Update completion rate in overview
  const lcComp = document.getElementById('lcCompletion');
  if (lcComp) lcComp.textContent = count > 0 ? completion + '%' : '0%';
  const bar3 = document.getElementById('lcBar3');
  if (bar3) bar3.style.width = completion + '%';
}

// ── DOWNLOAD PDF (force download instead of open) ────────────────────────
async function triggerPDFDownload(pdfId) {
  const client = window.supabaseClient;
  let user = null;
  try {
    const { data: { user: u } } = await supabase.auth.getUser();
    user = u;
  } catch(e) {}

  if (!user) {
    showToast('Please login to download.', 'info');
    navigate('login');
    return;
  }

  // Verify ownership — status is the ONLY access check. 'owned' (free PDFs)
  // and 'paid' (purchased PDFs) both grant identical Open/Download access.
  // Fast path: in-memory ownership cache (populated by _loadOwnershipCache /
  // grantFreeOwnership) so free PDFs already in My Library never hit this gate.
  let owned = _isOwned(String(pdfId));
  if (!owned && client) {
    try {
      const { data } = await client
        .from('purchased_pdfs').select('id')
        .eq('user_id', user.id).eq('pdf_uuid', String(pdfId)).in('status', ['paid', 'owned']);
      owned = data && data.length > 0;
      if (!owned) {
        // Email fallback
        const { data: emailRows } = await client
          .from('purchased_pdfs').select('id')
          .eq('email', user.email).eq('pdf_uuid', String(pdfId)).in('status', ['paid', 'owned']);
        owned = emailRows && emailRows.length > 0;
      }
      if (owned) window._ownedPdfIds.add(String(pdfId));
    } catch(e) {}
  }

  if (!owned) {
    showToast('You have not purchased this PDF.', 'error');
    return;
  }

  // Fetch fresh PDF url
  let pdfUrl = '';
  if (client) {
    try {
      const { data } = await client.from('pdfs').select('pdf_url, title').eq('id', pdfId).single();
      if (data?.pdf_url) pdfUrl = data.pdf_url;
    } catch(e) {}
  }
  if (!pdfUrl) {
    const pdf = (window.PDFS||[]).find(p => String(p.id) === String(pdfId));
    pdfUrl = pdf?.pdf_url || pdf?.pdfUrl || '';
  }

  // ── Resolve path → signed URL (pdfs bucket is PRIVATE) ─────────────
  // Full https Supabase storage URLs are re-signed by extracting the object path.
  // Non-storage external URLs are opened directly.
  // Bare path/filename → signed directly.
  const _VALID_PDF_BUCKET = 'pdfs';

  async function _resolveLibraryPdfUrl(rawUrl) {
    if (!rawUrl || rawUrl === '#') return { signedUrl: '', error: 'No URL' };
    const sc = window.supabaseClient || (typeof supabase !== 'undefined' ? supabase : null);

    console.log('🔍 [Library PDF] _resolveLibraryPdfUrl called with:', rawUrl);

    let filePath = rawUrl;
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      const match = rawUrl.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/);
      if (match) {
        filePath = decodeURIComponent(match[1]);
        console.log('🔍 [Library PDF] Extracted storage path from full URL:', filePath);
      } else {
        // Non-storage external URL — open directly
        console.log('✅ [Library PDF] Non-storage full URL — opening directly:', rawUrl);
        return { signedUrl: rawUrl };
      }
    }

    if (!sc) {
      console.error('❌ [Library PDF] No Supabase client to sign path:', filePath);
      return { signedUrl: '', error: 'No Supabase client' };
    }

    const { data, error } = await sc.storage
      .from(_VALID_PDF_BUCKET)
      .createSignedUrl(filePath, 3600);

    if (error) {
      console.error('❌ [Library PDF] createSignedUrl failed | path:', filePath, '| error:', error.message);
      return { signedUrl: '', error: error.message };
    }

    console.log('✅ [Library PDF] Signed URL created | path:', filePath, '| url:', data.signedUrl);
    return { signedUrl: data.signedUrl };
  }

  const { signedUrl: resolvedLibUrl, error: libResolveErr } = await _resolveLibraryPdfUrl(pdfUrl);
  console.log('📚 [Library Download] pdfId:', pdfId, '| pdf_url from DB:', pdfUrl, '| final signed URL:', resolvedLibUrl);

  if (!resolvedLibUrl) {
    console.error('❌ [Library Download] Could not resolve URL:', libResolveErr);
    showToast('Download link not available.', 'error');
    return;
  }

  // Force download via anchor
  showToast('Starting download… 📥', 'success');
  try {
    const a = document.createElement('a');
    a.href = resolvedLibUrl;
    a.download = '';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch(e) {
    window.open(resolvedLibUrl, '_blank');
  }
  // ── Increment real download_count in database ──────────────────────
  incrementDownloadCount(pdfId);
  // ── GA4 pdf_download event (My Library re-download) ────────────────
  const _libPdf = normalizePdf((window.PDFS || []).find(p => String(p.id) === String(pdfId))) || { id: pdfId };
  trackPdfDownloadEvent(_libPdf);
}

// Close all modals on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closePurchaseHistory();
    ['readingAnalyticsModal','recentlyOpenedModal','learningActivityModal','progressDashModal']
      .forEach(id => { const el = document.getElementById(id); if(el) el.classList.remove('open'); });
    document.body.style.overflow = '';
  }
});
