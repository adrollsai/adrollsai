/**
 * ONE APPROVAL ROUND TRIP, ONE REAL WHATSAPP.
 *
 * The complaint this closes: "approve used to do nothing". The unit gates prove the pieces
 * separately — verify:review-gate proves the gate refuses and records, verify:approval-loop-live
 * proves an approved id runs its exact call — and verify:outbound-live proves the channel reaches
 * the owner. None of them proves the whole sentence: that a message the owner approved is the
 * message that a real customer-facing provider then accepted, with nothing recited from a summary.
 *
 * So this runs all five steps against the real database and the real Graph API:
 *
 *   1. call the GATED tool with no approval   -> it must REFUSE and record a card
 *   2. read the recorded row                  -> it must hold the tool's exact arguments
 *   3. approve it the way the UI's tap does   -> mark the event approved
 *   4. call the tool again with only approvalId -> the approved arguments must be replayed
 *   5. re-read the row                        -> it must be SPENT (status 'used'), not still valid
 *
 * Step 5 is the one that stops an approval authorising the same send over and over.
 *
 * SAFETY: the recipient is forced to the owner's own number and the script refuses to run if the
 * configured target is anything else. No lead, no customer, no list is ever touched.
 *
 *   npx esbuild scripts/verify-approval-whatsapp-live.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-approval-wa.mjs && node .tmp-approval-wa.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

dotenv.config({ path: '.env.local', quiet: true });

const OWNER_EMAIL = 'rchopra489@gmail.com';
const OWNER_NUMBER = '918288835235';

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

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

// The rail: one number only.
const target = process.env.OUTBOUND_TEST_MODE === 'true'
  ? String(process.env.OUTBOUND_TEST_NUMBER || '').replace(/\D/g, '')
  : OWNER_NUMBER;
if (target !== OWNER_NUMBER) {
  console.error(
    `REFUSING: this proof may only reach ${OWNER_NUMBER}, but the configured target is ` +
      `"${target || '(empty)'}". Fix OUTBOUND_TEST_NUMBER before running it.`,
  );
  process.exit(1);
}

const owner = await admin
  .from('profiles')
  .select('id, business_name, contact_number')
  .eq('email', OWNER_EMAIL)
  .maybeSingle();
if (!owner.data?.id) {
  console.error('owner profile not found');
  process.exit(1);
}
const OWNER_ID = String(owner.data.id);
console.log(`account : ${owner.data.business_name} (${OWNER_ID.slice(0, 8)}…)`);
console.log(`target  : ${target} (owner only)`);
console.log(`testmode: ${process.env.OUTBOUND_TEST_MODE}\n`);

const ctx = await createAgentContext(admin as any, OWNER_ID, { intentText: 'send a whatsapp template to the owner' });
const tools = ctx.tools as any;
const send = tools.nobogent_whatsapp_send_template;
if (!send || typeof send.execute !== 'function') {
  console.error('nobogent_whatsapp_send_template is not in the toolset');
  process.exit(1);
}

// A template that actually exists on the WABA the app sends through, or Meta rejects the send for
// a reason that has nothing to do with the gate. `nobogent_whatsapp_list_templates` reads the local
// whatsapp_templates table, which is empty for the platform account, so ask Meta directly.
const ownerRow = await admin
  .from('profiles')
  .select('facebook_token, whatsapp_waba_id, whatsapp_phone_number_id')
  .eq('id', OWNER_ID)
  .maybeSingle();
const token = String(
  (ownerRow.data as any)?.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN || '',
).replace(/^["']|["']$/g, '').trim();
const wabaId = String((ownerRow.data as any)?.whatsapp_waba_id || process.env.DEV_WHATSAPP_WABA_ID || '');

let templateName = String(process.env.APPROVAL_PROOF_TEMPLATE || '');
if (!templateName && token && wabaId) {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${wabaId}/message_templates?fields=name,status,language,components&limit=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body: any = await res.json().catch(() => ({}));
  const approved: any[] = (body?.data ?? []).filter((t: any) => t.status === 'APPROVED');
  // Only a template that needs NOTHING but a recipient can be sent with variables: []. Two traps,
  // both of which read as a gate bug when they are not:
  //   - a MEDIA header (IMAGE / VIDEO / DOCUMENT) is itself a parameter and must be supplied;
  //   - {{n}} placeholders can sit in the body, and a wrong shape is rejected as 132012.
  const MEDIA_HEADERS = new Set(['IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION']);
  const sendsBare = (t: any) => {
    const comps = t.components ?? [];
    const header = comps.find((c: any) => String(c.type).toUpperCase() === 'HEADER');
    if (header && MEDIA_HEADERS.has(String(header.format ?? '').toUpperCase())) return false;
    const texts = comps
      .map((c: any) => String(c.text ?? ''))
      .join(' ');
    return !/\{\{\s*\d+\s*\}\}/.test(texts);
  };
  const bare = approved.filter(sendsBare);
  // hello_world is Meta's own test template: no placeholders, a plain TEXT header.
  const simple = bare.find((t) => t.name === 'hello_world') ?? bare[0];
  templateName = simple?.name ?? '';
  console.log(
    `templates on ${wabaId}: ${approved.length} approved, ${bare.length} sendable with no parameters; using ` +
      `${templateName ? `"${templateName}"` : 'NONE'}`,
  );
}
if (!templateName) {
  console.error(
    'Could not find an approved template with no variables on this WABA. Set ' +
      'APPROVAL_PROOF_TEMPLATE to one, or the send fails on template grounds rather than on the gate.',
  );
  process.exit(1);
}
console.log(`template: ${templateName}\n`);

const args = { phone: target, templateName, variables: [] as string[] };

// ── 1. Unapproved: must refuse, and record the card with the tool's OWN arguments.
console.log('▸ step 1: calling the gated tool with no approval');
const first = await send.execute(args, {} as any);
check('the gate refuses an unapproved send', first?.needs_review === true, `actionType=${first?.actionType}`);
const actionId = String(first?.actionId ?? '');
check('the refusal carries an actionId the chat can render', Boolean(actionId), actionId);

// ── 2. The recorded row must hold the exact arguments, not a summary.
console.log('\n▸ step 2: reading the recorded card');
const rowRes = await admin
  .from('agent_events')
  .select('id, status, payload')
  .eq('user_id', OWNER_ID)
  .eq('event_type', 'PENDING_ACTION_APPROVAL')
  .eq('payload->>actionId', actionId)
  .maybeSingle();
const row: any = rowRes.data;
check('a pending row exists for that actionId', row?.status === 'pending', row?.status ?? rowRes.error?.message);
const recorded = row?.payload?.actionPayload ?? {};
check(
  'the row holds the tool arguments (phone, templateName), not a plan summary',
  recorded.phone === args.phone && recorded.templateName === args.templateName,
  JSON.stringify(recorded).slice(0, 200),
);
check('the row names the tool that will run', row?.payload?.targetTool === 'nobogent_whatsapp_send_template', String(row?.payload?.targetTool));

// ── 3. Approve, exactly as the Approve button does.
console.log('\n▸ step 3: approving (what the UI tap does)');
const approved = await admin
  .from('agent_events')
  .update({ status: 'approved', updated_at: new Date().toISOString() })
  .eq('id', row.id);
check('the approval was recorded', !approved.error, approved.error?.message ?? '');

// ── 4. Resume by approvalId only: the approved arguments must be replayed, and it must really send.
console.log('\n▸ step 4: calling again with only the approvalId');
const second = await send.execute({ approvalId: actionId }, {} as any);
console.log('   provider said:', JSON.stringify(second).slice(0, 700));
check('the approved send actually ran', second?.success === true, String(second?.error ?? ''));
check('Meta accepted the message and returned an id', Boolean(second?.messageId), String(second?.messageId ?? ''));
check('it went to the owner, not a customer', String(second?.to ?? '').replace(/\D/g, '').endsWith(OWNER_NUMBER), String(second?.to ?? ''));

// ── 5. One approval, one run: the row must now be spent.
console.log('\n▸ step 5: the approval must be consumed');
const after = await admin
  .from('agent_events')
  .select('status')
  .eq('id', row.id)
  .maybeSingle();
check('the approval is spent, not still valid', (after.data as any)?.status === 'used', (after.data as any)?.status ?? '');

const again = await send.execute({ approvalId: actionId }, {} as any);
check('re-using the same approval is refused', again?.needs_review === true || again?.success === false, JSON.stringify(again).slice(0, 160));

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
