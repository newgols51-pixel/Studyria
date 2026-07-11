#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
// build/generate-static-pages.mjs
// ──────────────────────────────────────────────────────────────────
// Generates one static, crawlable HTML file per published PDF and
// per active job into /pdf/*.html and /job/*.html so GitHub Pages
// (a static host with no server-side rendering) can serve real,
// dedicated, SEO-friendly URLs for the MPA portion of the site.
//
// Uses the SAME public Supabase anon key already shipped client-side
// in supabase.js — this is a read-only, public-data query, so no new
// secret is required. Run via `node build/generate-static-pages.mjs`
// or via the provided GitHub Actions workflow.
//
// Does NOT touch index.html, sw.js, app.js, supabase.js, career-hub.js.
// ══════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname; // script + templates + generated /pdf,/job folders all live together in repo root

// ── Config — same public values already in supabase.js ────────────
const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://qsdfmgcekdpjdcyqhuhi.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzZGZtZ2Nla2RwamRjeXFodWhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NTE2NDcsImV4cCI6MjA5NjIyNzY0N30.kDOEYxUQyLTp1blasuX2kVSIy2olGLhdqqtOMTlEX5g';
const SITE_ORIGIN   = process.env.SITE_ORIGIN || 'https://studyria.qzz.io';

const PDF_STATUSES  = ['published']; // matches STATUSES in pdf-list.js exactly — keep in sync if that changes

const client = createClient(SUPABASE_URL, SUPABASE_ANON, {
  // Node 20 has no native WebSocket global — supabase-js's realtime
  // client throws at construction time without this, even though we
  // never actually use realtime subscriptions here (read-only queries
  // only). Same fix needed for the GitHub Actions runner (also Node 20).
  realtime: { transport: ws },
  auth: { persistSession: false },
});

// ── Helpers ─────────────────────────────────────────────────────
function slugify(str) {
  return String(str || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Collapse any run of whitespace (incl. accidental double-spaces from
// source data, e.g. "ADRE  3.0") down to a single space and trim ends.
// Fixes the "double space in title" bug flagged in the SEO audit.
function clean(str) {
  return String(str ?? '').replace(/\s+/g, ' ').trim();
}

// Build a meta description in the 120–160 char sweet spot. Truncates
// on a word boundary (never mid-word) and pads short source text with
// a generic-but-relevant closer so we don't ship <120-char descriptions.
function buildDescription(base, filler) {
  let desc = clean(base);
  if (desc.length < 120 && filler) desc = clean(`${desc} ${filler}`);
  if (desc.length <= 160) return desc;
  const cut = desc.slice(0, 160);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

// Scraped article/description fields sometimes contain leftover ad/CSS
// snippets (e.g. ".sn_responsive_1{width:...}", "@media(...){...}",
// "(adsbygoogle = window.adsbygoogle || []).push({});") instead of clean
// prose. Strip that noise so it never leaks into meta descriptions or
// JSON-LD — mirrors the smart-extraction approach already used client-side
// in career-hub.js for salary/date/vacancy fields.
function stripAdNoise(str) {
  return String(str ?? '')
    .replace(/\.[a-zA-Z][\w-]*\s*\{[^}]*\}/g, ' ')          // .sn_responsive_1{...}
    .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\}[^{}]*)*\}/g, ' ') // @media(...){ ... }
    .replace(/\(adsbygoogle[^)]*\)\.push\(\{\}\);?/g, ' ')   // adsbygoogle push snippet
    .replace(/<[^>]+>/g, ' ')                                   // stray HTML tags
    .replace(/\s+/g, ' ')
    .trim();
}

// Looks like ad/CSS junk rather than real prose (used to reject a
// "description" field scraped alongside the junk instead of clean text).
function looksLikeAdJunk(str) {
  const s = String(str ?? '').trim();
  if (!s) return true;
  return /^\.[a-zA-Z][\w-]*\s*\{/.test(s) || /@media\(/.test(s.slice(0, 60)) || /adsbygoogle/.test(s.slice(0, 120));
}

// Best-effort clean prose excerpt from a full scraped article body —
// used as the description source when the dedicated description field
// is empty or is itself ad/CSS junk.
function excerptFromArticle(articleText, maxLen = 200) {
  const cleaned = stripAdNoise(articleText);
  if (!cleaned) return '';
  // Find the first run of real sentence-like text (letters + spaces,
  // reasonably long) rather than starting mid-noise.
  const match = cleaned.match(/[A-Z][^.!?]{40,}[.!?]/);
  const start = match ? cleaned.indexOf(match[0]) : 0;
  return cleaned.slice(start, start + maxLen).trim();
}

async function readTemplate(name) {
  return fs.readFile(path.join(__dirname, name), 'utf8');
}

function fillTemplate(tpl, tokens) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : ''
  );
}

// Real (not fabricated) review aggregates from the public pdf_reviews
// table — same source powering the on-site rating stars. Google
// disallows AggregateRating with zero reviews, so callers must only
// use this when reviewCount > 0.
async function fetchReviewAggregates() {
  const map = new Map(); // pdf_id -> { avg, count }
  const { data, error } = await client.from('pdf_reviews').select('pdf_id, rating');
  if (error || !data) return map;
  const buckets = new Map();
  for (const row of data) {
    const r = Number(row.rating);
    if (!(r >= 1 && r <= 5)) continue;
    const arr = buckets.get(row.pdf_id) || [];
    arr.push(r);
    buckets.set(row.pdf_id, arr);
  }
  for (const [pdfId, ratings] of buckets) {
    const avg = Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10;
    map.set(pdfId, { avg, count: ratings.length });
  }
  return map;
}

// ── PDF pages ───────────────────────────────────────────────────
async function generatePdfPages() {
  const { data: rows, error } = await client
    .from('pdfs')
    .select('*')
    .in('status', PDF_STATUSES);

  if (error) {
    console.error('❌ Failed to fetch pdfs:', error.message);
    return [];
  }

  const reviewAgg = await fetchReviewAggregates();

  const tpl = await readTemplate('pdf-detail.template.html');
  const outDir = path.join(ROOT, 'pdf');
  await fs.mkdir(outDir, { recursive: true });

  const urls = [];
  for (const pdf of rows || []) {
    const title = clean(pdf.title);
    const category = clean(pdf.category || '');
    // ── Use DB 'slug' column directly (clean, permanent, no UUID suffix).
    //    Fallback to slugify(title) if slug is blank or suspiciously short (e.g. 'a').
    const rawDbSlug = String(pdf.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g,'');
    const slug = (rawDbSlug.length > 3 ? rawDbSlug : slugify(title)).slice(0, 80);
    const price = Number(pdf.price ?? 0);
    const filler = category
      ? `${category} study material — free & premium Assam govt exam PDF notes on Studyria.`
      : `Free & premium Assam government exam PDF notes on Studyria.`;
    const desc = buildDescription(
      pdf.description || `Download ${title} — study material on Studyria.`,
      filler
    );
    const cover = pdf.cover_url || pdf.cover_image || pdf.coverImage || `${SITE_ORIGIN}/og-cover.png`;
    const canonical = `${SITE_ORIGIN}/pdf/${slug}.html`;
    const agg = reviewAgg.get(pdf.id);

    const productSchema = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: title,
      description: desc,
      image: cover,
      sku: String(pdf.id),
      category: category || undefined,
      brand: { '@type': 'Brand', name: 'Studyria' },
      offers: {
        '@type': 'Offer',
        price: price.toFixed(2),
        priceCurrency: 'INR',
        availability: 'https://schema.org/InStock',
        url: canonical,
      },
      // Only include real, non-zero aggregates — never fabricate ratings.
      ...(agg && agg.count > 0
        ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: agg.avg, reviewCount: agg.count } }
        : {}),
    };

    const breadcrumbSchema = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Library', item: `${SITE_ORIGIN}/#library` },
        ...(category
          ? [{ '@type': 'ListItem', position: 3, name: category, item: `${SITE_ORIGIN}/#library?category=${encodeURIComponent(category)}` }]
          : []),
        { '@type': 'ListItem', position: category ? 4 : 3, name: title, item: canonical },
      ],
    };

    const html = fillTemplate(tpl, {
      TITLE: esc(title),
      DESCRIPTION: esc(desc),
      CANONICAL_URL: canonical,
      OG_IMAGE: esc(cover),
      PRICE: price.toFixed(2),
      CURRENCY: 'INR',
      CATEGORY: esc(category),
      PDF_ID: esc(pdf.id),
      PDF_ID_JSON: JSON.stringify(String(pdf.id)),
      CREATED_AT: pdf.created_at || '',
      JSON_LD: JSON.stringify([productSchema, breadcrumbSchema]),
    });

    await fs.writeFile(path.join(outDir, `${slug}.html`), html, 'utf8');
    urls.push(canonical);
  }

  console.log(`✅ Generated ${urls.length} /pdf/*.html pages`);
  return urls;
}

// ── Job pages ───────────────────────────────────────────────────
async function generateJobPages() {
  const { data: rows, error } = await client
    .from('jobs')
    .select('*')
    .eq('active', true);

  if (error) {
    console.error('❌ Failed to fetch jobs:', error.message);
    return [];
  }

  const tpl = await readTemplate('job-detail.template.html');
  const outDir = path.join(ROOT, 'job');
  await fs.mkdir(outDir, { recursive: true });

  const urls = [];
  for (const job of rows || []) {
    const title = clean(job.title);
    const org = clean(job.org || '');
    const location = clean(job.location || '');
    const rawJobSlug = String(job.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g,'');
    const slug = (rawJobSlug.length > 3 ? rawJobSlug : slugify(title)).slice(0, 80);
    // Prefer a clean job.description, but reject it if it's leftover ad/CSS
    // junk from scraping — fall back to a clean excerpt from the full
    // article body, then to a generic (but accurate) template line.
    const rawDesc = looksLikeAdJunk(job.description) ? '' : job.description;
    const descSource = rawDesc || excerptFromArticle(job.article_content) || `${title} at ${org} — apply on Studyria Career Hub.`;
    const desc = buildDescription(
      descSource,
      `Assam government job alert — apply online on Studyria Career Hub.`
    );
    const cover = job.imgUrl || `${SITE_ORIGIN}/og-cover.png`;
    const canonical = `${SITE_ORIGIN}/job/${slug}.html`;

    // Real field only — never invent a deadline that isn't in the source data.
    let validThrough;
    if (job.last_date) {
      const d = new Date(job.last_date);
      if (!Number.isNaN(d.getTime())) validThrough = d.toISOString();
    }

    const jobSchema = {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title,
      description: desc,
      identifier: { '@type': 'PropertyValue', name: org || 'Studyria Career Hub', value: String(job.id) },
      hiringOrganization: { '@type': 'Organization', name: org || 'Studyria Career Hub' },
      jobLocation: location
        ? {
            '@type': 'Place',
            address: {
              '@type': 'PostalAddress',
              addressLocality: location,
              addressRegion: 'Assam',
              addressCountry: 'IN',
            },
          }
        : undefined,
      datePosted: job.created_at || undefined,
      validThrough,
      directApply: !!job.applyLink,
    };

    const breadcrumbSchema = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Career Hub', item: `${SITE_ORIGIN}/#career-hub` },
        { '@type': 'ListItem', position: 3, name: title, item: canonical },
      ],
    };

    const html = fillTemplate(tpl, {
      TITLE: esc(title),
      ORG: esc(org),
      LOCATION: esc(location),
      DESCRIPTION: esc(desc),
      CANONICAL_URL: canonical,
      OG_IMAGE: esc(cover),
      JOB_ID: esc(job.id),
      JOB_ID_JSON: JSON.stringify(String(job.id)),
      APPLY_URL: esc(job.applyLink || ''),
      JSON_LD: JSON.stringify([jobSchema, breadcrumbSchema]),
    });

    await fs.writeFile(path.join(outDir, `${slug}.html`), html, 'utf8');
    urls.push(canonical);
  }

  console.log(`✅ Generated ${urls.length} /job/*.html pages`);
  return urls;
}

// ── Sitemap ─────────────────────────────────────────────────────
// Merges generated /pdf/ + /job/ URLs into the EXISTING sitemap.xml
// (which already has homepage/library/category/career-hub pages
// hand-maintained) instead of overwriting it. Only rewrites the
// generated-pages block between the markers below.
const GEN_START = '  <!-- ═══ AUTO-GENERATED PRODUCT/JOB PAGES (do not hand-edit below) ═══ -->';
const GEN_END   = '  <!-- ═══ END AUTO-GENERATED PAGES ═══ -->';

async function writeSitemap(urls) {
  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  let existing = await fs.readFile(sitemapPath, 'utf8').catch(() => null);

  const today = new Date().toISOString().slice(0, 10);
  const genBlock = [
    GEN_START,
    ...urls.map(u => `  <url>\n    <loc>${u}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>`),
    GEN_END,
  ].join('\n');

  let xml;
  if (existing && existing.includes(GEN_START) && existing.includes(GEN_END)) {
    // Replace previous auto-generated block only
    const startIdx = existing.indexOf(GEN_START);
    const endIdx = existing.indexOf(GEN_END) + GEN_END.length;
    xml = existing.slice(0, startIdx) + genBlock + existing.slice(endIdx);
  } else if (existing && existing.includes('</urlset>')) {
    // First run: inject block just before closing tag
    xml = existing.replace('</urlset>', `${genBlock}\n\n</urlset>`);
  } else {
    // No existing sitemap at all — create a minimal one
    xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `  <url><loc>${SITE_ORIGIN}/</loc></url>\n` +
      `${genBlock}\n` +
      `</urlset>\n`;
  }

  await fs.writeFile(sitemapPath, xml, 'utf8');
  console.log(`✅ Merged ${urls.length} generated URLs into sitemap.xml (existing pages preserved)`);
}

async function main() {
  const pdfUrls = await generatePdfPages();
  const jobUrls = await generateJobPages();
  await writeSitemap([...pdfUrls, ...jobUrls]);
}

main().catch(err => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
