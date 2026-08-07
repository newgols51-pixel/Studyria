#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════
// STUDYRIA — Fix DB Trigger: LOWER(bigint) error
// 
// Usage:
//   SUPABASE_SERVICE_KEY="your-service-role-key" node run-fix-migration.js
//
// Get your service role key from:
//   Supabase Dashboard → Project Settings → API → service_role key
// ════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import ws from 'ws';
globalThis.WebSocket = ws;

const SUPABASE_URL = 'https://qsdfmgcekdpjdcyqhuhi.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

if (!SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY environment variable is required');
  console.error('   Get it from: Supabase Dashboard → Settings → API → service_role key');
  console.error('   Then run: SUPABASE_SERVICE_KEY="eyJ..." node run-fix-migration.js');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function runFix() {
  console.log('🔧 Running DB trigger fix for LOWER(bigint) error...\n');

  // Step 1: Create safe slug helper
  const step1 = await sb.rpc('exec', { query: `
    CREATE OR REPLACE FUNCTION public.generate_pdf_slug(title text)
    RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
    DECLARE v_slug text;
    BEGIN
      v_slug := LOWER(TRIM(COALESCE(title, '')));
      v_slug := REGEXP_REPLACE(v_slug, '[^a-z0-9\\s-]', '', 'g');
      v_slug := REGEXP_REPLACE(v_slug, '\\s+', '-', 'g');
      v_slug := REGEXP_REPLACE(v_slug, '-+', '-', 'g');
      v_slug := TRIM(BOTH '-' FROM v_slug);
      RETURN LEFT(v_slug, 80);
    END;
    $$;
  `}).catch(e => ({ error: { message: e.message } }));
  console.log('Step 1 (slug helper):', step1.error?.message || '✅ OK');

  // Step 2: Create safe trigger function
  const step2 = await sb.rpc('exec', { query: `
    CREATE OR REPLACE FUNCTION public.pdf_before_insert_update()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.slug IS NULL OR TRIM(NEW.slug) = '' THEN
        NEW.slug := public.generate_pdf_slug(NEW.title::text);
      END IF;
      IF NEW.category IS NULL OR TRIM(NEW.category) = '' THEN
        NEW.category := 'Education';
      END IF;
      IF NEW.title IS NOT NULL THEN
        NEW.title := TRIM(NEW.title);
      END IF;
      IF NEW.status IS NULL OR TRIM(NEW.status) = '' THEN
        NEW.status := 'draft';
      END IF;
      IF TG_OP = 'INSERT' THEN
        NEW.created_at := COALESCE(NEW.created_at, NOW());
      END IF;
      NEW.updated_at := NOW();
      RETURN NEW;
    END;
    $$;
  `}).catch(e => ({ error: { message: e.message } }));
  console.log('Step 2 (safe trigger fn):', step2.error?.message || '✅ OK');

  // Step 3: Drop old triggers
  const triggerNames = [
    'pdf_before_insert_update_trigger', 'trg_pdf_before_insert', 'trg_pdf_before_update',
    'pdfs_before_insert', 'pdfs_normalize', 'pdf_normalize_trigger',
    'set_pdf_slug', 'pdf_set_slug', 'normalize_pdf_trigger'
  ];
  for (const tname of triggerNames) {
    await sb.rpc('exec', { query: `DROP TRIGGER IF EXISTS ${tname} ON public.pdfs;` }).catch(() => {});
  }
  console.log('Step 3 (drop old triggers): ✅ done');

  // Step 4: Create correct trigger
  const step4 = await sb.rpc('exec', { query: `
    CREATE TRIGGER pdf_before_insert_update_trigger
      BEFORE INSERT OR UPDATE ON public.pdfs
      FOR EACH ROW EXECUTE FUNCTION public.pdf_before_insert_update();
  `}).catch(e => ({ error: { message: e.message } }));
  console.log('Step 4 (create safe trigger):', step4.error?.message || '✅ OK');

  // Step 5: Verify
  const { data, error } = await sb.from('pdfs').insert({
    title: '__TRIGGER_FIX_VERIFICATION__',
    category: 'Education',
    category_id: 3,
    status: 'draft',
    free: true,
    price: 0,
  }).select('id').single();

  if (error) {
    console.log('\n❌ VERIFICATION FAILED:', error.message);
    console.log('The trigger may still be broken. Please run fix-trigger-lower-bigint.sql manually in Supabase SQL Editor.');
  } else {
    console.log('\n✅ VERIFICATION PASSED! PDF insert works correctly.');
    console.log('   Test row id:', data.id);
    await sb.from('pdfs').delete().eq('id', data.id);
    console.log('   Test row cleaned up.');
    console.log('\n🎉 The "function lower(bigint) does not exist" error is FIXED!');
  }
}

runFix().catch(console.error);
