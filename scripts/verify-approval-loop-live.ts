/**
 * The whole gate loop, against production, without a model in the way.
 *
 * WHAT THIS PROVES that the unit gates cannot: that the pieces are wired to each other in the
 * deployed database â€” the gate records the exact tool arguments, the approval row is the same
 * row the UI approves, and an approved id then RUNS that exact call.
 *
 * It deliberately spends a small, bounded amount: one image generation (8 credits) on a
 * throwaway account. That is the only way to know the launch button works; every cheaper test
 * stops one step short of the part that was broken.
 *
 * It never launches an ad, sends a message or places a call.
 *
 *   npm run verify:approval-loop-live
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

// The tools read their keys from process.env, so without this the generation fails with
// "KIE_API_KEY is not configured" â€” which looks exactly like a product bug and is not one.
dotenv.config({ path: '.env.local', quiet: true });

function env(name: string): string {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const m = raw.match(new RegExp('^' + name + '=(.*)$', 'm'));
  if (!m) throw new Error(`missing ${name}`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const url = env('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  â€” ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  â€” ${detail}` : ''}`);
  }
};
const head = (title: string) => console.log(`\nâ”€â”€ ${title} ${'â”€'.repeat(Math.max(0, 58 - title.length))}`);

const IMAGE_CALL = {
  // Unique per run: an identical payload would legitimately match an approval left by an earlier
  // run, and then this proof would be testing the fingerprint path instead of the fresh one.
  prompt:
    `[loop proof ${Date.now().toString(36)}] ` +
    'A single, clean 1:1 square announcement poster for a pilates studio. Deep navy background, ' +
    'large crisp white headline reading "BATCH 12", a thin gold hairline rule beneath it, and a ' +
    'small footer line reading "Launch Check Studio". Typography only, generous margins, no ' +
    'photography, no people, no invented prices or claims.',
  aspectRatio: '1:1' as const,
};

async function main() {
  const { data: profile } = await admin
    .from('profiles')
    .select('id, business_name, credits')
    .like('email', '%@nobogent.test')
    .limit(1)
    .maybeSingle();
  if (!profile?.id) throw new Error('no @nobogent.test account â€” refusing to run against a real customer');
  const userId = profile.id as string;
  console.log(`account: ${profile.business_name} (${userId.slice(0, 8)}â€¦) credits=${profile.credits}`);

  const ctx = await createAgentContext(admin, userId, { intentText: 'make a 1:1 announcement image' });
  const tools = ctx.tools as any;
  check('the gate is applied in the real orchestrator', typeof tools.generate_ai_image?.execute === 'function', 'generate_ai_image present');

  head('1. An unapproved spend is refused, and the refusal is recorded with the REAL arguments');

  const before = await admin
    .from('agent_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', 'PENDING_ACTION_APPROVAL')
    .eq('status', 'pending');

  const blocked = await tools.generate_ai_image.execute(IMAGE_CALL);
  check('the tool did not run', blocked?.needs_review === true, String(blocked?.why ?? ''));
  check(
    'the agent is handed a card it can show without transcribing',
    blocked?.artifact?.type === 'action_confirmation' && typeof blocked?.actionId === 'string',
    String(blocked?.actionId ?? ''),
  );
  check('the agent is told not to stage a second card', /do NOT call request_human_approval/.test(String(blocked?.message)), 'one card');

  const { data: row } = await admin
    .from('agent_events')
    .select('id, status, payload')
    .eq('user_id', userId)
    .eq('event_type', 'PENDING_ACTION_APPROVAL')
    .eq('payload->>actionId', blocked.actionId)
    .maybeSingle();

  check('a pending row exists for exactly that actionId', Boolean(row?.id) && row?.status === 'pending', `row ${String(row?.id).slice(0, 8)}â€¦`);
  const storedPayload = row?.payload?.actionPayload ?? {};
  check(
    'the stored payload is the TOOL input, not a description of it',
    typeof storedPayload.prompt === 'string' && storedPayload.prompt.length > 60 && storedPayload.aspectRatio === '1:1',
    `prompt ${String(storedPayload.prompt ?? '').length} chars, aspectRatio ${String(storedPayload.aspectRatio)}`,
  );
  check(
    'the row names the tool that must run',
    row?.payload?.targetTool === 'generate_ai_image',
    String(row?.payload?.targetTool ?? '(missing)'),
  );
  check(
    'the owner can tell what they are approving',
    /image/i.test(String(row?.payload?.why ?? row?.payload?.description ?? '')),
    String(row?.payload?.description ?? '').slice(0, 80),
  );

  head('2. The approval is what the UI flips â€” then the SAME call runs');

  const { error: approveError } = await admin
    .from('agent_events')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', row!.id);
  check('the approval was written', !approveError, approveError?.message ?? 'status=approved');

  // NOTE: this is a deliberate real generation â€” 8 credits â€” because the failure being tested
  // only appears when the tool actually executes.
  console.log('\n      running the approved generation (this spends 8 credits)â€¦');
  const ran = await tools.generate_ai_image.execute({ approvalId: blocked.actionId });
  const output = ran ?? {};
  const imageUrl =
    output.imageUrl || output.url || output.assetUrl || output?.result?.imageUrl || output?.result?.url || '';

  check('the approved call was not blocked again', output?.needs_review !== true, output?.why ? String(output.why) : 'ran');
  check('it succeeded', output?.success !== false, String(output?.error ?? output?.message ?? 'success').slice(0, 140));
  check('an image came back', typeof imageUrl === 'string' && /^https?:\/\//.test(imageUrl), imageUrl.slice(0, 90));

  if (imageUrl) {
    const head200 = await fetch(imageUrl, { method: 'HEAD' }).catch(() => null);
    check('the image is publicly reachable', !!head200 && head200.ok, head200 ? `HTTP ${head200.status}` : 'no response');
  }

  const { data: after } = await admin
    .from('profiles')
    .select('credits')
    .eq('id', userId)
    .maybeSingle();
  console.log(`\n      credits after: ${after?.credits} (was ${profile.credits})`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

await main().catch((error) => {
  console.error('live approval loop crashed:', error?.message || error);
  process.exitCode = 1;
});

