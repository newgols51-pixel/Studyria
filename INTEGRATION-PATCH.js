/**
 * ══════════════════════════════════════════════════════════════════════════
 *  Studyria — Poster Engine v2 · Integration Patch
 *  This file documents every change to make in index.html.
 *  Search for each STEP comment and apply the diff shown.
 * ══════════════════════════════════════════════════════════════════════════
 */

/* ──────────────────────────────────────────────────────────────────────────
   STEP 1 — Load the poster engine script (before closing </body>)

   Find this line in index.html (near line 27597):
     <script src="career-hub.js"></script>

   Add AFTER it:
     <script src="career-hub-poster-engine.js"></script>
 ──────────────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────────
   STEP 2 — Replace the old csGeneratePoster call in csCardHTML (~line 5270)

   FIND (inside the csCardHTML function):
     const posterUrl = csGeneratePoster(job);

   REPLACE WITH:
     const posterUrl = window.csPosterUrl ? window.csPosterUrl(job) : csGeneratePoster(job);

   This makes csCardHTML use the new engine when loaded, while keeping
   the old generator as a safe fallback during the transition.
 ──────────────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────────
   STEP 3 — Replace csCardHTML with the engine's version

   The poster engine exports  window.csCardHTML  which replaces the inline
   function. To avoid conflicts, RENAME the existing inline function:

   FIND (inside the Career Spotlight IIFE, ~line 5268):
     function csCardHTML(job) {

   REPLACE WITH:
     function _csCardHTMLLegacy(job) {

   Then in csRender (~line 5328):
   FIND:
     track.innerHTML = jobs.map(csCardHTML).join('');

   REPLACE WITH:
     const _cardFn = window.csCardHTML || _csCardHTMLLegacy;
     track.innerHTML = jobs.map(job => _cardFn(job)).join('');
 ──────────────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────────
   STEP 4 — Add "Regenerate Poster" button to Career Hub Manager row actions

   Find chmRowHTML function (~line 18539), inside the <td> with action buttons:

   FIND:
     <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="chmDeleteJob('${j.id}')" title="Delete">🗑️</button>

   ADD AFTER it (still inside the same <td>):
     <button class="btn btn-ghost btn-sm" onclick="chmRegeneratePoster('${j.id}', this)" title="Regenerate Poster">🖼</button>
 ──────────────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────────
   STEP 5 — Trigger poster generation on job publish (chmSaveJob, ~line 18773)

   FIND (inside chmSaveJob, the insert branch):
     } else {
       payload.source = 'manual';
       ({ error } = await sb.from('jobs').insert(payload));
     }
     if (error) throw error;
     if (typeof showToast === 'function') showToast(id ? 'Job updated ✓' : 'Job published ✓', 'success');

   REPLACE WITH:
     } else {
       payload.source = 'manual';
       const { data: insertedRows, error: insertErr } = await sb.from('jobs').insert(payload).select().single();
       error = insertErr;
       // ── Trigger poster generation on publish ──
       if (!error && insertedRows && typeof window.csPosterOnPublish === 'function') {
         window.csPosterOnPublish(insertedRows);
       }
     }
     if (error) throw error;
     if (typeof showToast === 'function') showToast(id ? 'Job updated ✓' : 'Job published ✓', 'success');

   NOTE: Also trigger regeneration on update (optional — only when key fields change):

   FIND (the update branch just above):
     if (id) {
       ({ error } = await sb.from('jobs').update(payload).eq('id', id));

   REPLACE WITH:
     if (id) {
       ({ error } = await sb.from('jobs').update(payload).eq('id', id));
       // If title / org / type changed, force poster regen
       const _posterFields = ['title','org','org_icon','job_type','category','location','salary'];
       const _needsRegen   = _posterFields.some(f => payload[f] !== undefined);
       if (!error && _needsRegen && typeof window.csPosterRegenerate === 'function') {
         window.csPosterRegenerate(id).catch(() => {});
       }
 ──────────────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────────
   STEP 6 — Update the Supabase SELECT to include new poster columns

   In csLoad (~line 5406), the select string already includes poster_url.
   Extend it with the new columns:

   FIND:
     .select('id,title,org,organization,org_icon,location,salary,last_date,job_type,category,is_trending,featured,is_urgent,active,created_at,poster_url')

   REPLACE WITH:
     .select('id,title,org,organization,org_icon,location,salary,last_date,job_type,category,is_trending,featured,is_urgent,active,created_at,poster_url,poster_generated,poster_version')

   Do the same in chmLoadJobs (~line 18502) which uses .select('*') — no change needed there.
 ──────────────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────────
   STEP 7 — Show poster status in Career Hub Manager table

   In chmRowHTML, inside the job title column, add a poster status indicator:

   FIND:
     <div class="chm-row-title">${(j.title||'').replace(/</g,'&lt;')}</div>
     <div class="chm-row-sub">${(j.org||'').replace(/</g,'&lt;')}</div>

   REPLACE WITH:
     <div class="chm-row-title">${(j.title||'').replace(/</g,'&lt;')}</div>
     <div class="chm-row-sub">${(j.org||'').replace(/</g,'&lt;')}
       ${j.poster_generated
         ? `<span title="Poster ready" style="color:#10d98e;font-size:.65rem">● poster</span>`
         : `<span title="No poster yet" style="color:#f59e0b;font-size:.65rem">○ no poster</span>`
       }
     </div>
 ──────────────────────────────────────────────────────────────────────────── */

/*
 * That's it. After applying all 7 steps:
 *
 *  1. Run poster-engine-migration.sql in Supabase.
 *  2. Create the  job-posters  Storage bucket (public read).
 *  3. Deploy career-hub-poster-engine.js alongside index.html.
 *
 *  Existing jobs will have their posters generated lazily on next page
 *  load (via requestIdleCallback). New jobs get their poster generated
 *  immediately after publish.
 *
 *  To regenerate all posters at once, run this in the browser console
 *  while logged in as admin:
 *
 *    const { data } = await window.supabaseClient.from('jobs').select('id').eq('active',true);
 *    for (const j of data) await window.csPosterRegenerate(j.id);
 */
