/**
 * poster-engine.js — Studyria Job Poster Automation System
 * ═════════════════════════════════════════════════════════
 * Central orchestrator. Imports all other poster modules,
 * exposes a unified API, and wires the system into the
 * existing Studyria career-hub-poster-engine.js hooks.
 *
 * Load order (already set in index.html):
 *   1. supabase SDK CDN
 *   2. supabase.js           → sets window.supabaseClient
 *   3. poster-init.js        → verifies connection, sets window.PosterSystem
 *   4. poster-engine.js  ← (this file, type="module")
 *      ↳ poster-sections.js  → shared constants & utilities
 *      ↳ poster-image.js     → Canvas generator
 *      ↳ poster-worker.js    → background queue processor
 *
 * Public surface:
 *   window.PosterEngine.generate(job)          → DataURL
 *   window.PosterEngine.regenerate(jobId)      → Promise<void>
 *   window.PosterEngine.onPublish(job)         → void
 *   window.PosterEngine.startWorker()          → void
 *   window.PosterEngine.stopWorker()           → void
 *   window.PosterEngine.workerStatus()         → Object
 *   window.PosterEngine.forceProcess(jobId)    → Promise<void>
 */

import {
  POSTER_THEMES, POSTER_W, POSTER_H,
  pickTheme, hexToRgba, truncate, escHtml,
  formatDate, daysLeft, getJobBadges,
  getCategoryLabel, wrapText, roundRect,
  BADGE_CLASS_MAP, POSTER_REGEN_FIELDS,
} from './poster-sections.js';

import {
  generatePosterDataUrl,
  getPosterDataUrl,
  invalidatePosterCache,
} from './poster-image.js';

import './poster-worker.js';   // registers window.PosterWorker

const MODULE  = '[PosterEngine]';
const VERSION = '1.0.0';

// ── Wait for PosterSystem to be ready (set by poster-init.js) ────────────────
async function _waitForPosterSystem(maxMs = 10_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (window.PosterSystem?.ready) { resolve(window.PosterSystem); return; }
      if (Date.now() - start >= maxMs) {
        reject(new Error(`${MODULE} window.PosterSystem not ready after ${maxMs}ms`));
        return;
      }
      setTimeout(check, 150);
    };
    check();
  });
}

// ── Card HTML builder (overrides legacy _csCardHTMLLegacy in index.html) ──────
function buildCardHTML(job) {
  const posterUrl    = getPosterDataUrl(job);
  const badges       = getJobBadges(job);
  const primaryBadge = badges[0] || null;
  const dl           = daysLeft(job.last_date);
  const urgentClass  = (dl !== null && dl <= 7) ? ' urgent' : '';
  const salaryText   = job.salary   ? '💰 ' + job.salary : '';
  const lastDateText = job.last_date
    ? (dl !== null && dl <= 0
        ? '🔴 Closed'
        : dl !== null && dl <= 7
          ? `⚡ ${dl}d left`
          : '📅 ' + formatDate(job.last_date))
    : '';
  const stateText = job.location ? '📍 ' + truncate(job.location, 18) : '';
  const orgText   = truncate(job.org || job.organization || '', 22);

  const badgeHtml = primaryBadge
    ? `<span class="cs-poster-badge ${BADGE_CLASS_MAP[primaryBadge] || 'cs-badge-new'}">${primaryBadge}</span>`
    : '';

  return `
<div class="cs-card" role="button" tabindex="0"
     aria-label="${(job.title || '').replace(/"/g, '&quot;')}"
     onclick="csOpenJob(${JSON.stringify(job.id)})"
     onkeydown="if(event.key==='Enter'||event.key===' ')csOpenJob(${JSON.stringify(job.id)})">
  <div class="cs-poster">
    <img src="${posterUrl}" alt="${(job.title || '').replace(/"/g, '&quot;')}"
         loading="lazy" decoding="async" width="${POSTER_W}" height="${POSTER_H}" />
    <div class="cs-poster-overlay"></div>
    ${badgeHtml}
    <div class="cs-poster-info">
      <div class="cs-poster-title">${escHtml(job.title || 'Job Opportunity')}</div>
      <div class="cs-poster-org">${escHtml(orgText)}</div>
    </div>
  </div>
  <div class="cs-card-meta">
    <div class="cs-meta-row">
      ${stateText ? `<span>${escHtml(stateText)}</span>` : ''}
      ${stateText && job.job_type ? `<span class="cs-meta-dot"></span>` : ''}
      ${job.job_type ? `<span>${escHtml(truncate(job.job_type, 10))}</span>` : ''}
    </div>
    ${salaryText   ? `<div class="cs-meta-salary">${escHtml(salaryText)}</div>`  : ''}
    ${lastDateText ? `<div class="cs-meta-last-date${urgentClass}">${escHtml(lastDateText)}</div>` : ''}
  </div>
</div>`.trim();
}

// ── Main boot sequence ────────────────────────────────────────────────────────
async function boot() {
  console.groupCollapsed(`${MODULE} v${VERSION} booting…`);

  try {
    // 1. Wait for poster-init.js to confirm Supabase is live
    await _waitForPosterSystem();
    console.log(`${MODULE} ✅ PosterSystem ready.`);

    // 2. Override the card builder used by the Career Spotlight carousel
    //    (window.csCardHTML is checked by csRender() in index.html)
    window.csCardHTML = buildCardHTML;
    console.log(`${MODULE} ✅ Career Spotlight card builder overridden.`);

    // 3. Override the legacy csPosterUrl hook (used by _csCardHTMLLegacy)
    window.csPosterUrl = getPosterDataUrl;
    console.log(`${MODULE} ✅ csPosterUrl hook set.`);

    // 4. Expose unified PosterEngine API
    window.PosterEngine = {
      version:      VERSION,

      /** Generate and cache a poster for a job object. Returns DataURL. */
      generate(job) {
        return generatePosterDataUrl(job);
      },

      /** Regenerate poster for a job by ID (invalidates cache first). */
      async regenerate(jobId) {
        invalidatePosterCache(jobId);
        if (typeof window.csPosterRegenerate === 'function') {
          await window.csPosterRegenerate(jobId);
        }
      },

      /** Call after a new job is published to immediately generate its poster. */
      onPublish(job) {
        if (typeof window.csPosterOnPublish === 'function') {
          window.csPosterOnPublish(job);
        }
      },

      /** Start the background worker queue (batch-processes all missing posters). */
      startWorker() {
        if (window.PosterWorker) {
          window.PosterWorker.start();
        } else {
          console.warn(`${MODULE} PosterWorker not loaded.`);
        }
      },

      /** Stop the background worker. */
      stopWorker() {
        if (window.PosterWorker) window.PosterWorker.stop();
      },

      /** Get current worker status snapshot. */
      workerStatus() {
        return window.PosterWorker ? window.PosterWorker.status() : null;
      },

      /** Force-generate a poster for a specific jobId immediately. */
      async forceProcess(jobId) {
        if (window.PosterWorker) await window.PosterWorker.forceProcess(jobId);
      },

      /** Expose utilities for external scripts. */
      utils: {
        pickTheme, hexToRgba, truncate, escHtml, formatDate,
        daysLeft, getJobBadges, getCategoryLabel, wrapText, roundRect,
        POSTER_THEMES, BADGE_CLASS_MAP, POSTER_REGEN_FIELDS,
      },
    };

    // 5. Wire admin hooks (these are also set by poster-image.js but we
    //    re-wire here to guarantee the engine-level logging)
    window.csPosterRegenerate = async (jobId) => {
      await window.PosterEngine.regenerate(jobId);
    };
    window.csPosterOnPublish = (job) => {
      window.PosterEngine.onPublish(job);
    };

    // 6. Auto-start background worker after a short delay
    //    so the page render comes first
    setTimeout(() => {
      const pending = window.PosterSystem?.totalPending ?? 0;
      if (pending > 0) {
        console.log(`${MODULE} 🚀 Auto-starting worker (${pending} pending posters)…`);
        window.PosterEngine.startWorker();
      } else {
        console.log(`${MODULE} ℹ️ No pending posters — worker on standby.`);
      }
    }, 3000);

    console.log(`${MODULE} 🚀 PosterEngine v${VERSION} ready. API: window.PosterEngine`);

  } catch (err) {
    console.error(`${MODULE} Boot failed (non-fatal):`, err);
  } finally {
    console.groupEnd();
  }
}

// ── Auto-boot ─────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
