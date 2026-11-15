/**
 * Proves the review gate cannot be walked around.
 *
 * The claim this gate makes is strong: a tool that spends money, reaches a customer or
 * deletes data CANNOT run unless the owner approved that exact call. So the tests are
 * adversarial — the interesting cases are the ways an agent might slip past a prompt
 * instruction:
 *
 *   - calling the tool directly, as if no rule existed
 *   - approving something small, then running something large
 *   - approving one campaign and launching a different one
 *   - approvals being unreadable (the database is down) -> must fail CLOSED
 *   - a free tool being gated by mistake -> must not be
 *
 *   npm run verify:review-gate
 */
import {
  REVIEW_POLICY,
  applyReviewGate,
  approveFingerprint,
  blockedResult,
  isApproved,
  reviewPolicyFor,
  supabaseApprovalStore,
  stripApprovalId,
  type ApprovalStore,
  type ReviewActionType,
} from '../lib/agent/review-gate';
import { z } from 'zod';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

/** A store that holds whatever we tell it to. */
function storeWith(
  payloads: { actionType: ReviewActionType; actionPayload: unknown; actionId?: string }[],
): ApprovalStore {
  return {
    async approved(actionType) {
      return payloads
        .filter((entry) => entry.actionType === actionType)
        .map((entry) => ({ actionId: entry.actionId, actionPayload: entry.actionPayload }));
    },
  };
}

/** A tool that records whether it actually ran. */
function spyTool() {
  const calls: unknown[] = [];
  return {
    calls,
    definition: {
      description: 'test tool',
      execute: async (input: unknown) => {
        calls.push(input);
        return { success: true, ran: true, input };
      },
    },
  };
}

const IMAGE_CALL = { brief: 'Diwali offer card', aspectRatio: '1:1', facts: { price: '₹999' } };
const DIFFERENT_IMAGE_CALL = { brief: 'Diwali offer card', aspectRatio: '1:1', facts: { price: '₹9,999' } };
const CAMPAIGN_A = { name: 'Batch 12', dailyBudget: 50000 };
const CAMPAIGN_B = { name: 'Batch 12', dailyBudget: 500000 };

head('1. The dangerous set is named, and the free set is not');

check(
  'spending, reaching and destroying are all covered',
  ['generate_ai_image', 'meta_mcp_launch_leadgen_campaign', 'nobogent_voice_dispatch_call', 'delete_data'].every(
    (tool) => reviewPolicyFor(tool) !== null,
  ),
  Object.keys(REVIEW_POLICY).length + ' tools gated',
);
check(
  'free, reversible work is NOT gated, so the gate does not become noise',
  ['plan_video', 'plan_image', 'reverse_plan', 'list_skills', 'pick_skill', 'scrape_run', 'list_automation_flows'].every(
    (tool) => reviewPolicyFor(tool) === null,
  ),
  'planning, listing and scraping run freely',
);
check(
  'every policy says WHY the owner is being asked',
  Object.values(REVIEW_POLICY).every((policy) => policy.why.length > 20),
  'each has a sentence',
);

head('2. An unapproved call does NOT run');

{
  const spy = spyTool();
  const gated = applyReviewGate({ generate_ai_image: spy.definition }, storeWith([]));
  const result = await gated.generate_ai_image.execute(IMAGE_CALL);

  check('the tool did not execute', spy.calls.length === 0, `${spy.calls.length} executions`);
  check(
    'it returns needs_review with the reason, not an error the agent can retry blindly',
    result?.needs_review === true && result?.success === false && /costs credits/.test(String(result.why)),
    String(result?.why),
  );
  check(
    'it hands back the exact request_human_approval call, including the payload to approve',
    result?.call?.tool === 'request_human_approval' &&
      result?.call?.actionType === 'create_asset' &&
      approveFingerprint(result?.call?.actionPayload) === approveFingerprint(IMAGE_CALL),
    'the owner is asked to approve precisely this call',
  );
  check(
    'the message tells the agent the order of operations',
    /request_human_approval/.test(String(result?.message)) && /only call this tool again after/.test(String(result?.message)),
    String(result?.message).slice(0, 90),
  );
}

head('3. An approval unlocks that call — and only that call');

{
  const spy = spyTool();
  const gated = applyReviewGate(
    { generate_ai_image: spy.definition },
    storeWith([{ actionType: 'create_asset', actionPayload: IMAGE_CALL }]),
  );

  const allowed = await gated.generate_ai_image.execute(IMAGE_CALL);
  check('the approved call runs', allowed?.ran === true && spy.calls.length === 1, 'executed once');

  const changed = await gated.generate_ai_image.execute(DIFFERENT_IMAGE_CALL);
  check(
    'the SAME approval does not authorise a different price',
    changed?.needs_review === true && spy.calls.length === 1,
    'a ₹999 approval cannot run a ₹9,999 image',
  );

  const unrelated = await gated.generate_ai_image.execute({ brief: 'something else entirely' });
  check(
    'nor an unrelated request of the same type',
    unrelated?.needs_review === true && spy.calls.length === 1,
    'fingerprint mismatch refused',
  );
}

{
  const spy = spyTool();
  const gated = applyReviewGate(
    { meta_mcp_launch_leadgen_campaign: spy.definition },
    storeWith([{ actionType: 'ad_spend', actionPayload: CAMPAIGN_A }]),
  );
  const small = await gated.meta_mcp_launch_leadgen_campaign.execute(CAMPAIGN_A);
  const large = await gated.meta_mcp_launch_leadgen_campaign.execute(CAMPAIGN_B);
  check(
    'approving ₹500/day does not authorise ₹5,000/day',
    small?.ran === true && large?.needs_review === true && spy.calls.length === 1,
    'the budget the owner saw is the budget that runs',
  );
}

head('4. It fails CLOSED when approvals cannot be read');

{
  const spy = spyTool();
  const broken: ApprovalStore = {
    async approved() {
      throw new Error('database is down');
    },
  };
  const gated = applyReviewGate({ generate_ai_image: spy.definition }, broken);
  const result = await gated.generate_ai_image.execute(IMAGE_CALL);
  check(
    'a database failure blocks the action instead of allowing it',
    result?.needs_review === true && spy.calls.length === 0,
    'stuck, not unsafe',
  );
}

head('5. The gate is a wrapper, not a rewrite');

{
  const free = spyTool();
  const gated = applyReviewGate({ plan_video: free.definition }, storeWith([]));
  const result = await gated.plan_video.execute({ beats: {} });
  check(
    'a free tool runs untouched with no approval at all',
    result?.ran === true && free.calls.length === 1,
    'no approval needed',
  );
  check(
    'every non-gated tool is passed through by reference',
    applyReviewGate({ plan_video: free.definition }, storeWith([])).plan_video === free.definition,
    'no wrapper added',
  );
  check(
    'a tool without an execute function does not crash the wrapper',
    (() => {
      const wrapped = applyReviewGate({ list_skills: { description: 'no execute', inputSchema: {} } }, storeWith([]));
      return wrapped.list_skills?.description === 'no execute';
    })(),
    'registry shapes preserved',
  );
}

head('6. The fingerprint is stable and order-insensitive');

check(
  'key order does not change the fingerprint',
  approveFingerprint({ a: 1, b: 2 }) === approveFingerprint({ b: 2, a: 1 }),
  'sorted keys',
);
check(
  'a changed value does change it',
  approveFingerprint({ price: '₹999' }) !== approveFingerprint({ price: '₹9,999' }),
  'value-sensitive',
);
check(
  'nested objects and arrays are compared, not flattened away',
  approveFingerprint({ a: [{ x: 1 }, { y: 2 }] }) !== approveFingerprint({ a: [{ x: 1 }, { y: 3 }] }),
  'deep',
);
check(
  'an empty input still produces a fingerprint',
  typeof approveFingerprint({}) === 'string' && approveFingerprint(undefined).length > 0,
  'never throws',
);

head('7. The real store queries the right rows');

{
  const queries: { table?: string; event?: string; status?: string } = {};
  const fakeSupabase = {
    from(table: string) {
      queries.table = table;
      const builder: any = {
        select: () => builder,
        eq: (column: string, value: string) => {
          if (column === 'event_type') queries.event = value;
          if (column === 'status') queries.status = value;
          return builder;
        },
        order: () => builder,
        limit: async () => ({
          data: [
            { payload: { actionType: 'create_asset', actionPayload: IMAGE_CALL } },
            { payload: { actionType: 'ad_spend', actionPayload: CAMPAIGN_A } },
          ],
          error: null,
        }),
      };
      return builder;
    },
  };
  const store = supabaseApprovalStore(fakeSupabase, 'user-1');
  const approved = await store.approved('create_asset');
  check(
    'it reads the approved actions the approval tool writes',
    queries.table === 'agent_events' && queries.event === 'PENDING_ACTION_APPROVAL' && queries.status === 'approved',
    `${queries.table}/${queries.event}/${queries.status}`,
  );
  check(
    'it returns only the approvals of the requested type',
    approved.length === 1 && approveFingerprint(approved[0].actionPayload) === approveFingerprint(IMAGE_CALL),
    `${approved.length} of 2 rows`,
  );
  const spend = await store.approved('ad_spend');
  check('and a different action type sees its own approvals', spend.length === 1, 'scoped by type');
}

head('8. The blocked result is what the agent needs, not a dead end');

{
  const policy = reviewPolicyFor('meta_mcp_launch_leadgen_campaign')!;
  const blocked = blockedResult('meta_mcp_launch_leadgen_campaign', policy, CAMPAIGN_A);
  check(
    'the blocked result carries a title, a reason and the payload',
    blocked.call.title.includes('meta_mcp_launch_leadgen_campaign') &&
      blocked.call.description.length > 20 &&
      approveFingerprint(blocked.call.actionPayload) === approveFingerprint(CAMPAIGN_A),
    blocked.call.title,
  );
  check(
    'it is signposted to request_human_approval specifically',
    blocked.call.tool === 'request_human_approval',
    blocked.call.tool,
  );
}

head('9. An approval can carry its own payload — and only that payload runs');

{
  // THE PRODUCTION FAILURE THIS FIXES: the owner approves, the agent is told to run it, and the
  // model re-words the image prompt instead of repeating itself. The fingerprint does not match,
  // so the gate refuses work the owner just approved. Passing the approvalId removes the model
  // from the copy-verbatim problem entirely.
  const spy = spyTool();
  const gated = applyReviewGate(
    { generate_ai_image: spy.definition },
    storeWith([{ actionType: 'create_asset', actionPayload: IMAGE_CALL, actionId: 'act_approved' }]),
  );

  const byId = await gated.generate_ai_image.execute({ approvalId: 'act_approved', brief: 'totally reworded' });
  check(
    'passing the approvalId runs the approved call',
    byId?.ran === true && spy.calls.length === 1,
    'no fingerprint needed',
  );
  check(
    'and it runs the APPROVED arguments, not the caller\'s restatement',
    approveFingerprint(spy.calls[0]) === approveFingerprint(IMAGE_CALL),
    'a reworded payload cannot change what was approved',
  );
  check(
    'the reworded price in the retry is ignored, not merged',
    !/reworded/.test(JSON.stringify(spy.calls[0])),
    'the approved ₹999 runs, not a smuggled ₹9,999',
  );

  const unknownId = await gated.generate_ai_image.execute({ approvalId: 'act_never_approved' });
  check(
    'an approvalId that was never approved is refused',
    unknownId?.needs_review === true && spy.calls.length === 1,
    'no fallback to the caller\'s arguments',
  );
  check(
    'the refusal tells the agent how to use an approval it really has',
    /approvalId/.test(String(unknownId?.message)),
    'actionable, not a dead end',
  );

  const wrongType = applyReviewGate(
    { generate_ai_image: spy.definition },
    storeWith([{ actionType: 'ad_spend', actionPayload: CAMPAIGN_A, actionId: 'act_campaign' }]),
  );
  const crossType = await wrongType.generate_ai_image.execute({ approvalId: 'act_campaign' });
  check(
    'an approval for a different action type does not unlock this tool',
    crossType?.needs_review === true,
    'an ad-spend approval cannot generate an image',
  );
}

{
  const spy = spyTool();
  const gated = applyReviewGate(
    { generate_ai_image: spy.definition },
    storeWith([{ actionType: 'create_asset', actionPayload: IMAGE_CALL, actionId: 'act_approved' }]),
  );
  const blocked = await gated.generate_ai_image.execute({ approvalId: 'act_x', brief: 'nope' });
  check(
    'the blocked result does not echo the gate\'s own approvalId back as a payload',
    blocked?.call?.actionPayload && !('approvalId' in (blocked.call.actionPayload as object)),
    'clean payload for approval',
  );
}

{
  // The field has to survive schema validation or the whole path is dead on arrival.
  const schema = z.object({ brief: z.string() });
  const spy = spyTool();
  const gated = applyReviewGate(
    { generate_ai_image: { ...spy.definition, inputSchema: schema } },
    storeWith([{ actionType: 'create_asset', actionPayload: { brief: 'x' }, actionId: 'act_1' }]),
  );
  const parsed = gated.generate_ai_image.inputSchema.parse({ brief: 'x', approvalId: 'act_1' });
  check(
    'every gated tool accepts an approvalId through its schema',
    parsed.approvalId === 'act_1',
    'not stripped by validation',
  );
  check(
    'the tool itself never receives the gate\'s bookkeeping field',
    (() => {
      const result = stripApprovalId({ brief: 'x', approvalId: 'act_1' }) as any;
      return result.brief === 'x' && !('approvalId' in result);
    })(),
    'tools see their own arguments only',
  );
}

head('10. The gate records the approval itself, with the exact arguments');

{
  // THE PRODUCTION FAILURE THIS FIXES: the model staged the card via request_human_approval and
  // described the call in its own words — {brief, facts} where generate_ai_image needs {prompt}.
  // The owner approved, the faithful re-run passed that description to the tool, and the tool
  // answered "prompt is required." The owner approved something that could not run.
  const recorded: { tool?: string; toolInput?: unknown; actionType?: string }[] = [];
  const spy = spyTool();
  const store: ApprovalStore = {
    async approved() {
      return [];
    },
    async recordPending(request) {
      recorded.push(request);
      return { actionId: 'act_recorded' };
    },
  };
  const gated = applyReviewGate({ generate_ai_image: spy.definition }, store);
  const blocked = await gated.generate_ai_image.execute(IMAGE_CALL);

  check(
    'a refused call is recorded with the exact tool arguments',
    recorded.length === 1 && approveFingerprint(recorded[0].toolInput) === approveFingerprint(IMAGE_CALL),
    'not a paraphrase',
  );
  check(
    'the record names the tool that must run, so the payload has a known shape',
    recorded[0].tool === 'generate_ai_image' && recorded[0].actionType === 'create_asset',
    'generate_ai_image / create_asset',
  );
  check(
    'the chat gets a renderable card without the model transcribing anything',
    blocked?.artifact?.type === 'action_confirmation' &&
      blocked?.artifact?.actionId === 'act_recorded' &&
      blocked?.requiresApproval === true,
    'the card is the gate\'s own output',
  );
  check(
    'the agent is told not to stage a second card',
    /do NOT call request_human_approval/.test(String(blocked?.message)),
    'one card, not two',
  );
  check(
    'an approved id then runs the recorded arguments',
    await (async () => {
      const spy2 = spyTool();
      const store2: ApprovalStore = {
        async approved() {
          return [{ actionId: 'act_recorded', actionPayload: IMAGE_CALL }];
        },
      };
      const gated2 = applyReviewGate({ generate_ai_image: spy2.definition }, store2);
      const ran = await gated2.generate_ai_image.execute({ approvalId: 'act_recorded' });
      return ran?.ran === true && spy2.calls.length === 1;
    })(),
    'round trip closes',
  );
  check(
    'a store without recordPending still blocks honestly',
    await (async () => {
      const spy3 = spyTool();
      const gated3 = applyReviewGate({ generate_ai_image: spy3.definition }, storeWith([]));
      const result = await gated3.generate_ai_image.execute(IMAGE_CALL);
      return result?.needs_review === true && spy3.calls.length === 0;
    })(),
    'no database, no false green',
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
