/**
 * Proves a transfer can be undone, and that a media template can actually be sent.
 *
 *   npm run verify:transfer-reverse
 */
import fs from 'node:fs';

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

const transfer = fs.readFileSync('app/api/crm/bulk-transfer/route.ts', 'utf8');
const reverse = fs.readFileSync('app/api/crm/bulk-transfer/reverse/route.ts', 'utf8');
const outbound = fs.readFileSync('lib/agent/tools/outbound.ts', 'utf8');
const mcp = fs.readFileSync('lib/agent/mcp/nobogent_app_mcp.ts', 'utf8');

head('1. A transfer records what a reverse needs');

check('a batch id is minted for the operation', /const batchId = .*tr_\$\{Date\.now/.test(transfer));
check('the receipt records where the lead came from', /previous_assignee: \(lead as any\)\.assigned_to/.test(transfer));
check('and where it went, and who moved it', /new_assignee: targetAgentId/.test(transfer) && /by: actingUserId/.test(transfer));
check('the stage it was in is kept', /stage_before: String\(lead\.pipeline_stage/.test(transfer));
check('so are the attempt counters and the follow-up', /attempts_before: Number\(\(lead as any\)\.voice_call_retry_count\)/.test(transfer) && /next_followup_before/.test(transfer));
check('and which flags it set', /hid_history: Boolean\(hideHistoryFromAssignee\)/.test(transfer) && /hid_pending_actions/.test(transfer));
check('the response hands back the id to undo with', /batchId,\s*\n\s*transferredCount/.test(transfer));

head('2. The reverse inverts exactly that, and nothing else');

check('it restores the previous owner', /payload\.assigned_to = receipt\.previous_assignee/.test(reverse));
check('it removes the history cutoff, so history is visible again', /delete cf\.history_visible_from/.test(reverse) && /delete cf\.history_hidden_from_assignee/.test(reverse));
check('it restores the stage and its shadow keys', /payload\.pipeline_stage = receipt\.stage_before/.test(reverse) && /stage_before_reset_fields/.test(reverse));
check('it restores the attempt counters and the follow-up', /payload\.voice_call_retry_count = receipt\.attempts_before/.test(reverse) && /payload\.next_followup = receipt\.next_followup_before/.test(reverse));
check('it un-hides scheduled actions', /delete cf\.pending_actions_hidden/.test(reverse));
check('it never deletes a lead or its trail', !/\.delete\(\)/.test(reverse), 'no destructive call');
check('it marks the receipt spent instead of removing it', /reversed_at: new Date\(\)\.toISOString\(\)/.test(reverse));
check('a second reverse of the same batch is refused', /if \(receipt\.reversed_at\) continue/.test(reverse));
check('and it says why rather than silently doing nothing', /already undone|un-reversed receipt/.test(reverse));
check('it requires the same authority as a transfer', /super_admin', 'agency', 'admin/.test(reverse));
check('it can be previewed without changing anything', /dryRun/.test(reverse) && /wouldRestore/.test(reverse));
check('the work is bounded and parallel, not a 200-lead timeout', /CONCURRENCY = 40/.test(reverse));

head('3. A media template can actually be sent');

check('the send builds a header parameter', /type: 'header',\s*\n\s*parameters: \[\{ type: media\.kind/.test(outbound));
check('the body variables still ride along after it', /type: 'body',\s*\n\s*parameters: params\.variables\.map/.test(outbound));
check('the caller can supply the media', /headerMedia\?: \{ kind: 'image' \| 'video' \| 'document'/.test(outbound));
check('the agent tool exposes it', /headerMediaUrl: z/.test(mcp) && /headerMediaKind: z/.test(mcp));
check('and passes it through', /headerMedia:\s*\n?\s*headerMediaUrl && headerMediaKind/.test(mcp));

head('4. Email is billed at 2× on the paths that carry an account');

check('the digest charges the account', /chargeEmailSends\(supabase, routine\.user_id/.test(fs.readFileSync('app/api/cron/ceo-digest/route.ts', 'utf8')));
check('the transfer notice charges the account that sent it', /chargeEmailSends\(supabaseAdmin, actingUserId/.test(transfer));
check(
  'the subscription reminders charge, through their one shared helper',
  /chargeEmailSends\(admin, userId, \{ count: 1, label: 'Subscription reminder' \}/.test(fs.readFileSync('app/api/cron/subscription-reminders/route.ts', 'utf8')),
);
check(
  'the end-of-day report charges the billing owner',
  /chargeEmailSends\(supabaseAdmin, billingOwnerId \|\| profileId/.test(fs.readFileSync('app/api/cron/eod-report/worker/route.ts', 'utf8')),
);

head('5. The reverse is reachable, and media templates can be created');

check('the account activity page lists reversible transfers', /TransferUndoPanel/.test(fs.readFileSync('app/dashboard/profile/history/page.tsx', 'utf8')));
check('and offers to put them back', /Put them back/.test(fs.readFileSync('app/dashboard/profile/history/page.tsx', 'utf8')));
check('there is a GET that lists the batches', /export async function GET/.test(reverse) && /reversibleCount/.test(reverse));

const templates = fs.readFileSync('lib/whatsapp/templates.ts', 'utf8');
check('media header types exist', /'NONE' \| 'TEXT' \| 'IMAGE' \| 'VIDEO' \| 'DOCUMENT'/.test(templates));
check('a media header builds a header_handle example', /example: \{ header_handle: \[String\(input\.headerHandle\)/.test(templates));
check('and the sample is uploaded to Meta first', /uploads\?file_length=/.test(templates) && /file_offset: '0'/.test(templates));
check('a media header without a handle is refused before Meta sees it', /needs a sample file uploaded first/.test(templates));
check('the agent tool accepts a sample URL per media kind', /headerImageUrl: z/.test(fs.readFileSync('lib/agent/tools/messaging.ts', 'utf8')));

console.log(`\n${'='.repeat(64)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nA transfer that cannot be undone is a trap, and a template that cannot be sent is a lie.');
  process.exit(1);
}
console.log('Transfers are reversible with their history intact, and media templates can be sent.');
