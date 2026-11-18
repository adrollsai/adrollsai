/**
 * An approval card must survive the discovery proxy.
 *
 * THE BUG
 * The model reaches most tools through `call_tool`, which wraps the real result:
 * `{ ok, tool, result }`. Every renderer looked for `output.artifact` at the TOP
 * level, so for any proxied tool:
 *
 *   - the approval card was never drawn. `nobogent_whatsapp_send_template` and
 *     `nobogent_voice_dispatch_call` are not in the inline hot set, so they are
 *     ALWAYS proxied — their card could never appear at all;
 *   - a question asked through the proxy never reached the question panel;
 *   - image / audio / video artefacts from proxied tools rendered as a bare row.
 *
 * With no card there is no tap, and the gate only unlocks an action whose approval
 * row says `approved` — so the action was not merely hidden, it was impossible.
 *
 * WHAT THIS CHECKS
 * Not the helper on its own, which would pass while the wiring stayed broken:
 * this runs the REAL `applyReviewGate` around a REAL tool, puts it behind the REAL
 * `buildDiscoverableTools`, calls it through `call_tool` exactly as the model does,
 * and then asks the same function the UI asks. If either side changes shape, this
 * fails.
 *
 *   npm run verify:tool-artifacts
 */
import { tool } from 'ai';
import { z } from 'zod';
import { applyReviewGate, type ApprovalStore } from '../lib/agent/review-gate';
import { buildDiscoverableTools } from '../lib/agent/harness/tool-proxy';
import {
  artifactFrom,
  isFailedToolOutput,
  pendingApprovalFrom,
  realToolName,
  realToolOutput,
} from '../lib/agent/tool-output';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  const text = detail === undefined ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${text}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${text}`);
  }
}

/** In-memory stand-in for the approvals table, with the same contract. */
function memoryStore(): ApprovalStore & { rows: any[] } {
  const rows: any[] = [];
  return {
    rows,
    async approved() {
      return rows
        .filter((r) => r.status === 'approved')
        .map((r) => ({ actionId: r.actionId, actionPayload: r.actionPayload, status: r.status }));
    },
    async recordPending(request: Parameters<NonNullable<ApprovalStore['recordPending']>>[0]) {
      const actionId = `act_test_${rows.length + 1}`;
      rows.push({
        actionId,
        status: 'pending',
        actionPayload: request.toolInput,
        tool: request.tool,
        actionType: request.actionType,
      });
      return { actionId };
    },
    async consumeApproval(actionId: string) {
      const row = rows.find((r) => r.actionId === actionId);
      if (row) row.status = 'used';
    },
  } as any;
}

async function main() {
  // ── 1. a gated tool, called the way the model calls it ────────────────────
  const store = memoryStore();

  // A gated tool under its REAL name — the policy lookup is by name, so a
  // stand-in name would silently pass straight through and the test would be
  // checking nothing. (That happened while writing this.)
  const gated = applyReviewGate(
    {
      nobogent_whatsapp_send_template: tool({
        description: 'Really sends a WhatsApp template',
        inputSchema: z.object({ phone: z.string(), templateName: z.string(), variables: z.array(z.string()).optional() }),
        execute: async () => ({ success: true, messageId: 'wamid.TEST' }),
      }),
    } as any,
    store as any
  ) as Record<string, any>;

  const registry: Record<string, any> = {
    ...gated,
    look_at_picture: tool({
      description: 'returns an image artifact',
      inputSchema: z.object({}),
      execute: async () => ({
        success: true,
        artifact: { type: 'image_preview', title: 'A picture', imageUrl: 'https://example.com/a.png' },
      }),
    }),
    ask_the_owner: tool({
      description: 'asks the owner a question',
      inputSchema: z.object({}),
      execute: async () => ({
        success: true,
        artifact: { type: 'user_input_prompt', inputRequestId: 'req_1', question: 'Which lead?' },
      }),
    }),
    plain_reader: tool({
      description: 'returns no artifact',
      inputSchema: z.object({}),
      execute: async () => ({ success: true, rows: 3 }),
    }),
    broken_tool: tool({
      description: 'always fails',
      inputSchema: z.object({}),
      // Declared return type on purpose: an async function whose only statement
      // throws infers `never`, which the tool() overloads reject.
      execute: async (): Promise<{ success: boolean }> => {
        throw new Error('provider said no');
      },
    }),
  };

  const discovery = buildDiscoverableTools(registry as any);
  const call = discovery.tools.call_tool as any;
  const direct = registry.nobogent_whatsapp_send_template as any;

  const args = { phone: '+918288835235', templateName: 'auto_drip_followup_24h', variables: ['Rahul'] };

  console.log('\n▸ through the proxy (how the model actually calls it)');
  const proxied = await call.execute({ name: 'nobogent_whatsapp_send_template', arguments: args });
  check('the envelope really wraps the result', proxied?.ok === true && proxied?.tool === 'nobogent_whatsapp_send_template', {
    keys: Object.keys(proxied ?? {}),
  });

  const card = artifactFrom(proxied);
  check(
    'the approval card is found through the proxy',
    card?.type === 'action_confirmation',
    card?.type ?? 'no artifact found'
  );
  check('…carrying the action id the button needs', typeof card?.actionId === 'string' && card.actionId.length > 4, card?.actionId);
  check('…and the exact arguments the owner is approving', card?.payload?.templateName === args.templateName, card?.payload);
  check('…and it is marked pending', String(card?.status ?? '') === 'pending', card?.status);

  const pending = pendingApprovalFrom(proxied);
  check('a pending approval is recognised as pending', pending?.actionId === card?.actionId, pending);

  check(
    'the row is labelled with the real tool, not "call_tool"',
    realToolName('call_tool', proxied) === 'nobogent_whatsapp_send_template',
    realToolName('call_tool', proxied)
  );
  check(
    'a refused send is not shown as a green success',
    isFailedToolOutput(proxied) === false,
    'needs_review is a stage, not a failure'
  );
  check('the real tool decided nothing was sent', realToolOutput(proxied)?.success === false, realToolOutput(proxied)?.success);

  console.log('\n▸ the same call made directly (must behave identically)');
  const directly = await direct.execute(args, {});
  const directCard = artifactFrom(directly);
  check('a direct call also yields the card', directCard?.type === 'action_confirmation', directCard?.type);
  check(
    '…with its own pending action id (a second un-approved call stages a second approval)',
    typeof directCard?.actionId === 'string' && directCard.actionId !== card?.actionId,
    directCard?.actionId
  );
  check('a direct call is labelled with its own name', realToolName('nobogent_whatsapp_send_template', directly) === 'nobogent_whatsapp_send_template');
  check(
    'both staged approvals are pending, so the transcript collapses them to one card',
    pendingApprovalFrom(proxied)?.actionType === pendingApprovalFrom(directly)?.actionType,
    pendingApprovalFrom(directly)?.actionType
  );

  console.log('\n▸ the approval, once given, actually runs the work');
  if (card?.actionId) {
    store.rows.find((r) => r.actionId === card.actionId)!.status = 'approved';
    const afterApproval = await call.execute({
      name: 'nobogent_whatsapp_send_template',
      arguments: { ...args, approvalId: card.actionId },
    });
    const inner = realToolOutput(afterApproval);
    check('an approved action runs through the proxy', inner?.success === true, inner?.messageId ?? inner?.error);
    check('…and no card is staged a second time', artifactFrom(afterApproval) === null);
  }

  console.log('\n▸ artefacts other than approvals survive too');
  const image = await call.execute({ name: 'look_at_picture', arguments: {} });
  check('an image artefact comes through the proxy', artifactFrom(image)?.type === 'image_preview', artifactFrom(image)?.type);
  const question = await call.execute({ name: 'ask_the_owner', arguments: {} });
  check(
    'a question artefact comes through the proxy',
    artifactFrom(question)?.type === 'user_input_prompt',
    artifactFrom(question)?.type
  );

  console.log('\n▸ nothing is invented');
  const plain = await call.execute({ name: 'plain_reader', arguments: {} });
  check('a result with no artifact yields no card', artifactFrom(plain) === null);
  check('…and is not treated as a pending approval', pendingApprovalFrom(plain) === null);
  check('…and is not treated as failed', isFailedToolOutput(plain) === false);

  const broken = await call.execute({ name: 'broken_tool', arguments: { } });
  check('a tool that throws comes back as a failure', isFailedToolOutput(broken) === true, realToolOutput(broken)?.error);
  check('…and stages no card', artifactFrom(broken) === null);

  console.log('\n▸ malformed input cannot crash a renderer');
  for (const bad of [null, undefined, 42, 'text', [], { ok: true }, { ok: true, result: null }]) {
    let threw = false;
    try {
      artifactFrom(bad);
      realToolOutput(bad);
      realToolName('call_tool', bad);
      isFailedToolOutput(bad);
      pendingApprovalFrom(bad);
    } catch {
      threw = true;
    }
    check(`safe on ${JSON.stringify(bad) ?? 'undefined'}`, !threw);
  }

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} checks passed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFAILED:', err?.message || err);
  process.exit(1);
});
