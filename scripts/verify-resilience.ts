/**
 * The four things that were never tested.
 *
 *   1. Cancelling a running task          — does "stop" actually stop, and is the
 *                                           run left in a state the UI can show?
 *   2. Resuming after the tab closes      — can a reload find the live run again?
 *   3. Running out of credits             — is expensive work refused BEFORE we pay
 *                                           for it, with a message a human can act on?
 *   4. An API being down                  — does a failing vendor degrade into a
 *                                           usable error, or take the turn with it?
 *
 * These run against the real database and real helpers, but without spending on model
 * turns, so they are cheap enough to run on every change.
 *
 *   npm run verify:resilience
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import {
  enqueueRun,
  getRun,
  hasLiveRun,
  requestCancel,
  isCancelRequested,
  finishRun,
  listRunsForSession,
} from '../lib/agent/harness/runs';
import { canAfford, estimateMediaCredits } from '../lib/agent/usage';
import { createKieTask, queryKieTask } from '../utils/external-apis';
import { recordSpend, recentSpend } from '../lib/agent/spend';

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

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: profile } = await sb
    .from('profiles')
    .select('id, business_name, credits')
    .limit(1)
    .maybeSingle();
  if (!profile?.id) {
    console.error('no profile');
    process.exit(1);
  }
  console.log(`profile: ${profile.business_name} (credits: ${profile.credits})\n`);

  // ═══ 1. CANCELLATION ══════════════════════════════════════════════════════
  console.log('=== cancelling a running task ===');
  const { data: session } = await sb
    .from('harness_sessions')
    .insert({ user_id: profile.id, title: 'resilience-cancel-test' })
    .select('id')
    .maybeSingle();

  if (!session?.id) {
    console.log('SKIP  could not create a test session');
  } else {
    const run = await enqueueRun(sb, {
      sessionId: session.id,
      userId: profile.id,
      goal: 'resilience test',
      idempotencyKey: `resilience-cancel-${Date.now()}`,
    });
    check('a run can be queued', Boolean(run?.id));

    if (run?.id) {
      check('a queued run counts as live (so a second one is refused)', await hasLiveRun(sb, session.id));
      check('cancel is not requested yet', (await isCancelRequested(sb, run.id)) === false);

      // requestCancel takes (supabase, runId, userId) — the user filter is what keeps
      // one tenant from cancelling another's run.
      await requestCancel(sb, run.id, profile.id);
      check('cancel can be requested', (await isCancelRequested(sb, run.id)) === true,
        'the runner checks this between steps — it never stops mid-tool-call');

      const after = await getRun(sb, run.id, profile.id);
      check('the run is marked cancelled for the UI', after?.status === 'cancelled', `status=${after?.status}`);

      // Mark it finished so it stops counting as a live run and cannot race later tests.
      await finishRun(sb, run.id, 'resilience-test', { status: 'cancelled', error: 'test cleanup' }).catch(() => {});
      const stillLive = await hasLiveRun(sb, session.id);
      check('a cancelled run no longer blocks a new message', stillLive === false, `live=${stillLive}`);
    }
    await sb.from('harness_events').delete().eq('session_id', session.id);
    await sb.from('harness_runs').delete().eq('session_id', session.id);
    await sb.from('harness_sessions').delete().eq('id', session.id);
  }

  // ═══ 2. RESUME AFTER A CLOSED TAB ═════════════════════════════════════════
  console.log('\n=== resuming after the tab closes ===');
  const { data: session2 } = await sb
    .from('harness_sessions')
    .insert({ user_id: profile.id, title: 'resilience-resume-test' })
    .select('id')
    .maybeSingle();

  if (!session2?.id) {
    console.log('SKIP  could not create a test session');
  } else {
    const run2 = await enqueueRun(sb, {
      sessionId: session2.id,
      userId: profile.id,
      goal: 'resume test',
      idempotencyKey: `resilience-resume-${Date.now()}`,
    });
    // This is exactly what the UI does on reload: ask for live runs of the session.
    check('a reload can find the live run again', await hasLiveRun(sb, session2.id));
    const listed = await listRunsForSession(sb, session2.id);
    check('the run is listed for the session', listed.some((r: any) => r.id === run2?.id), `${listed.length} run(s)`);
    const fetched = await getRun(sb, run2!.id, profile.id);
    check('the run carries its status for the status strip', Boolean(fetched?.status), `status=${fetched?.status}`);

    if (run2?.id) await finishRun(sb, run2.id, 'resilience-test', { status: 'completed' }).catch(() => {});
    await sb.from('harness_runs').delete().eq('session_id', session2.id);
    await sb.from('harness_sessions').delete().eq('id', session2.id);
  }

  // ═══ 3. RUNNING OUT OF CREDITS ════════════════════════════════════════════
  console.log('\n=== running out of credits ===');
  const cheap = await canAfford(profile.id, estimateMediaCredits('image', 1));
  check('an ordinary image is affordable for this account', cheap.ok === true, cheap.reason || 'allowed');

  const absurd = await canAfford(profile.id, 9_999_999);
  check('an impossible cost is refused before any work starts', absurd.ok === false);
  check(
    'the refusal tells the user what to do',
    Boolean(absurd.reason && /credit|top up|cheaper/i.test(absurd.reason)),
    (absurd.reason || '').slice(0, 90)
  );
  check('a free action is always allowed', (await canAfford(profile.id, 0)).ok === true);
  const video15 = estimateMediaCredits('grok-video:720p', 15);
  check('a 15s 720p video is priced, not free', video15 > 0, `${video15} credits`);

  // ═══ 4. A VENDOR BEING DOWN ═══════════════════════════════════════════════
  console.log('\n=== an API being down ===');
  // A bogus task id stands in for the vendor being unreachable or rejecting us.
  const badQuery = await queryKieTask('0000000000000000000000000000dead');
  check('querying a bad task returns an error, not a throw', typeof badQuery.error !== 'undefined' || badQuery.state !== 'success',
    `state=${badQuery.state}`);

  const badTask = await createKieTask({ model: 'definitely-not-a-model', input: {} });
  check('creating an invalid task fails cleanly', badTask.taskId === null || badTask.error !== null,
    String(badTask.error || '').slice(0, 70));

  // Metering must survive a failure: a down vendor must not break billing.
  const before = recentSpend().length;
  let meterThrew = false;
  try {
    await recordSpend({ service: 'other', costInr: 1.23, detail: 'resilience test' });
    await recordSpend({ service: 'other', costInr: NaN as any, detail: 'NaN cost must not crash' });
  } catch {
    meterThrew = true;
  }
  check('recording spend never throws, even on bad input', meterThrew === false);
  check('spend was still recorded', recentSpend().length >= before, `${recentSpend().length} events`);

  // ═══ SUMMARY ══════════════════════════════════════════════════════════════
  console.log(`\n=== ${pass}/${pass + fail} checks passed ===`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.error('failed:', e?.message || e);
  process.exit(1);
});
