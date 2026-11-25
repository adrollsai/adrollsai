import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildDigest, type DigestItem } from '@/lib/agent/digest';
import { sendGenericEmail } from '@/utils/email-helper';
import { periodKey, periodLabel } from '@/lib/agent/routines';
import { gatherDayMetrics, supabaseMetricsReader, windowFor } from '@/lib/agent/ceo-metrics';
import { analyseDay } from '@/lib/agent/ceo-findings';
import { chargeEmailSends } from '@/lib/automation/email-billing';
import { planDigestSends, type DigestSlot } from '@/lib/agent/digest-batch';

export const maxDuration = 300;

/**
 * Morning plan + evening wrap, by email, once each per business per day.
 *
 * `/api/cron/ceo-digest` derives each business's slot from its own clock; `?slot=morning|eod`
 * forces one (manual sends, and the contract the old crons used). `?limit=` caps the sends per
 * invocation, default 12.
 *
 * Idempotency lives where the facts do: `routine_runs.digest` records which slot was sent for
 * which period, so a retried cron cannot mail twice. A business with no routine gets nothing at
 * all — silence is better than an empty "nothing happened" email landing forever.
 *
 * Sliced for the whole platform: see `lib/agent/digest-batch.ts` for why one invocation can no
 * longer walk every business.
 */
export async function GET(req: NextRequest) {
  const secret =
    req.headers.get('authorization')?.replace('Bearer ', '') || req.nextUrl.searchParams.get('secret');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const forcedSlot = (req.nextUrl.searchParams.get('slot') || null) as DigestSlot | null;
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') || 12), 1), 40);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: routines, error } = await supabase
    .from('business_routines')
    .select('id, user_id, name, timezone, cadence, daily_credit_cap')
    .eq('enabled', true)
    .order('created_at', { ascending: true });

  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json({ ok: true, skipped: 'routines table not present' });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const sent: string[] = [];
  const skipped: string[] = [];
  const now = new Date();

  /**
   * Two reads for the whole run instead of two per business.
   *
   * The per-business selects were tolerable at twelve accounts and are not at a hundred: profiles
   * and today's runs are needed before a single send can be decided, so they are fetched in bulk
   * and indexed. This is what buys the budget for the sends themselves.
   */
  const userIds = (routines || []).map((routine) => routine.user_id);
  const since = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();
  const [{ data: profileRows }, { data: runRows }] = await Promise.all([
    userIds.length
      ? supabase
          .from('profiles')
          .select('id, email, business_name, credits, timezone')
          .in('id', userIds)
      : Promise.resolve({ data: [] as any[] }),
    userIds.length
      ? supabase
          .from('routine_runs')
          .select('id, user_id, period_key, status, digest, credits_spent, session_id')
          .in('user_id', userIds)
          .gte('created_at', since)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const profileByUser = new Map<string, any>((profileRows || []).map((row: any) => [row.id, row]));
  const runByPeriod = new Map<string, any>(
    (runRows || []).map((row: any) => [`${row.user_id}|${row.period_key}`, row])
  );
  const runFor = (routine: any) =>
    runByPeriod.get(
      `${routine.user_id}|${periodKey(now, routine.timezone || 'Asia/Kolkata', routine.cadence || 'daily')}`
    );

  const plan = planDigestSends(routines || [], {
    now,
    forcedSlot,
    isSent: (routine, slot) => Boolean((runFor(routine)?.digest as any)?.[`${slot}_sent_at`]),
    limit,
  });

  for (const { routine, slot } of plan.due) {
    const period = periodKey(now, routine.timezone || 'Asia/Kolkata', routine.cadence || 'daily');
    const label = periodLabel(now, routine.timezone || 'Asia/Kolkata');
    const profile = profileByUser.get(routine.user_id) || null;

    /**
     * NO RUN ROW, NO EMAIL.
     *
     * The only record that "this slot went out" is `routine_runs.digest`, stamped on the run for
     * the period. Without a run row there is nothing to stamp, so the same business would be mailed
     * again on every invocation — twice a day that was a duplicate, but the cron now runs every
     * fifteen minutes to sweep the platform, so it would be two dozen. Waiting for the run is also
     * the truthful order: the email describes a day's work, and the work is not queued yet.
     * `materialiseDueRoutines` runs every ten minutes, so the wait is short.
     */
    const run = runFor(routine) || null;
    if (!run?.id) {
      skipped.push(`${routine.id}: no run for ${period} yet`);
      continue;
    }

    // `profiles.email` is null for accounts created through some paths — Procolor's is null while
    // its real address sits on the auth user — and the old code simply skipped them, so the
    // twice-daily report silently never arrived. Fall back to the auth record.
    let toEmail: string | null = profile?.email || null;
    if (!toEmail) {
      try {
        const { data: authUser } = await supabase.auth.admin.getUserById(routine.user_id);
        toEmail = authUser?.user?.email || null;
      } catch (authErr: any) {
        console.warn(`[ceo-digest] auth email lookup failed for ${routine.user_id}:`, authErr?.message);
      }
    }

    if (!toEmail) {
      skipped.push(`${routine.id}: no email`);
      continue;
    }

    // What the owner must act on: anything still pending approval for this business.
    const { data: pending } = await supabase
      .from('agent_events')
      .select('id, payload, created_at')
      .eq('user_id', routine.user_id)
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(5);

    const needsYou: DigestItem[] = (pending || []).map((p: any) => ({
      label: p.payload?.title || 'Approval needed',
      detail: p.payload?.estimatedCost ? `about ${p.payload.estimatedCost}` : undefined,
    }));

    const done: DigestItem[] = [];
    const digestData = (run?.digest as any) || {};
    if (Array.isArray(digestData.done)) {
      for (const d of digestData.done) done.push({ label: String(d.label || d), detail: d.detail, url: d.url });
    } else if (run) {
      done.push({
        label: `${routine.name} — ${run.status}`,
        detail: slot === 'morning' ? 'queued for today' : undefined,
      });
    }

    // The analysis half of the report: where the business is losing money and what we would do
    // about it. Same engine the CEO tab renders, so the email and the tab can never disagree.
    // A failure here must not cost the owner the whole report.
    let bottlenecks: DigestItem[] = [];
    // Kept out here so the "what went out" section can use the same read. It is gathered once
    // per business either way; this only stops the second consumer paying for a second read.
    let dayMetrics: any = null;
    try {
      const tz = (profile as any)?.timezone || routine.timezone || 'Asia/Kolkata';
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const { metrics } = await gatherDayMetrics(
        supabaseMetricsReader(supabase, routine.user_id),
        windowFor(yesterday, tz)
      );
      dayMetrics = metrics;
      bottlenecks = analyseDay(metrics)
        .filter((f) => f.severity === 'blocked' || f.severity === 'risk')
        .slice(0, 4)
        .map((f) => ({ label: f.title, detail: f.recommendation }));
    } catch (findErr: any) {
      console.warn(`[ceo-digest] findings failed for ${routine.id}:`, findErr?.message);
    }

    /**
     * Ads are the half of "what went out" that the routine never reports.
     *
     * `done` is built from `routine_runs.digest`, so it only ever describes work the daily job
     * did. Meta spends and delivers whether or not that job is switched on — an account with a
     * live campaign was told "nothing went out today" while ₹3,746 left its bank and 42 enquiries
     * arrived. The owner's reasonable reading of that email is that the app is not watching the
     * account at all. It is; it just was not saying so.
     *
     * Only in the evening slot: the morning email is "what I am doing today", and yesterday's
     * delivery in it would read as a plan.
     */
    if (slot === 'eod' && dayMetrics) {
      const spend = Number(dayMetrics.campaigns?.spendPaise ?? 0);
      const adLeads = Number(dayMetrics.campaigns?.leads ?? 0);
      const running = Number(dayMetrics.campaigns?.active ?? 0);
      if (spend > 0 || running > 0) {
        const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
        done.push({
          label:
            spend > 0
              ? `Your ads spent ${rupees(spend)} and brought ${adLeads} enquir${adLeads === 1 ? 'y' : 'ies'}`
              : `${running} ad campaign${running === 1 ? ' is' : 's are'} live`,
          detail:
            running > 0
              ? `${running} campaign${running === 1 ? '' : 's'} running · last 7 days, from Meta`
              : 'no campaign is running right now · last 7 days, from Meta',
        });
      }
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com').replace(/\/$/, '');
    const digest = buildDigest({
      businessName: profile?.business_name || 'Your business',
      slot,
      dateLabel: label,
      done,
      bottlenecks,
      needsYou,
      notDone: Array.isArray(digestData.not_done) ? digestData.not_done : undefined,
      tomorrow: digestData.tomorrow,
      creditsSpent: run?.credits_spent != null ? Number(run.credits_spent) : null,
      creditsLeft: (profile as any)?.credits ?? null,
      ceoUrl: `${appUrl}/dashboard/ceo`,
    });

    try {
      await sendGenericEmail(toEmail, digest.subject, digest.html);
      sent.push(`${routine.id}: ${slot}`);
      /**
       * The email is billed to the account at 2× our cost, like every other metered action.
       *
       * Charged AFTER the provider accepted the message, never before: an account must not pay for a
       * mail that did not leave. This is the send that reaches every business twice a day, so it was the
       * largest unmetered cost in the product. `chargeEmailSends` never throws — a billing failure is
       * logged, and the report still goes out.
       */
      const billed = await chargeEmailSends(supabase, routine.user_id, {
        count: 1,
        label: `CEO ${slot} digest`,
      });
      if (billed.credits > 0) {
        console.log(`[ceo-digest] charged ${billed.credits} credits for the ${slot} email (our cost ₹${billed.costInr})`);
      }
      // Stamp the slot on the run so a cron retry cannot send it twice. If there is no
      // run row yet, the agent_events trail is the only place to note it, so skip the
      // stamping and rely on the log line rather than inventing a row.
      if (run?.id) {
        await supabase
          .from('routine_runs')
          .update({
            digest: { ...digestData, [`${slot}_sent_at`]: now.toISOString() },
          })
          .eq('id', run.id);
      }
    } catch (e: any) {
      skipped.push(`${routine.id}: send failed — ${e?.message || e}`);
    }
  }

  console.log(
    `[ceo-digest] sent ${sent.length}, skipped ${skipped.length}, outside window ${plan.outsideWindow}, ` +
      `already sent ${plan.alreadySent}, deferred ${plan.deferred}`
  );
  return NextResponse.json({
    ok: true,
    slot: forcedSlot || 'per-business',
    sent,
    skipped,
    outsideWindow: plan.outsideWindow,
    alreadySent: plan.alreadySent,
    // Non-zero means the next invocation has work left — the platform is being swept in slices.
    deferred: plan.deferred,
  });
}
