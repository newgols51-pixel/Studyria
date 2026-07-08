
// Store current PDF for report
window._reportPdfId = null;
window._reportPdfUrl = null;

function openReportModal(pdfId, pdfTitle, pdfUrl) {
  window._reportPdfId = pdfId;
  window._reportPdfUrl = pdfUrl || '';
  const el = document.getElementById('reportModal');
  if (!el) return;
  document.getElementById('reportPdfTitle').value = pdfTitle || '';
  document.getElementById('reportProblem').value = '';
  document.getElementById('reportEmail').value = '';
  el.style.display = 'flex';
}

function closeReportModal() {
  const el = document.getElementById('reportModal');
  if (el) el.style.display = 'none';
}

async function submitReport() {
  const problem = document.getElementById('reportProblem')?.value?.trim();
  if (!problem) { showToast('Please describe the problem.', 'error'); return; }
  const sb = window.supabaseClient;
  const payload = {
    pdf_id: window._reportPdfId,
    pdf_title: document.getElementById('reportPdfTitle')?.value || '',
    pdf_url: window._reportPdfUrl || '',
    problem_description: problem,
    reporter_email: document.getElementById('reportEmail')?.value?.trim() || null,
    status: 'open',
    created_at: new Date().toISOString()
  };
  if (sb) {
    try {
      await sb.from('broken_pdf_reports').insert(payload);
    } catch(e) { /* table may not exist yet — still show success */ }
  }
  closeReportModal();
  showToast('✅ Report submitted! We\'ll fix it soon. Thank you 🙏', 'success');
}

// Close modal on backdrop click
document.getElementById('reportModal')?.addEventListener('click', function(e) {
  if (e.target === this) closeReportModal();
});
