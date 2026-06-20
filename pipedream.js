/* ════════════════════════════════════════════════════════════════════
   STUDYRIA — PIPEDREAM INTEGRATION
   ════════════════════════════════════════════════════════════════════
   TWO responsibilities:

   1. BROWSER CODE (runs in the app):
      window.sendToPipedream(payload)  — generic fire-and-forget webhook
      window.pipedream_onLogin(user)   — called on every sign-in

   2. PIPEDREAM WORKFLOW TEMPLATE (server-side, NOT browser code):
      The Node.js workflow at the bottom of this file runs on Pipedream's
      servers on a schedule. Copy it into a Pipedream "Node.js" step.
      It syncs AssamCareer RSS + other feeds → Supabase `jobs` table,
      using `source_id` upsert so reruns never create duplicates.
   ════════════════════════════════════════════════════════════════════ */

// ── Config ───────────────────────────────────────────────────────
window._PIPEDREAM_WEBHOOK_URL = window._PIPEDREAM_WEBHOOK_URL
  || 'https://eod16l3iacfjwl6.m.pipedream.net';

// ── Generic event sender ─────────────────────────────────────────
// Fire-and-forget: never blocks the UI, never throws into calling code.
// Usage: window.sendToPipedream({ event: 'pdf_download', pdf_id, email })
window.sendToPipedream = async function sendToPipedream(payload) {
  try {
    await fetch(window._PIPEDREAM_WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        ...payload,
        sent_at: new Date().toISOString(),
        source:  'studyria-app',
      }),
    });
  } catch (e) {
    console.warn('Pipedream webhook error:', e);
  }
};

// ── Login event helper ───────────────────────────────────────────
window.pipedream_onLogin = function pipedream_onLogin(user) {
  if (!user) return;
  window.sendToPipedream({ event: 'user_login', user_id: user.id, email: user.email });
};

/* ════════════════════════════════════════════════════════════════════
   CAREER HUB AUTO-SYNC — PIPEDREAM WORKFLOW (SERVER-SIDE ONLY)
   ════════════════════════════════════════════════════════════════════
   Setup:
     1. Pipedream → New Workflow → Trigger: Schedule (e.g. every 3 hours)
     2. Add a "Node.js" code step — paste the export below into it
     3. Set these environment variables in Pipedream:
          SUPABASE_URL          — your Supabase project URL
          SUPABASE_SERVICE_ROLE — service role key (bypasses RLS for writes)
          JSEARCH_API_KEY       — (optional) RapidAPI key for JSearch
     4. npm packages required in the step: @supabase/supabase-js fast-xml-parser

   What the workflow does:
     • Fetches AssamCareer RSS feed (primary source)
     • Fetches additional govt / fresher RSS feeds
     • Optionally fetches JSearch API for private/IT roles
     • Normalises every listing to the `jobs` table schema
       — sets `published_at` from the RSS <pubDate> field
       — sets `apply_url` and `link` from the RSS <link> field
       — sets `source_id` = stable dedupe key (link URL for RSS, job_id for JSearch)
     • Upserts on `source_id` — reruns are fully idempotent (no duplicates)
     • Once a row lands in `jobs`, every open Studyria tab updates
       instantly via the Supabase Realtime subscription in career-hub.js

   ── Paste into the Pipedream Node.js step: ──────────────────────── */

/*

import { createClient } from "@supabase/supabase-js";
import { XMLParser }    from "fast-xml-parser";

export default defineComponent({
  async run({ steps, $ }) {

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE   // service role bypasses RLS
    );

    const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: "__cdata" });
    const rawJobs = [];

    // ── Helper: safe string extract from parsed XML value ──────────
    const str = v => {
      if (!v) return "";
      if (typeof v === "string") return v.trim();
      if (v.__cdata) return String(v.__cdata).trim();
      return String(v).trim();
    };

    // ── Helper: fetch + parse an RSS feed ──────────────────────────
    async function fetchRSS(url, sourceName, mapFn) {
      try {
        const res  = await fetch(url, { headers: { "User-Agent": "StudyriaCareerHub/1.0" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml  = await res.text();
        const feed = parser.parse(xml);
        const items = feed?.rss?.channel?.item || feed?.feed?.entry || [];
        const list  = Array.isArray(items) ? items : [items];
        for (const item of list.slice(0, 50)) {
          const job = mapFn(item);
          if (job) rawJobs.push(job);
        }
      } catch (e) {
        console.warn(`RSS fetch failed for ${sourceName} (${url}):`, e.message);
      }
    }

    // ── Source 1: AssamCareer RSS (primary) ───────────────────────
    await fetchRSS(
      "https://assamcareer.in/feed",   // ← update URL if different
      "AssamCareer",
      item => {
        const title = str(item.title);
        const link  = str(item.link || item.guid);
        if (!title || !link) return null;
        return {
          title,
          org:           str(item["dc:creator"] || item.author) || "AssamCareer",
          org_icon:      "🗺️",
          location:      "Assam",
          qualification: "Varies — see notification",
          salary:        "",
          last_date:     null,
          category:      ["govt", "assam"],
          featured:      false,
          is_new:        true,
          apply_url:     link,
          link,                            // keep both columns in sync
          vacancies:     null,
          description:   str(item.description || item.summary || "").slice(0, 600),
          source:        "rss",
          source_id:     link,             // stable dedupe key
          active:        true,
          published_at:  item.pubDate ? new Date(str(item.pubDate)).toISOString() : null,
        };
      }
    );

    // ── Source 2: Sarkari Result RSS ──────────────────────────────
    await fetchRSS(
      "https://www.sarkariresult.com/rss.xml",
      "SarkariResult",
      item => {
        const title = str(item.title);
        const link  = str(item.link || item.guid);
        if (!title || !link) return null;
        return {
          title,
          org:           "Sarkari Result",
          org_icon:      "🏛️",
          location:      "National",
          qualification: "Varies — see notification",
          salary:        "",
          last_date:     null,
          category:      ["govt"],
          featured:      false,
          is_new:        true,
          apply_url:     link,
          link,
          vacancies:     null,
          description:   str(item.description || "").slice(0, 600),
          source:        "rss",
          source_id:     link,
          active:        true,
          published_at:  item.pubDate ? new Date(str(item.pubDate)).toISOString() : null,
        };
      }
    );

    // ── Source 3: FreshersWorld RSS ───────────────────────────────
    await fetchRSS(
      "https://www.freshersworld.com/feed",
      "FreshersWorld",
      item => {
        const title = str(item.title);
        const link  = str(item.link || item.guid);
        if (!title || !link) return null;
        return {
          title,
          org:           "FreshersWorld",
          org_icon:      "🌱",
          location:      "Pan India",
          qualification: "Graduate",
          salary:        "",
          last_date:     null,
          category:      ["freshers", "private"],
          featured:      false,
          is_new:        true,
          apply_url:     link,
          link,
          vacancies:     null,
          description:   str(item.description || "").slice(0, 600),
          source:        "rss",
          source_id:     link,
          active:        true,
          published_at:  item.pubDate ? new Date(str(item.pubDate)).toISOString() : null,
        };
      }
    );

    // ── Source 4: Employment News RSS ─────────────────────────────
    await fetchRSS(
      "https://www.employmentnews.gov.in/rss/EN.xml",
      "EmploymentNews",
      item => {
        const title = str(item.title);
        const link  = str(item.link || item.guid);
        if (!title || !link) return null;
        return {
          title,
          org:           "Employment News (Govt of India)",
          org_icon:      "📰",
          location:      "National",
          qualification: "Varies — see notification",
          salary:        "",
          last_date:     null,
          category:      ["govt"],
          featured:      false,
          is_new:        true,
          apply_url:     link,
          link,
          vacancies:     null,
          description:   str(item.description || "").slice(0, 600),
          source:        "rss",
          source_id:     link,
          active:        true,
          published_at:  item.pubDate ? new Date(str(item.pubDate)).toISOString() : null,
        };
      }
    );

    // ── Source 5: JSearch API — private / IT roles (optional) ─────
    if (process.env.JSEARCH_API_KEY) {
      try {
        const res  = await fetch(
          "https://jsearch.p.rapidapi.com/search?query=fresher+jobs+india&page=1&num_pages=1",
          {
            headers: {
              "X-RapidAPI-Key":  process.env.JSEARCH_API_KEY,
              "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
            },
          }
        );
        const json = await res.json();
        for (const j of (json.data || [])) {
          rawJobs.push({
            title:         j.job_title,
            org:           j.employer_name,
            org_icon:      "💼",
            location:      j.job_city || j.job_country || "India",
            qualification: "Graduate",
            salary:        j.job_min_salary && j.job_max_salary
              ? `₹${j.job_min_salary} – ₹${j.job_max_salary}`
              : "",
            last_date:     j.job_offer_expiration_datetime_utc || null,
            category:      ["private", "it", "freshers"],
            featured:      false,
            is_new:        true,
            apply_url:     j.job_apply_link,
            link:          j.job_apply_link,
            vacancies:     null,
            description:   (j.job_description || "").slice(0, 600),
            source:        "jsearch",
            source_id:     j.job_id,
            active:        true,
            published_at:  j.job_posted_at_datetime_utc
              ? new Date(j.job_posted_at_datetime_utc).toISOString()
              : null,
          });
        }
      } catch (e) {
        console.warn("JSearch fetch failed:", e.message);
      }
    }

    // ── Upsert — deduplicates on source_id, idempotent reruns ─────
    if (!rawJobs.length) {
      console.log("No jobs fetched this run.");
      return { upserted: 0 };
    }

    // Batch in chunks of 100 to avoid request-body limits
    let totalUpserted = 0;
    for (let i = 0; i < rawJobs.length; i += 100) {
      const chunk = rawJobs.slice(i, i + 100);
      const { error, count } = await supabase
        .from("jobs")
        .upsert(chunk, { onConflict: "source_id", count: "exact" });
      if (error) {
        console.error("Supabase upsert error (chunk " + i + "):", error);
      } else {
        totalUpserted += count || chunk.length;
      }
    }

    console.log(`Career Hub sync complete. Upserted ${totalUpserted} jobs.`);
    return { upserted: totalUpserted, total_fetched: rawJobs.length };
  },
});

*/
/* ════════════════════════════════════════════════════════════════════ */
