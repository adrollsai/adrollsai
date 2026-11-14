import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildDigest, type DigestItem } from '@/lib/agent/digest';
import { sendGenericEmail } from '@/utils/email-helper';
import { periodKey, periodLabel } from '@/lib/agent/routines';

export const maxDuration = 300;

/**
 * Morning plan + evening wrap, by email, once each per business per day.
 *
 * `/api/cron/ceo-digest?slot=morning` and `?slot=eod`.
 *
 * Idempotency lives where the facts do: `routine_runs.digest` records which slot was
 * sent for which period, so a retried cron cannot mail twice. A business with no
 * routine gets nothing at all — silence is better than an empty "nothing happened"
 * email landing forever.
 */
export async function GET(req: NextRequest) {
  const secret =
    req.headers.get('authorization')?.replace('Bearer ', '') || req.nextUrl.searchParams.get('secret');
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const slot = (req.nextUrl.searchParams.get('slot') || 'morning') as 'morning' | 'eod';
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: routines, error } = await supabase
    .from('business_routines')
    .select('id, user_id, name, timezone, daily_credit_cap')
    .eq('enabled', true);

  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json({ ok: true, skipped: 'routines table not present' });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const sent: string[] = [];
  const skipped: string[] = [];
  const now = new Date();

  for (const routine of routines || []) {
    const period = periodKey(now, routine.timezone || 'Asia/Kolkata', 'daily');
    const label = periodLabel(now, routine.timezone || 'Asia/Kolkata');

    const { data: profile } = await supabase
      .from('profiles')
      .select('email, business_name, credits')
      .eq('id', routine.user_id)
      .single();

    if (!profile?.email) {
      skipped.push(`${routine.id}: no email`);
      continue;
    }

    const { data: run } = await supabase
      .from('routine_runs')
      .select('id, period_key, status, digest, credits_spent, session_id')
      .eq('routine_id', routine.id)
      .eq('period_key', period)
      .maybeSingle();

    const already = (run?.digest as any)?.[`${slot}_sent_at`];
    if (already) {
      skipped.push(`${routine.id}: ${slot} already sent`);
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

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com').replace(/\/$/, '');
    const digest = buildDigest({
      businessName: profile.business_name || 'Your business',
      slot,
      dateLabel: label,
      done,
      needsYou,
      notDone: Array.isArray(digestData.not_done) ? digestData.not_done : undefined,
      tomorrow: digestData.tomorrow,
      creditsSpent: run?.credits_spent != null ? Number(run.credits_spent) : null,
      creditsLeft: profile.credits ?? null,
      ceoUrl: `${appUrl}/dashboard/ceo`,
    });

    try {
      await sendGenericEmail(profile.email, digest.subject, digest.html);
      sent.push(`${routine.id}: ${slot}`);
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

  console.log(`[ceo-digest] ${slot}: sent ${sent.length}, skipped ${skipped.length}`);
  return NextResponse.json({ ok: true, slot, sent, skipped });
}
