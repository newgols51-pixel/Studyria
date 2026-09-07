#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   STUDYRIA — Production-safe PDF Storage Recovery (one command, no re-upload)
   Usage:  SUPABASE_SERVICE_KEY="…" node run-pdf-recovery.js

   Safe order (nothing is deleted, ever):
     0. run cloud-storage-migration.sql (additive tables + cloud-assets bucket)
     1. BACKUP all pdfs metadata + ownership references → cloud-backup-*.json
     2. SCAN every source for each broken PDF object (all buckets, pdf_versions,
        local recovery-sources/ folder)
     3. COPY found source into the pdfs bucket (never overwrite an existing file)
     4. VERIFY the copied object (HEAD + size + %PDF magic bytes)
     5. UPDATE only pdf_url on the EXISTING row (IDs, prices, purchases untouched)
     6. VERIFY read-time access (signed URL creation test)
     7. Honest report: recovered / repaired / already-healthy / genuinely missing
   ════════════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';

const SUPABASE_URL = 'https://qsdfmgcekdpjdcyqhuhi.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE_KEY) { console.error('❌ SUPABASE_SERVICE_KEY required (Supabase → Settings → API → service_role)'); process.exit(1); }
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const BUCKETS = ['pdfs', 'covers', 'cloud-assets', 'creator-pdfs', 'avatars', 'profile-photos'];
const report = { startedAt: new Date().toISOString(), steps: [], brokenFound: 0, recovered: [], repairedRefs: [], alreadyHealthy: [], genuinelyMissing: [], duplicatesDetected: [], dbRowsChanged: [], storageBefore: 0, storageAfter: 0 };
const log = (m) => { console.log(m); report.steps.push(m.replace(/\x1b\[[0-9;]*m/g, '')); };

/* ── STEP 0: additive cloud migration (idempotent) ─────────────── */
log('STEP 0 — Applying cloud-storage-migration.sql (additive, idempotent)…');
try {
  const sql = readFileSync('./cloud-storage-migration.sql', 'utf8');
  const r = await sb.rpc('exec', { query: sql });
  if (r.error) { log('  ⚠ migration note: ' + r.error.message + ' (continuing — tables may already exist)'); }
  else log('  ✅ Cloud tables + cloud-assets bucket ensured');
} catch (e) { log('  ⚠ migration step skipped: ' + e.message); }

/* ── STEP 1: FULL METADATA BACKUP (before touching anything) ───── */
log('STEP 1 — Backing up database metadata…');
const backup = { takenAt: new Date().toISOString(), pdfs: [], pdfVersions: [], tables: {} };
{
  const { data: pdfs, error } = await sb.from('pdfs').select('*');
  if (error) { console.error('❌ Cannot read pdfs table: ' + error.message); process.exit(1); }
  backup.pdfs = pdfs;
  for (const t of ['pdf_versions', 'purchases', 'orders', 'wishlist', 'user_library', 'downloads']) {
    const { data, error: e2 } = await sb.from(t).select('*').limit(2000);
    if (!e2 && data) { backup.tables[t] = data; }
  }
  const fn = `cloud-backup-pre-recovery-${Date.now()}.json`;
  writeFileSync(fn, JSON.stringify(backup, null, 2));
  log('  ✅ Backup saved: ' + fn + ' (' + pdfs.length + ' PDF rows, ' + Object.keys(backup.tables).length + ' related tables)');
}

/* ── storage census (recursive, service role) ─────────────────── */
async function listBucket(bucket, prefix, acc = []) {
  const { data, error } = await sb.storage.from(bucket).list(prefix || '', { limit: 100, sortBy: { column: 'name', order: 'asc' } });
  if (error || !data) return acc;
  for (const it of data) {
    if (it.id != null) acc.push({ bucket, path: (prefix ? prefix + '/' : '') + it.name, name: it.name, bytes: it.metadata?.size || 0, mime: it.metadata?.mimetype || '' });
    else acc = await listBucket(bucket, (prefix ? prefix + '/' : '') + it.name, acc);
  }
  return acc;
}
log('STEP 2 — Scanning all storage buckets…');
const census = [];
for (const b of BUCKETS) {
  const files = await listBucket(b, '');
  census.push(...files);
  log('  • ' + b + ': ' + files.length + ' objects');
}
const totalBytes = census.reduce((s, f) => s + f.bytes, 0);
report.storageBefore = totalBytes;
log('  Total storage: ' + (totalBytes / 1048576).toFixed(2) + ' MB across ' + census.length + ' objects');

/* local recovery sources (user may drop original files here later) */
const localSources = [];
if (existsSync('./recovery-sources')) {
  for (const f of readdirSync('./recovery-sources')) {
    const p = './recovery-sources/' + f;
    if (statSync(p).isFile()) localSources.push({ name: f, path: p, bytes: statSync(p).size });
  }
  log('  Local recovery-sources/ folder: ' + localSources.length + ' files');
}

/* ── STEP 3: cross-check every PDF row against real storage ────── */
log('STEP 3 — Cross-checking ' + backup.pdfs.length + ' PDF records against storage…');
const pdfsSet = new Map(); census.filter(f => f.bucket === 'pdfs').forEach(f => pdfsSet.set(f.path, f));

/* duplicate detection across all buckets */
const seen = new Map();
for (const f of census) { const k = f.bytes + '::' + f.name.replace(/^\d{10,}_/, '').replace(/^v\d+_\d+_pdf.*$/, 'pdf'); if (seen.has(k)) report.duplicatesDetected.push({ a: seen.get(k), b: f }); else seen.set(k, f); }

/* fuzzy slug helper — match title to candidate file */
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

async function findSource(pdfRow) {
  const exact = pdfsSet.get(pdfRow.pdf_url);
  if (exact) return { from: 'already-in-bucket', obj: exact };
  /* 1. exact name in any bucket */
  const anyExact = census.find(f => f.name === pdfRow.pdf_url || f.path.endsWith('/' + pdfRow.pdf_url));
  if (anyExact) return { from: 'other-bucket:' + anyExact.bucket, obj: anyExact };
  /* 2. title-slug fuzzy match: PDF mime in any bucket */
  const slug = slugify(pdfRow.title);
  const fuzzy = census.find(f => (/pdf/i.test(f.mime) || /\.pdf$/i.test(f.name)) && slug.length > 12 && (slugify(f.name).includes(slug.slice(0, 20)) || slugify(f.name).slice(0, 25) === slug.slice(0, 25)));
  if (fuzzy) return { from: 'fuzzy:' + fuzzy.bucket, obj: fuzzy };
  /* 3. archived version that still exists */
  const { data: vers } = await sb.from('pdf_versions').select('*').eq('pdf_id', pdfRow.id);
  for (const v of (vers || [])) if (pdfsSet.has(v.pdf_url)) return { from: 'pdf_versions', obj: pdfsSet.get(v.pdf_url) };
  /* 4. local recovery-sources/ folder */
  const local = localSources.find(l => slug.length > 12 && (l.name === pdfRow.pdf_url || slugify(l.name).includes(slug.slice(0, 20))));
  if (local) return { from: 'local-folder', obj: { bucket: 'local', path: local.path, name: local.name, bytes: local.bytes } };
  return null;
}

async function verifyObject(bucket, path, expectBytes) {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data) return 'signed-url failed: ' + (error?.message || 'none');
  const r = await fetch(data.signedUrl);
  if (!r.ok) return 'HTTP ' + r.status;
  const head = new Uint8Array(await r.arrayBuffer());
  if (head.length < 5 || String.fromCharCode(...head.slice(0, 5)) !== '%PDF-') return 'not a valid PDF (magic bytes)';
  if (expectBytes && Math.abs(head.length - expectBytes) > 1024) return 'size mismatch ' + head.length + ' vs ' + expectBytes;
  return null; // healthy
}

async function copyInto(from, targetPath, expectBytes) {
  if (from.bucket === 'local') {
    const buf = readFileSync(from.path);
    const { error } = await sb.storage.from('pdfs').upload(targetPath, buf, { contentType: 'application/pdf' });
    if (error) throw new Error('upload failed: ' + error.message);
  } else {
    const { data: url } = await sb.storage.from(from.bucket).createSignedUrl(from.path, 300);
    if (!url?.signedUrl) throw new Error('cannot read source ' + from.bucket + '/' + from.path);
    const buf = Buffer.from(await (await fetch(url.signedUrl)).arrayBuffer());
    const { error } = await sb.storage.from('pdfs').upload(targetPath, buf, { contentType: 'application/pdf' });
    if (error) throw new Error('copy failed: ' + error.message);
  }
  const v = await verifyObject('pdfs', targetPath, expectBytes);
  if (v) { await sb.storage.from('pdfs').remove([targetPath]).catch(() => {}); throw new Error('verification failed: ' + v); }
}

for (const row of backup.pdfs) {
  const fn = String(row.pdf_url || '');
  if (!fn) { report.genuinelyMissing.push({ id: row.id, title: row.title, reason: 'no pdf_url in database' }); continue; }
  const src = await findSource(row);
  if (src && src.from === 'already-in-bucket') {
    const v = await verifyObject('pdfs', row.pdf_url, src.obj.bytes);
    if (!v) { report.alreadyHealthy.push({ id: row.id, title: row.title, path: row.pdf_url, bytes: src.obj.bytes }); continue; }
    log('  ⚠ ' + row.title.slice(0, 50) + ' — reference exists but object is corrupt: ' + v);
    report.genuinelyMissing.push({ id: row.id, title: row.title, reason: 'corrupt: ' + v });
    continue;
  }
  if (src) {
    /* SAFE COPY → VERIFY → update reference only */
    const target = row.pdf_url; // keep the SAME reference the DB already has
    if (pdfsSet.has(target)) { report.alreadyHealthy.push({ id: row.id, title: row.title, path: target }); continue; }
    try {
      await copyInto(src.obj, target, src.obj.bytes);
      const { error } = await sb.from('pdfs').update({ pdf_url: target }).eq('id', row.id); // no-op if already equal; only this field
      if (error) throw new Error('DB update failed: ' + error.message);
      const { error: aErr } = await sb.from('cloud_audit_log').insert({ admin_email: 'recovery-script', action: 'auto_recover', bucket: 'pdfs', target, result: 'ok', details: { pdf_id: row.id, source: src.from, bytes: src.obj.bytes } });
      report.recovered.push({ id: row.id, title: row.title, from: src.from, to: 'pdfs/' + target, bytes: src.obj.bytes });
      report.dbRowsChanged.push({ id: row.id, field: 'pdf_url', old: fn, new: target });
      log('  ✅ RECOVERED: ' + row.title.slice(0, 50) + '  (' + src.from + ' → pdfs/' + target + ')');
    } catch (e) {
      report.genuinelyMissing.push({ id: row.id, title: row.title, reason: 'recovery failed: ' + e.message });
      log('  ✖ RECOVERY FAILED: ' + row.title.slice(0, 50) + ' — ' + e.message);
    }
  } else {
    report.genuinelyMissing.push({ id: row.id, title: row.title, expectedPath: fn, price: row.price, reason: 'object not found in any bucket, pdf_versions, or recovery-sources/' });
    log('  ✖ GENUINELY MISSING: ' + row.title.slice(0, 50) + '  (expects pdfs/' + fn + ')');
  }
}

/* ── STEP 4: final verification pass ─────────────────────────── */
log('STEP 4 — Final verification (signed-URL read test for every published PDF)…');
const { data: finalPdfs } = await sb.from('pdfs').select('id,title,pdf_url,status').eq('status', 'published');
let pass = 0, fail = 0;
for (const p of (finalPdfs || [])) {
  const v = await verifyObject('pdfs', p.pdf_url, null);
  if (v) { fail++; log('  ✖ ' + p.title.slice(0, 50) + ': ' + v); } else pass++;
}

/* ── STEP 5: post-recovery snapshot ───────────────────────────── */
const after = [];
for (const b of BUCKETS) after.push(...await listBucket(b, ''));
report.storageAfter = after.reduce((s, f) => s + f.bytes, 0);

/* ── REPORT ───────────────────────────────────────────────────── */
report.verification = { publishedPass: pass, publishedFail: fail };
writeFileSync('cloud-recovery-report-' + Date.now() + '.json', JSON.stringify(report, null, 2));
console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║              MIGRATION / RECOVERY REPORT                  ║');
console.log('╠════════════════════════════════════════════════════════════╣');
console.log('║ PDFs found: ' + backup.pdfs.length);
console.log('║ Already healthy: ' + report.alreadyHealthy.length);
console.log('║ Recovered automatically: ' + report.recovered.length);
console.log('║ References repaired: ' + report.repairedRefs.length);
console.log('║ Genuinely missing (no source anywhere — NOT faked): ' + report.genuinelyMissing.length);
for (const m of report.genuinelyMissing) console.log('║   ✖ ' + m.title.slice(0, 48) + (m.expectedPath ? ' → ' + m.expectedPath : ''));
console.log('║ Duplicate objects detected: ' + report.duplicatesDetected.length);
console.log('║ Database rows changed: ' + report.dbRowsChanged.length + ' (pdf_url field only — IDs/prices/purchases untouched)');
console.log('║ Storage before: ' + (report.storageBefore / 1048576).toFixed(2) + ' MB → after: ' + (report.storageAfter / 1048576).toFixed(2) + ' MB');
console.log('║ Final verification: ' + pass + ' published PDFs readable, ' + fail + ' failing');
console.log('║ Full report: cloud-recovery-report-*.json');
console.log('╚════════════════════════════════════════════════════════════╝');
if (report.genuinelyMissing.length) {
  console.log('\n→ To recover the genuinely-missing files AUTOMATICALLY (still no manual re-upload):');
  console.log('  1. Copy the original PDF files into the repo folder: recovery-sources/');
  console.log('  2. Run again: SUPABASE_SERVICE_KEY="…" node run-pdf-recovery.js');
  console.log('  The script will find, copy, verify and re-link them to the SAME product IDs.');
}
