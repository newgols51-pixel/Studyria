/**
 * poster-worker.js — Studyria Job Poster Automation System
 * ════════════════════════════════════════════════════════
 * Background queue processor for batch poster generation.
 *
 * Responsibilities:
 *   - Polls the `jobs_missing_posters` Supabase view periodically
 *   - Processes jobs in small batches to avoid blocking the main thread
 *   - Delegates actual rendering to poster-image.js
 *   - Updates window.PosterSystem.pendingJobs / totalPending in real-time
 *   - Exposes start / stop / status API via window.PosterWorker
 *   - Uses requestIdleCallback when available for minimal UI impact
 *   - Respects a global pause flag (window.PosterWorker.paused)
 *
 * Does NOT directly touch the DOM — pure background logic.
 */

import { generatePosterDataUrl, invalidatePosterCache } from './poster-image.js';

const MODULE      = '[PosterWorker]';
const VIEW_NAME   = 'jobs_missing_posters';
const BATCH_SIZE  = 5;                 // jobs processed per tick
const POLL_MS     = 5 * 60 * 1000;    // re-poll Supabase every 5 minutes
const TICK_GAP_MS = 800;              // gap between batches (ms)

// ── Internal state ────────────────────────────────────────────────────────────
let _queue       = [];    // Array of job objects waiting to be processed
let _running     = false; // whether the worker loop is active
let _pollTimer   = null;  // setInterval handle
let _tickTimer   = null;  // setTimeout handle for current batch
let _processed   = 0;     // session total

// ── Supabase accessor ─────────────────────────────────────────────────────────
function getClient() {
  return window.PosterSystem?.client || window.supabaseClient || null;
}

// ── Queue refresh — fetch from Supabase view ──────────────────────────────────
async function refreshQueue() {
  const sb = getClient();
  if (!sb) {
    console.warn(`${MODULE} No Supabase client — skipping queue refresh.`);
    return;
  }

  try {
    const { data, error, count } = await sb
      .from(VIEW_NAME)
      .select('id,title,org,organization,org_icon,location,salary,last_date,job_type,category,is_trending,featured,is_urgent,active,created_at,poster_url,poster_generated,poster_version', { count: 'exact' })
      .limit(200);

    if (error) {
      if (error.code === '42P01') {
        console.warn(`${MODULE} View "${VIEW_NAME}" not found. Create it in Supabase first.`);
      } else {
        console.error(`${MODULE} Queue refresh error:`, error.message);
      }
      return;
    }

    _queue = data || [];

    // Update shared PosterSystem state
    if (window.PosterSystem) {
      window.PosterSystem.pendingJobs  = _queue;
      window.PosterSystem.totalPending = count ?? _queue.length;
    }

    console.log(`${MODULE} Queue refreshed — ${_queue.length} jobs pending.`);
  } catch (err) {
    console.error(`${MODULE} refreshQueue exception:`, err);
  }
}

// ── Process one batch of jobs ─────────────────────────────────────────────────
async function processBatch() {
  if (window.PosterWorker?.paused) {
    _scheduleTick();
    return;
  }

  if (_queue.length === 0) {
    console.log(`${MODULE} Queue empty — waiting for next poll.`);
    return;
  }

  const batch = _queue.splice(0, BATCH_SIZE);

  for (const job of batch) {
    try {
      // Invalidate any stale cache entry first
      invalidatePosterCache(job.id);

      // Generate the poster (Canvas → DataURL → cached → Supabase flag)
      generatePosterDataUrl(job);
      _processed++;

      console.log(`${MODULE} ✅ [${_processed}] Poster generated: ${job.id} — ${job.title}`);
    } catch (err) {
      console.error(`${MODULE} Error generating poster for job ${job.id}:`, err);
    }

    // Tiny breathing room between individual jobs within a batch
    await _sleep(60);
  }

  // Update PosterSystem state after batch
  if (window.PosterSystem) {
    window.PosterSystem.pendingJobs  = _queue;
    window.PosterSystem.totalPending = _queue.length;
  }

  if (_queue.length > 0) {
    _scheduleTick(); // more work — schedule next batch
  } else {
    console.log(`${MODULE} 🎉 All queued posters processed this cycle. Processed total: ${_processed}`);
  }
}

// ── Schedule next batch tick ──────────────────────────────────────────────────
function _scheduleTick() {
  if (_tickTimer) clearTimeout(_tickTimer);

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => {
      _tickTimer = setTimeout(processBatch, TICK_GAP_MS);
    }, { timeout: 3000 });
  } else {
    _tickTimer = setTimeout(processBatch, TICK_GAP_MS);
  }
}

// ── Sleep helper ──────────────────────────────────────────────────────────────
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Start the worker ──────────────────────────────────────────────────────────
async function start() {
  if (_running) {
    console.log(`${MODULE} Already running.`);
    return;
  }
  _running = true;
  console.log(`${MODULE} 🚀 Worker started.`);

  // Initial queue fill
  await refreshQueue();

  if (_queue.length > 0) {
    _scheduleTick();
  }

  // Periodic re-poll
  _pollTimer = setInterval(async () => {
    await refreshQueue();
    if (_queue.length > 0 && _tickTimer === null) {
      _scheduleTick();
    }
  }, POLL_MS);
}

// ── Stop the worker ───────────────────────────────────────────────────────────
function stop() {
  _running = false;
  if (_pollTimer) { clearInterval(_pollTimer);  _pollTimer = null; }
  if (_tickTimer) { clearTimeout(_tickTimer);   _tickTimer = null; }
  console.log(`${MODULE} 🛑 Worker stopped. Session total processed: ${_processed}`);
}

// ── Status snapshot ───────────────────────────────────────────────────────────
function status() {
  return {
    running:   _running,
    queued:    _queue.length,
    processed: _processed,
    paused:    window.PosterWorker?.paused ?? false,
  };
}

// ── Force-process a single job immediately (for admin use) ────────────────────
async function forceProcess(jobId) {
  const sb = getClient();
  if (!sb) { console.error(`${MODULE} No Supabase client for forceProcess.`); return; }

  try {
    const { data, error } = await sb
      .from('jobs')
      .select('id,title,org,organization,org_icon,location,salary,last_date,job_type,category,is_trending,featured,is_urgent,active,created_at,poster_url,poster_generated,poster_version')
      .eq('id', jobId)
      .single();

    if (error || !data) {
      console.error(`${MODULE} forceProcess: job ${jobId} not found.`, error?.message);
      return;
    }

    invalidatePosterCache(data.id);
    generatePosterDataUrl(data);
    console.log(`${MODULE} ✅ Force-processed poster for job ${jobId}`);
  } catch (err) {
    console.error(`${MODULE} forceProcess exception:`, err);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
window.PosterWorker = {
  start,
  stop,
  status,
  forceProcess,
  refreshQueue,
  paused: false,   // set to true externally to pause batch processing
};

console.log(`${MODULE} ✅ Loaded — call window.PosterWorker.start() to begin batch processing.`);
