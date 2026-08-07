/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  Studyria — Career Hub Poster Engine  v2.0
 *  Generate-once · Store in Supabase Storage · Reuse Everywhere
 * ──────────────────────────────────────────────────────────────────────────────
 *  PHILOSOPHY
 *  • Posters are generated ONCE when a job is published (or on first encounter).
 *  • Generated WebP (600×800, quality 80 %) is uploaded to Supabase Storage
 *    bucket  "job-posters"  and the public URL is saved back to the jobs row.
 *  • Every subsequent render — Career Spotlight, Trending Jobs, Featured Jobs,
 *    Search Results, Job Details — reads  job.poster_url  and renders a plain
 *    <img>. Zero canvas work at page-load.
 *  • Regeneration only happens when:
 *      1. job.poster_url is missing / null
 *      2. job.poster_version differs from POSTER_ENGINE_VERSION
 *      3. Admin clicks "Regenerate Poster" in Career Hub Manager
 *
 *  PERFORMANCE BUDGET
 *  • Canvas work is deferred via  requestIdleCallback()  (fallback: setTimeout).
 *  • Posters are lazy-loaded via IntersectionObserver.
 *  • Battery-aware: skips idle-generation on low-battery devices.
 *  • In-session memory cache prevents duplicate canvas work within the same tab.
 *  • Browser HTTP cache is honoured (Supabase Storage CDN sets Cache-Control).
 *
 *  SUPABASE REQUIREMENTS
 *  ─────────────────────
 *  1. Storage bucket  "job-posters"  (public read, authenticated write)
 *     Dashboard → Storage → New Bucket → name: job-posters → Public: ✓
 *
 *  2. jobs table must have these columns (add via Supabase SQL editor):
 *
 *     ALTER TABLE public.jobs
 *       ADD COLUMN IF NOT EXISTS poster_url          text,
 *       ADD COLUMN IF NOT EXISTS poster_generated    boolean DEFAULT false,
 *       ADD COLUMN IF NOT EXISTS poster_theme        text,
 *       ADD COLUMN IF NOT EXISTS poster_badges       text[],
 *       ADD COLUMN IF NOT EXISTS poster_generated_at timestamptz,
 *       ADD COLUMN IF NOT EXISTS poster_version      integer DEFAULT 0;
 *
 *  3. Storage RLS policy (run once):
 *
 *     CREATE POLICY "Public read job posters"
 *       ON storage.objects FOR SELECT
 *       USING ( bucket_id = 'job-posters' );
 *
 *     CREATE POLICY "Service role upload job posters"
 *       ON storage.objects FOR INSERT TO authenticated
 *       WITH CHECK ( bucket_id = 'job-posters' );
 *
 * ══════════════════════════════════════════════════════════════════════════════
 */

(function (global) {
  'use strict';

  /* ── Version stamp — bump to force-regenerate all posters ─────────────── */
  const POSTER_ENGINE_VERSION = 2;

  /* ── Supabase Storage bucket name ─────────────────────────────────────── */
  const BUCKET = 'job-posters';

  /* ── In-session memory cache: jobId → poster_url (data-URL or https URL) ─ */
  global._csPosterCache = global._csPosterCache || new Map();

  /* ── Generation queue: prevents parallel uploads for the same job ──────── */
  const _generating = new Set();

  /* ══════════════════════════════════════════════════════════════════════════
     COLOUR THEMES  (deterministic per job id hash)
  ══════════════════════════════════════════════════════════════════════════ */
  const CS_THEMES = [
    { name:'navy',    bg:['#0d1b3e','#1a3a6b','#0a2044'], accent:'#3d8ef8', accent2:'#00c8e8', icon:'💼' },
    { name:'violet',  bg:['#1a0d3e','#2d1a6b','#12044a'], accent:'#8b5cf6', accent2:'#c4b5fd', icon:'🎓' },
    { name:'emerald', bg:['#0d2e1b','#1a5c38','#0a3020'], accent:'#10d98e', accent2:'#34d399', icon:'🏛'  },
    { name:'gold',    bg:['#3e1a0d','#6b2d10','#4a1a08'], accent:'#f59e0b', accent2:'#fcd34d', icon:'⭐' },
    { name:'rose',    bg:['#2e0d1a','#6b1a38','#3a0820'], accent:'#ff4d6d', accent2:'#fda4af', icon:'🔥' },
    { name:'cyan',    bg:['#0d2e3e','#1a5c6b','#0a3040'], accent:'#00c8e8', accent2:'#67e8f9', icon:'🚀' },
    { name:'purple',  bg:['#1e0d3e','#3d1a6b','#160844'], accent:'#a78bfa', accent2:'#ddd6fe', icon:'✨' },
    { name:'lime',    bg:['#1a2e0d','#3a6b1a','#1e3a0a'], accent:'#84cc16', accent2:'#bef264', icon:'📋' },
    { name:'orange',  bg:['#3e2e0d','#6b4a10','#4a3008'], accent:'#f97316', accent2:'#fdba74', icon:'💰' },
    { name:'blue',    bg:['#0d1e3e','#1a3a6b','#081840'], accent:'#60a5fa', accent2:'#bfdbfe', icon:'🎯' },
    { name:'fuchsia', bg:['#2e0d2e','#6b1a6b','#3a0838'], accent:'#e879f9', accent2:'#f5d0fe', icon:'🌟' },
    { name:'teal',    bg:['#0d2e2e','#1a5c5c','#083030'], accent:'#2dd4bf', accent2:'#99f6e4', icon:'🏆' },
  ];

  /* ══════════════════════════════════════════════════════════════════════════
     UTILITIES
  ══════════════════════════════════════════════════════════════════════════ */

  function _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    return Math.abs(h);
  }

  function _themeFor(job) {
    return CS_THEMES[_hash(String(job.id)) % CS_THEMES.length];
  }

  function _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function _truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
  }

  function _formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) { return dateStr; }
  }

  function _idle(fn) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(fn, { timeout: 4000 });
    } else {
      setTimeout(fn, 200);
    }
  }

  function _isMobile() {
    return /Mobi|Android/i.test(navigator.userAgent) || window.innerWidth < 600;
  }

  function _isLowBattery() {
    return !!global._lowBattery; // set by main performance layer in index.html
  }

  /* ══════════════════════════════════════════════════════════════════════════
     BADGE DERIVATION  (same logic as original csGetBadges)
  ══════════════════════════════════════════════════════════════════════════ */

  function _getBadges(job) {
    const badges = [];
    const type   = (job.job_type || '').toLowerCase();
    const cats   = Array.isArray(job.category) ? job.category.map(c => c.toLowerCase()) : [];
    const loc    = (job.location || '').toLowerCase();
    const sal    = job.salary || '';
    const dl     = job.last_date ? Math.ceil((new Date(job.last_date) - Date.now()) / 86400000) : 999;
    const age    = job.created_at ? Math.floor((Date.now() - new Date(job.created_at)) / 86400000) : 999;

    if (age <= 5)  badges.push('NEW');
    if (type === 'government' || cats.includes('govt') || cats.includes('government')) badges.push('GOVT');
    else if (type === 'private' || cats.includes('private')) badges.push('PRIVATE');
    if (loc.includes('assam') || cats.includes('assam'))          badges.push('ASSAM');
    if (type === 'scholarship' || cats.includes('scholarship'))    badges.push('SCHOLARSHIP');
    if (type === 'internship'  || cats.includes('internship'))     badges.push('INTERNSHIP');
    if (job.is_trending) badges.push('TRENDING');

    if (sal) {
      const nums = sal.match(/[\d,]+/g);
      if (nums) {
        const maxSal = Math.max(...nums.map(n => parseInt(n.replace(/,/g, ''), 10)));
        if (maxSal >= 50000) badges.push('HIGH SALARY');
      }
    }
    return badges.slice(0, 2);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CANVAS POSTER RENDERER  — 600×800 WebP @ 80 %
  ══════════════════════════════════════════════════════════════════════════ */

  function _renderPosterToBlob(job) {
    return new Promise((resolve) => {
      const W = 600, H = 800;
      const canvas = document.createElement('canvas');
      canvas.width  = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      const theme = _themeFor(job);

      /* ── Background gradient ───────────────────────────────────────── */
      const bgGrad = ctx.createLinearGradient(0, 0, W, H);
      bgGrad.addColorStop(0,   theme.bg[0]);
      bgGrad.addColorStop(0.5, theme.bg[1]);
      bgGrad.addColorStop(1,   theme.bg[2]);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      /* ── Geometric background pattern ──────────────────────────────── */
      ctx.save();

      // Large accent glow — top-right
      const g1 = ctx.createRadialGradient(W * 0.85, H * 0.12, 20, W * 0.85, H * 0.12, 280);
      g1.addColorStop(0, _hexToRgba(theme.accent, 0.22));
      g1.addColorStop(1, _hexToRgba(theme.accent, 0));
      ctx.fillStyle = g1;
      ctx.beginPath(); ctx.arc(W * 0.85, H * 0.12, 280, 0, Math.PI * 2); ctx.fill();

      // Secondary glow — bottom-left
      const g2 = ctx.createRadialGradient(W * 0.15, H * 0.82, 10, W * 0.15, H * 0.82, 160);
      g2.addColorStop(0, _hexToRgba(theme.accent2, 0.18));
      g2.addColorStop(1, _hexToRgba(theme.accent2, 0));
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(W * 0.15, H * 0.82, 160, 0, Math.PI * 2); ctx.fill();

      // Diagonal accent lines
      ctx.strokeStyle = _hexToRgba(theme.accent, 0.1);
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(-80 + i * 120, 0);
        ctx.lineTo(W + i * 120 - 400, H);
        ctx.stroke();
      }

      // Subtle dot grid — upper half only
      ctx.fillStyle = _hexToRgba(theme.accent2, 0.06);
      for (let gx = 30; gx < W; gx += 40) {
        for (let gy = 30; gy < H * 0.52; gy += 40) {
          ctx.beginPath(); ctx.arc(gx, gy, 1.6, 0, Math.PI * 2); ctx.fill();
        }
      }

      // Top-left corner bracket decoration
      ctx.strokeStyle = _hexToRgba(theme.accent, 0.25);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(24, 60); ctx.lineTo(24, 24); ctx.lineTo(60, 24);
      ctx.stroke();

      // Bottom-right corner bracket
      ctx.beginPath();
      ctx.moveTo(W - 24, H - 60); ctx.lineTo(W - 24, H - 24); ctx.lineTo(W - 60, H - 24);
      ctx.stroke();

      ctx.restore();

      /* ── Bottom scrim for text legibility ──────────────────────────── */
      const scrim = ctx.createLinearGradient(0, H * 0.40, 0, H);
      scrim.addColorStop(0,    'rgba(0,0,0,0)');
      scrim.addColorStop(0.35, 'rgba(0,0,0,0.50)');
      scrim.addColorStop(1,    'rgba(0,0,0,0.92)');
      ctx.fillStyle = scrim;
      ctx.fillRect(0, H * 0.40, W, H * 0.60);

      /* ── Central icon / emoji ──────────────────────────────────────── */
      ctx.save();
      ctx.font = '96px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Shadow for depth
      ctx.shadowColor   = _hexToRgba(theme.accent, 0.6);
      ctx.shadowBlur    = 40;
      ctx.fillText(job.org_icon || theme.icon, W * 0.5, H * 0.30);
      ctx.restore();

      /* ── Accent divider line ───────────────────────────────────────── */
      const lineGrad = ctx.createLinearGradient(30, 0, W - 30, 0);
      lineGrad.addColorStop(0,   _hexToRgba(theme.accent, 0));
      lineGrad.addColorStop(0.3, theme.accent);
      lineGrad.addColorStop(0.7, theme.accent2);
      lineGrad.addColorStop(1,   _hexToRgba(theme.accent2, 0));
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(30, H * 0.57);
      ctx.lineTo(W - 30, H * 0.57);
      ctx.stroke();

      /* ── Studyria logo watermark (top-left) ────────────────────────── */
      ctx.save();
      ctx.font = '600 18px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = _hexToRgba('#ffffff', 0.22);
      ctx.fillText('Studyria', 28, 48);
      ctx.restore();

      /* ── Organisation label ────────────────────────────────────────── */
      ctx.save();
      ctx.font = '600 18px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = _hexToRgba(theme.accent2, 0.92);
      ctx.fillText(_truncate(job.org || job.organization || 'Organisation', 30), 28, H * 0.64);
      ctx.restore();

      /* ── Job title (wrapped, max 2 lines) ──────────────────────────── */
      ctx.save();
      ctx.font = '700 28px "Inter", system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      _wrapText(ctx, job.title || 'Job Opportunity', 28, H * 0.72, W - 56, 36, 2);
      ctx.restore();

      /* ── Category chip ─────────────────────────────────────────────── */
      const catLabel = _getCategoryLabel(job);
      if (catLabel) {
        ctx.save();
        ctx.font = '600 14px "Inter", system-ui, sans-serif';
        ctx.textAlign = 'left';
        const chipW = ctx.measureText(catLabel).width + 24;
        const chipH = 26;
        const chipY = H * 0.845;

        // Chip background
        ctx.fillStyle = _hexToRgba(theme.accent, 0.22);
        _roundRect(ctx, 28, chipY, chipW, chipH, 6);
        ctx.fill();

        // Chip border
        ctx.strokeStyle = _hexToRgba(theme.accent, 0.55);
        ctx.lineWidth = 1;
        _roundRect(ctx, 28, chipY, chipW, chipH, 6);
        ctx.stroke();

        ctx.fillStyle = theme.accent;
        ctx.fillText(catLabel, 40, chipY + chipH * 0.68);
        ctx.restore();
      }

      /* ── Last date ─────────────────────────────────────────────────── */
      if (job.last_date) {
        ctx.save();
        ctx.font = '500 14px "Inter", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.textAlign = 'right';
        ctx.fillText('📅 ' + _formatDate(job.last_date), W - 28, H * 0.935);
        ctx.restore();
      }

      /* ── Location tag ──────────────────────────────────────────────── */
      if (job.location) {
        ctx.save();
        ctx.font = '500 14px "Inter", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.50)';
        ctx.textAlign = 'left';
        ctx.fillText('📍 ' + _truncate(job.location, 22), 28, H * 0.935);
        ctx.restore();
      }

      /* ── Convert to Blob ───────────────────────────────────────────── */
      const quality = 0.80;
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(blob => resolve({ blob, theme }), 'image/webp', quality);
      } else {
        // Fallback (Safari < 16): toDataURL then convert
        const dataUrl = canvas.toDataURL('image/webp', quality);
        fetch(dataUrl).then(r => r.blob()).then(blob => resolve({ blob, theme }));
      }
    });
  }

  /* ── Canvas text-wrap helper ───────────────────────────────────────────── */
  function _wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
    const words = text.split(' ');
    let line = '', lineCount = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y + lineCount * lineH);
        lineCount++;
        if (lineCount >= maxLines) {
          ctx.fillText(words.slice(i).join(' ') + '…', x, y + lineCount * lineH);
          return;
        }
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y + lineCount * lineH);
  }

  /* ── Canvas rounded-rect path helper ──────────────────────────────────── */
  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /* ── Category label extraction ─────────────────────────────────────────── */
  function _getCategoryLabel(job) {
    const t = (job.job_type || '').toLowerCase();
    if (t === 'government') return 'GOVT';
    if (t === 'private')    return 'PRIVATE';
    if (t === 'internship') return 'INTERNSHIP';
    if (t === 'scholarship') return 'SCHOLARSHIP';
    const cats = Array.isArray(job.category) ? job.category : [];
    if (cats.length) return cats[0].toUpperCase().slice(0, 12);
    return '';
  }

  /* ══════════════════════════════════════════════════════════════════════════
     SUPABASE STORAGE UPLOAD
  ══════════════════════════════════════════════════════════════════════════ */

  /**
   * Uploads the WebP blob to  storage/job-posters/<jobId>.webp
   * Returns the public URL on success, or null on failure.
   */
  async function _uploadToStorage(jobId, blob) {
    const sb = global.supabaseClient;
    if (!sb) return null;

    const path = `${jobId}.webp`;

    // upsert: overwrite if already exists (handles regenerate scenario)
    const { data, error } = await sb.storage
      .from(BUCKET)
      .upload(path, blob, {
        contentType:  'image/webp',
        cacheControl: '31536000', // 1 year — posters are immutable per version
        upsert:       true,
      });

    if (error) {
      console.warn('[PosterEngine] Storage upload failed:', error.message);
      return null;
    }

    // Get the permanent public URL (no expiry — bucket is public)
    const { data: { publicUrl } } = sb.storage.from(BUCKET).getPublicUrl(path);
    return publicUrl || null;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     METADATA SAVE
  ══════════════════════════════════════════════════════════════════════════ */

  async function _savePosterMeta(job, posterUrl, theme, badges) {
    const sb = global.supabaseClient;
    if (!sb) return;

    const { error } = await sb.from('jobs').update({
      poster_url:          posterUrl,
      poster_generated:    true,
      poster_theme:        theme.name,
      poster_badges:       badges,           // text[] column
      poster_generated_at: new Date().toISOString(),
      poster_version:      POSTER_ENGINE_VERSION,
    }).eq('id', job.id);

    if (error) {
      console.warn('[PosterEngine] Metadata save failed:', error.message);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CORE PUBLIC API
  ══════════════════════════════════════════════════════════════════════════ */

  /**
   * csPosterUrl(job)
   *
   * Returns the poster URL for a given job — synchronously from cache, or
   * schedules background generation and returns a placeholder in the meantime.
   *
   * Usage (drop-in replacement for the old csGeneratePoster):
   *   const url = csPosterUrl(job);
   *   img.src   = url;
   *
   * When generation completes, the poster cache is updated and any <img>
   * elements with data-job-id="<id>" are updated automatically.
   */
  global.csPosterUrl = function csPosterUrl(job) {
    const cacheKey = 'poster_' + job.id;

    /* 1. In-session cache hit ─────────────────────────────────────────── */
    if (global._csPosterCache.has(cacheKey)) {
      return global._csPosterCache.get(cacheKey);
    }

    /* 2. Already stored in Supabase (happy path — no generation needed) ─ */
    if (job.poster_url && job.poster_generated && job.poster_version === POSTER_ENGINE_VERSION) {
      global._csPosterCache.set(cacheKey, job.poster_url);
      return job.poster_url;
    }

    /* 3. Needs generation — schedule idle work, return placeholder ──────── */
    const placeholder = _buildPlaceholderDataUrl(job);
    global._csPosterCache.set(cacheKey, placeholder);

    // Don't pile up duplicate generation requests
    if (!_generating.has(job.id)) {
      _scheduleGeneration(job, cacheKey);
    }

    return placeholder;
  };

  /**
   * csPosterRegenerate(jobId)
   *
   * Forces a fresh poster render + upload, regardless of existing poster_url.
   * Called from the Admin Career Hub Manager "Regenerate Poster" button.
   * Returns a Promise<string|null> — the new poster URL.
   */
  global.csPosterRegenerate = async function csPosterRegenerate(jobId) {
    const sb = global.supabaseClient;
    if (!sb) { console.warn('[PosterEngine] Supabase not ready.'); return null; }

    // Fetch current job row
    const { data: job, error } = await sb
      .from('jobs')
      .select('id,title,org,organization,org_icon,location,salary,last_date,job_type,category,is_trending,featured,is_urgent,active,created_at')
      .eq('id', jobId)
      .maybeSingle();

    if (error || !job) {
      console.warn('[PosterEngine] csPosterRegenerate: job not found', jobId, error?.message);
      return null;
    }

    // Force regenerate
    const cacheKey = 'poster_' + jobId;
    global._csPosterCache.delete(cacheKey);
    _generating.delete(jobId);

    return await _doGenerate(job, cacheKey);
  };

  /* ══════════════════════════════════════════════════════════════════════════
     INTERNAL GENERATION PIPELINE
  ══════════════════════════════════════════════════════════════════════════ */

  function _scheduleGeneration(job, cacheKey) {
    _generating.add(job.id);

    _idle(async () => {
      // Skip if on mobile AND low battery to save resources
      if (_isMobile() && _isLowBattery()) {
        _generating.delete(job.id);
        return;
      }
      await _doGenerate(job, cacheKey);
    });
  }

  async function _doGenerate(job, cacheKey) {
    try {
      /* Step 1: Render canvas → WebP Blob */
      const { blob, theme } = await _renderPosterToBlob(job);

      /* Step 2: Upload to Supabase Storage */
      const posterUrl = await _uploadToStorage(job.id, blob);

      if (!posterUrl) {
        // Storage unavailable — fall back to in-memory data-URL
        const reader = new FileReader();
        const dataUrl = await new Promise(res => {
          reader.onload = () => res(reader.result);
          reader.readAsDataURL(blob);
        });
        global._csPosterCache.set(cacheKey, dataUrl);
        _swapImgSrc(job.id, dataUrl);
        return dataUrl;
      }

      /* Step 3: Update in-session cache */
      global._csPosterCache.set(cacheKey, posterUrl);

      /* Step 4: Derive badge list for metadata */
      const badges = _getBadges(job);

      /* Step 5: Persist metadata to jobs row (non-blocking) */
      _savePosterMeta(job, posterUrl, theme, badges).catch(() => {});

      /* Step 6: Patch any rendered <img> elements on the page */
      _swapImgSrc(job.id, posterUrl);

      /* Step 7: Invalidate the Supabase query cache so fresh data is read */
      if (global._supabaseCache) {
        global._supabaseCache.delete('cs_jobs_v1');
        global._supabaseCache.delete('ch_jobs_v1');
      }

      return posterUrl;
    } catch (err) {
      console.warn('[PosterEngine] Generation error for job', job.id, err);
      return null;
    } finally {
      _generating.delete(job.id);
    }
  }

  /* ── Update all <img data-job-id="x"> on page after generation ─────────── */
  function _swapImgSrc(jobId, url) {
    document.querySelectorAll(`[data-job-id="${CSS.escape(String(jobId))}"]`).forEach(el => {
      if (el.tagName === 'IMG') {
        el.src = url;
      } else {
        const img = el.querySelector('img[data-poster]');
        if (img) img.src = url;
      }
    });
  }

  /* ── Lightweight placeholder while real poster generates ──────────────── */
  function _buildPlaceholderDataUrl(job) {
    const theme = _themeFor(job);
    const W = 600, H = 800;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');

    // Minimal gradient background only (fast — no text, no patterns)
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, theme.bg[0]);
    bg.addColorStop(1, theme.bg[2]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Subtle loading pulse ring
    const pulse = ctx.createRadialGradient(W/2, H/2, 30, W/2, H/2, 90);
    pulse.addColorStop(0, _hexToRgba(theme.accent, 0.15));
    pulse.addColorStop(1, _hexToRgba(theme.accent, 0));
    ctx.fillStyle = pulse;
    ctx.beginPath(); ctx.arc(W/2, H/2, 90, 0, Math.PI * 2); ctx.fill();

    try {
      return c.toDataURL('image/webp', 0.5);
    } catch (_) {
      return c.toDataURL('image/png');
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     LAZY IMAGE OBSERVER  (wraps window.initLazyImages from perf layer)
  ══════════════════════════════════════════════════════════════════════════ */

  /**
   * Observe a poster <img> so it only loads when near the viewport.
   * Usage: <img data-src="..." data-job-id="42" loading="lazy" />
   */
  global.csPosterObserve = function csPosterObserve(imgEl) {
    if (!imgEl) return;
    if (global._lazyObserver) {
      global._lazyObserver.observe(imgEl);
    } else {
      // Fallback: just set src immediately
      if (imgEl.dataset.src) {
        imgEl.src = imgEl.dataset.src;
        delete imgEl.dataset.src;
      }
    }
  };

  /* ══════════════════════════════════════════════════════════════════════════
     CARD HTML BUILDER
     Drop-in replacement for the original csCardHTML function.
     Outputs semantic HTML referencing  data-job-id  so poster can be patched.
  ══════════════════════════════════════════════════════════════════════════ */

  global.csCardHTML = function csCardHTML(job) {
    const posterUrl    = global.csPosterUrl(job);
    const badges       = _getBadges(job);
    const primaryBadge = badges[0] || null;
    const dl           = job.last_date ? Math.ceil((new Date(job.last_date) - Date.now()) / 86400000) : null;
    const urgentClass  = (dl !== null && dl <= 7) ? ' urgent' : '';
    const salaryText   = job.salary ? '💰 ' + job.salary : '';
    const lastDateText = job.last_date
      ? (dl !== null && dl <= 0 ? '🔴 Closed'
        : dl !== null && dl <= 7 ? `⚡ ${dl}d left`
        : '📅 ' + _formatDate(job.last_date))
      : '';
    const stateText = job.location ? '📍 ' + _truncate(job.location, 18) : '';
    const orgText   = _truncate(job.org || job.organization || '', 22);

    const badgeHtml = primaryBadge
      ? `<span class="cs-poster-badge ${_badgeClass(primaryBadge)}">${primaryBadge}</span>`
      : '';

    return `
<div class="cs-card" role="button" tabindex="0" aria-label="${_attr(job.title || 'Job')}"
     data-job-id="${_attr(job.id)}"
     onclick="csOpenJob(${JSON.stringify(job.id)})"
     onkeydown="if(event.key==='Enter'||event.key===' ')csOpenJob(${JSON.stringify(job.id)})">
  <div class="cs-poster">
    <img
      src="${_attr(posterUrl)}"
      alt="${_attr(job.title || 'Job Opportunity')}"
      data-job-id="${_attr(job.id)}"
      data-poster="1"
      loading="lazy"
      decoding="async"
      width="600"
      height="800"
    />
    <div class="cs-poster-overlay"></div>
    ${badgeHtml}
    <div class="cs-poster-info">
      <div class="cs-poster-title">${_esc(job.title || 'Job Opportunity')}</div>
      <div class="cs-poster-org">${_esc(orgText)}</div>
    </div>
  </div>
  <div class="cs-card-meta">
    <div class="cs-meta-row">
      ${stateText ? `<span>${_esc(stateText)}</span>` : ''}
      ${stateText && job.job_type ? `<span class="cs-meta-dot"></span>` : ''}
      ${job.job_type ? `<span>${_esc(_truncate(job.job_type, 10))}</span>` : ''}
    </div>
    ${salaryText   ? `<div class="cs-meta-salary">${_esc(salaryText)}</div>` : ''}
    ${lastDateText ? `<div class="cs-meta-last-date${urgentClass}">${_esc(lastDateText)}</div>` : ''}
  </div>
</div>`.trim();
  };

  function _badgeClass(badge) {
    const map = {
      'NEW':'cs-badge-new','GOVT':'cs-badge-govt','PRIVATE':'cs-badge-private',
      'ASSAM':'cs-badge-assam','SCHOLARSHIP':'cs-badge-scholarship',
      'INTERNSHIP':'cs-badge-internship','TRENDING':'cs-badge-trending',
      'HIGH SALARY':'cs-badge-high-salary',
    };
    return map[badge] || 'cs-badge-new';
  }

  function _esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _attr(val) { return _esc(val); }

  /* ══════════════════════════════════════════════════════════════════════════
     ADMIN: "REGENERATE POSTER" BUTTON HANDLER
     Called from Career Hub Manager row actions.
  ══════════════════════════════════════════════════════════════════════════ */

  global.chmRegeneratePoster = async function chmRegeneratePoster(jobId, btnEl) {
    if (!jobId) return;
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳ Regenerating…'; }

    try {
      const newUrl = await global.csPosterRegenerate(jobId);
      if (newUrl) {
        if (typeof global.showToast === 'function') global.showToast('✅ Poster regenerated!', 'success');
        // Refresh admin table to show new poster_generated_at
        if (typeof global.chmLoadJobs === 'function') global.chmLoadJobs();
      } else {
        if (typeof global.showToast === 'function') global.showToast('⚠️ Regeneration failed — check Storage bucket.', 'error');
      }
    } finally {
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = '🖼 Regen Poster'; }
    }
  };

  /* ══════════════════════════════════════════════════════════════════════════
     ON-PUBLISH HOOK
     Integrate into chmSaveJob() in index.html:
       After: ({ error } = await sb.from('jobs').insert(payload));
       Add:   if (!error) csPosterOnPublish(insertedJob);
  ══════════════════════════════════════════════════════════════════════════ */

  /**
   * csPosterOnPublish(job)
   *
   * Call this immediately after a new job row is inserted.
   * Schedules poster generation via requestIdleCallback — non-blocking.
   */
  global.csPosterOnPublish = function csPosterOnPublish(job) {
    if (!job || !job.id) return;
    // Only generate if no poster exists yet
    if (job.poster_generated && job.poster_version === POSTER_ENGINE_VERSION) return;

    _idle(async () => {
      if (_isLowBattery()) return; // defer on low battery — will generate on next normal load
      const cacheKey = 'poster_' + job.id;
      await _doGenerate(job, cacheKey);
    });
  };

  /* ══════════════════════════════════════════════════════════════════════════
     EXPORT ENGINE VERSION (for debugging)
  ══════════════════════════════════════════════════════════════════════════ */
  global._csPosterEngineVersion = POSTER_ENGINE_VERSION;

  console.log('[PosterEngine] v' + POSTER_ENGINE_VERSION + ' loaded ✓');

})(window);
