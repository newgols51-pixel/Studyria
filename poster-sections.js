/**
 * poster-sections.js — Studyria Job Poster Automation System
 * ═══════════════════════════════════════════════════════════
 * Shared constants, design themes, badge logic, and utility
 * functions used by all other poster modules.
 *
 * Load order: must be imported first by poster-engine.js.
 * ES Module — no global side-effects except window.PosterSections.
 */

// ── Design Palette — 12 gradient themes (mirrors CS_THEMES in index.html) ──
export const POSTER_THEMES = [
  { bg: ['#0d1b3e','#1a3a6b','#0a2044'], accent: '#3d8ef8', accent2: '#00c8e8', icon: '💼' },
  { bg: ['#1a0d3e','#2d1a6b','#12044a'], accent: '#8b5cf6', accent2: '#c4b5fd', icon: '🎓' },
  { bg: ['#0d2e1b','#1a5c38','#0a3020'], accent: '#10d98e', accent2: '#34d399', icon: '🏛'  },
  { bg: ['#3e1a0d','#6b2d10','#4a1a08'], accent: '#f59e0b', accent2: '#fcd34d', icon: '⭐' },
  { bg: ['#2e0d1a','#6b1a38','#3a0820'], accent: '#ff4d6d', accent2: '#fda4af', icon: '🔥' },
  { bg: ['#0d2e3e','#1a5c6b','#0a3040'], accent: '#00c8e8', accent2: '#67e8f9', icon: '🚀' },
  { bg: ['#1e0d3e','#3d1a6b','#160844'], accent: '#a78bfa', accent2: '#ddd6fe', icon: '✨' },
  { bg: ['#1a2e0d','#3a6b1a','#1e3a0a'], accent: '#84cc16', accent2: '#bef264', icon: '📋' },
  { bg: ['#3e2e0d','#6b4a10','#4a3008'], accent: '#f97316', accent2: '#fdba74', icon: '💰' },
  { bg: ['#0d1e3e','#1a3a6b','#081840'], accent: '#60a5fa', accent2: '#bfdbfe', icon: '🎯' },
  { bg: ['#2e0d2e','#6b1a6b','#3a0838'], accent: '#e879f9', accent2: '#f5d0fe', icon: '🌟' },
  { bg: ['#0d2e2e','#1a5c5c','#083030'], accent: '#2dd4bf', accent2: '#99f6e4', icon: '🏆' },
];

// Poster canvas dimensions
export const POSTER_W = 300;
export const POSTER_H = 400;

// ── Badge map ────────────────────────────────────────────────────────────────
export const BADGE_CLASS_MAP = {
  'NEW':         'cs-badge-new',
  'GOVT':        'cs-badge-govt',
  'PRIVATE':     'cs-badge-private',
  'ASSAM':       'cs-badge-assam',
  'SCHOLARSHIP': 'cs-badge-scholarship',
  'INTERNSHIP':  'cs-badge-internship',
  'TRENDING':    'cs-badge-trending',
  'HIGH SALARY': 'cs-badge-high-salary',
};

// ── Fields that, when changed, require a poster regeneration ─────────────────
export const POSTER_REGEN_FIELDS = [
  'title', 'org', 'org_icon', 'job_type', 'category', 'location', 'salary',
];

// ── Utility: pick theme deterministically from job.id ────────────────────────
export function pickTheme(jobId) {
  let h = 0;
  const s = String(jobId);
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return POSTER_THEMES[Math.abs(h) % POSTER_THEMES.length];
}

// ── Utility: hex → rgba ──────────────────────────────────────────────────────
export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Utility: truncate string ─────────────────────────────────────────────────
export function truncate(str, len) {
  return String(str || '').length > len
    ? String(str).slice(0, len - 1) + '…'
    : String(str || '');
}

// ── Utility: HTML escape ─────────────────────────────────────────────────────
export function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Utility: format date (DD Mon YYYY) ──────────────────────────────────────
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return String(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Utility: days until last_date ────────────────────────────────────────────
export function daysLeft(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - Date.now()) / 86_400_000);
}

// ── Badge derivation from job fields ─────────────────────────────────────────
export function getJobBadges(job) {
  const badges = [];
  const type     = (job.job_type   || '').toLowerCase();
  const cats     = Array.isArray(job.category) ? job.category.map(c => c.toLowerCase()) : [];
  const loc      = (job.location   || '').toLowerCase();
  const sal      = job.salary      || '';
  const dl       = job.last_date
    ? Math.ceil((new Date(job.last_date) - Date.now()) / 86_400_000) : 999;
  const ageDays  = job.created_at
    ? Math.floor((Date.now() - new Date(job.created_at)) / 86_400_000) : 999;

  if (ageDays <= 5)                                                  badges.push('NEW');
  if (type === 'government' || cats.includes('govt') ||
      cats.includes('government'))                                    badges.push('GOVT');
  else if (type === 'private' || cats.includes('private'))           badges.push('PRIVATE');
  if (loc.includes('assam') || cats.includes('assam'))               badges.push('ASSAM');
  if (type === 'scholarship' || cats.includes('scholarship'))        badges.push('SCHOLARSHIP');
  if (type === 'internship'  || cats.includes('internship'))         badges.push('INTERNSHIP');
  if (job.is_trending)                                               badges.push('TRENDING');
  if (sal) {
    const nums = sal.match(/[\d,]+/g);
    if (nums) {
      const max = Math.max(...nums.map(n => parseInt(n.replace(/,/g, ''), 10)));
      if (max >= 50_000) badges.push('HIGH SALARY');
    }
  }
  return badges.slice(0, 2);
}

// ── Category label for poster chip ───────────────────────────────────────────
export function getCategoryLabel(job) {
  const t = (job.job_type || '').toLowerCase();
  if (t === 'government')  return 'GOVT JOB';
  if (t === 'private')     return 'PRIVATE';
  if (t === 'scholarship') return 'SCHOLARSHIP';
  if (t === 'internship')  return 'INTERNSHIP';
  const cats = Array.isArray(job.category) ? job.category : [];
  if (cats.length) return String(cats[0]).toUpperCase().slice(0, 12);
  return '';
}

// ── Canvas helper: wrap text ──────────────────────────────────────────────────
export function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = String(text || '').split(' ');
  let line = '';
  let lineCount = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + lineCount * lineH);
      lineCount++;
      if (lineCount >= maxLines) {
        ctx.fillText(words.slice(i).join(' ') + (i < words.length - 1 ? '…' : ''), x, y + lineCount * lineH);
        return;
      }
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y + lineCount * lineH);
}

// ── Canvas helper: rounded rect path ─────────────────────────────────────────
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── Expose on window for non-module legacy scripts ───────────────────────────
window.PosterSections = {
  POSTER_THEMES, POSTER_W, POSTER_H, BADGE_CLASS_MAP, POSTER_REGEN_FIELDS,
  pickTheme, hexToRgba, truncate, escHtml, formatDate, daysLeft,
  getJobBadges, getCategoryLabel, wrapText, roundRect,
};
