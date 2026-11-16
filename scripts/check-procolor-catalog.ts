/**
 * Reads the Procolor catalogue through the table the app really uses.
 *
 * The catalogue is the `properties` table (this product began life as a real-estate CRM and was
 * generalised, so the nouns moved but the table name did not). Confirming the row exists, and
 * what media it carries, before an end-to-end ad proof spends render time on it.
 *
 * Read-only.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';
const PRODUCT = 'cd40f892-81bc-4712-a40d-ac3163588628';

const one = await sb.from('properties').select('*').eq('id', PRODUCT).maybeSingle();
if (one.error) console.log('single-row error:', one.error.message);
if (one.data) {
  console.log('=== PRODUCT ROW FOUND ===');
  for (const [k, v] of Object.entries(one.data as Record<string, unknown>)) {
    if (v === null || v === '' || v === undefined) continue;
    const shown = typeof v === 'object' ? JSON.stringify(v).slice(0, 700) : String(v).slice(0, 300);
    console.log(`  ${k}: ${shown}`);
  }
} else {
  console.log('no row with that id; listing the org catalogue instead');
}

const all = await sb.from('properties').select('id,title,user_id').eq('user_id', ORG).limit(20);
if (all.error) console.log('list error:', all.error.message);
console.log(`\n=== org catalogue: ${all.data?.length ?? 0} row(s)`);
for (const row of all.data ?? []) {
  console.log(`  ${row.id}  ${row.title}`);
}
