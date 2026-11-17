/**
 * Does every column the bulk transfer writes actually exist?
 *
 * The bug this is for: the transfer set `next_follow_up_at` — a column I invented; the real one is `next_followup`.
 * Because Supabase rejects the whole update when one field is unknown, the transfer failed entirely with "Could not
 * find the 'next_follow_up_at' column of 'leads' in the schema cache". Assignment, custom fields and the stage reset
 * never happened, and the owner found out by clicking the button.
 *
 * TypeScript cannot catch this: the update payload is `any`. So this reads the payload keys out of the route source and
 * checks them against a REAL row from the live table. It also checks the custom_fields stamps it writes, because those
 * are the audit trail and silent typos there are just as damaging.
 *
 *   npx esbuild scripts/verify-transfer-columns.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-transfer-cols.mjs && node .tmp-transfer-cols.mjs
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const ROUTE = 'app/api/crm/bulk-transfer/route.ts';
const source = fs.readFileSync(ROUTE, 'utf8');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const { data, error } = await sb.from('leads').select('*').limit(1);
if (error || !data?.length) {
  console.log(`FAIL  could not read a lead to learn the schema — ${error?.message ?? 'no rows'}`);
  process.exit(1);
}
const columns = new Set(Object.keys(data[0]));
console.log(`▸ live leads table has ${columns.size} columns`);

// 1. Every `updatePayload.<column> =` assignment in the route must be a real column.
const assigned = [...new Set([...source.matchAll(/updatePayload\.([a-z_][a-z0-9_]*)\s*=/gi)].map((m) => m[1]))];
console.log(`  columns written: ${assigned.join(', ') || '(none found)'}`);
check('the route writes at least one column', assigned.length > 0);

const missing = assigned.filter((column) => !columns.has(column));
check(
  'every column the transfer writes exists on leads',
  missing.length === 0,
  missing.length ? `NOT IN SCHEMA: ${missing.join(', ')}` : `${assigned.length} checked`,
);

// 2. The specific column that caused the failure, pinned so it cannot come back.
check("`next_followup` is the real column name (not next_follow_up_at)", columns.has('next_followup') && !source.includes('next_follow_up_at'));

// 3. The custom_fields stamps are the audit trail; a typo there loses the record silently.
//    `stage_before_reset_fields` and `next_action_cleared_at` are part of the same reset story: the categoriser reads a
//    shadow stage and a scheduled action out of custom_fields, so a reset has to archive and clear those too or the lead
//    never actually reaches the Fresh bucket.
const stamps = [...new Set([...source.matchAll(/\bcf\.([a-z_][a-z0-9_]*)\s*=/gi)].map((m) => m[1]))];
console.log(`  custom_fields stamps: ${stamps.join(', ')}`);
check(
  'the audit stamps are namespaced and consistent',
  stamps.every((s) => /^(history_|pending_actions_|stage_(before_)?reset|attempts_(before_)?reset|next_action_cleared)/.test(s)),
  stamps.join(', '),
);
check(
  'a reset records the stage it came from',
  stamps.includes('stage_before_reset'),
  'without it an admin cannot tell a reset lead from a new one',
);
check(
  'a reset records the attempt count it came from',
  stamps.includes('attempts_before_reset'),
);

// 4. A reset lead must actually reach the Fresh bucket. categorizeLeadStage() reads a shadow stage out of custom_fields
//    and treats any scheduled action as Ongoing, so clearing only the pipeline_stage column is not enough - the lead
//    looks reset in the database and still shows up under Ongoing in the CRM. That was a real, reported bug.
check(
  'a reset clears the shadow stage keys the categoriser reads',
  /shadowKeys/.test(source) && /delete cf\[k\]/.test(source),
  'cf.pipeline_stage / cf.status / cf.lead_status / cf.client_status override the column',
);
check(
  'a reset clears the scheduled-action keys that force Ongoing',
  /delete cf\[k\]/.test(source) && /next_action_date/.test(source),
  'cf.next_action_date alone keeps a New Lead in Ongoing',
);
check(
  'the transfer reports what actually happened, not just what was asked',
  /updatedCount/.test(source) && /failedCount/.test(source),
  'a partial transfer must be visible in the response',
);

// 5. The timeline entry exists, so the transfer is auditable.
check('the transfer writes a lead_history entry', /from\('lead_history'\)/.test(source));

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
