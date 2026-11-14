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
  const { data: profile } = profileId
    ? await sb
        .from('profiles')
        .select('id, business_name, role, parent_id, agency_id')
        .eq('id', profileId)
        .maybeSingle()
    : await sb
        .from('profiles')
        .select('id, business_name, role, parent_id, agency_id')
        .eq('role', 'super_admin')
        .limit(1)
        .maybeSingle();

  if (!profile) {
    console.error('no super_admin profile to test with');
    process.exit(1);
  }
  const root = profile.parent_id || profile.agency_id || profile.id;
  console.log(`testing as ${profile.business_name} (org root ${root.slice(0, 8)})\n`);

  const tools = createReportingTools(sb, profile.id) as any;
  const run = (args: any) => tools.org_call_report.execute(args, { toolCallId: 't', messages: [] });

  // ── member set ───────────────────────────────────────────────────────────
  const { data: members } = await sb
    .from('profiles')
    .select('id')
    .or(`id.eq.${root},parent_id.eq.${root},agency_id.eq.${root}`);
  const ids = (members || []).map((m) => m.id);

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

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})();


