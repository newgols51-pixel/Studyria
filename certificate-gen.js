/**
 * ═══════════════════════════════════════════════════════════════════════════
 * certificate-gen.js — Studyria V5.1 Module 5: Certificate Generator
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

(function (root) {
  const R = () => root.StudyriaRevenue;
  if (!R()) { console.error('[CertificateGen] Core not loaded'); return; }

  async function render(container) {
    if (!container) return;
    const user = await R()._user();
    if (!user) { container.innerHTML = R().emptyHTML('🔒', 'Please login to view your certificates.'); return; }

    container.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div class="rm-search" style="flex:1"><input type="text" placeholder="Verify Certificate ID..." oninput="CertificateGen._verifyInput(this.value)" style="padding-left:40px"></div>
        <button class="rm-btn rm-btn-primary" onclick="CertificateGen._verify()">Verify</button>
      </div>
      <div id="cgVerifyResult" style="margin-bottom:20px"></div>
      <div id="cgList">${R().skeletonHTML(4)}</div>`;

    try {
      const { data } = await R()._sb().from('certificates')
        .select('id,certificate_id,user_name,course_title,template_type,issued_at,is_revoked')
        .eq('user_id', user.id).order('issued_at', { ascending: false }).limit(30);
      if (!data?.length) { document.getElementById('cgList').innerHTML = R().emptyHTML('📜', 'No certificates yet. Complete a course to earn one!'); return; }
      document.getElementById('cgList').innerHTML = `<div class="rm-grid rm-grid-2">${data.map(c => `
        <div class="rm-card">
          <div class="rm-certificate" style="padding:20px;margin-bottom:12px">
            <div class="rm-certificate-title">${c.template_type === 'merit' ? '🏆 Certificate of Merit' : '📜 Certificate of Completion'}</div>
            <div class="rm-certificate-name">${R().sanitize(c.user_name)}</div>
            <div style="font-size:0.82rem;color:rgba(255,255,255,0.6)">${R().sanitize(c.course_title)}</div>
            <div style="font-size:0.72rem;color:rgba(255,255,255,0.4);margin-top:8px">ID: ${R().sanitize(c.certificate_id)}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="rm-btn rm-btn-primary" style="flex:1" onclick="CertificateGen._download('${c.id}')">⬇️ Download</button>
            <button class="rm-btn rm-btn-ghost" style="flex:1" onclick="CertificateGen._share('${c.id}')">🔗 Share</button>
          </div>
          ${c.is_revoked ? '<div style="color:var(--rm-danger);font-size:0.78rem;margin-top:8px">⚠️ This certificate has been revoked.</div>' : ''}
        </div>`).join('')}</div>`;
    } catch (e) { document.getElementById('cgList').innerHTML = R().errorHTML(e.message); }
  }

  let _verifyId = '';
  function _verifyInput(v) { _verifyId = v.trim(); }

  async function _verify() {
    if (!_verifyId) { R().toast('Enter a certificate ID to verify.', 'info'); return; }
    const result = document.getElementById('cgVerifyResult');
    if (!result) return;
    result.innerHTML = '<div class="rm-skeleton" style="height:80px"></div>';
    try {
      const { data } = await R()._sb().from('certificates')
        .select('certificate_id,user_name,course_title,issued_at,is_revoked,revoked_reason')
        .eq('certificate_id', _verifyId).single();
      if (!data) { result.innerHTML = '<div class="rm-card" style="border-color:var(--rm-danger)"><p style="color:var(--rm-danger)">❌ Certificate not found. Please check the ID and try again.</p></div>'; return; }
      if (data.is_revoked) { result.innerHTML = `<div class="rm-card" style="border-color:var(--rm-danger)">
        <p style="color:var(--rm-danger);font-weight:700">⚠️ This certificate has been REVOKED.</p>
        <p style="color:var(--rm-text-muted);font-size:0.82rem">Reason: ${R().sanitize(data.revoked_reason || 'Not specified')}</p></div>`; return; }
      result.innerHTML = `<div class="rm-card" style="border-color:var(--rm-success)">
        <p style="color:var(--rm-success);font-weight:700;font-size:1.1rem">✅ Certificate Verified!</p>
        <div style="margin-top:8px"><strong>${R().sanitize(data.user_name)}</strong></div>
        <div style="font-size:0.82rem;color:var(--rm-text-muted)">${R().sanitize(data.course_title)}</div>
        <div style="font-size:0.78rem;color:var(--rm-text-muted)">Issued: ${R().formatDate(data.issued_at)}</div>
      </div>`;
    } catch (e) { result.innerHTML = '<div class="rm-card" style="border-color:var(--rm-danger)"><p style="color:var(--rm-danger)">❌ Certificate not found.</p></div>'; }
  }

  async function _download(certId) {
    try {
      const { data: c } = await R()._sb().from('certificates').select('*').eq('id', certId).single();
      if (!c) return;
      const html = _certHTML(c);
      const w = window.open('', '_blank');
      if (!w) { R().toast('Please allow popups to download.', 'info'); return; }
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
    } catch (e) { R().toast('Error: ' + e.message, 'error'); }
  }

  function _certHTML(c) {
    return `<html><head><title>Certificate ${R().sanitize(c.certificate_id)}</title>
    <style>@page{size:landscape;margin:0}body{margin:0;font-family:Inter,system-ui,sans-serif}
    .cert{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#0d1a3a,#081020);color:#fff;padding:40px;text-align:center;
    border:4px solid #f59e0b;border-radius:20px}
    .cert h1{font-size:2.5rem;background:linear-gradient(135deg,#f59e0b,#f97316);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin:0}
    .cert .name{font-size:2rem;font-weight:700;margin:20px 0}
    .cert .course{font-size:1.2rem;color:rgba(255,255,255,0.7)}
    .cert .id{font-size:0.9rem;color:rgba(255,255,255,0.4);margin-top:20px}
    .cert .date{font-size:0.9rem;color:rgba(255,255,255,0.5);margin-top:10px}</style></head>
    <body><div class="cert">
    <h1>${c.template_type === 'merit' ? '🏆 Certificate of Merit' : '📜 Certificate of Completion'}</h1>
    <p>This certifies that</p>
    <div class="name">${R().sanitize(c.user_name)}</div>
    <p>has successfully completed</p>
    <div class="course">${R().sanitize(c.course_title)}</div>
    <div class="date">Issued on ${R().formatDate(c.issued_at)}</div>
    <div class="id">Certificate ID: ${R().sanitize(c.certificate_id)}</div>
    </div></body></html>`;
  }

  function _share(certId) {
    const url = `${root.location.origin}?verify=${certId}`;
    if (navigator.share) { navigator.share({ title: 'My Studyria Certificate', url }); }
    else { navigator.clipboard?.writeText(url); R().toast('Link copied to clipboard!', 'success'); }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  root.CertificateGen = Object.freeze({
    render, _verify, _verifyInput, _download, _share,
    init: () => { const p = document.getElementById('page-certificate-gen'); if (p && p.classList.contains('active')) render(p); }
  });

  R().register('certificateGen', root.CertificateGen);
  console.log('[CertificateGen] V5.1 loaded.');

}(typeof self !== 'undefined' ? self : this));
