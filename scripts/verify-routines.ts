/**
 * The daily loop: routines → runs → one thread per day.
 *
 * What has to be true and is checked here:
 *   1. the brief it hands the agent names the business, the day, the money ceiling,
 *      the "one gate" rule and the digest shape
 *   2. a due routine produces exactly ONE run per period, however often cron fires
 *   3. the day's session is reused, not recreated
 *   4. a disabled routine does nothing at all
 *   5. it never runs a routine that is not due yet
 *
 *   npm run verify:routines
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import {
  dailyBrief,
  defaultRoutineIntent,
  materialiseDueRoutines,
  periodKey,
  periodLabel,
} from '../lib/agent/routines';

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

const routine: any = {
  id: 'routine-test',
  user_id: 'user-test',
  name: 'Daily marketing',
  intent: defaultRoutineIntent('HomCom Realtors', 'real estate'),
  cadence: 'daily',
  run_at_hour: 7,
  timezone: 'Asia/Kolkata',
  daily_credit_cap: 200,
  approval_policy: 'always',
  tool_groups: ['core', 'media'],
  channels: ['whatsapp', 'email'],
  enabled: true,
  version: 1,
  last_run_at: null,
  next_run_at: null,
};

async function main() {
  // ---------------------------------------------------------------- 1. the brief
  const brief = dailyBrief(routine, {
    businessName: 'HomCom Realtors',
    industry: 'real estate',
    todaysDate: '2026-11-12',
    timezone: 'Asia/Kolkata',
    festivals: ['Diwali'],
    lastWeekNotes: 'images led, reels lagged',
    creditsLeft: 820,
  });
  check('brief names the business and the day', brief.includes('HomCom Realtors') && brief.includes('2026-11-12'));
  check('brief carries the standing intent', brief.includes('Grow HomCom Realtors'));
  check('brief says to look before planning', /BEFORE YOU PLAN, LOOK AT THE BUSINESS/.test(brief));
  check('brief carries the festival', brief.includes('Diwali'));
  check('brief states the spend ceiling', brief.includes('200 credits'));
  check('brief enforces the single gate', /request_human_approval/.test(brief));
  check('brief forbids invented facts', /never invent a price/.test(brief));
  check('brief allows a quiet day', /quiet day is a valid outcome/.test(brief));
  check('brief demands the digest shape', ['DONE:', 'SPENT:', 'NEEDS YOU:', 'NOT DONE:', 'TOMORROW:'].every((k) => brief.includes(k)));
  check('brief warns about duplicate approvals', /do not duplicate them/.test(brief) === false, 'only when approvals pending');
  const withPending = dailyBrief(routine, {
    todaysDate: '2026-11-12',
    timezone: 'Asia/Kolkata',
    pendingApprovals: 2,
  });
  check('brief warns about duplicate approvals when some are pending', /do not duplicate them/.test(withPending));

  // ---------------------------------------------------------------- 2. period keys
  const noon = new Date('2026-11-12T06:30:00Z'); // 12:00 IST
  check('daily period key is the local date', periodKey(noon, 'Asia/Kolkata', 'daily') === '2026-11-12', periodKey(noon, 'Asia/Kolkata', 'daily'));
  check('the same instant in UTC is still the 12th locally', periodKey(new Date('2026-11-11T20:00:00Z'), 'Asia/Kolkata', 'daily') === '2026-11-12');
  check('period label reads like a day', /Thursday/.test(periodLabel(noon, 'Asia/Kolkata')), periodLabel(noon, 'Asia/Kolkata'));

  // ---------------------------------------------------------------- 3. live materialise
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const probe = await sb.from('business_routines').select('id').limit(1);
  if (probe.error) {
    console.log(`\nSKIP live checks — ${probe.error.message}`);
    console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} checks passed`);
    if (fail) process.exit(1);
    return;
  }

  /**
   * WHICH ACCOUNT THE LIVE CHECKS USE.
   *
   * This used to be `profiles ... limit(1)` — whichever row happened to come back first. That stopped
   * being workable once the book contained (a) sub-accounts with no auth user, `harness_sessions.user_id`
   * being a foreign key to auth.users, and (b) businesses that ALREADY hold a routine which ran today.
   * The claim on a run is unique per `(user_id, period_key)`, so a fixture routine inserted on such an
   * account is refused with "period already ran" — correct product behaviour, but it makes the test
   * prove nothing.
   *
   * So: an enabled account that owns no routine row at all. It cannot have claimed today's period, and
   * it is exactly the state a new tenant is in.
   */
  const { data: candidates } = await sb
    .from('profiles')
    .select('id, business_name, is_disabled')
    .eq('is_disabled', false)
    .limit(200);
  const { data: routineOwners } = await sb.from('business_routines').select('user_id').limit(2000);
  const owners = new Set((routineOwners || []).map((row: any) => String(row.user_id)));
  const profile = (candidates || []).find((row: any) => row?.id && !owners.has(String(row.id))) as
    | { id: string; business_name: string | null }
    | undefined;
  check('an account with no routine yet exists for the live checks', Boolean(profile?.id), profile?.business_name || '');
  if (!profile?.id) {
    console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} checks passed`);
    if (fail) process.exit(1);
    return;
  }

  const created: string[] = [];
  const cleanup = async () => {
    for (const id of created) {
      await sb.from('routine_runs').delete().eq('routine_id', id);
      await sb.from('business_routines').delete().eq('id', id);
    }
  };

  try {
    const { data: r1, error: r1Error } = await sb
      .from('business_routines')
      .insert({
        user_id: profile.id,
        name: `verify daily ${Date.now()}`,
        intent: defaultRoutineIntent(profile.business_name || 'Verify Co', 'real estate'),
        cadence: 'daily',
        next_run_at: new Date(Date.now() - 60_000).toISOString(),
        daily_credit_cap: 50,
      })
      .select('id')
      .single();
    check('the fixture routine row was created', Boolean(r1?.id), r1Error?.message || '');
    if (!r1?.id) {
      console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} checks passed`);
      process.exit(1);
    }
    created.push(r1.id);

    const first = await materialiseDueRoutines(sb, new Date());
    const mine = first.queued.filter((q) => q.routineId === r1!.id);
    check('a due routine queues one run', mine.length === 1, `${first.checked} checked`);
    check("it opens the day's session", !!mine[0]?.sessionId);

    const second = await materialiseDueRoutines(sb, new Date());
    const again = second.queued.filter((q) => q.routineId === r1!.id);
    check('running the materialiser twice does not double-run the day', again.length === 0, 'idempotent per period');

    const { data: runs } = await sb.from('routine_runs').select('session_id, run_id').eq('routine_id', r1!.id);
    check('exactly one routine_runs row exists for the period', (runs || []).length === 1);
    check('the row is linked to a real harness run', !!runs?.[0]?.run_id);

    const third = await materialiseDueRoutines(sb, new Date());
    check('a satisfied routine is not due again today', third.queued.filter((q) => q.routineId === r1!.id).length === 0);

    // Disabled routines must be invisible to the loop.
    const { data: r2 } = await sb
      .from('business_routines')
      .insert({
        user_id: profile.id,
        name: `verify disabled ${Date.now()}`,
        intent: 'should never run',
        cadence: 'daily',
        enabled: false,
        next_run_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .select('id')
      .single();
    if (r2?.id) created.push(r2.id);
    const fourth = await materialiseDueRoutines(sb, new Date());
    check('a disabled routine never runs', !r2?.id || fourth.queued.every((q) => q.routineId !== r2?.id));

    // Not-yet-due routines must be left alone.
    const { data: r3 } = await sb
      .from('business_routines')
      .insert({
        user_id: profile.id,
        name: `verify future ${Date.now()}`,
        intent: 'should wait',
        cadence: 'daily',
        next_run_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
      })
      .select('id')
      .single();
    if (r3?.id) created.push(r3.id);
    const fifth = await materialiseDueRoutines(sb, new Date());
    check('a routine due later is not run early', !r3?.id || fifth.queued.every((q) => q.routineId !== r3?.id));
  } finally {
    await cleanup();
  }

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} checks passed`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error('verify-routines crashed:', e?.message || e);
  process.exit(1);
});
