#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════
// STUDYRIA — Cloud Storage Migration Runner
// Usage:
//   SUPABASE_SERVICE_KEY="your-service-role-key" node run-cloud-migration.js
// (or simply paste cloud-storage-migration.sql into Supabase SQL Editor)
// ════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SUPABASE_URL = 'https://qsdfmgcekdpjdcyqhuhi.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY env var required (Supabase → Settings → API → service_role)');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const sql = readFileSync('./cloud-storage-migration.sql', 'utf8');

const res = await sb.rpc('exec', { query: sql }).catch(e => ({ error: { message: e.message } }));
if (res && res.error) {
  console.error('❌ Migration error:', res.error.message);
  console.error('   → paste cloud-storage-migration.sql into the Supabase SQL Editor instead.');
  process.exit(1);
}
const { data, error } = await sb.from('cloud_settings').select('key').limit(1);
console.log(error ? '⚠ Verify manually: ' + error.message : '✅ Migration complete — cloud_settings readable.');
