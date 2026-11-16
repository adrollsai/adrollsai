/**
 * Can a gated tool be resumed with ONLY an approvalId?
 *
 * The review gate tells the model, and buildResumePrompt tells it again in stronger words: "call the
 * tool again and pass this approvalId. The approved arguments are used verbatim, so do NOT re-type or
 * re-word the payload." That is only true if the schema ACCEPTS a call carrying nothing but the id.
 *
 * A live video run suggests it is not: `generate_voiceover { approvalId }` produced no tool result at
 * all, the agent gave up on the voice, and the delivered film came out silent. If the tool's own
 * required fields are still required, the call never reaches `execute` — so the approved args are
 * never replayed and the instruction is a trap.
 *
 * This checks the schemas directly. It calls no tool, so it spends nothing.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { REVIEW_POLICY, blockedResult, reviewPolicyFor } from '../lib/agent/review-gate';
import { buildResumePrompt } from '../lib/agent/resume-prompt';

dotenv.config({ path: '.env.local', quiet: true });

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const ctx = await createAgentContext(sb as any, ORG, { intentText: 'make a video ad with a voiceover' });
const tools = ctx.tools as any;

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

const gated = Object.keys(REVIEW_POLICY).filter((name) => tools[name]);
console.log(`gated tools present in this turn: ${gated.length}\n`);

let acceptsBareId = 0;
for (const name of gated) {
  const schema = tools[name]?.inputSchema;
  const bare = { approvalId: 'act_test' };
  let ok = false;
  let why = '';
  try {
    schema.parse(bare);
    ok = true;
  } catch (error: any) {
    const issues = (error?.issues ?? []).map((i: any) => `${(i.path ?? []).join('.')}: ${i.message}`);
    why = issues.slice(0, 4).join('; ') || String(error?.message ?? error);
  }
  if (ok) acceptsBareId++;
  console.log(`${ok ? 'ACCEPTS' : 'REJECTS'}  ${name}${why ? `  — ${why}` : ''}`);
}

console.log('');
const bareRejected = gated.length - acceptsBareId;
check(
  'the schemas establish the constraint (a bare approvalId does not satisfy a gated tool)',
  bareRejected > 0,
  `${bareRejected}/${gated.length} gated tools reject a bare approvalId, ${acceptsBareId} accept it`,
);

// The invariant that actually matters: the INSTRUCTIONS must agree with the schemas. This is the bug
// that shipped a silent film — the resume prompt told the agent to send only the id, which no gated
// tool accepts, so the call died before the gate and the voiceover never ran.
if (bareRejected > 0) {
  const resume = buildResumePrompt({ actionId: 'act_x', actionType: 'create_asset', title: 'x' });
  check(
    'the resume prompt tells the agent to repeat the arguments',
    /repeat the arguments/i.test(resume),
    'otherwise an id-only retry is rejected by validation',
  );
  check(
    'the resume prompt warns that an id-only call fails',
    /only the approvalId will fail/i.test(resume),
    'the trap is named rather than left to be discovered',
  );
  check(
    'the resume prompt still carries the approvalId itself',
    resume.includes('act_x'),
    'the gate matches on it',
  );

  // The gate's own retry instruction must agree too — it is the other place the model is told what
  // to do after an approval, and it said the same wrong thing.
  const policy = reviewPolicyFor('generate_voiceover');
  if (policy) {
    const gateMessage = String(blockedResult('generate_voiceover', policy, {}).message);
    check(
      "the gate's refusal no longer tells the model to send only the id",
      !/do not re-type the arguments/i.test(gateMessage),
      'the wrong instruction is gone from both places',
    );
  }
}
console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
