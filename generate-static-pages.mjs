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

async function readTemplate(name) {
  return fs.readFile(path.join(__dirname, name), 'utf8');
}

function fillTemplate(tpl, tokens) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : ''
  );
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

  const tpl = await readTemplate('pdf-detail.template.html');
  const outDir = path.join(ROOT, 'pdf');
  await fs.mkdir(outDir, { recursive: true });

  const urls = [];
  for (const pdf of rows || []) {
    const slug = `${slugify(pdf.title)}-${pdf.id}`;
    const price = Number(pdf.price ?? 0);
    const desc = (pdf.description || `Download ${pdf.title} — study material on Studyria.`).slice(0, 155);
    const cover = pdf.cover_image || pdf.coverImage || `${SITE_ORIGIN}/og-cover.png`;
    const canonical = `${SITE_ORIGIN}/pdf/${slug}.html`;

    const html = fillTemplate(tpl, {
      TITLE: esc(pdf.title),
      DESCRIPTION: esc(desc),
      CANONICAL_URL: canonical,
      OG_IMAGE: esc(cover),
      PRICE: price.toFixed(2),
      CURRENCY: 'INR',
      CATEGORY: esc(pdf.category || ''),
      PDF_ID: esc(pdf.id),
      PDF_ID_JSON: JSON.stringify(String(pdf.id)),
      CREATED_AT: pdf.created_at || '',
      JSON_LD: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: pdf.title,
        description: desc,
        image: cover,
        offers: {
          '@type': 'Offer',
          price: price.toFixed(2),
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
          url: canonical,
        },
      }),
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
    const slug = `${slugify(job.title)}-${job.id}`;
    const desc = (job.description || `${job.title} at ${job.org} — apply on Studyria Career Hub.`).slice(0, 155);
    const cover = job.imgUrl || `${SITE_ORIGIN}/og-cover.png`;
    const canonical = `${SITE_ORIGIN}/job/${slug}.html`;

    const html = fillTemplate(tpl, {
      TITLE: esc(job.title),
      ORG: esc(job.org || ''),
      LOCATION: esc(job.location || ''),
      DESCRIPTION: esc(desc),
      CANONICAL_URL: canonical,
      OG_IMAGE: esc(cover),
      JOB_ID: esc(job.id),
      JOB_ID_JSON: JSON.stringify(String(job.id)),
      APPLY_URL: esc(job.applyLink || ''),
      JSON_LD: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'JobPosting',
        title: job.title,
        description: desc,
        hiringOrganization: { '@type': 'Organization', name: job.org },
        jobLocation: job.location
          ? { '@type': 'Place', address: job.location }
          : undefined,
        datePosted: job.created_at || undefined,
        directApply: !!job.applyLink,
      }),
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
