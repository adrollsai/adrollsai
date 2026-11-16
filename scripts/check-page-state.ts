/**
 * What state does a landing page actually have?
 *
 * §3.7 asks for "page draft stage with approvals before live". The orchestrator prompt already claims
 * "creating a page stages it, and the owner approves before it goes live", and the review gate does
 * gate `site_publish_landing_page`. Whether a page can exist in a DRAFT state, rather than only
 * existing once it is public, depends on the table having a status/live column at all — and this
 * codebase has a history of prompts describing columns that are not there.
 *
 * Read-only. Publishes nothing.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

for (const table of ['landing_pages', 'leads', 'profiles']) {
  const one = await sb.from(table).select('*').limit(1);
  if (one.error) {
    console.log(`${table}: ERROR ${one.error.message}`);
    continue;
  }
  const cols = one.data?.[0] ? Object.keys(one.data[0]) : [];
  console.log(`\n=== ${table} (${cols.length} columns, ${one.data?.length ?? 0} row(s) sampled)`);
  console.log(cols.join(', '));
  const interesting = cols.filter((c) => /status|draft|live|publish|state|stage|slug|domain|form|lead/i.test(c));
  console.log(`  state-ish: ${interesting.join(', ') || 'NONE'}`);
}
