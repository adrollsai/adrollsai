/**
 * Live round trip for the review gate: pending → approved → runs, and nothing wider than that.
 *
 * WHY THIS IS SEPARATE FROM verify:review-gate
 * That gate proves the LOGIC with a fake store. This one proves the WIRING: that a row written
 * the way `request_human_approval` writes it, in the real `agent_events` table, is the same row
 * `supabaseApprovalStore` finds and `isApproved` accepts. A gate that passes unit tests while
 * reading the wrong column is exactly the kind of thing that fails on the night it matters.
 *
 * WHAT IT DOES NOT DO
 * It never calls a spending tool. It wraps two STUB tools with `applyReviewGate` and counts how
 * many times the stub body actually ran. No ad is launched, no message is sent, no money moves.
 *
 * SAFETY OF WRITING TO PRODUCTION
 * Rows are inserted against a real profile (so any foreign key is satisfied) and carry a marker
 * in the name; every one is deleted in a `finally` block, and the script re-reads the table to
 * prove nothing was left behind.
 *
 *   npm run verify:review-gate-live
 */
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  applyReviewGate,
  approveFingerprint,
  reviewPolicyFor,
  supabaseApprovalStore,
} from '../lib/agent/review-gate';

config({ path: '.env.local', quiet: true });

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const MARKER = `live-gate-proof-${Date.now()}`;
const insertedIds: string[] = [];

/** The exact ad the owner would approve. */
const LAUNCH = { campaign_name: 'Diwali Batch 12', daily_budget_paise: 50000, page_id: 'pg_123' };
/** Same campaign, ten times the budget. Must never ride on the first approval. */
const LAUNCH_BIG = { campaign_name: 'Diwali Batch 12', daily_budget_paise: 500000, page_id: 'pg_123' };

async function main() {
  head('0. Setup — a real owner, and two stub tools behind the real gate');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, business_name')
    .limit(1)
    .maybeSingle();
  if (profileError || !profile?.id) {
    console.error('Could not read a profile to test against:', profileError?.message);
    process.exitCode = 1;
    return;
  }
  const userId = profile.id as string;
  console.log(`      testing as profile ${userId.slice(0, 8)}… (${profile.business_name ?? 'unnamed'})`);

  // Stub bodies that record whether the gate let them through. They are named exactly as the
  // real tools so REVIEW_POLICY applies unchanged.
  let launchRuns = 0;
  let whatsappRuns = 0;
  const tools = applyReviewGate(
    {
      meta_mcp_launch_leadgen_campaign: {
        execute: async (input: any) => {
          launchRuns++;
          return { success: true, ran: input };
        },
      },
      nobogent_whatsapp_send_template: {
        execute: async (input: any) => {
          whatsappRuns++;
          return { success: true, ran: input };
        },
      },
      list_products: { execute: async () => ({ success: true }) },
    },
    supabaseApprovalStore(supabase, userId),
  );

  const launch = (input: unknown) => tools.meta_mcp_launch_leadgen_campaign.execute(input) as Promise<any>;

  check(
    'an ungated tool is untouched and needs no approval',
    (await tools.list_products.execute({}))?.success === true,
    'list_products ran',
  );
  check(
    'both spending/reaching tools are in the policy',
    reviewPolicyFor('meta_mcp_launch_leadgen_campaign')?.actionType === 'ad_spend' &&
      reviewPolicyFor('nobogent_whatsapp_send_template')?.actionType === 'whatsapp_broadcast',
    'ad_spend + whatsapp_broadcast',
  );

  head('1. With NO approval on record, the launch does not run');

  const first = await launch(LAUNCH);
  check(
    'the tool refuses and the stub body never executes',
    first?.needs_review === true && launchRuns === 0,
    `needs_review=${first?.needs_review}, body runs=${launchRuns}`,
  );
  check(
    'the refusal hands back the exact call to request, payload included',
    first?.call?.tool === 'request_human_approval' &&
      approveFingerprint(first?.call?.actionPayload) === approveFingerprint(LAUNCH),
    first?.call?.title,
  );

  head('2. A PENDING row is not an approval');

  const { data: pendingRow, error: pendingError } = await supabase
    .from('agent_events')
    .insert({
      user_id: userId,
      event_type: 'PENDING_ACTION_APPROVAL',
      status: 'pending',
      scheduled_for: new Date().toISOString(),
      payload: {
        actionType: 'ad_spend',
        actionPayload: LAUNCH,
        title: `${MARKER} pending`,
        description: 'waiting on the owner',
      },
    })
    .select('id')
    .single();
  if (pendingError || !pendingRow) {
    console.error('Could not write the pending row:', pendingError?.message);
    process.exitCode = 1;
    return;
  }
  insertedIds.push(pendingRow.id as string);

  const stillBlocked = await launch(LAUNCH);
  check(
    'status="pending" still refuses to run',
    stillBlocked?.needs_review === true && launchRuns === 0,
    `row ${String(pendingRow.id).slice(0, 8)}… is pending`,
  );

  head('3. The owner approves — the SAME action now runs');

  const { error: approveError } = await supabase
    .from('agent_events')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', pendingRow.id);
  check('the approval was written', !approveError, approveError?.message ?? 'status flipped to approved');

  const approvedRun = await launch(LAUNCH);
  check(
    'the identical call is let through',
    approvedRun?.success === true && launchRuns === 1,
    `body runs=${launchRuns}`,
  );

  head('4. The approval is NOT wider than what was approved');

  const bigger = await launch(LAUNCH_BIG);
  check(
    'ten times the budget is a different action and is refused',
    bigger?.needs_review === true && launchRuns === 1,
    `₹${(LAUNCH_BIG.daily_budget_paise / 100).toFixed(0)}/day refused; ₹${(LAUNCH.daily_budget_paise / 100).toFixed(0)}/day allowed`,
  );
  check(
    'a different campaign name is refused too',
    (await launch({ ...LAUNCH, campaign_name: 'Eid Batch 3' }))?.needs_review === true && launchRuns === 1,
    'name is part of the fingerprint',
  );

  const whatsapp = await tools.nobogent_whatsapp_send_template.execute({
    template_name: 'diwali_offer',
    to: ['919000000000'],
  });
  check(
    'an ad_spend approval does not unlock a WhatsApp broadcast',
    whatsapp?.needs_review === true && whatsappRuns === 0,
    'action types are separate',
  );

  head('5. The fingerprint is exact but not brittle');

  const reordered = await launch({
    page_id: LAUNCH.page_id,
    daily_budget_paise: LAUNCH.daily_budget_paise,
    campaign_name: LAUNCH.campaign_name,
  });
  check(
    'the same arguments in a different key order still match',
    reordered?.success === true && launchRuns === 2,
    'key order normalised, so the gate is usable',
  );

  head('6. Unreadable approvals fail CLOSED');

  const brokenStore = {
    approved: async () => {
      throw new Error('connection reset');
    },
  };
  const brokenTools = applyReviewGate(
    { meta_mcp_launch_leadgen_campaign: { execute: async () => ({ success: true }) } },
    brokenStore as any,
  );
  const broken = await brokenTools.meta_mcp_launch_leadgen_campaign.execute(LAUNCH);
  check(
    'when the store throws, the tool is refused rather than released',
    broken?.needs_review === true,
    'a stuck button, never an unreviewed launch',
  );

  head('7. Cleanup');

  const { error: cleanupError } = await supabase.from('agent_events').delete().in('id', insertedIds);
  const { count: leftovers } = await supabase
    .from('agent_events')
    .select('id', { count: 'exact', head: true })
    .in('id', insertedIds);
  check(
    'the test rows are gone from production',
    !cleanupError && leftovers === 0,
    `${insertedIds.length} row(s) deleted`,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

void main().catch(async (error) => {
  console.error('live gate proof crashed:', error);
  if (insertedIds.length) await supabase.from('agent_events').delete().in('id', insertedIds);
  process.exitCode = 1;
});
