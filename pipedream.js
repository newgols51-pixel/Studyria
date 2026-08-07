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
      now downloading and cleaning each FULL ARTICLE (not just the link)
      so Studyria never has to redirect users to AssamCareer to read a
      job notification. Uses `source_url` upsert so reruns never create
      duplicates. Only apply_url / notification_link / official_website
      are ever saved as "open externally" links.
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
   CAREER HUB FULL-ARTICLE IMPORT — PIPEDREAM WORKFLOW (SERVER-SIDE ONLY)
   ════════════════════════════════════════════════════════════════════
   Setup:
     1. Pipedream → New Workflow → Trigger: Schedule (e.g. every 3 hours)
        OR Trigger: "New Item in RSS Feed" pointed at the AssamCareer feed
     2. Add a "Node.js" code step — paste the export below into it
     3. Set these environment variables in Pipedream:
          SUPABASE_URL          — your Supabase project URL
          SUPABASE_SERVICE_ROLE — service role key (bypasses RLS for writes)
          JSEARCH_API_KEY       — (optional) RapidAPI key for JSearch
     4. npm packages required in the step:
          @supabase/supabase-js  fast-xml-parser  cheerio
     5. Run supabase-migration.sql once (adds article_content, organization,
        source_url, scrape_status, scraped_at to the `jobs` table)

   What changed vs. the old link-only sync:
     • No more "store the AssamCareer link and redirect users to it."
       Every RSS item now gets its full article HTML downloaded, cleaned
       (ads/scripts/popups/nav/share-bars/forms stripped, every <a> inside
       the body unwrapped so the article text can't link back out), and
       saved into `article_content`.
     • Structured fields (organization, qualification, age_limit,
       application_fee, important_dates, vacancy_details) are extracted
       from the cleaned article text with label-matching regex.
     • Only apply_url, notification_link, and official_website are ever
       saved as "open externally" links — career-hub.js only renders
       those three as outbound buttons; everything else stays readable
       inside Studyria.
     • Upserts on `source_url` (falls back to `source_id`/link) — reruns
       are fully idempotent, no duplicates.
     • Failed scrapes are saved with active:false + scrape_status:'failed'
       so they don't show up in Career Hub until the selectors are fixed.
     • Once a row lands in `jobs`, every open Studyria tab updates
       instantly via the Supabase Realtime subscription in career-hub.js

   ── Paste into the Pipedream Node.js step: ──────────────────────── */

/*

import { createClient } from "@supabase/supabase-js";
import { XMLParser }    from "fast-xml-parser";
import * as cheerio     from "cheerio";

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

    // ── Helper: fetch full article HTML and return cleaned body + text ─
    // Strips ads, scripts, popups, share bars, forms, nav — leaves only
    // the actual notification content. Every <a> inside the body is
    // unwrapped (text kept, href dropped) so reading the article can
    // never tap through to the source site by accident.
    const ARTICLE_SELECTORS = [
      "article .entry-content",
      "article .post-content",
      ".entry-content",
      ".post-content",
      ".td-post-content",
      "article",
    ];
    const STRIP_SELECTORS = [
      "script", "style", "noscript", "iframe", "ins", ".adsbygoogle",
      "[id*='ad-' i]", "[class*='ad-' i]", "[class*='advert' i]",
      ".sharedaddy", ".jp-relatedposts", ".td-post-sharing",
      ".td-post-source-tags", ".social-share", ".share-buttons",
      ".newsletter-signup", ".popup", ".modal", "form", "nav",
      "header", "footer", ".breadcrumb", ".breadcrumbs",
      ".comments-area", "#comments", ".related-posts",
      ".wp-block-buttons", "[onclick]",
    ];

    async function fetchAndCleanArticle(url) {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          },
          redirect: "follow",
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

        const html  = await res.text();
        const $page = cheerio.load(html);

        let $article = null;
        for (const sel of ARTICLE_SELECTORS) {
          const found = $page(sel).first();
          if (found.length && found.text().trim().length > 200) { $article = found; break; }
        }
        if (!$article) return { ok: false, error: "No article body found" };

        STRIP_SELECTORS.forEach(sel => $article.find(sel).remove());
        $article.find("*").each((_, el) => {
          const $el = $page(el);
          ["onclick","onerror","onload","style","data-src-orig"].forEach(a => $el.removeAttr(a));
        });
        $article.find("p").each((_, el) => { if (!$page(el).text().trim()) $page(el).remove(); });
        $article.find("img").each((_, el) => {
          const $img = $page(el);
          const real = $img.attr("data-src") || $img.attr("data-lazy-src") || $img.attr("src");
          if (real) $img.attr("src", real);
          $img.removeAttr("data-src").removeAttr("data-lazy-src").removeAttr("srcset");
          $img.attr("loading", "lazy");
        });
        $article.find("a").each((_, el) => {
          const $a = $page(el);
          $a.replaceWith($a.html() || $a.text());   // unwrap — never link back out
        });

        const cleanedHtml = $article.html()?.trim() || "";
        const plainText   = $article.text().replace(/\s+/g, " ").trim();
        return { ok: !!cleanedHtml, articleContent: cleanedHtml, plainText };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    // ── Helper: pull "Label: value" style fields out of article text ──
    function extractStructuredFields(text, rssItem) {
      const grab = labels => {
        for (const label of labels) {
          const re = new RegExp(`${label}\\s*[:\\-–]\\s*([^\\n]+?)(?=\\s{2,}|$|\\.(?:\\s[A-Z])|\\n)`, "i");
          const m = text.match(re);
          if (m && m[1]) return m[1].trim().replace(/\s{2,}/g, " ");
        }
        return null;
      };
      const urlInText = label => {
        const m = text.match(new RegExp(`${label}[^h]{0,40}(https?:\\/\\/[^\\s)<]+)`, "i"));
        return m ? m[1].replace(/[.,]+$/, "") : null;
      };

      const organization = grab(["Organization","Department","Recruiting Body","Board"])
        || rssItem.title?.split(/recruitment|invites|notification/i)[0]?.trim() || null;

      const dateLines = [...text.matchAll(/([A-Za-z .]{3,40}Date[s]?)\s*[:\-–]\s*([0-9]{1,2}[\/\-. ][A-Za-z0-9]{2,9}[\/\-. ][0-9]{2,4})/gi)]
        .map(([, label, date]) => `${label.trim()}: ${date.trim()}`);

      return {
        organization,
        qualification:   grab(["Educational Qualification","Qualification","Eligibility"]),
        ageLimit:        grab(["Age Limit","Age Criteria","Age"]),
        applicationFee:  grab(["Application Fee","Examination Fee","Fee"]),
        vacancyDetails:  grab(["Total Vacancy","No\\.? of Posts","Number of Posts","Total Post","Vacancy Details"]),
        lastDateRaw:     grab(["Last Date to Apply","Last Date for Submission","Last Date","Closing Date"]),
        importantDates:  dateLines.length ? dateLines.join("\n") : null,
        applyLink:        urlInText("Apply") || grab(["Apply Online","Apply Link","Registration Link"]) || rssItem.link,
        notificationLink: urlInText("Notification") || grab(["Notification PDF","Official Notification","Download Notification"]),
        officialWebsite:  urlInText("Official Website") || grab(["Official Website","Website"]),
      };
    }

    // ── Helper: fetch + parse an RSS feed, then fetch+clean each article ─
    async function fetchRSS(url, sourceName, defaults) {
      try {
        const res  = await fetch(url, { headers: { "User-Agent": "StudyriaCareerHub/1.0" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml   = await res.text();
        const feed  = parser.parse(xml);
        const items = feed?.rss?.channel?.item || feed?.feed?.entry || [];
        const list  = Array.isArray(items) ? items : [items];

        for (const raw of list.slice(0, 50)) {
          const title = str(raw.title);
          const link  = str(raw.link || raw.guid);
          if (!title || !link) continue;

          const article = await fetchAndCleanArticle(link);
          const fields  = extractStructuredFields(
            article.plainText || str(raw.description || raw.summary || ""),
            { title, link }
          );

          let lastDateIso = null;
          if (fields.lastDateRaw) {
            const d = new Date(fields.lastDateRaw);
            if (!isNaN(d.getTime())) lastDateIso = d.toISOString().slice(0, 10);
          }

          const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);

          rawJobs.push({
            title,
            slug,
            org:                defaults.org || fields.organization || sourceName,
            organization:       fields.organization || defaults.org || sourceName,
            org_icon:           defaults.org_icon,
            location:           defaults.location,
            qualification:      fields.qualification || defaults.qualification,
            age_limit:          fields.ageLimit,
            application_fee:    fields.applicationFee,
            important_dates:    fields.importantDates,
            vacancy_details:    fields.vacancyDetails,
            salary:             "",
            last_date:          lastDateIso,
            category:           defaults.category,
            featured:           false,
            is_new:             true,
            apply_url:          fields.applyLink || link,
            notification_link:  fields.notificationLink,
            official_website:   fields.officialWebsite,
            link,                                  // legacy column, kept in sync
            vacancies:          null,
            description:        (article.plainText || str(raw.description || "")).slice(0, 400),
            article_content:    article.ok ? article.articleContent : null,
            source:             "rss",
            source_id:          link,
            source_url:         link,
            active:             article.ok,         // failed scrapes stay hidden until fixed
            scrape_status:      article.ok ? "ok" : "failed",
            scraped_at:         new Date().toISOString(),
            published_at:       raw.pubDate ? new Date(str(raw.pubDate)).toISOString() : new Date().toISOString(),
          });

          // Be polite to the source site — avoid hammering it with rapid
          // back-to-back article fetches.
          await new Promise(r => setTimeout(r, 800));
        }
      } catch (e) {
        console.warn(`RSS fetch failed for ${sourceName} (${url}):`, e.message);
      }
    }

    // ── Source 1: AssamCareer RSS (primary — full article import) ────
    await fetchRSS(
      "https://assamcareer.in/feed",   // ← update URL if different
      "AssamCareer",
      { org: null, org_icon: "🗺️", location: "Assam", qualification: "Varies — see notification", category: ["govt","assam"] }
    );

    // ── Source 2: Sarkari Result RSS ──────────────────────────────
    await fetchRSS(
      "https://www.sarkariresult.com/rss.xml",
      "SarkariResult",
      { org: "Sarkari Result", org_icon: "🏛️", location: "National", qualification: "Varies — see notification", category: ["govt"] }
    );

    // ── Source 3: FreshersWorld RSS ───────────────────────────────
    await fetchRSS(
      "https://www.freshersworld.com/feed",
      "FreshersWorld",
      { org: "FreshersWorld", org_icon: "🌱", location: "Pan India", qualification: "Graduate", category: ["freshers","private"] }
    );

    // ── Source 4: Employment News RSS ─────────────────────────────
    await fetchRSS(
      "https://www.employmentnews.gov.in/rss/EN.xml",
      "EmploymentNews",
      { org: "Employment News (Govt of India)", org_icon: "📰", location: "National", qualification: "Varies — see notification", category: ["govt"] }
    );

    // ── Source 5: JSearch API — private / IT roles (optional) ─────
    // No full-article import here (JSearch returns a structured API
    // response, not an HTML notification page) — kept as link + summary.
    if (process.env.JSEARCH_API_KEY) {
      try {
        const res  = await fetch(
          "https://jsearch.p.rapidapi.com/search?query=fresher+jobs+india&page=1&num_pages=1",
          { headers: { "X-RapidAPI-Key": process.env.JSEARCH_API_KEY, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" } }
        );
        const json = await res.json();
        for (const j of (json.data || [])) {
          rawJobs.push({
            title:         j.job_title,
            org:           j.employer_name,
            organization:  j.employer_name,
            org_icon:      "💼",
            location:      j.job_city || j.job_country || "India",
            qualification: "Graduate",
            salary:        j.job_min_salary && j.job_max_salary ? `₹${j.job_min_salary} – ₹${j.job_max_salary}` : "",
            last_date:     j.job_offer_expiration_datetime_utc || null,
            category:      ["private","it","freshers"],
            featured:      false,
            is_new:        true,
            apply_url:     j.job_apply_link,
            official_website: null,
            notification_link: null,
            link:          j.job_apply_link,
            vacancies:     null,
            description:   (j.job_description || "").slice(0, 400),
            article_content: null,
            source:        "jsearch",
            source_id:     j.job_id,
            source_url:    j.job_apply_link,
            active:        true,
            scrape_status: "ok",
            scraped_at:    new Date().toISOString(),
            published_at:  j.job_posted_at_datetime_utc ? new Date(j.job_posted_at_datetime_utc).toISOString() : null,
          });
        }
      } catch (e) {
        console.warn("JSearch fetch failed:", e.message);
      }
    }

    // ── Upsert — deduplicates on source_url, idempotent reruns ────
    if (!rawJobs.length) {
      console.log("No jobs fetched this run.");
      return { upserted: 0 };
    }

    let totalUpserted = 0;
    for (let i = 0; i < rawJobs.length; i += 100) {
      const chunk = rawJobs.slice(i, i + 100);
      const { error, count } = await supabase
        .from("jobs")
        .upsert(chunk, { onConflict: "source_url", count: "exact" });
      if (error) {
        console.error("Supabase upsert error (chunk " + i + "):", error);
      } else {
        totalUpserted += count || chunk.length;
      }
    }

    const failedCount = rawJobs.filter(j => j.scrape_status === "failed").length;
    console.log(`Career Hub full-article sync complete. Upserted ${totalUpserted} jobs (${failedCount} failed scrape — saved inactive for review).`);
    return { upserted: totalUpserted, total_fetched: rawJobs.length, failed_scrapes: failedCount };
  },
});

*/
/* ════════════════════════════════════════════════════════════════════ */
