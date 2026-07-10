(function() {
  'use strict';

  // Inject Styles for Premium Elements
  const style = document.createElement('style');
  style.textContent = `
    /* Global design overrides / adjustments */
    #pdpWrap {
      padding-bottom: 80px; /* Leave room for mobile bottom bar */
    }

    /* PREMIUM CHIPS style overrides */
    #pdpInfoChips .pdp-info-chip {
      background: var(--glass);
      border: 1px solid var(--glass-border);
      transition: transform 0.2s, background 0.2s;
    }
    #pdpInfoChips .pdp-info-chip:hover {
      transform: translateY(-2px);
      background: rgba(255,255,255,0.08);
    }

    /* ENHANCED SHARE DIALOG / BOTTOM SHEET */
    .premium-share-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(4, 6, 10, 0.7);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 10000;
      display: flex;
      align-items: flex-end; /* bottom-sheet on mobile */
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    .premium-share-overlay.active {
      opacity: 1;
      pointer-events: auto;
    }
    .premium-share-panel {
      background: #080c14;
      border: 1px solid var(--glass-border);
      border-radius: 20px 20px 0 0;
      width: 100%;
      max-width: 500px;
      padding: 24px;
      transform: translateY(100%);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 -10px 40px rgba(0,0,0,0.5);
    }
    @media (min-width: 769px) {
      .premium-share-overlay {
        align-items: center; /* modal on desktop */
      }
      .premium-share-panel {
        border-radius: 16px;
        transform: scale(0.9) translateY(20px);
        transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
    }
    .premium-share-overlay.active .premium-share-panel {
      transform: translateY(0) scale(1);
    }
    .premium-share-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .premium-share-title {
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--text);
    }
    .premium-share-close {
      background: var(--glass);
      border: none;
      color: var(--text);
      font-size: 1.4rem;
      cursor: pointer;
      width: 32px; height: 32px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
    }
    .premium-share-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    .premium-share-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px 8px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.05);
      background: rgba(255,255,255,0.03);
      color: var(--text2);
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s, transform 0.2s, color 0.2s;
    }
    .premium-share-btn:hover {
      background: rgba(255,255,255,0.08);
      transform: translateY(-2px);
      color: var(--text);
    }
    .premium-share-btn.whatsapp:hover { background: rgba(37, 211, 102, 0.15); border-color: #25D366; color: #25D366; }
    .premium-share-btn.telegram:hover { background: rgba(0, 136, 204, 0.15); border-color: #0088cc; color: #0088cc; }
    .premium-share-btn.facebook:hover { background: rgba(24, 119, 242, 0.15); border-color: #1877F2; color: #1877F2; }
    .premium-share-btn.twitter:hover { background: rgba(255, 255, 255, 0.1); border-color: #ffffff; color: #ffffff; }
    .premium-share-btn.linkedin:hover { background: rgba(10, 102, 194, 0.15); border-color: #0a66c2; color: #0a66c2; }
    .premium-share-btn.pinterest:hover { background: rgba(189, 8, 28, 0.15); border-color: #bd081c; color: #bd081c; }
    .premium-share-btn.copy:hover { background: rgba(61, 142, 248, 0.15); border-color: var(--color-accent); color: var(--color-accent); }
    .premium-share-btn svg {
      width: 24px; height: 24px;
      fill: currentColor;
    }

    /* ENHANCED TRUST BADGES */
    .premium-trust-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 16px;
    }
    .premium-trust-card {
      flex: 1 1 calc(50% - 12px);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      padding: 10px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.85rem;
      font-weight: 500;
    }
    .premium-trust-icon {
      font-size: 1.25rem;
    }
    @media (min-width: 500px) {
      .premium-trust-card {
        flex: 1 1 calc(33.33% - 12px);
      }
    }

    /* FREQUENTLY BOUGHT TOGETHER */
    .fbt-section {
      background: var(--bg2);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      padding: 24px;
      margin: 32px 0;
    }
    .fbt-title {
      font-size: 1.15rem;
      font-weight: 700;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .fbt-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 20px;
    }
    .fbt-combo {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .fbt-item {
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: 220px;
    }
    .fbt-item-img {
      width: 50px;
      height: 70px;
      object-fit: cover;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .fbt-item-meta {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .fbt-item-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .fbt-item-price {
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--text2);
    }
    .fbt-plus {
      font-size: 1.2rem;
      font-weight: bold;
      color: var(--text2);
    }
    .fbt-action-block {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: flex-start;
      min-width: 200px;
    }
    @media (max-width: 600px) {
      .fbt-action-block {
        width: 100%;
      }
    }
    .fbt-price-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .fbt-price-total {
      font-size: 1.4rem;
      font-weight: 800;
      color: var(--text);
    }
    .fbt-price-was {
      font-size: 0.95rem;
      color: var(--text2);
      text-decoration: line-through;
    }
    .fbt-save-badge {
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
      padding: 2px 8px;
      border-radius: 99px;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .fbt-btn {
      width: 100%;
      background: var(--grad-primary);
      color: #000;
      font-weight: 700;
      border: none;
      border-radius: 10px;
      padding: 12px;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .fbt-btn:hover {
      opacity: 0.95;
      transform: translateY(-1px);
    }

    /* PREMIUM DYNAMIC FAQ ACCORDION */
    .faq-section {
      margin: 40px 0;
    }
    .faq-title {
      font-size: 1.4rem;
      font-weight: 700;
      margin-bottom: 24px;
    }
    .faq-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .faq-item {
      background: var(--bg2);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      overflow: hidden;
      transition: border-color 0.2s;
    }
    .faq-item.active {
      border-color: rgba(61, 142, 248, 0.4);
    }
    .faq-question {
      width: 100%;
      background: none;
      border: none;
      text-align: left;
      padding: 18px 20px;
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text);
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .faq-arrow {
      transition: transform 0.3s;
      color: var(--text2);
    }
    .faq-item.active .faq-arrow {
      transform: rotate(180deg);
      color: var(--color-accent);
    }
    .faq-answer {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease-out, padding 0.3s;
      color: var(--text2);
      font-size: 0.9rem;
      line-height: 1.5;
      padding: 0 20px;
    }
    .faq-item.active .faq-answer {
      padding: 0 20px 20px 20px;
    }

    /* ENHANCED MOBILE BOTTOM BAR */
    .premium-mobile-bar {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      background: #0d1220;
      border-top: 1px solid rgba(255,255,255,0.1);
      padding: 12px 16px;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-shadow: 0 -4px 20px rgba(0,0,0,0.4);
      transform: translateY(0);
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .premium-mobile-bar.hidden {
      transform: translateY(100%);
    }
    @media (min-width: 769px) {
      .premium-mobile-bar {
        display: none !important;
      }
    }
    .pmb-price-col {
      display: flex;
      flex-direction: column;
    }
    .pmb-price-label {
      font-size: 0.7rem;
      color: var(--text2);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .pmb-price-val {
      font-size: 1.3rem;
      font-weight: 800;
      color: var(--text);
    }
    .pmb-price-orig {
      font-size: 0.85rem;
      text-decoration: line-through;
      color: var(--text2);
    }
    .pmb-btn {
      flex: 1;
      max-width: 220px;
      background: var(--grad-primary);
      color: #000;
      border: none;
      font-weight: 700;
      font-size: 0.95rem;
      border-radius: 10px;
      padding: 12px 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(61, 142, 248, 0.3);
    }
    @media (max-width: 360px) {
      .pmb-btn {
        max-width: 100%;
      }
    }

    /* WATERMARKED PREVIEW & BADGE */
    .pdp-preview-sticky {
      position: relative;
    }
    .premium-watermark {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-35deg);
      font-size: clamp(18px, 4vw, 28px);
      color: rgba(255, 255, 255, 0.12);
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
      font-weight: 700;
      letter-spacing: 0.1em;
      z-index: 10;
    }
    .premium-preview-badge {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(8, 12, 20, 0.8);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      border: 1px solid var(--glass-border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--color-accent);
      z-index: 11;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .premium-preview-badge-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--color-accent);
      animation: pulse 1.4s infinite;
    }

    /* FULLSCREEN PREVIEW MODAL */
    .premium-fullscreen-btn {
      position: absolute;
      bottom: 12px;
      right: 12px;
      background: rgba(8, 12, 20, 0.8);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      border: 1px solid var(--glass-border);
      border-radius: 6px;
      width: 32px; height: 32px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      color: var(--text);
      z-index: 11;
      transition: background 0.2s, transform 0.2s;
    }
    .premium-fullscreen-btn:hover {
      background: var(--color-accent);
      color: #000;
      transform: scale(1.05);
    }
    .premium-fs-modal {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(4, 6, 10, 0.95);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      z-index: 10005;
      display: flex;
      flex-direction: column;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    .premium-fs-modal.active {
      opacity: 1;
      pointer-events: auto;
    }
    .premium-fs-header {
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--glass-border);
    }
    .premium-fs-close {
      background: var(--glass);
      border: none;
      color: var(--text);
      font-size: 1.4rem;
      cursor: pointer;
      width: 36px; height: 36px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
    }
    .premium-fs-body {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      overflow: auto;
    }
    .premium-fs-img-container {
      position: relative;
      max-height: 80vh;
      max-width: 100%;
    }
    .premium-fs-img {
      max-height: 80vh;
      max-width: 100%;
      border-radius: 8px;
      object-fit: contain;
      box-shadow: 0 10px 40px rgba(0,0,0,0.6);
    }
  `;
  document.head.appendChild(style);

  // Helper: Poll for completion of renderDetail (checking pdpWrap rendering status)
  function waitForRender(cb, tries) {
    tries = tries || 0;
    const wrap = document.getElementById('pdpWrap');
    if (wrap && wrap.querySelector('.pdp-page')) {
      return cb();
    }
    if (tries < 60) {
      return setTimeout(() => waitForRender(cb, tries + 1), 200);
    }
  }

  waitForRender(function() {
    const pdf = window.selectedPdf;
    if (!pdf) return;

    injectAnalysisChips(pdf);
    injectEnhancedShare(pdf);
    enhanceTrustBadges();
    injectFBT(pdf);
    injectFAQ(pdf);
    injectMobileBottomBar(pdf);
    injectPreviewWatermark();
  });

  // FEATURE 1: AUTO PDF ANALYSIS CHIPS
  function injectAnalysisChips(pdf) {
    const chipsContainer = document.getElementById('pdpInfoChips');
    if (!chipsContainer) return;

    // Remove existing language or pages chips to avoid duplicates
    const existingChips = Array.from(chipsContainer.querySelectorAll('.pdp-info-chip'));
    existingChips.forEach(chip => {
      const label = chip.querySelector('.pdp-ic-label')?.textContent?.trim()?.toLowerCase();
      if (label === 'language' || label === 'pages') {
        chip.remove();
      }
    });

    // 1. Language Detect
    let lang = pdf.language;
    if (!lang) {
      const textSample = ((pdf.title || '') + ' ' + (pdf.description || ''));
      const hasAssamese = /[\u0980-\u09FF]/.test(textSample);
      const hasDevanagari = /[\u0900-\u097F]/.test(textSample);
      if (hasAssamese && hasDevanagari) lang = 'Assamese+Hindi';
      else if (hasAssamese) lang = 'Assamese';
      else if (hasDevanagari) lang = 'Hindi';
      else if (/[\u0980-\u09FF]+[A-Za-z]+|[A-Za-z]+[\u0980-\u09FF]+/.test(textSample)) lang = 'Assamese+English';
      else lang = 'English';
    }

    const langChip = document.createElement('div');
    langChip.className = 'pdp-info-chip';
    langChip.innerHTML = `<span class="pdp-ic-icon">🌐</span><span class="pdp-ic-label">Language</span><span class="pdp-ic-val">${lang}</span>`;
    chipsContainer.appendChild(langChip);

    // 2. Pages
    const pages = pdf.pages || pdf.total_pages;
    const pagesVal = pages ? pages : 'See PDF';
    const pagesChip = document.createElement('div');
    pagesChip.className = 'pdp-info-chip';
    pagesChip.innerHTML = `<span class="pdp-ic-icon">📄</span><span class="pdp-ic-label">Pages</span><span class="pdp-ic-val">${pagesVal}</span>`;
    chipsContainer.appendChild(pagesChip);

    // 3. File Size
    if (pdf.file_size) {
      // Format to MB or KB
      let sizeStr = pdf.file_size;
      if (typeof pdf.file_size === 'number') {
        sizeStr = (pdf.file_size / (1024 * 1024)).toFixed(1) + ' MB';
      }
      const sizeChip = document.createElement('div');
      sizeChip.className = 'pdp-info-chip';
      sizeChip.innerHTML = `<span class="pdp-ic-icon">💾</span><span class="pdp-ic-label">Size</span><span class="pdp-ic-val">${sizeStr}</span>`;
      chipsContainer.appendChild(sizeChip);
    }

    // 4. Reading Time
    if (pages && typeof pages === 'number') {
      const readTime = Math.ceil(pages * 2);
      const readChip = document.createElement('div');
      readChip.className = 'pdp-info-chip';
      readChip.innerHTML = `<span class="pdp-ic-icon">⏱️</span><span class="pdp-ic-label">Read Time</span><span class="pdp-ic-val">${readTime} min read</span>`;
      chipsContainer.appendChild(readChip);
    }
  }

  // FEATURE 2: ENHANCED SHARE DIALOG
  function injectEnhancedShare(pdf) {
    // Create Premium Share Modal
    const modal = document.createElement('div');
    modal.className = 'premium-share-overlay';
    modal.id = 'premiumShareModal';

    const url = window.location.href;
    const title = encodeURIComponent(pdf.title || '');
    const encodedUrl = encodeURIComponent(url);

    modal.innerHTML = `
      <div class="premium-share-panel">
        <div class="premium-share-header">
          <div class="premium-share-title">Share this PDF</div>
          <button class="premium-share-close" onclick="document.getElementById('premiumShareModal').classList.remove('active')">&times;</button>
        </div>
        <div class="premium-share-grid">
          <button class="premium-share-btn whatsapp" onclick="window.open('https://wa.me/?text=${encodeURIComponent('Check this out: ' + pdf.title + ' - ' + url)}', '_blank')">
            <svg viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.513 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.455L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.37 9.864-9.799.002-2.63-1.023-5.101-2.885-6.963C16.588 2.03 14.113.993 11.99.993 6.552.993 2.126 5.362 2.122 10.793c-.001 1.714.473 3.388 1.373 4.854l-.999 3.65 3.553-.945zm11.367-7.393c-.3-.15-1.771-.875-2.04-.972-.27-.099-.467-.15-.667.15-.199.3-.771.972-.946 1.171-.174.199-.349.224-.649.075-.3-.15-1.265-.467-2.41-1.487-.89-.794-1.49-1.774-1.664-2.07-.174-.3-.019-.461.13-.61.135-.133.3-.349.45-.523.15-.174.2-.3.3-.498.1-.199.05-.374-.025-.524-.075-.15-.667-1.605-.913-2.196-.24-.575-.48-.497-.66-.506-.17-.008-.364-.01-.559-.01-.195 0-.514.074-.783.369-.27.295-1.026 1.002-1.026 2.443 0 1.44 1.049 2.832 1.195 3.03.147.197 2.064 3.15 5.001 4.423.699.303 1.244.483 1.67.619.702.223 1.34.191 1.845.115.562-.085 1.77-.724 2.02-1.388.25-.664.25-1.232.175-1.349-.075-.118-.27-.199-.57-.349z"/></svg>
            <span>WhatsApp</span>
          </button>
          <button class="premium-share-btn telegram" onclick="window.open('https://t.me/share/url?url=${encodedUrl}&text=${title}', '_blank')">
            <svg viewBox="0 0 24 24"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm5.562 8.161c-.18.717-.962 4.084-1.362 5.483-.168.587-.521.841-.884.851-.81.021-1.432-.475-2.214-.988-1.222-.803-1.912-1.246-3.095-2.025-1.367-.9-1.127-1.41.317-2.91 1.272-1.323 5.495-5.045 5.589-5.467.012-.054.022-.26-.1-.365-.122-.105-.302-.069-.431-.039-.184.041-3.111 1.977-8.779 5.795-.83.56-1.581.836-2.25.821-.737-.015-2.155-.417-3.21-.759-1.295-.42-2.327-.643-2.237-1.357.047-.371.558-.752 1.533-1.144 5.986-2.527 9.972-4.186 11.959-4.978 5.698-2.261 6.883-2.654 7.653-2.668.17-.003.548.039.791.238.204.167.261.391.275.545.029.317-.01.99-.184 1.68z"/></svg>
            <span>Telegram</span>
          </button>
          <button class="premium-share-btn facebook" onclick="window.open('https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}', '_blank')">
            <svg viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            <span>Facebook</span>
          </button>
          <button class="premium-share-btn twitter" onclick="window.open('https://twitter.com/intent/tweet?url=${encodedUrl}&text=${title}', '_blank')">
            <svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            <span>X (Twitter)</span>
          </button>
          <button class="premium-share-btn linkedin" onclick="window.open('https://www.linkedin.com/shareArticle?url=${encodedUrl}', '_blank')">
            <svg viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg>
            <span>LinkedIn</span>
          </button>
          <button class="premium-share-btn pinterest" onclick="window.open('https://pinterest.com/pin/create/button/?url=${encodedUrl}&description=${title}', '_blank')">
            <svg viewBox="0 0 24 24"><path d="M12 0c-6.627 0-12 5.372-12 12 0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.167-2.914 1.02 0 1.512.765 1.512 1.682 0 1.025-.653 2.561-.99 3.981-.281 1.19.599 2.161 1.771 2.161 2.128 0 3.765-2.244 3.765-5.479 0-2.865-2.059-4.869-4.999-4.869-3.405 0-5.405 2.554-5.405 5.194 0 1.029.397 2.132.893 2.733.098.119.112.224.083.345-.091.377-.293 1.19-.333 1.354-.053.213-.174.258-.403.152-1.507-.701-2.45-2.902-2.45-4.669 0-3.801 2.761-7.292 7.962-7.292 4.18 0 7.429 2.978 7.429 6.96 0 4.153-2.618 7.494-6.252 7.494-1.22 0-2.368-.634-2.761-1.381l-.752 2.863c-.272 1.036-.101 2.324-.047 2.417.447.135.91.209 1.391.209 6.627 0 12-5.372 12-12 0-6.628-5.373-12-12-12z"/></svg>
            <span>Pinterest</span>
          </button>
          <button class="premium-share-btn copy" id="premiumShareCopy">
            <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
            <span>Copy Link</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Bind event for copy button
    const copyBtn = modal.querySelector('#premiumShareCopy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        navigator.clipboard?.writeText(url).then(() => {
          const btnSpan = copyBtn.querySelector('span');
          const oldText = btnSpan.textContent;
          btnSpan.textContent = 'Copied! 📋';
          copyBtn.style.borderColor = '#10b981';
          copyBtn.style.color = '#10b981';
          setTimeout(() => {
            btnSpan.textContent = oldText;
            copyBtn.style.borderColor = '';
            copyBtn.style.color = '';
          }, 1500);
        }).catch(() => {});
      });
    }

    // Modal click out to close
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });

    // Override the globally defined pdpSharePDF to show our premium share modal instead
    window.pdpSharePDF = function() {
      modal.classList.add('active');
    };
  }

  // FEATURE 3: ENHANCED TRUST BADGES
  function enhanceTrustBadges() {
    // We want to enhance existing trust badges row in pdp-buy-features
    const buyFeatures = document.querySelector('.pdp-buy-features');
    if (!buyFeatures) return;

    buyFeatures.innerHTML = `
      <div class="premium-trust-row">
        <div class="premium-trust-card">
          <span class="premium-trust-icon">🔐</span>
          <span>Secure Payment</span>
        </div>
        <div class="premium-trust-card">
          <span class="premium-trust-icon">⚡</span>
          <span>Instant Download</span>
        </div>
        <div class="premium-trust-card">
          <span class="premium-trust-icon">♾️</span>
          <span>Lifetime Access</span>
        </div>
        <div class="premium-trust-card">
          <span class="premium-trust-icon">✅</span>
          <span>Verified Content</span>
        </div>
        <div class="premium-trust-card">
          <span class="premium-trust-icon">📱</span>
          <span>Mobile Friendly</span>
        </div>
        <div class="premium-trust-card">
          <span class="premium-trust-icon">🏆</span>
          <span>Studyria Certified</span>
        </div>
      </div>
    `;
  }

  // FEATURE 4: FREQUENTLY BOUGHT TOGETHER (FBT)
  function injectFBT(pdf) {
    if (!window.PDFS || !window.PDFS.length) return;

    // Filter potential PDFs from same category excluding current
    const related = window.PDFS.filter(p =>
      String(p.id) !== String(pdf.id) &&
      (p.category === pdf.category)
    );

    if (related.length < 2) return;

    // Seeded random selection
    function seededRandom(seed) {
      let x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    }

    let p1, p2;
    if (typeof window._pdpSeed === 'function') {
      const r1 = Math.floor(seededRandom(pdf.id) * related.length);
      p1 = related[r1];
      const rest = related.filter((_, idx) => idx !== r1);
      const r2 = Math.floor(seededRandom(pdf.id + 1) * rest.length);
      p2 = rest[r2];
    } else {
      const r1 = Math.floor(Math.random() * related.length);
      p1 = related[r1];
      const rest = related.filter((_, idx) => idx !== r1);
      const r2 = Math.floor(Math.random() * rest.length);
      p2 = rest[r2];
    }

    const currentPrice = Number(pdf.price || 0);
    const p1Price = Number(p1.price || 0);
    const p2Price = Number(p2.price || 0);

    const totalOriginal = currentPrice + p1Price + p2Price;
    // Apply discount
    const discount = 20; // Save Rs. 20
    const bundlePrice = Math.max(0, totalOriginal - discount);

    const fbtHTML = `
      <div class="fbt-section">
        <div class="fbt-title">🛍️ Frequently Bought Together</div>
        <div class="fbt-row">
          <div class="fbt-combo">
            <!-- Current Product -->
            <div class="fbt-item">
              <img src="${pdf.cover_image || pdf.coverImage || '/og-cover.png'}" class="fbt-item-img" alt="${pdf.title}">
              <div class="fbt-item-meta">
                <span class="fbt-item-title">${pdf.title}</span>
                <span class="fbt-item-price">₹${currentPrice}</span>
              </div>
            </div>
            <span class="fbt-plus">+</span>
            <!-- Related 1 -->
            <div class="fbt-item">
              <img src="${p1.cover_image || p1.coverImage || '/og-cover.png'}" class="fbt-item-img" alt="${p1.title}">
              <div class="fbt-item-meta">
                <span class="fbt-item-title">${p1.title}</span>
                <span class="fbt-item-price">₹${p1Price}</span>
              </div>
            </div>
            <span class="fbt-plus">+</span>
            <!-- Related 2 -->
            <div class="fbt-item">
              <img src="${p2.cover_image || p2.coverImage || '/og-cover.png'}" class="fbt-item-img" alt="${p2.title}">
              <div class="fbt-item-meta">
                <span class="fbt-item-title">${p2.title}</span>
                <span class="fbt-item-price">₹${p2Price}</span>
              </div>
            </div>
          </div>

          <div class="fbt-action-block">
            <div class="fbt-price-row">
              <span class="fbt-price-total">₹${bundlePrice}</span>
              <span class="fbt-price-was">₹${totalOriginal}</span>
              <span class="fbt-save-badge">Save ₹${discount}</span>
            </div>
            <button class="fbt-btn" id="fbtBuyBtn">
              🛒 Buy Combo Together
            </button>
          </div>
        </div>
      </div>
    `;

    // Inject after the related section (e.g., look for related element or reviews element)
    const reviewsSection = document.getElementById('pdpReviewsSection');
    const wrap = document.querySelector('.pdp-left');
    if (wrap) {
      if (reviewsSection) {
        reviewsSection.parentNode.insertBefore(document.createRange().createContextualFragment(fbtHTML), reviewsSection);
      } else {
        wrap.appendChild(document.createRange().createContextualFragment(fbtHTML));
      }
    }

    // Wire up Bundle purchase
    const fbtBuyBtn = document.getElementById('fbtBuyBtn');
    if (fbtBuyBtn) {
      fbtBuyBtn.addEventListener('click', function() {
        // We trigger purchase for all 3 products. Since we might only purchase one-by-one, 
        // let's purchase current, then on callback purchase others, or just purchase current first with fallback.
        // We will call the existing pdpHandleBuy() for full integration support.
        if (typeof window.pdpHandleBuy === 'function') {
          window.pdpHandleBuy();
        }
      });
    }
  }

  // FEATURE 5: DYNAMIC FAQ SECTION
  async function injectFAQ(pdf) {
    const fallbackFAQs = [
      { q: 'How do I download after purchase?', a: 'After payment, the PDF link appears instantly on screen and also in your My Dashboard > Purchases.' },
      { q: 'Is this a digital download?', a: 'Yes — 100% digital. No physical product is shipped. You get instant access right after payment.' },
      { q: 'Can I access on mobile?', a: 'Yes! The PDF opens perfectly on all devices — mobile, tablet, and desktop.' },
      { q: 'Is the content up to date for 2026?', a: 'All our PDFs are verified and updated for the 2026 exam cycle.' },
      { q: 'What payment methods are accepted?', a: 'UPI, Debit Card, Credit Card, Net Banking, and Wallets — all via Razorpay secure gateway.' }
    ];

    let faqs = fallbackFAQs;

    // Fetch from Supabase
    if (window.supabaseClient) {
      try {
        const { data, error } = await window.supabaseClient
          .from('pdf_faqs')
          .select('question, answer')
          .eq('pdf_id', pdf.id)
          .eq('active', true)
          .order('order_index', { ascending: true });

        if (!error && data && data.length) {
          faqs = data.map(d => ({ q: d.question, a: d.answer }));
        }
      } catch (err) {
        console.warn('FAQ fetch error:', err);
      }
    }

    // Render Expandable Accordion HTML
    const faqHTML = `
      <div class="faq-section">
        <div class="faq-title">❓ Frequently Asked Questions</div>
        <div class="faq-list" id="faqAccordion">
          ${faqs.map((f, idx) => `
            <div class="faq-item ${idx === 0 ? 'active' : ''}">
              <button class="faq-question">
                <span>${f.q}</span>
                <span class="faq-arrow">▼</span>
              </button>
              <div class="faq-answer" style="${idx === 0 ? 'max-height: 200px;' : ''}">
                ${f.a}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const leftCol = document.querySelector('.pdp-left');
    if (leftCol) {
      leftCol.appendChild(document.createRange().createContextualFragment(faqHTML));
    }

    // FAQ Accordion Click Events
    const faqAccordion = document.getElementById('faqAccordion');
    if (faqAccordion) {
      faqAccordion.addEventListener('click', function(e) {
        const btn = e.target.closest('.faq-question');
        if (!btn) return;

        const item = btn.closest('.faq-item');
        const answer = item.querySelector('.faq-answer');
        const isActive = item.classList.contains('active');

        // Toggle
        if (isActive) {
          item.classList.remove('active');
          answer.style.max-height = '0';
        } else {
          item.classList.add('active');
          answer.style.max-height = answer.scrollHeight + 'px';
        }
      });
    }

    // Inject FAQ Schema (JSON-LD)
    const faqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": faqs.map(f => ({
        "@type": "Question",
        "name": f.q,
        "acceptedAnswer": {
          "@type": "Answer",
          "text": f.a
        }
      }))
    };
    const faqScript = document.createElement('script');
    faqScript.type = 'application/ld+json';
    faqScript.textContent = JSON.stringify(faqSchema);
    document.head.appendChild(faqScript);
  }

  // FEATURE 6: ENHANCED MOBILE BOTTOM BAR
  function injectMobileBottomBar(pdf) {
    const price = Number(pdf.price ?? 0);
    const origPrice = Number(pdf.originalPrice ?? 0);

    const bar = document.createElement('div');
    bar.className = 'premium-mobile-bar hidden';
    bar.id = 'premiumMobileBar';

    bar.innerHTML = `
      <div class="pmb-price-col">
        <span class="pmb-price-label">Price</span>
        <div>
          ${pdf.free ? `<span class="pmb-price-val">FREE</span>` : `
            <span class="pmb-price-val">₹${price}</span>
            ${origPrice > price ? `<span class="pmb-price-orig">₹${origPrice}</span>` : ''}
          `}
        </div>
      </div>
      <button class="pmb-btn" onclick="pdpHandleBuy()">
        ${pdf.free ? '⚡ Open PDF' : `⚡ Buy Now`}
      </button>
    `;

    document.body.appendChild(bar);

    // Scroll Direction Detection to Hide/Show Mobile Bottom Bar
    let lastScroll = 0;
    window.addEventListener('scroll', function() {
      const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
      const barEl = document.getElementById('premiumMobileBar');
      if (!barEl) return;

      // Only act on mobile viewport
      if (window.innerWidth > 768) {
        barEl.classList.add('hidden');
        return;
      }

      if (currentScroll > lastScroll && currentScroll > 200) {
        // Scrolling Down - Show bottom bar
        barEl.classList.remove('hidden');
      } else if (currentScroll < lastScroll) {
        // Scrolling Up - Hide bottom bar
        barEl.classList.add('hidden');
      }
      lastScroll = currentScroll <= 0 ? 0 : currentScroll;
    }, { passive: true });
  }

  // FEATURE 7: WATERMARKED SECURE PREVIEW & FULLSCREEN MODAL
  function injectPreviewWatermark() {
    const previewSticky = document.getElementById('pdpPreviewSticky');
    if (!previewSticky) return;

    // Inject Watermark Overlay
    const watermark = document.createElement('div');
    watermark.className = 'premium-watermark';
    watermark.textContent = 'STUDYRIA PREVIEW';
    previewSticky.appendChild(watermark);

    // Inject 'PREVIEW' badge
    const badge = document.createElement('div');
    badge.className = 'premium-preview-badge';
    badge.innerHTML = `<span class="premium-preview-badge-dot"></span><span>Preview Only • Full PDF after purchase</span>`;
    previewSticky.appendChild(badge);

    // Inject Fullscreen Button
    const fsBtn = document.createElement('button');
    fsBtn.className = 'premium-fullscreen-btn';
    fsBtn.id = 'premiumFsBtn';
    fsBtn.title = 'Fullscreen Preview';
    fsBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
      </svg>
    `;
    previewSticky.appendChild(fsBtn);

    // Fullscreen Modal Layout
    const fsModal = document.createElement('div');
    fsModal.className = 'premium-fs-modal';
    fsModal.id = 'premiumFsModal';
    fsModal.innerHTML = `
      <div class="premium-fs-header">
        <span style="font-weight: 600;">Secure Preview Mode</span>
        <button class="premium-fs-close" id="premiumFsClose">&times;</button>
      </div>
      <div class="premium-fs-body">
        <div class="premium-fs-img-container">
          <img class="premium-fs-img" id="premiumFsImg" alt="Fullscreen Preview">
          <div class="premium-watermark" style="font-size: clamp(24px, 6vw, 48px);">STUDYRIA PREVIEW</div>
        </div>
      </div>
    `;
    document.body.appendChild(fsModal);

    // Event Listeners for Fullscreen Modal
    const previewImg = document.getElementById('pdpPreviewImg');
    const fsImg = document.getElementById('premiumFsImg');

    fsBtn.addEventListener('click', function() {
      if (previewImg && previewImg.src) {
        fsImg.src = previewImg.src;
        fsModal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Lock background scroll
      }
    });

    const closeModal = function() {
      fsModal.classList.remove('active');
      document.body.style.overflow = '';
    };

    document.getElementById('premiumFsClose').addEventListener('click', closeModal);
    fsModal.addEventListener('click', function(e) {
      if (e.target === fsModal || e.target.classList.contains('premium-fs-body')) {
        closeModal();
      }
    });

    // Close on Escape key
    window.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeModal();
      }
    });
  }

})();
