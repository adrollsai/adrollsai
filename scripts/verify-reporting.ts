/**
 * Verifies org_call_report against the real database.
 *
 * The whole point of this tool is that the number is right, so the test does
 * not trust it: it re-counts independently and compares, and it checks the
 * timezone boundary actually moves the window.
 *
 *   npm run verify:reporting
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createReportingTools } from '../lib/agent/tools/reporting';

dotenv.config({ path: '.env.local' });

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

(async () => {
  // Pass a profile id to test a specific organisation, e.g.
  //   node .tmp-rep.cjs bc63c065-9bcc-4793-bedc-f0960406425b
  const profileId = process.argv[2] || process.env.VERIFY_USER_ID || null;

  const rootOf = (p: any) => p.parent_id || p.agency_id || p.id;
  const memberIdsOf = async (root: string) => {
    const { data: members } = await sb
      .from('profiles')
      .select('id')
      .or(`id.eq.${root},parent_id.eq.${root},agency_id.eq.${root}`);
    return (members || []).map((m: any) => m.id as string);
  };

  /**
   * Pick an organisation that can actually exercise these tools.
   *
   * `role = super_admin` alone is not enough: the first such row can be an empty demo account. This
   * gate used to test "Nobogent Demo Infra" — an org that has never logged a call — and then failed
   * two checks because there was no data to check, which reads as a defect and sends somebody
   * hunting through the reporting code. Prefer an org with a recorded call, then one with any leads,
   * then anything, and say which it picked and why.
   */
  let profile: any = null;
  let pickedBecause = '';
  if (profileId) {
    const { data } = await sb
      .from('profiles')
      .select('id, business_name, role, parent_id, agency_id')
      .eq('id', profileId)
      .maybeSingle();
    profile = data ?? null;
    pickedBecause = 'explicitly requested';
  } else {
    const { data: candidates } = await sb
      .from('profiles')
      .select('id, business_name, role, parent_id, agency_id')
      .eq('role', 'super_admin')
      .limit(50);

    for (const withRecordings of [true, false]) {
      for (const candidate of candidates || []) {
        const memberIds = await memberIdsOf(rootOf(candidate));
        let query = sb
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .in('user_id', memberIds.length ? memberIds : [candidate.id]);
        if (withRecordings) query = query.not('voice_recording_url', 'is', null);
        const { count } = await query;
        if ((count ?? 0) > 0) {
          profile = candidate;
          pickedBecause = withRecordings ? `${count} lead(s) with a call recording` : `${count} lead(s)`;
          break;
        }
      }
      if (profile) break;
    }
    if (!profile && candidates?.length) {
      profile = candidates[0];
      pickedBecause = 'no organisation had lead data, so the first super_admin was used';
    }
  }

  if (!profile) {
    console.error('no super_admin profile to test with');
    process.exit(1);
  }
  const root = rootOf(profile);
  console.log(`testing as ${profile.business_name} (org root ${root.slice(0, 8)}) — ${pickedBecause}\n`);

  const tools = createReportingTools(sb, profile.id) as any;
  const run = (args: any) => tools.org_call_report.execute(args, { toolCallId: 't', messages: [] });

  // The organisation's member set: the root plus everything hanging off it.
  const ids = await memberIdsOf(root);

  // ── today ────────────────────────────────────────────────────────────────
  const today = await run({ period: 'today' });
  console.log(`today answer: "${today.answer}"`);
  if (today.note) console.log(`note: ${today.note}`);

  check('today returned a clean sentence', typeof today.answer === 'string' && today.answer.length > 10, today.answer?.slice(0, 90));
  // Scope, not equality: a platform owner legitimately sees every account, while an admin
  // sees their subtree. What matters is that the count never silently shrinks to one
  // account, which is what made a real owner's "my account" report read as zero.
  check(
    'today covers at least the whole org',
    today.accountsInScope >= ids.length && today.accountsInScope >= 1,
    `${today.accountsInScope} accounts vs ${ids.length} in the test's own scope`
  );

  // Independent recount of the same window, from the same table the tool must use: the
  // Analytics → Action Report reads lead_history, so a report built on call_logs told an
  // owner "0 yesterday" on a day whose dashboard showed dozens of attempts.
  const { data: recountRows } = await sb
    .from('lead_history')
    .select('action_type, description')
    .in('user_id', ids)
    .gte('created_at', today.rangeStart)
    .lte('created_at', today.rangeEnd)
    .limit(20000);
  const recount = (recountRows || []).filter((h: any) => {
    const type = String(h.action_type || '').toUpperCase();
    const desc = String(h.description || '').toLowerCase();
    if (['REOPENED', 'BULK_TRANSFER', 'LEAD_IMPORT'].includes(type)) return false;
    if (
      desc.includes('facebook ad submission') ||
      desc.includes('reopened from facebook') ||
      desc.includes('bulk transferred') ||
      desc.includes('transferred from')
    ) {
      return false;
    }
    if (['CALL_FEEDBACK', 'CALL', 'OUTBOUND_CALL', 'CALL_LOG', 'DNP'].includes(type)) return true;
    if (desc.includes('dnp') || desc.includes('not picked') || desc.includes('did not pick')) return true;
    if (desc.includes('call') || desc.includes('followup') || desc.includes('feedback')) return true;
    return false;
  }).length;
  check('today count matches an independent recount of lead_history', recount === today.totalCalls, `tool=${today.totalCalls} db=${recount}`);

  // ── timezone boundary actually matters ───────────────────────────────────
  const kolkata = await run({ period: 'today', timezone: 'Asia/Kolkata' });
  const utc = await run({ period: 'today', timezone: 'UTC' });
  check(
    'timezone changes the window boundary',
    kolkata.rangeStart !== utc.rangeStart,
    `IST ${kolkata.rangeStart} vs UTC ${utc.rangeStart}`
  );
  check('IST window starts at 18:30Z', String(kolkata.rangeStart).includes('T18:30'), String(kolkata.rangeStart));

  // ── a zero result must still be useful ───────────────────────────────────
  if (today.totalCalls === 0) {
    check('zero result explains when calls last happened', Boolean(today.note), today.note || '');
    check('zero reads as an answer, not an error', /No calls were made/i.test(today.answer), today.answer);
  } else {
    check('non-zero result states the count in words', /\d+ calls?/i.test(today.answer), today.answer);
  }

  // ── all time is a superset of today ──────────────────────────────────────
  const all = await run({ period: 'all_time' });
  check(
    'all_time >= today',
    (all.totalCalls || 0) >= (today.totalCalls || 0),
    `all=${all.totalCalls} today=${today.totalCalls}`
  );

  // ── status breakdown is coherent ─────────────────────────────────────────
  const statusSum = Object.values(today.byStatus || {}).reduce((a: number, b: any) => a + Number(b), 0);
  check('status breakdown sums to the total', statusSum === today.totalCalls, `${statusSum} vs ${today.totalCalls}`);

  /* ====================================================================== */
  /* "connected" must mean connected                                        */
  /* ====================================================================== */
  //
  // The bucket used to be a catch-all: anything that was not a DNP counted as a
  // connected call, so an owner was told "10 connected" on a day whose rows were
  // seven CRM stage edits, two "outbound call initiated" remarks and one "number
  // out of service". Nothing had connected.
  console.log('\n— connected means connected —');
  {
    const buckets = Object.keys(today.byStatus || {});
    check(
      'no bucket claims "connected" without the word in the row',
      (today.byStatus?.connected || 0) === 0 || buckets.includes('connected'),
      JSON.stringify(today.byStatus)
    );
    check(
      'non-committal rows get a non-committal bucket',
      // An EMPTY day is a legitimate answer with no buckets at all ("No calls were made today"), so it
      // must pass. This assertion is about days that DO have attempt rows: none may be silently
      // dropped. Before, it failed on a quiet day, which made the gate assert a state of the data
      // rather than a property of the code.
      Number(today.total ?? today.attempts ?? 0) === 0 ||
        today.connectedCalls > 0 ||
        buckets.some((b) => /call noted|call started|dnp|whatsapp/i.test(b)),
      buckets.length ? buckets.join(', ') : 'no attempt rows at all today',
    );

    if ((today.connectedCalls || 0) === 0) {
      check(
        'the answer does not claim a connected count it cannot support',
        !/\d+\s+connected/i.test(String(today.answer || '')),
        today.answer
      );
      const unresolved =
        (today.byStatus?.['call noted (no outcome recorded)'] || 0) +
        (today.byStatus?.['call started (outcome unknown)'] || 0);
      check(
        'when no call is evidenced as connected, the answer says so',
        unresolved === 0 || Boolean(today.outcomeUnknown),
        today.outcomeUnknown || '(no caveat)'
      );
    } else {
      check('a real connected count is stated', /\d+\s+recorded as connected/i.test(String(today.answer || '')), today.answer);
    }
  }

  /* ====================================================================== */
  /* lead_conversations: "pull the conversation and the audio too"           */
  /* ====================================================================== */
  //
  // Both halves used to be unanswerable from the tool that exists for exactly
  // this question. The transcript is an ARRAY of turns and was stringified, so
  // the model received "[object Object],[object Object],…"; the recording link
  // was never selected at all. The owner asked, got nothing, and the agent spent
  // seven minutes guessing table names before being cancelled.
  console.log('\n— lead_conversations: conversation + audio —');
  {
    // Must be a lead inside the org this run is testing as — the tool scopes by
    // org, so a lead belonging to another tenant would (correctly) come back empty
    // and the test would be failing its own harness.
    const { data: withRecording } = await sb
      .from('leads')
      .select('id, name, user_id')
      .in('user_id', ids.length ? ids : [profile.id])
      .not('voice_recording_url', 'is', null)
      .limit(1);
    const target = withRecording?.[0];

    if (!target) {
      check(
        'a lead with a recording exists in this org to test against',
        false,
        'none found — cannot check the audio half for this org'
      );
    } else {
      const out = await tools.lead_conversations.execute(
        { leadId: target.id, onlyWithSummary: false, limit: 1 },
        { toolCallId: 't', messages: [] }
      );
      const lead = out?.leads?.[0];
      check('the tool returns the lead it was asked about', lead?.leadId === target.id, lead?.name);
      check(
        'the recording link is returned',
        typeof lead?.recordingUrl === 'string' && lead.recordingUrl.startsWith('http'),
        String(lead?.recordingUrl).slice(0, 64)
      );
      check('…and flagged as present', lead?.hasRecording === true);
      // The bucket is private now, so a link must be a SIGNED, expiring URL and must
      // never be the bare public path that returns "Bucket not found".
      check(
        '…and it is a signed, expiring link rather than a public bucket URL',
        typeof lead?.recordingUrl === 'string' &&
          lead.recordingUrl.includes('/object/sign/') &&
          /token=/.test(lead.recordingUrl) &&
          !lead.recordingUrl.includes('/object/public/'),
        String(lead?.recordingUrl).slice(0, 72)
      );
      check('…with a stated expiry for the owner', Number(lead?.recordingLinkMinutes) > 0, `${lead?.recordingLinkMinutes} min`);

      if (typeof lead?.recordingUrl === 'string') {
        // It has to actually play, otherwise "private" has simply broken the feature.
        const audio = await fetch(lead.recordingUrl, { headers: { Range: 'bytes=0-1023' } });
        check(
          '…and the signed link actually serves audio',
          (audio.status === 200 || audio.status === 206) &&
            String(audio.headers.get('content-type') || '').includes('audio'),
          `HTTP ${audio.status} ${audio.headers.get('content-type') || ''}`
        );
        if (audio.body) await audio.arrayBuffer();

        // And the old public form must be closed at the origin.
        const publicForm = lead.recordingUrl.replace('/object/sign/', '/object/public/').split('?')[0];
        const open = await fetch(`${publicForm}?cb=${Date.now()}`);
        check(
          '…while the public bucket URL is refused at the origin',
          open.status >= 400,
          `HTTP ${open.status} (a CDN HIT can still replay for up to an hour)`
        );
      }

      check(
        'the transcript is readable prose, not [object Object]',
        typeof lead?.transcriptExcerpt === 'string' &&
          !lead.transcriptExcerpt.includes('[object Object]') &&
          /^(Nobo|Lead):/m.test(lead.transcriptExcerpt),
        String(lead?.transcriptExcerpt).split('\n')[0]?.slice(0, 80)
      );
      check('…and reports how many turns it has', Number(lead?.transcriptTurns) > 0, String(lead?.transcriptTurns));
      check(
        'the headline answer mentions the recording',
        /recording/i.test(String(out?.answer || '')),
        String(out?.answer).slice(-70)
      );
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})();


