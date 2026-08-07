/**
 * poster-init.js — Studyria Job Poster Automation System
 * ═══════════════════════════════════════════════════════
 * Initializes the Job Poster System and connects to the existing
 * Supabase client already established by supabase.js.
 *
 * Load order: must come AFTER supabase.js sets window.supabaseClient.
 * Usage: <script type="module" src="poster-init.js"></script>
 *
 * Responsibilities:
 *   1. Verify Supabase connection is live.
 *   2. Query the `jobs_missing_posters` view for pending poster jobs.
 *   3. Log a summary to the console.
 *   4. Expose window.PosterSystem for downstream poster modules.
 *   5. Never throw — all errors are caught and reported safely.
 */

// ── Constants ──────────────────────────────────────────────────────────────
const MODULE     = '[PosterInit]';
const VIEW_NAME  = 'jobs_missing_posters';

// How long to wait (ms) for supabase.js to set window.supabaseClient
const MAX_WAIT_MS  = 8_000;
const POLL_STEP_MS = 100;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Waits until window.supabaseClient is available (set by supabase.js),
 * or rejects after MAX_WAIT_MS.
 * @returns {Promise<SupabaseClient>}
 */
function waitForSupabaseClient () {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      const client = window.supabaseClient;
      if (client && typeof client.from === 'function') {
        resolve(client);
        return;
      }
      if (Date.now() - start >= MAX_WAIT_MS) {
        reject(new Error(
          `${MODULE} window.supabaseClient not available after ${MAX_WAIT_MS}ms. ` +
          'Ensure supabase.js is loaded before poster-init.js.'
        ));
        return;
      }
      setTimeout(check, POLL_STEP_MS);
    };

    check();
  });
}

/**
 * Verifies the Supabase connection is live by performing a lightweight
 * auth.getSession() call.
 * @param {SupabaseClient} sb
 * @returns {Promise<boolean>}
 */
async function verifyConnection (sb) {
  try {
    const { error } = await sb.auth.getSession();
    if (error) {
      console.warn(`${MODULE} Supabase connection check returned an auth warning:`, error.message);
      // Not a fatal error — anon access still works for public views
    }
    return true;
  } catch (err) {
    console.error(`${MODULE} Supabase connection verification failed:`, err);
    return false;
  }
}

/**
 * Queries the `jobs_missing_posters` view and returns the result rows.
 * Falls back gracefully if the view does not yet exist.
 * @param {SupabaseClient} sb
 * @returns {Promise<{ data: Array|null, error: Object|null, count: number }>}
 */
async function fetchPendingPosterJobs (sb) {
  try {
    const { data, error, count } = await sb
      .from(VIEW_NAME)
      .select('id, title, org, created_at', { count: 'exact' })
      .limit(500);   // safety ceiling — adjust as needed

    if (error) {
      // If the view doesn't exist yet, surface a clear setup hint
      if (error.code === '42P01') {   // undefined_table
        console.warn(
          `${MODULE} View "${VIEW_NAME}" does not exist in Supabase yet.\n` +
          `  ➜ Create it with:\n` +
          `      CREATE OR REPLACE VIEW public.${VIEW_NAME} AS\n` +
          `        SELECT id, title, org, organization, location, created_at\n` +
          `        FROM   public.jobs\n` +
          `        WHERE  (poster_url IS NULL OR poster_url = '')\n` +
          `          AND  active = true\n` +
          `        ORDER  BY created_at DESC;\n` +
          `  ➜ Then grant SELECT to anon:\n` +
          `      GRANT SELECT ON public.${VIEW_NAME} TO anon, authenticated;`
        );
        return { data: null, error, count: 0 };
      }

      console.error(`${MODULE} Error querying "${VIEW_NAME}":`, error.message);
      return { data: null, error, count: 0 };
    }

    return { data: data ?? [], error: null, count: count ?? (data?.length ?? 0) };
  } catch (err) {
    console.error(`${MODULE} Unexpected error fetching poster jobs:`, err);
    return { data: null, error: err, count: 0 };
  }
}

// ── Public API exposed on window ───────────────────────────────────────────

/**
 * window.PosterSystem — lightweight namespace for downstream poster modules
 * (poster-engine.js, poster-worker.js, poster-image.js, poster-sections.js).
 *
 * Populated after init(); downstream scripts can check window.PosterSystem.ready.
 */
window.PosterSystem = window.PosterSystem || {
  ready:       false,
  client:      null,   // set to window.supabaseClient after init
  pendingJobs: [],     // populated after first query
  totalPending: 0,
};

// ── Main initialiser ───────────────────────────────────────────────────────

async function init () {
  console.groupCollapsed(`${MODULE} Initialising Studyria Job Poster System…`);

  try {
    // 1. Wait for Supabase client (set by supabase.js)
    console.log(`${MODULE} Waiting for window.supabaseClient…`);
    const sb = await waitForSupabaseClient();
    console.log(`${MODULE} ✅ Supabase client found.`);

    // 2. Verify connection
    const connected = await verifyConnection(sb);
    if (!connected) {
      console.error(`${MODULE} ❌ Could not verify Supabase connection. Poster system will not start.`);
      console.groupEnd();
      return;
    }
    console.log(`${MODULE} ✅ Supabase connection verified.`);

    // 3. Query pending poster jobs
    console.log(`${MODULE} Querying view: ${VIEW_NAME}…`);
    const { data, error, count } = await fetchPendingPosterJobs(sb);

    if (error && !data) {
      // Already logged in fetchPendingPosterJobs; just mark as partially ready
      window.PosterSystem.ready  = false;
      window.PosterSystem.client = sb;
      console.warn(`${MODULE} ⚠️ Poster system partially initialised (view unavailable).`);
      console.groupEnd();
      return;
    }

    // 4. Update shared namespace
    window.PosterSystem.ready        = true;
    window.PosterSystem.client       = sb;
    window.PosterSystem.pendingJobs  = data ?? [];
    window.PosterSystem.totalPending = count;

    // 5. Console summary
    if (count === 0) {
      console.log(`${MODULE} ✅ No pending poster jobs — all jobs have posters.`);
    } else {
      console.log(
        `${MODULE} 📋 Total pending poster jobs: ${count}\n` +
        `  ➜ View: Supabase → "${VIEW_NAME}"\n` +
        `  ➜ Jobs awaiting posters:`,
        (data ?? []).slice(0, 10).map(j => `${j.id} — ${j.title} (${j.org ?? j.organization ?? '—'})`).join('\n     ')
      );
      if (count > 10) {
        console.log(`  … and ${count - 10} more.`);
      }
    }

    console.log(`${MODULE} 🚀 Job Poster System ready. Access via window.PosterSystem.`);

  } catch (err) {
    // Top-level safety net — nothing here should break the rest of Studyria
    console.error(`${MODULE} ❌ Initialisation failed (non-fatal):`, err);
  } finally {
    console.groupEnd();
  }
}

// ── Auto-start on page load ────────────────────────────────────────────────
// Uses DOMContentLoaded so the page shell renders first; supabase.js
// typically fires its own DOMContentLoaded listener which sets
// window.supabaseClient. We then poll for it via waitForSupabaseClient().

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  // DOM already ready (e.g. script injected dynamically)
  init();
}
