import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { defaultRoutineIntent } from '@/lib/agent/routines';

export const maxDuration = 60;

/**
 * A business's daily routine — read it, or switch it on.
 *
 * POST seeds the conservative default: one creative a day, video only when the day
 * calls for it, always ask before spending. Cadence changes are meant to arrive as
 * words ("stop doing reels daily") rather than as a settings screen, so this endpoint
 * deliberately exposes only create + list.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('business_routines')
    .select('*')
    .eq('user_id', user.id)
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

  const body = await req.json().catch(() => ({}));
  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, industry')
    .eq('id', user.id)
    .single();

  const { data: existing } = await supabase
    .from('business_routines')
    .select('id')
    .eq('user_id', user.id)
    .eq('enabled', true)
    .maybeSingle();

  if (existing?.id) {
    return NextResponse.json({ ok: true, routineId: existing.id, alreadyRunning: true });
  }

  const { data: created, error } = await supabase
    .from('business_routines')
    .insert({
      user_id: user.id,
      name: body.name || 'Daily marketing',
      intent: body.intent || defaultRoutineIntent(profile?.business_name || 'the business', profile?.industry || null),
      cadence: 'daily',
      run_at_hour: 7,
      timezone: body.timezone || 'Asia/Kolkata',
      daily_credit_cap: body.dailyCreditCap || 200,
      approval_policy: 'always',
      // First run is tomorrow morning, not immediately: nobody wants a job starting
      // because they clicked a button at 11pm.
      next_run_at: new Date(Date.now() + 12 * 3600_000).toISOString(),
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, routineId: created.id });
}
