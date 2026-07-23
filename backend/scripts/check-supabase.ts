/**
 * @file check-supabase.ts
 * @description One-off connectivity check — run with: npx tsx --env-file .env scripts/check-supabase.ts
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env['SUPABASE_URL'];
const key = process.env['SUPABASE_SERVICE_KEY'];

if (!url || !key) {
  console.error('MISSING: SUPABASE_URL or SUPABASE_SERVICE_KEY not set in .env');
  process.exit(1);
}

console.log('URL host:', new URL(url).host);
console.log('Service key length:', key.length);

const client = createClient(url, key, { auth: { persistSession: false } });

void (async () => {
  try {
    const result = await client.from('documents').select('id', { count: 'exact', head: true });
    if (result.error) {
      console.error('SUPABASE_API_ERROR:', result.error.code, '-', result.error.message);
      if (/schema cache|could not find the table/i.test(result.error.message)) {
        console.error('');
        console.error('FIX: Open Supabase Dashboard → SQL Editor');
        console.error('     Run the full contents of: supabase/migrations/001_initial.sql');
      }
      process.exit(1);
    }
    console.log('SUPABASE_OK — documents table reachable (count:', result.count, ')');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause ? String(err.cause) : '';
    console.error('FETCH_FAILED:', message);
    if (cause) console.error('CAUSE:', cause);
    process.exit(1);
  }
})();
