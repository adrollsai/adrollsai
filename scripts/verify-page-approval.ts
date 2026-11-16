/**
 * Nothing public without a tap: are ALL the page tools gated?
 *
 * §3.7 asks for "page draft stage with approvals before live". There is no draft: `landing_pages` has
 * no status/draft/live column (12 columns, none of them state), so a page is reachable at
 * /shared/<owner>/<slug> the instant its row exists. That makes CREATION the public act, not
 * publication — and `create_landing_page` was the one page tool missing from REVIEW_POLICY, while
 * `site_publish_landing_page` and `build_website` were both in it. The prompt meanwhile told the agent
 * "creating a page stages it, and the owner approves before it goes live", which was not true.
 *
 * This gate pins the only thing that can be true without a schema change:
 *   - every tool that can put a page in front of the public is in REVIEW_POLICY;
 *   - each of them actually refuses when called without an approval;
 *   - the prompt no longer claims a draft state that does not exist.
 *
 *   npx esbuild scripts/verify-page-approval.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-page-approval.mjs && node .tmp-page-approval.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { REVIEW_POLICY, reviewPolicyFor } from '../lib/agent/review-gate';

dotenv.config({ path: '.env.local', quiet: true });

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';

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

// Every tool that can make a page or site public.
const PUBLIC_PAGE_TOOLS = ['create_landing_page', 'build_website', 'site_publish_landing_page'];

console.log('▸ every public page tool is in REVIEW_POLICY');
for (const name of PUBLIC_PAGE_TOOLS) {
  const policy = reviewPolicyFor(name);
  check(`  ${name} is gated`, policy !== null, policy ? `actionType=${policy.actionType}` : 'NOT GATED');
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

// A sites turn, so the page tools are actually registered and can be exercised.
const ctx = await createAgentContext(sb as any, ORG, {
  intentText: 'create a landing page for the November batch and publish my website',
});
const tools = ctx.tools as any;
console.log(`\ntool groups: ${ctx.toolGroups.join(', ')}`);

console.log('\n▸ each one REFUSES when called without an approval');
// Each refusal records a real approval card in agent_events. A gate that leaves cards behind puts
// three stale "Approve: …" rows in the owner's chat every time it runs, so they are collected here
// and deleted at the end whatever happens.
const stagedActionIds: string[] = [];
for (const name of PUBLIC_PAGE_TOOLS) {
  const toolDef = tools[name];
  if (!toolDef?.execute) {
    check(`  ${name} is registered for a sites turn`, false, 'not in the toolset');
    continue;
  }
  // Deliberately minimal but schema-valid arguments: the point is the GATE, not the page.
  const args =
    name === 'create_landing_page'
      ? { businessName: 'Procolor Film Academy', productName: 'Diploma in Cinematography', phone: '9569919985' }
      : {};
  let result: any;
  try {
    result = await toolDef.execute(args, {} as any);
  } catch (error: any) {
    result = { threw: String(error?.message ?? error) };
  }
  if (result?.actionId) stagedActionIds.push(String(result.actionId));
  check(
    `  ${name} refuses without approval`,
    result?.needs_review === true,
    result?.needs_review ? `actionId=${result.actionId}` : `got: ${JSON.stringify(result).slice(0, 140)}`,
  );
}

console.log('\n▸ the prompt does not claim a draft state that does not exist');
const prompt = String(ctx.systemPrompt || '');
check(
  'the prompt no longer says creating a page "stages" it',
  !/creating a page stages it/i.test(prompt),
  'the false claim is gone',
);
// Whitespace-tolerant on purpose: the prompt is line-wrapped, so a phrase written across two lines
// would otherwise make a correct prompt fail its own gate.
check(
  'the prompt says the page is live the moment it is created',
  /no\s+draft\s+state|no\s+draft\s+stage|reachable\s+at\s+its\s+slug/i.test(prompt),
  'the real behaviour is stated',
);

// Leave the owner's approval queue as we found it: the cards this gate staged are deleted.
if (stagedActionIds.length) {
  const { error } = await sb
    .from('agent_events')
    .delete()
    .eq('user_id', ORG)
    .eq('event_type', 'PENDING_ACTION_APPROVAL')
    .in('status', ['pending'])
    .filter('payload->>actionId', 'in', `(${stagedActionIds.map((id) => `"${id}"`).join(',')})`);
  console.log(
    `\ncleanup: removed ${stagedActionIds.length} staged card(s)${error ? ` (${error.message})` : ''}`,
  );
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
