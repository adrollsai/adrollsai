import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { resolveActingUser } from '@/utils/route-auth';
import { defaultRoutineIntent } from '@/lib/agent/routines';
import { nextRunAt, DEFAULT_RUN_HOUR, DEFAULT_TIMEZONE } from '@/lib/agent/routine-schedule';

export const maxDuration = 60;

/**
 * A business's daily routine — read it, or switch it on.
 *
 * POST seeds the conservative default: one creative a day, video only when the day
 * calls for it, always ask before spending. Cadence changes are meant to arrive as
 * words ("stop doing reels daily") rather than as a settings screen, so this endpoint
 * deliberately exposes only create + list.
 *
 * `?impersonate=<uuid>` is honoured only for a caller that may act for that
 * account (super_admin always, agency/admin for their own sub-accounts).
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const acting = await resolveActingUser(req, req.nextUrl.searchParams.get('impersonate'));
  if (!acting.ok) return acting.response;
  const actingUserId = acting.userId;

  const { data, error } = await supabase
    .from('business_routines')
    .select('*')
    .eq('user_id', actingUserId)
    .order('created_at', { ascending: true });

  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json({ needsMigration: true, routines: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ routines: data || [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const acting = await resolveActingUser(req, req.nextUrl.searchParams.get('impersonate'));
  if (!acting.ok) return acting.response;
  const actingUserId = acting.userId;

  const body = await req.json().catch(() => ({}));
  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, industry')
    .eq('id', actingUserId)
    .single();

  const { data: existing } = await supabase
    .from('business_routines')
    .select('id, enabled, run_at_hour, timezone')
    .eq('user_id', actingUserId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing?.id && existing.enabled) {
    return NextResponse.json({ ok: true, routineId: existing.id, alreadyRunning: true });
  }

  // The first run is the routine's own next wall-clock slot, not "twelve hours from now".
  //
  // The +12h version was wrong in a way the owner would notice: click Start at 09:45 and it
  // fired at 21:45 the same night, while the toast promised "tomorrow morning"; click at 23:00
  // and it fired at 11:00 tomorrow. `nextRunAt` already resolves the cadence's hour in the
  // business's own timezone, so this now says what it means and means what it says.
  const timezone = body.timezone || (existing as any)?.timezone || DEFAULT_TIMEZONE;
  const runAtHour = Number((existing as any)?.run_at_hour ?? DEFAULT_RUN_HOUR);
  const firstRun = nextRunAt(new Date(), {
    cadence: 'daily',
    run_at_hour: runAtHour,
    timezone,
  }).toISOString();

  // A disabled row IS this business's routine, switched off. Re-enable it instead of inserting
  // a second one: `pickRoutinesToMaterialise()` and the CEO tab both treat the routine as
  // singular, so a new row would leave the old dead one behind forever — and the card would
  // still be showing the stale one.
  if (existing?.id) {
    const { error } = await supabase
      .from('business_routines')
      .update({ enabled: true, next_run_at: firstRun })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, routineId: existing.id, reenabled: true, nextRunAt: firstRun });
  }

  const { data: created, error } = await supabase
    .from('business_routines')
    .insert({
      user_id: actingUserId,
      name: body.name || 'Daily marketing',
      intent: body.intent || defaultRoutineIntent(profile?.business_name || 'the business', profile?.industry || null),
      cadence: 'daily',
      run_at_hour: runAtHour,
      timezone,
      daily_credit_cap: body.dailyCreditCap || 200,
      approval_policy: 'always',
      // Tomorrow morning's slot, not immediately: nobody wants a job starting because they
      // clicked a button at 11pm.
      next_run_at: firstRun,
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, routineId: created.id, nextRunAt: firstRun });
}
