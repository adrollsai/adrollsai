/**
 * Does creating a flow actually produce a flow the engine can run?
 *
 * `create_flow` is the agent's authoring tool, and "it worked" has to mean more
 * than `success: true` in the tool result. What matters is that the row it
 * writes:
 *
 *   1. exists, and is PAUSED (authoring is not activating),
 *   2. round-trips through the reader the runner uses (planFromFlowDescription),
 *      recovering the trigger and the steps in order,
 *   3. passes validateFlow — the same check audit:flows uses to call 7 stored
 *      flows un-runnable,
 *   4. refuses the things it is supposed to refuse (a comment trigger cannot
 *      drive a WhatsApp message; a duplicate trigger is refused),
 *   5. does not silently clamp a long wait into an immediate send.
 *
 * Run against the live database with the service role; everything it creates is
 * tagged and deleted.
 *
 *   npm run verify:flow-creation
 */
import '../lib/env-local';
import { createClient } from '@supabase/supabase-js';
import { createFlowAuthoringTools } from '../lib/agent/tools/flows';
import { validateFlow } from '../lib/flows/schema';
import { planFromFlowDescription } from '../lib/flows/start';

const PROBLEM = ['error', 'fatal'];
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail === undefined ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail === undefined ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  }
}

async function main() {
  // A real tenant is needed: the ledger rows reference profiles.
  const { data: profiles } = await sb
    .from('profiles')
    .select('id, business_name')
    .eq('role', 'super_admin')
    .limit(1);
  const tenant = profiles?.[0]?.id as string;
  if (!tenant) throw new Error('no super_admin profile to test against');
  console.log(`\ncreating flows through create_flow() for ${tenant.slice(0, 8)}…`);

  const tools = createFlowAuthoringTools(sb as any, tenant);
  const create = (tools as any).create_flow;
  const marker = `Verify ${Date.now().toString(36)}`;
  const createdIds: string[] = [];

  const cleanup = async () => {
    for (const id of createdIds) {
      await sb.from('automations').delete().eq('id', id);
    }
  };

  try {
    // ── 1. the happy path, exactly as the agent calls it ────────────────────
    const result = await create.execute({
      name: marker,
      trigger: 'trigger_crm_lead',
      steps: [
        { kind: 'message', text: 'Thanks for reaching out — we will call you shortly.' },
        { kind: 'wait', seconds: 5 },
        { kind: 'call', text: 'Qualify the enquiry and confirm the site visit.' },
      ],
    });
    check('create_flow reports success', result?.success === true, result?.error);
    check('the flow is created PAUSED, not live', result?.active === false, { active: result?.active });
    check('it reports 4 nodes (trigger + 3 steps)', result?.nodeCount === 4, result?.nodeCount);

    const flowId = result?.flowId;
    check('it returns a real flow id', typeof flowId === 'string' && flowId.length > 10, flowId);
    if (!flowId) throw new Error('no flow id — cannot continue');
    createdIds.push(flowId);

    // ── 2. the row it actually stored ───────────────────────────────────────
    const { data: row } = await sb
      .from('automations')
      .select('id, title, description, is_active, user_id')
      .eq('id', flowId)
      .maybeSingle();
    check('the row exists in automations', Boolean(row?.id));
    check('the row is inactive', row?.is_active === false, { is_active: row?.is_active });
    check('the row belongs to the tenant', row?.user_id === tenant);

    let graph: any = null;
    try {
      graph = JSON.parse(String(row?.description || ''));
    } catch {
      /* reported below */
    }
    check('the description is valid JSON', Boolean(graph));
    check('it carries the trigger in the stored shape', graph?.trigger?.type === 'trigger_crm_lead', graph?.trigger);
    check('it stores the node graph, not just prose', Array.isArray(graph?.nodes) && graph.nodes.length === 4, graph?.nodes?.length);

    // ── 3. the two readers that matter ──────────────────────────────────────
    const verdict = validateFlow(graph ?? {});
    const blocking = (verdict.issues ?? []).filter((p: any) => PROBLEM.includes(String(p.severity)));
    check(
      'validateFlow finds nothing blocking (audit:flows uses this)',
      blocking.length === 0,
      blocking.map((p: any) => p.message)
    );

    const plan = planFromFlowDescription(String(row?.description || ''));
    check('the runner’s reader has no problems with it', (plan?.problems ?? []).length === 0, plan?.problems);
    check('it recovers the same trigger', plan?.triggerType === 'trigger_crm_lead', plan?.triggerType);
    check(
      'it recovers the steps in order: message, wait, call',
      JSON.stringify((plan?.actions ?? []).map((s: any) => s.kind)) === JSON.stringify(['message', 'wait', 'call']),
      (plan?.actions ?? []).map((s: any) => s.kind)
    );
    check(
      'the message text survives the round trip',
      String((plan?.actions ?? []).find((s: any) => s.kind === 'message')?.text ?? '').includes('Thanks for reaching out')
    );
    // This was broken: buildFlow wrote a call step's text as `data.script`, and the
    // only reader looks at `data.description`, so the instructions were dropped and
    // the call was queued with a null script.
    check(
      'the call script survives the round trip',
      String((plan?.actions ?? []).find((s: any) => s.kind === 'call')?.text ?? '').includes('Qualify the enquiry'),
      (plan?.actions ?? []).find((s: any) => s.kind === 'call')?.text ?? null
    );
    check(
      'the wait keeps its real length',
      Number((plan?.actions ?? []).find((s: any) => s.kind === 'wait')?.seconds) === 5,
      (plan?.actions ?? []).find((s: any) => s.kind === 'wait')?.seconds
    );

    // ── 4. what it must refuse ──────────────────────────────────────────────
    const duplicate = await create.execute({
      name: `${marker} again`,
      trigger: 'trigger_crm_lead',
      steps: [{ kind: 'message', text: 'second flow on the same trigger' }],
    });
    check(
      'a second flow on the same trigger is refused as a duplicate',
      duplicate?.success === false && duplicate?.reason === 'duplicate_flow',
      { reason: duplicate?.reason }
    );

    const impossible = await create.execute({
      name: `${marker} impossible`,
      // A comment can never yield a phone number, so a WhatsApp message on it must be
      // refused for THAT reason — not merely for being an unknown trigger.
      trigger: 'trigger_ig_comment',
      steps: [{ kind: 'message', text: 'comment triggers cannot yield a phone number' }],
    });
    check(
      'a message on a comment trigger is refused as impossible',
      impossible?.success === false && impossible?.reason === 'impossible_action',
      { reason: impossible?.reason, error: String(impossible?.error ?? '').slice(0, 90) }
    );

    const longWait = await create.execute({
      name: `${marker} long wait`,
      trigger: 'trigger_whatsapp_inbound',
      steps: [{ kind: 'wait', seconds: 7200 }, { kind: 'message', text: 'two hours later' }],
    });
    check(
      'a 2-hour wait is refused rather than silently clamped to 10s',
      longWait?.success === false && longWait?.reason === 'delay_too_long',
      { reason: longWait?.reason, error: String(longWait?.error ?? '').slice(0, 110) }
    );

    const noSteps = await create.execute({
      name: `${marker} empty`,
      trigger: 'trigger_whatsapp_inbound',
      steps: [],
    });
    check(
      'a flow with no steps is refused',
      noSteps?.success === false && noSteps?.reason === 'no_steps',
      { reason: noSteps?.reason }
    );

    const onlyTrigger = await create.execute({
      name: `${marker} trigger only`,
      trigger: 'trigger_whatsapp_inbound',
      steps: [],
    });
    check('a trigger-only flow is refused', onlyTrigger?.success === false, { reason: onlyTrigger?.reason });

    const badTrigger = await create.execute({
      name: `${marker} bad trigger`,
      trigger: 'trigger_telepathy',
      steps: [{ kind: 'message', text: 'nope' }],
    });
    check(
      'an unknown trigger is refused and names the real ones',
      badTrigger?.success === false && badTrigger?.reason === 'unknown_trigger',
      { reason: badTrigger?.reason }
    );

    // ── 5. nothing refused was written anyway ───────────────────────────────
    const { data: strays } = await sb
      .from('automations')
      .select('id, title')
      .eq('user_id', tenant)
      .ilike('title', `%${marker}%`);
    check(
      'only the one accepted flow was stored — refusals wrote nothing',
      (strays || []).length === 1,
      (strays || []).map((s: any) => s.title)
    );
  } finally {
    await cleanup();
    const { data: left } = await sb
      .from('automations')
      .select('id')
      .eq('user_id', tenant)
      .ilike('title', `%${marker}%`);
    console.log(`\ncleanup: removed ${createdIds.length} flow(s); ${(left || []).length} left behind`);
  }

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} checks passed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFAILED:', err?.message || err);
  process.exit(1);
});
