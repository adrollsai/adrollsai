import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { dispatchVoiceCall } from '@/lib/agent/tools/outbound';

export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

/** One test call a minute per account: enough to check the voice, not enough to dial a list. */
const MIN_SECONDS_BETWEEN_CALLS = 60;

/**
 * Place a real test call to the owner's own number.
 *
 * WHY THIS ROUTE EXISTS
 * The calling screen had a "Test call" button that started an 1.8-second timer and then said "Live
 * Test Call initiated — pick up your phone". It dialled nothing. An owner reading that waits by the
 * phone for a call that was never made, and concludes the voice agent is broken rather than the
 * button. That is the worst kind of UI: confidently wrong.
 *
 * So this does the real thing, through the same dispatcher the agent and the automation pipeline use,
 * and it returns exactly what happened — a call id when a call was placed, the provider's own words
 * when it was not. It also refuses rather than pretends: no number, a bad number, or a second call
 * inside a minute all come back as errors a person can read.
 */
export async function POST(request: NextRequest) {
  try {
    // ── who is asking ────────────────────────────────────────────────────────────────────────────
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '').trim() : null;
    const cookieClient = await (await import('@/utils/supabase/server')).createClient();
    const { data: cookieUser } = await cookieClient.auth.getUser();
    const bearerUser = bearer ? (await supabaseAdmin.auth.getUser(bearer)).data?.user : null;
    const user = cookieUser?.user ?? bearerUser ?? null;
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const digits = String(body?.phone ?? '').replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) {
      return NextResponse.json(
        { error: 'Enter the full phone number to call, including the country code.' },
        { status: 400 }
      );
    }

    /**
     * Rate limit, from the audit trail rather than memory: a serverless function has no reliable
     * memory between invocations, so an in-process timestamp would let a double-click dial twice.
     */
    const since = new Date(Date.now() - MIN_SECONDS_BETWEEN_CALLS * 1000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from('agent_events')
      .select('id, created_at')
      .eq('user_id', user.id)
      .eq('event_type', 'VOICE_TEST_CALL')
      .gte('created_at', since)
      .limit(1);
    if ((recent ?? []).length > 0) {
      const waitedAt = new Date((recent as any[])[0].created_at).getTime();
      const secondsLeft = Math.max(1, Math.ceil((waitedAt + MIN_SECONDS_BETWEEN_CALLS * 1000 - Date.now()) / 1000));
      return NextResponse.json(
        { error: `A test call was just placed. Try again in ${secondsLeft} second${secondsLeft === 1 ? '' : 's'}.`, retryAfterSeconds: secondsLeft },
        { status: 429 }
      );
    }

    // The audit row is written BEFORE dialling: a crash mid-call must not leave the limit open.
    const { data: guard } = await supabaseAdmin
      .from('agent_events')
      .insert({
        user_id: user.id,
        event_type: 'VOICE_TEST_CALL',
        status: 'pending',
        scheduled_for: new Date().toISOString(),
        payload: { phone: digits, source: 'calling_screen' },
      })
      .select('id')
      .single();

    const result = await dispatchVoiceCall({
      supabase: supabaseAdmin,
      userId: user.id,
      phone: digits,
      objective: 'This is a short test call from Nobogent. Ask the person whether the voice sounded clear, then end the call politely.',
      // Capped and concrete: the bridge builds its greeting from this, and a long sentence produced a
      // 25-second opener that got barged over.
      reason: 'your Nobogent test call',
      leadName: 'Test call',
    });

    // Record the outcome on the guard row so the audit trail says what actually happened.
    if (guard?.id) {
      await supabaseAdmin
        .from('agent_events')
        .update({
          status: result.success ? 'completed' : 'failed',
          payload: {
            phone: digits,
            source: 'calling_screen',
            callId: result.callId ?? null,
            to: result.to ?? null,
            error: result.error ?? null,
          },
        })
        .eq('id', guard.id);
    }

    if (!result.success) {
      // The dispatcher's message is the honest one — test mode with no number, an inactive provider,
      // an unreachable bridge. Passing it through beats inventing a reason.
      return NextResponse.json({ ok: false, error: result.error || 'The call could not be placed.' }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      callId: result.callId ?? result.callSid ?? null,
      to: result.to ?? null,
      scheduled: Boolean(result.scheduled),
      message: result.scheduled
        ? `Test call scheduled to ${result.to ?? digits}.`
        : `Test call placed to ${result.to ?? digits}. Answer it to hear the agent.`,
    });
  } catch (error: any) {
    console.error('[voice/test-call] failed:', error);
    return NextResponse.json({ error: error?.message || 'The test call failed.' }, { status: 500 });
  }
}
