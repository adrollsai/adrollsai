/**
 * CEO surfaces: the two emails, and approve/skip/change from WhatsApp.
 *
 * What this checks:
 *   1. the morning and evening emails carry the four sections, in words a client reads
 *   2. an "APPROVE" reply resolves the pending approval and queues the work
 *   3. a "SKIP" reply closes it and generates nothing
 *   4. a sentence gets treated as a change, not as approval
 *   5. a one-word non-answer asks instead of guessing
 *   6. a lead's reply is left alone ('none') so normal CRM handling still runs
 *
 *   npm run verify:ceo
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildDigest } from '../lib/agent/digest';
import { phoneTail } from '../lib/agent/approval-whatsapp';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

async function main() {
  // ---------------------------------------------------------------- emails
  const morning = buildDigest({
    businessName: 'HomCom Realtors',
    slot: 'morning',
    dateLabel: 'Thursday 12 Nov',
    done: [{ label: 'Hero creative for Palm Greens', detail: '9:16 + 1:1, Hinglish voiceover' }],
    needsYou: [{ label: 'Approve the creative plan', detail: 'about ₹7' }],
    notDone: [],
    tomorrow: 'Saturday open-house reel (approx 59 credits).',
    creditsSpent: 0,
    creditsLeft: 820,
    ceoUrl: 'https://app.example.com/dashboard/ceo',
  });
  check('morning subject names the business and the day', /HomCom Realtors/.test(morning.subject) && /12 Nov/.test(morning.subject));
  check('morning email has the plan section', /What I am doing today/.test(morning.html));
  check('morning email has needs-you', /Needs you/.test(morning.html));
  check('morning email always shows not-done', /Not done, and why/.test(morning.html));
  check('morning email shows the money', /820/.test(morning.html));
  check('morning email links to the CEO tab', /dashboard\/ceo/.test(morning.html));
  check('morning text version is readable', /NEEDS YOU:/.test(morning.text) && /TOMORROW:/.test(morning.text));

  const eod = buildDigest({
    businessName: 'HomCom Realtors',
    slot: 'eod',
    dateLabel: 'Thursday 12 Nov',
    done: [{ label: '2 creatives sent' }],
    needsYou: [],
    notDone: [{ label: 'Reel skipped', detail: 'only 40 credits left, needs 59' }],
    creditsSpent: 9,
    creditsLeft: 811,
  });
  check('evening subject reads as a wrap', /wrap/i.test(eod.subject));
  check('evening email says nothing is pending when nothing is', /nothing — no action needed/.test(eod.html));
  check('evening email names what was skipped and why', /Reel skipped/.test(eod.html) && /40 credits left/.test(eod.html));

  const quiet = buildDigest({ businessName: 'X', slot: 'morning', dateLabel: 'Friday 13 Nov' });
  check('a quiet day still produces a full email', /nothing planned yet/.test(quiet.html) && /nothing skipped/.test(quiet.html));

  // ---------------------------------------------------------------- phone matching
  check('phone tails ignore +91 and spaces', phoneTail('+91 98726 69935') === '9872669935', phoneTail('+91 98726 69935'));
  check('phone tail of a short number still works', phoneTail('9872669935') === '9872669935');

  // ---------------------------------------------------------------- live resolver
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: profile } = await sb
    .from('profiles')
    .select('id, email, whatsapp_phone_number, contact_number')
    .not('whatsapp_phone_number', 'is', null)
    .limit(1)
    .maybeSingle();

  if (!profile?.whatsapp_phone_number) {
    console.log('\nSKIP live resolver checks — no profile has a whatsapp_phone_number set');
    console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} checks passed`);
    if (fail) process.exit(1);
    return;
  }

  const { resolveApprovalReply, pendingApprovalsForPhone } = await import('../lib/agent/approval-whatsapp');
  // Seed against the profile the resolver itself resolves this phone to, otherwise the
  // test proves nothing about the real lookup path.
  const probe = await pendingApprovalsForPhone(sb, profile.whatsapp_phone_number);
  if (!probe.userId) {
    console.log('\nSKIP live resolver checks — that phone does not resolve to a profile');
    console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} checks passed`);
    if (fail) process.exit(1);
    return;
  }
  const ownerUserId = probe.userId;
  const phone = profile.whatsapp_phone_number as string;
  const phone2 = phone;
  const created: string[] = [];

  const seed = async (title: string) => {
    const id = crypto.randomUUID();
    const actionId = 'act_verify_' + Math.random().toString(36).slice(2, 10);
    const { error } = await sb.from('agent_events').insert({
      id,
      user_id: ownerUserId,
      event_type: 'PENDING_ACTION_APPROVAL',
      status: 'pending',
      scheduled_for: new Date().toISOString(),
      payload: {
        actionId,
        actionType: 'create_asset',
        title,
        description: 'test approval',
        estimatedCost: '₹7',
        spec: [{ label: 'Dimensions', value: '9:16' }],
        resumePrompt: 'Approved — generate the staged creative now.',
      },
    });
    if (error) throw new Error(error.message);
    created.push(id);
    return id;
  };

  try {
    // Lead-ish reply: no pending approval → must be left alone.
    await sb
      .from('agent_events')
      .update({ status: 'rejected' })
      .eq('user_id', ownerUserId)
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .eq('status', 'pending');
    const none = await resolveApprovalReply(sb, phone2, 'approve');
    check("with nothing pending it stays out of the way", none.kind === 'none');

    const approveId = await seed('Approve the Palm Greens creative');
    const approved = await resolveApprovalReply(sb, phone, 'APPROVE');
    check('APPROVE resolves as approved', approved.kind === 'approved', approved.message);
    const { data: afterApprove } = await sb.from('agent_events').select('status').eq('id', approveId).single();
    check('the approval row is marked approved', afterApprove?.status === 'approved', afterApprove?.status);

    const skipId = await seed('Approve the Saturday reel');
    const skipped = await resolveApprovalReply(sb, phone, 'skip');
    check('SKIP resolves as skipped', skipped.kind === 'skipped');
    const { data: afterSkip } = await sb.from('agent_events').select('status').eq('id', skipId).single();
    check('the approval row is marked rejected', afterSkip?.status === 'rejected', afterSkip?.status);

    const editId = await seed('Approve the price-led poster');
    const edited = await resolveApprovalReply(sb, phone, 'headline shorter please and no price on the poster');
    check('a sentence is treated as a change', edited.kind === 'edit');
    check('the owner’s words survive intact', /headline shorter please/.test(edited.instruction || ''));
    const { data: afterEdit } = await sb.from('agent_events').select('status').eq('id', editId).single();
    check('a change request leaves the approval open', afterEdit?.status === 'pending', afterEdit?.status);

    const ambId = await seed('Approve the Diwali greeting');
    const ambiguous = await resolveApprovalReply(sb, phone, 'hmm');
    check('a one-word non-answer asks instead of acting', ambiguous.kind === 'none');
    const { data: afterAmb } = await sb.from('agent_events').select('status').eq('id', ambId).single();
    check('the ambiguous reply does not close the approval', afterAmb?.status === 'pending');
  } finally {
    for (const id of created) await sb.from('agent_events').delete().eq('id', id);
  }

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} checks passed`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error('verify-ceo crashed:', e?.message || e);
  process.exit(1);
});
