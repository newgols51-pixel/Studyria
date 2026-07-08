
  /* ═══════════════════════════════════════════════════════════════
     CAREER SPOTLIGHT ENGINE  v1.0
     SVG+Canvas Hybrid Poster Generator + Netflix Carousel
     ═══════════════════════════════════════════════════════════════ */
  (function() {

    /* ── Poster design palette — 12 distinct gradient schemes ─── */
    const CS_THEMES = [
      { bg: ['#0d1b3e','#1a3a6b','#0a2044'], accent: '#3d8ef8', accent2: '#00c8e8', icon: '💼' },
      { bg: ['#1a0d3e','#2d1a6b','#12044a'], accent: '#8b5cf6', accent2: '#c4b5fd', icon: '🎓' },
      { bg: ['#0d2e1b','#1a5c38','#0a3020'], accent: '#10d98e', accent2: '#34d399', icon: '🏛' },
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

    /* ── Badge logic: derive auto-badges from job fields ─────── */
    function csGetBadges(job) {
      const badges = [];
      const type = (job.job_type || '').toLowerCase();
      const cats = Array.isArray(job.category) ? job.category.map(c => c.toLowerCase()) : [];
      const loc  = (job.location || '').toLowerCase();
      const sal  = job.salary || '';
      const daysLeft = job.last_date ? Math.ceil((new Date(job.last_date) - Date.now()) / 86400000) : 999;
      const createdDiff = job.created_at ? Math.floor((Date.now() - new Date(job.created_at)) / 86400000) : 999;

      if (createdDiff <= 5) badges.push('NEW');
      if (type === 'government' || cats.includes('govt') || cats.includes('government')) badges.push('GOVT');
      else if (type === 'private' || cats.includes('private')) badges.push('PRIVATE');
      if (loc.includes('assam') || cats.includes('assam')) badges.push('ASSAM');
      if (type === 'scholarship' || cats.includes('scholarship')) badges.push('SCHOLARSHIP');
      if (type === 'internship' || cats.includes('internship')) badges.push('INTERNSHIP');
      if (job.is_trending) badges.push('TRENDING');

      // High salary detection — parse numeric value from string like "₹25,000 - ₹81,000"
      if (sal) {
        const nums = sal.match(/[\d,]+/g);
        if (nums) {
          const maxSal = Math.max(...nums.map(n => parseInt(n.replace(/,/g,''),10)));
          if (maxSal >= 50000) badges.push('HIGH SALARY');
        }
      }
      return badges.slice(0, 2); // max 2 badges on poster
    }

    /* ── Badge CSS class map ─────────────────────────────────── */
    function csBadgeClass(badge) {
      const map = {
        'NEW':'cs-badge-new','GOVT':'cs-badge-govt','PRIVATE':'cs-badge-private',
        'ASSAM':'cs-badge-assam','SCHOLARSHIP':'cs-badge-scholarship',
        'INTERNSHIP':'cs-badge-internship','TRENDING':'cs-badge-trending',
        'HIGH SALARY':'cs-badge-high-salary'
      };
      return map[badge] || 'cs-badge-new';
    }

    /* ═══════════════════════════════════════════════════════════
       SVG+Canvas Hybrid Poster Generator
       — Generates a unique poster DataURL for each job
       — Uses Canvas for speed + SVG patterns for visual richness
       — Result cached in window._csPosterCache (session memory)
       — Also checks/saves poster_url in Supabase for persistence
    ═══════════════════════════════════════════════════════════ */
    window._csPosterCache = window._csPosterCache || new Map();

    function csGeneratePoster(job) {
      const cacheKey = 'poster_' + job.id;
      if (window._csPosterCache.has(cacheKey)) return window._csPosterCache.get(cacheKey);

      // Deterministically pick a theme from job id hash
      const hash = (str) => { let h = 0; for (let i=0; i<str.length; i++) h = Math.imul(31,h) + str.charCodeAt(i)|0; return Math.abs(h); };
      const theme = CS_THEMES[hash(String(job.id)) % CS_THEMES.length];

      const W = 300, H = 400;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');

      // ── Background gradient ─────────────────────────────────
      const bgGrad = ctx.createLinearGradient(0, 0, W, H);
      bgGrad.addColorStop(0, theme.bg[0]);
      bgGrad.addColorStop(0.5, theme.bg[1]);
      bgGrad.addColorStop(1, theme.bg[2]);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // ── Abstract geometric pattern (SVG-style circles) ──────
      ctx.save();
      // Large accent circle top-right
      const grad1 = ctx.createRadialGradient(W*0.85, H*0.12, 10, W*0.85, H*0.12, 140);
      grad1.addColorStop(0, hexToRgba(theme.accent, 0.22));
      grad1.addColorStop(1, hexToRgba(theme.accent, 0));
      ctx.fillStyle = grad1;
      ctx.beginPath(); ctx.arc(W*0.85, H*0.12, 140, 0, Math.PI*2); ctx.fill();

      // Small accent circle bottom-left
      const grad2 = ctx.createRadialGradient(W*0.15, H*0.82, 5, W*0.15, H*0.82, 80);
      grad2.addColorStop(0, hexToRgba(theme.accent2, 0.18));
      grad2.addColorStop(1, hexToRgba(theme.accent2, 0));
      ctx.fillStyle = grad2;
      ctx.beginPath(); ctx.arc(W*0.15, H*0.82, 80, 0, Math.PI*2); ctx.fill();

      // Diagonal line accents
      ctx.strokeStyle = hexToRgba(theme.accent, 0.12);
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(-40 + i*80, 0);
        ctx.lineTo(W + i*80 - 200, H);
        ctx.stroke();
      }

      // Grid dot pattern (subtle)
      ctx.fillStyle = hexToRgba(theme.accent2, 0.07);
      for (let gx = 20; gx < W; gx += 28) {
        for (let gy = 20; gy < H*0.55; gy += 28) {
          ctx.beginPath(); ctx.arc(gx, gy, 1.2, 0, Math.PI*2); ctx.fill();
        }
      }
      ctx.restore();

      // ── Bottom gradient for text legibility ────────────────
      const textGrad = ctx.createLinearGradient(0, H*0.45, 0, H);
      textGrad.addColorStop(0, 'rgba(0,0,0,0)');
      textGrad.addColorStop(0.45, 'rgba(0,0,0,0.55)');
      textGrad.addColorStop(1, 'rgba(0,0,0,0.88)');
      ctx.fillStyle = textGrad;
      ctx.fillRect(0, H*0.45, W, H*0.55);

      // ── Icon / Emoji centered upper area ───────────────────
      ctx.font = '52px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(job.org_icon || theme.icon, W*0.5, H*0.3);

      // ── Accent line above text ─────────────────────────────
      const lineGrad = ctx.createLinearGradient(20, 0, W-20, 0);
      lineGrad.addColorStop(0, hexToRgba(theme.accent, 0));
      lineGrad.addColorStop(0.3, theme.accent);
      lineGrad.addColorStop(0.7, theme.accent2);
      lineGrad.addColorStop(1, hexToRgba(theme.accent2, 0));
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(20, H*0.58); ctx.lineTo(W-20, H*0.58); ctx.stroke();

      // ── Organization label ─────────────────────────────────
      ctx.font = '500 10px "Inter", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = hexToRgba(theme.accent2, 0.9);
      ctx.fillText(truncate(job.org || job.organization || 'Organization', 30), 14, H*0.65);

      // ── Job Title (wrapped, 2 lines max) ───────────────────
      ctx.font = '700 15px "Inter", system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      wrapText(ctx, job.title || 'Job Opportunity', 14, H*0.72, W-28, 20, 2);

      // ── Category chip ─────────────────────────────────────
      const catLabel = csGetCategoryLabel(job);
      if (catLabel) {
        ctx.font = '600 9px "Inter", system-ui, sans-serif';
        const tw = ctx.measureText(catLabel).width + 16;
        ctx.fillStyle = hexToRgba(theme.accent, 0.25);
        roundRect(ctx, 14, H*0.855, tw, 16, 4);
        ctx.fill();
        ctx.fillStyle = theme.accent;
        ctx.textAlign = 'left';
        ctx.fillText(catLabel, 22, H*0.868);
      }

      // ── Last date ─────────────────────────────────────────
      if (job.last_date) {
        const dateStr = '📅 ' + formatDate(job.last_date);
        ctx.font = '500 9px "Inter", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.textAlign = 'right';
        ctx.fillText(dateStr, W-14, H*0.93);
      }

      ctx.textAlign = 'left';

      // ── Convert to WebP (or fallback PNG) ─────────────────
      let dataUrl;
      try {
        dataUrl = canvas.toDataURL('image/webp', 0.82);
        // Some browsers return image/png even when webp requested — that's fine
      } catch(e) {
        dataUrl = canvas.toDataURL('image/png');
      }

      window._csPosterCache.set(cacheKey, dataUrl);

      // ── Upload to Supabase Storage + mark job as poster_generated ──
      // Non-blocking: fires in background so the UI isn't held up.
      if (window.supabaseClient) {
        (async () => {
          try {
            const sb = window.supabaseClient;

            // STEP 1: Job loaded (confirmed by caller — log here for trace)
            console.log('[PosterGen] STEP 1 Job loaded', job.id, job.title);

            // STEP 2: Poster rendered — dataUrl already in scope
            console.log('[PosterGen] STEP 2 Poster rendered', job.id, 'dataUrl length:', dataUrl.length);

            // STEP 3: Blob created
            const res  = await fetch(dataUrl);
            const blob = await res.blob();
            const mime = blob.type || 'image/webp';
            const ext  = mime.includes('webp') ? 'webp' : 'png';
            const path = `posters/${job.id}.${ext}`;
            console.log('[PosterGen] STEP 3 Blob created', job.id, mime, blob.size, 'bytes → path:', path);

            // STEP 4: Upload started
            console.log('[PosterGen] STEP 4 Upload started', job.id, '→ bucket: job-posters //', path);
            const { error: uploadErr } = await sb.storage
              .from('job-posters')
              .upload(path, blob, { contentType: mime, upsert: true });

            if (uploadErr) {
              console.error('POSTER_UPLOAD_ERROR', uploadErr);
              console.error('[PosterGen] STEP 4 FAILED for job', job.id,
                '| bucket=job-posters | path=', path,
                '| message:', uploadErr.message,
                '| hint:', uploadErr.hint ?? 'none',
                '| status:', uploadErr.status ?? 'n/a');
              throw new Error(`Storage upload failed — check Storage bucket "job-posters": ${uploadErr.message}`);
            }

            // STEP 5: Upload success
            console.log('[PosterGen] STEP 5 Upload success', job.id, path);

            // Get public URL
            const { data: urlData } = sb.storage
              .from('job-posters')
              .getPublicUrl(path);
            const publicUrl = urlData && urlData.publicUrl;
            if (!publicUrl) {
              console.error('POSTER_UPLOAD_ERROR', 'Could not resolve public URL for', path);
              throw new Error(`Could not get public URL for ${path} — bucket may not be public`);
            }

            // STEP 6: DB updated
            console.log('[PosterGen] STEP 6 DB update started', job.id, publicUrl);
            const { error: updateErr } = await sb.from('jobs').update({
              poster_url:          publicUrl,
              poster_generated:    true,
              poster_generated_at: new Date().toISOString()
            }).eq('id', job.id);

            if (updateErr) {
              console.error('POSTER_UPLOAD_ERROR', updateErr);
              console.error('[PosterGen] STEP 6 DB update failed', job.id, updateErr.message);
              throw new Error(`DB update failed: ${updateErr.message}`);
            }

            console.log('[PosterGen] STEP 6 DB updated ✅ Poster saved for job', job.id, publicUrl);
            // Also update in-memory cache so csLoad picks it up on next refresh
            if (window._csPosterUrlCache) window._csPosterUrlCache.set(String(job.id), publicUrl);

          } catch(err) {
            console.error('POSTER_UPLOAD_ERROR', err);
            console.error('[PosterGen] Unexpected error for job', job.id, err.message, err);
          }
        })();
      }

      return dataUrl;
    }

    /* ── Canvas helper: wrap text ────────────────────────────── */
    function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
      const words = text.split(' ');
      let line = '';
      let lineCount = 0;
      for (let i = 0; i < words.length; i++) {
        const test = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(test).width > maxW && line) {
          ctx.fillText(line, x, y + lineCount * lineH);
          lineCount++;
          if (lineCount >= maxLines) { ctx.fillText(words.slice(i).join(' ') + (i < words.length-1 ? '…' : ''), x, y + lineCount * lineH); return; }
          line = words[i];
        } else { line = test; }
      }
      if (line) ctx.fillText(line, x, y + lineCount * lineH);
    }

    /* ── Canvas helper: rounded rect ────────────────────────── */
    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x+r, y);
      ctx.lineTo(x+w-r, y); ctx.arcTo(x+w, y, x+w, y+r, r);
      ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
      ctx.lineTo(x+r, y+h); ctx.arcTo(x, y+h, x, y+h-r, r);
      ctx.lineTo(x, y+r); ctx.arcTo(x, y, x+r, y, r);
      ctx.closePath();
    }

    /* ── Utility: hex color → rgba string ───────────────────── */
    function hexToRgba(hex, alpha) {
      const r = parseInt(hex.slice(1,3),16);
      const g = parseInt(hex.slice(3,5),16);
      const b = parseInt(hex.slice(5,7),16);
      return `rgba(${r},${g},${b},${alpha})`;
    }

    function truncate(str, len) { return str.length > len ? str.slice(0,len-1) + '…' : str; }

    function formatDate(dateStr) {
      if (!dateStr) return '';
      const d = new Date(dateStr);
      if (isNaN(d)) return dateStr;
      return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
    }

    function csGetCategoryLabel(job) {
      const t = (job.job_type||'').toLowerCase();
      if (t === 'government') return 'GOVT JOB';
      if (t === 'private') return 'PRIVATE';
      if (t === 'scholarship') return 'SCHOLARSHIP';
      if (t === 'internship') return 'INTERNSHIP';
      const cats = Array.isArray(job.category) ? job.category : [];
      if (cats.length) return cats[0].toUpperCase().slice(0,12);
      return '';
    }

    /* ── Compute days-to-deadline ──────────────────────────── */
    function daysLeft(dateStr) {
      if (!dateStr) return null;
      return Math.ceil((new Date(dateStr) - Date.now()) / 86400000);
    }

    /* ── Build a single card HTML string ─────────────────────── */
    function _csCardHTMLLegacy(job) {
      const posterUrl = window.csPosterUrl ? window.csPosterUrl(job) : csGeneratePoster(job);
      const badges    = csGetBadges(job);
      const primaryBadge = badges[0] || null;
      const dl = daysLeft(job.last_date);
      const urgentClass = (dl !== null && dl <= 7) ? ' urgent' : '';
      const salaryText = job.salary ? '💰 ' + job.salary : '';
      const lastDateText = job.last_date
        ? (dl !== null && dl <= 0 ? '🔴 Closed' : dl !== null && dl <= 7 ? `⚡ ${dl}d left` : '📅 ' + formatDate(job.last_date))
        : '';
      const stateText = job.location ? '📍 ' + truncate(job.location, 18) : '';
      const orgText = truncate(job.org || job.organization || '', 22);

      const badgeHtml = primaryBadge
        ? `<span class="cs-poster-badge ${csBadgeClass(primaryBadge)}">${primaryBadge}</span>` : '';

      // We use a lazy img with data-src pointing to the Canvas dataURL
      return `
<div class="cs-card" role="button" tabindex="0" aria-label="${(job.title||'').replace(/"/g,'&quot;')}"
     onclick="csOpenJob(${JSON.stringify(job.id)})"
     onkeydown="if(event.key==='Enter'||event.key===' ')csOpenJob(${JSON.stringify(job.id)})">
  <div class="cs-poster">
    <img src="${posterUrl}" alt="${(job.title||'').replace(/"/g,'&quot;')}" loading="lazy" decoding="async" width="300" height="400" />
    <div class="cs-poster-overlay"></div>
    ${badgeHtml}
    <div class="cs-poster-info">
      <div class="cs-poster-title">${escHtml(job.title||'Job Opportunity')}</div>
      <div class="cs-poster-org">${escHtml(orgText)}</div>
    </div>
  </div>
  <div class="cs-card-meta">
    <div class="cs-meta-row">
      ${stateText ? `<span>${escHtml(stateText)}</span>` : ''}
      ${stateText && job.job_type ? `<span class="cs-meta-dot"></span>` : ''}
      ${job.job_type ? `<span>${escHtml(truncate(job.job_type,10))}</span>` : ''}
    </div>
    ${salaryText ? `<div class="cs-meta-salary">${escHtml(salaryText)}</div>` : ''}
    ${lastDateText ? `<div class="cs-meta-last-date${urgentClass}">${escHtml(lastDateText)}</div>` : ''}
  </div>
</div>`.trim();
    }

    function escHtml(str) {
      return String(str||'')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    /* ── Render carousel ──────────────────────────────────────── */
    function csRender(jobs) {
      const track = document.getElementById('csTrack');
      const dotsEl = document.getElementById('csDots');
      if (!track) return;

      if (!jobs || !jobs.length) {
        track.innerHTML = `
          <div style="padding:48px 28px;text-align:center;font-family:var(--font-ui)">
            <div style="font-size:2rem;margin-bottom:12px">🎨</div>
            <div style="color:var(--text);font-weight:700;font-size:1rem;margin-bottom:6px">Posters Being Generated</div>
            <div style="color:var(--text2);font-size:.82rem;max-width:280px;margin:0 auto">
              Premium job posters are currently being created. Check back shortly or run
              <strong>Generate All Posters</strong> from the Admin → Career Hub panel.
            </div>
          </div>`;
        return;
      }

      const _cardFn = window.csCardHTML || _csCardHTMLLegacy;
      track.innerHTML = jobs.map(job => _cardFn(job)).join('');

      // Build dots (1 dot per ~3 jobs)
      if (dotsEl) {
        const totalDots = Math.ceil(jobs.length / 3);
        dotsEl.innerHTML = Array.from({length: totalDots}, (_,i) =>
          `<div class="cs-dot${i===0?' active':''}" data-idx="${i}" onclick="csScrollToDot(${i})"></div>`
        ).join('');
      }
    }

    /* ── Open job: delegate to career-hub.js's chOpenJobSheet ── */
    window.csOpenJob = function(jobId) {
      // Try Career Hub's native job sheet first
      if (typeof window.chOpenJobSheet === 'function') {
        window.chOpenJobSheet(jobId);
        return;
      }
      // Fallback: navigate to Career Hub page
      if (typeof navigate === 'function') navigate('career-hub');
    };

    /* ── Dot scroll ─────────────────────────────────────────── */
    window.csScrollToDot = function(idx) {
      const outer = document.getElementById('csOuter');
      const card = outer && outer.querySelector('.cs-card');
      if (!outer || !card) return;
      const cardW = card.offsetWidth + 16;
      outer.scrollLeft = idx * 3 * cardW;
    };

    /* ── Dot active state on scroll ─────────────────────────── */
    function csInitDotSync() {
      const outer = document.getElementById('csOuter');
      const dotsEl = document.getElementById('csDots');
      if (!outer || !dotsEl) return;
      outer.addEventListener('scroll', () => {
        const card = outer.querySelector('.cs-card');
        if (!card) return;
        const cardW = card.offsetWidth + 16;
        const idx = Math.round(outer.scrollLeft / (cardW * 3));
        dotsEl.querySelectorAll('.cs-dot').forEach((d,i) => d.classList.toggle('active', i===idx));
      }, { passive: true });
    }

    /* ── Nav buttons ─────────────────────────────────────────── */
    function csInitNav() {
      const outer = document.getElementById('csOuter');
      const prev  = document.getElementById('csPrev');
      const next  = document.getElementById('csNext');
      if (!outer) return;
      const scroll = (dir) => {
        const card = outer.querySelector('.cs-card');
        const cardW = card ? card.offsetWidth + 16 : 220;
        outer.scrollBy({ left: dir * cardW * 2, behavior: 'smooth' });
      };
      if (prev) prev.onclick = () => scroll(-1);
      if (next) next.onclick = () => scroll(1);

      // Touch/drag scroll
      let startX = 0, isDragging = false;
      outer.addEventListener('mousedown', e => { startX = e.pageX - outer.scrollLeft; isDragging = true; });
      outer.addEventListener('mousemove', e => { if (!isDragging) return; e.preventDefault(); outer.scrollLeft = e.pageX - startX; });
      outer.addEventListener('mouseup',   () => { isDragging = false; });
      outer.addEventListener('mouseleave',() => { isDragging = false; });
    }

    /* ── Poll until window.supabaseClient is set (max 30s) ─────── */
    function csWaitForSupabase(callback) {
      var attempts = 0;
      var maxAttempts = 150;
      function check() {
        if (window.supabaseClient) {
          console.log('Career Spotlight: supabaseClient ready, attempts=' + attempts);
          callback(window.supabaseClient);
          return;
        }
        if (++attempts < maxAttempts) {
          setTimeout(check, 200);
        } else {
          console.error('Career Spotlight: supabaseClient never ready after 30s');
        }
      }
      check();
    }

    /* ── Main loader ─────────────────────────────────────────── */
    /* IMPORTANT: Premium Opportunities shows ONLY jobs where           */
    /* poster_generated = true AND poster_url IS NOT NULL.              */
    /* No fallback to un-generated jobs. Use csPostersBulkGenerate()   */
    /* (admin function) to generate posters first.                      */
    function csLoad() {
      csWaitForSupabase(async function(sb) {
        try {
          var SEL = 'id,title,org,organization,org_icon,location,salary,last_date,job_type,category,is_trending,featured,trending,is_urgent,active,created_at,poster_url,poster_generated,poster_version';

          // ONLY load jobs that have a real generated poster
          var result = await sb.from('jobs').select(SEL)
            .eq('active', true)
            .eq('poster_generated', true)
            .not('poster_url', 'is', null)
            .neq('poster_url', '__generated__')   // exclude legacy flag-only rows
            .order('featured',   { ascending: false })
            .order('trending',   { ascending: false })
            .order('created_at', { ascending: false })
            .limit(30);

          var jobs = (!result.error && Array.isArray(result.data)) ? result.data : [];
          console.log('[CareerSpotlight] poster_generated jobs:', jobs.length);

          csRender(jobs);
          csInitDotSync();
          csInitNav();

        } catch(e) {
          console.warn('Career Spotlight: load error', e);
          var track = document.getElementById('csTrack');
          if (track) track.innerHTML = '';
        }
      });
    }

    /* ── Init: start as soon as DOM is ready; csLoad self-polls for supabaseClient ── */
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', csLoad);
    } else {
      csLoad();
    }

    // Also re-init when Career Hub publishes a new job (optional hook)
    window._csRefresh = csLoad;
    // Expose canvas generator so admin bulk-generation can call it directly
    window._csGeneratePoster = csGeneratePoster;

  })();
  