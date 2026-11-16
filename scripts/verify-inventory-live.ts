/**
 * Does the agent's catalogue search actually see the catalogue?
 *
 * The owner's complaint "it asks me which catalogue product before it invents one" is only fixable
 * if the search works. It did not: the select asked for a `location` column that does not exist, and
 * the error handler re-ran the same broken select and reported its null data as
 * `success: true, count: 0`. Two live runs were told "the catalogue has no course records" while
 * four live products existed.
 *
 * This calls the REAL tool through the real orchestrator for the Procolor test org and asserts it
 * finds them — by name, and by a category filter, and that a failing read is never reported as an
 * empty catalogue.
 *
 *   npx esbuild scripts/verify-inventory-live.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-inv-live.mjs && node .tmp-inv-live.mjs
 *
 * Read-only. Spends nothing.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

dotenv.config({ path: '.env.local', quiet: true });

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';
const expect = ['Diploma in Cinematography', 'Diploma in Photography', 'Master Video Editing', 'Smartphone Content Creator'];

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

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const ctx = await createAgentContext(sb as any, ORG, { intentText: 'what courses do we sell' });
const tool = (ctx.tools as any).nobogent_inventory_search;
if (!tool?.execute) {
  console.error('nobogent_inventory_search is not in the toolset');
  process.exit(1);
}

console.log('▸ no query — the whole catalogue');
const all = await tool.execute({ limit: 20 }, {} as any);
check('the search succeeds rather than erroring', all?.success === true, String(all?.error ?? ''));
check(
  'it returns the org catalogue, not 0',
  all?.count >= expect.length,
  `count=${all?.count}`,
);
const titles = (all?.items ?? []).map((i: any) => String(i.title));
for (const name of expect) {
  check(`  it can see "${name}"`, titles.includes(name));
}
check(
  'the rows carry the media an ad needs',
  (all?.items ?? []).every((i: any) => Array.isArray(i.images)),
  JSON.stringify((all?.items?.[0]?.images ?? []).slice(0, 1)),
);
check(
  'the rows carry the real address column (not a missing location)',
  (all?.items ?? []).some((i: any) => 'address' in i),
);

console.log('\n▸ a title query — "cinematography"');
const one = await tool.execute({ query: 'cinematography', limit: 20 }, {} as any);
check('a title/description query succeeds', one?.success === true, String(one?.error ?? ''));
check(
  'it narrows to the cinematography course',
  (one?.items ?? []).some((i: any) => String(i.title) === 'Diploma in Cinematography'),
  `count=${one?.count}`,
);

console.log('\n▸ a category filter — property_type');
const byType = await tool.execute({ category: 'Generic', limit: 20 }, {} as any);
check('a category filter succeeds', byType?.success === true, String(byType?.error ?? ''));
check('the filter finds rows', byType?.count > 0, `count=${byType?.count}`);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
