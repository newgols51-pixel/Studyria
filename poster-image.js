/**
 * poster-image.js — Studyria Job Poster Automation System
 * ════════════════════════════════════════════════════════
 * Canvas-based poster image generator.
 * Produces a 300×400 DataURL (WebP → PNG fallback) for each job.
 *
 * Features:
 *   - Deterministic gradient theme per job.id
 *   - Geometric background pattern (circles + diagonal lines + dot grid)
 *   - Bottom text overlay with org, title, category chip, last_date
 *   - Session-level LRU cache (window._csPosterCache) — shared with
 *     the inline csGeneratePoster() already in index.html
 *   - Non-blocking Supabase persistence of poster_url flag
 *   - Safe fallback if Canvas API is unavailable
 *
 * Exports: generatePosterDataUrl(job) → string
 *          invalidatePosterCache(jobId)
 *          getPosterDataUrl(job) → string (cache-first)
 */

import {
  POSTER_W, POSTER_H,
  pickTheme, hexToRgba,
  truncate, formatDate, getCategoryLabel,
  wrapText, roundRect,
} from './poster-sections.js';

const MODULE = '[PosterImage]';

// Shared with the inline csGeneratePoster() in index.html so there's
// one unified cache across both the legacy carousel and this module.
function getCache() {
  window._csPosterCache = window._csPosterCache || new Map();
  return window._csPosterCache;
}

// ── Core generator ────────────────────────────────────────────────────────────
/**
 * Generate a poster DataURL for a job object.
 * Result is stored in the shared session cache.
 * @param {Object} job — Supabase jobs row
 * @returns {string} DataURL (image/webp or image/png)
 */
export function generatePosterDataUrl(job) {
  const cacheKey = 'poster_' + job.id;
  const cache = getCache();
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const theme = pickTheme(job.id);
  const W = POSTER_W;
  const H = POSTER_H;

  // ── Canvas setup ────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    console.warn(`${MODULE} Canvas 2D context unavailable for job ${job.id}`);
    return '';
  }

  // ── Background gradient ──────────────────────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0,   theme.bg[0]);
  bgGrad.addColorStop(0.5, theme.bg[1]);
  bgGrad.addColorStop(1,   theme.bg[2]);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // ── Geometric pattern ────────────────────────────────────────────
  ctx.save();

  // Large accent circle — top right
  const grad1 = ctx.createRadialGradient(W * 0.85, H * 0.12, 10, W * 0.85, H * 0.12, 140);
  grad1.addColorStop(0, hexToRgba(theme.accent, 0.22));
  grad1.addColorStop(1, hexToRgba(theme.accent, 0));
  ctx.fillStyle = grad1;
  ctx.beginPath(); ctx.arc(W * 0.85, H * 0.12, 140, 0, Math.PI * 2); ctx.fill();

  // Small accent circle — bottom left
  const grad2 = ctx.createRadialGradient(W * 0.15, H * 0.82, 5, W * 0.15, H * 0.82, 80);
  grad2.addColorStop(0, hexToRgba(theme.accent2, 0.18));
  grad2.addColorStop(1, hexToRgba(theme.accent2, 0));
  ctx.fillStyle = grad2;
  ctx.beginPath(); ctx.arc(W * 0.15, H * 0.82, 80, 0, Math.PI * 2); ctx.fill();

  // Diagonal line accents
  ctx.strokeStyle = hexToRgba(theme.accent, 0.12);
  ctx.lineWidth   = 1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(-40 + i * 80, 0);
    ctx.lineTo(W + i * 80 - 200, H);
    ctx.stroke();
  }

  // Subtle dot grid
  ctx.fillStyle = hexToRgba(theme.accent2, 0.07);
  for (let gx = 20; gx < W; gx += 28) {
    for (let gy = 20; gy < H * 0.55; gy += 28) {
      ctx.beginPath(); ctx.arc(gx, gy, 1.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();

  // ── Bottom text gradient overlay ─────────────────────────────────
  const textGrad = ctx.createLinearGradient(0, H * 0.45, 0, H);
  textGrad.addColorStop(0,    'rgba(0,0,0,0)');
  textGrad.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  textGrad.addColorStop(1,    'rgba(0,0,0,0.88)');
  ctx.fillStyle = textGrad;
  ctx.fillRect(0, H * 0.45, W, H * 0.55);

  // ── Organization icon / emoji ─────────────────────────────────────
  ctx.font          = '52px serif';
  ctx.textAlign     = 'center';
  ctx.textBaseline  = 'middle';
  ctx.fillText(job.org_icon || theme.icon, W * 0.5, H * 0.3);

  // ── Accent divider line ───────────────────────────────────────────
  const lineGrad = ctx.createLinearGradient(20, 0, W - 20, 0);
  lineGrad.addColorStop(0,   hexToRgba(theme.accent, 0));
  lineGrad.addColorStop(0.3, theme.accent);
  lineGrad.addColorStop(0.7, theme.accent2);
  lineGrad.addColorStop(1,   hexToRgba(theme.accent2, 0));
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth   = 2;
  ctx.beginPath(); ctx.moveTo(20, H * 0.58); ctx.lineTo(W - 20, H * 0.58); ctx.stroke();

  // ── Organization label ────────────────────────────────────────────
  ctx.font          = '500 10px "Inter", system-ui, sans-serif';
  ctx.textAlign     = 'left';
  ctx.textBaseline  = 'alphabetic';
  ctx.fillStyle     = hexToRgba(theme.accent2, 0.9);
  ctx.fillText(truncate(job.org || job.organization || 'Organization', 30), 14, H * 0.65);

  // ── Job title (wrapped, 2 lines max) ─────────────────────────────
  ctx.font      = '700 15px "Inter", system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  wrapText(ctx, job.title || 'Job Opportunity', 14, H * 0.72, W - 28, 20, 2);

  // ── Category chip ─────────────────────────────────────────────────
  const catLabel = getCategoryLabel(job);
  if (catLabel) {
    ctx.font = '600 9px "Inter", system-ui, sans-serif';
    const tw = ctx.measureText(catLabel).width + 16;
    ctx.fillStyle = hexToRgba(theme.accent, 0.25);
    roundRect(ctx, 14, H * 0.855, tw, 16, 4);
    ctx.fill();
    ctx.fillStyle  = theme.accent;
    ctx.textAlign  = 'left';
    ctx.fillText(catLabel, 22, H * 0.868);
  }

  // ── Last date ─────────────────────────────────────────────────────
  if (job.last_date) {
    const dateStr = '📅 ' + formatDate(job.last_date);
    ctx.font      = '500 9px "Inter", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'right';
    ctx.fillText(dateStr, W - 14, H * 0.93);
  }

  ctx.textAlign = 'left';

  // ── Export as WebP (PNG fallback) ────────────────────────────────
  let dataUrl;
  try {
    dataUrl = canvas.toDataURL('image/webp', 0.82);
  } catch (_) {
    dataUrl = canvas.toDataURL('image/png');
  }

  // Store in shared session cache
  cache.set(cacheKey, dataUrl);

  // Persist a lightweight flag to Supabase in the background
  _persistPosterFlag(job);

  return dataUrl;
}

/**
 * Cache-first accessor — returns cached URL or generates on demand.
 * @param {Object} job
 * @returns {string}
 */
export function getPosterDataUrl(job) {
  const cacheKey = 'poster_' + job.id;
  const cache    = getCache();
  return cache.has(cacheKey) ? cache.get(cacheKey) : generatePosterDataUrl(job);
}

/**
 * Invalidate a specific job's poster from cache (call after regen).
 * @param {string|number} jobId
 */
export function invalidatePosterCache(jobId) {
  getCache().delete('poster_' + jobId);
}

// ── Internal: persist poster flag to Supabase ─────────────────────────────────
function _persistPosterFlag(job) {
  if (job.poster_url) return; // already flagged
  const sb = window.supabaseClient;
  if (!sb) return;

  sb.from('jobs')
    .update({ poster_url: '__generated__', poster_generated: true })
    .eq('id', job.id)
    .then(() => {})
    .catch(() => {});
}

// ── Expose on window so legacy index.html inline code can call these ──────────
// Overrides the legacy window.csPosterUrl hook used by _csCardHTMLLegacy
window.csPosterUrl = getPosterDataUrl;

// Hook for admin: regenerate a poster by jobId
window.csPosterRegenerate = async function csPosterRegenerate(jobId) {
  invalidatePosterCache(jobId);
  const sb = window.supabaseClient;
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from('jobs')
      .select('id,title,org,organization,org_icon,location,salary,last_date,job_type,category,is_trending,featured,is_urgent,active,created_at,poster_url,poster_generated,poster_version')
      .eq('id', jobId)
      .single();
    if (error || !data) return;
    generatePosterDataUrl(data);
    console.log(`${MODULE} ✅ Poster regenerated for job ${jobId}`);
  } catch (err) {
    console.error(`${MODULE} Regen error for job ${jobId}:`, err);
  }
};

// Hook for admin: generate poster immediately after a new job is published
window.csPosterOnPublish = function csPosterOnPublish(job) {
  if (!job || !job.id) return;
  try {
    generatePosterDataUrl(job);
    console.log(`${MODULE} ✅ Poster generated on publish for job ${job.id}`);
  } catch (err) {
    console.error(`${MODULE} OnPublish error:`, err);
  }
};

console.log(`${MODULE} ✅ Loaded — Canvas poster generator ready.`);
