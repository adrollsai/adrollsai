/**
 * Bookings as an event a sequence can hang off.
 *
 * A booking is the one moment in a lead's life where the timing is not up to us: the customer has
 * agreed to be somewhere at a particular hour. So the reminders that matter are relative to THAT
 * hour — "24 hours before", "30 minutes before" — and they stop being true the moment it changes.
 *
 * Three things this module is responsible for, and the third is the one that is usually forgotten:
 *
 *   1. a new booking starts the appointment sequence, with the appointment time as the anchor;
 *   2. a RESCHEDULE cancels what was already queued and re-plans against the new time. Without this,
 *      someone who moves Tuesday's meeting to Friday still gets "your meeting is in an hour" on
 *      Tuesday — the single most damaging message this system could send;
 *   3. a CANCELLATION cancels the queued steps outright. Nothing is more obviously wrong to a
 *      customer than a reminder for an appointment they called off.
 *
 * Every step still goes through the approval queue before it reaches a person, so this module
 * schedules and cancels work; it never messages anybody.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fireFlowTrigger } from './ingress';
import { storedTrigger } from './start';
import { SCHEDULES } from './store';

export interface BookingEvent {
  userId: string;
  leadId: string;
  /** The appointment's new time, or null when the booking was cancelled. */
  bookedTime: Date | string | null;
  /** What it used to be, so a reschedule can be told apart from a first booking. */
  previousBookedTime?: Date | string | null;
  now?: Date;
}

export interface BookingTriggerResult {
  action: 'started' | 'replanned' | 'cancelled' | 'unchanged';
  started: number;
  cancelledSteps: number;
  notes: string[];
}

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** The flows on this account that listen for a booking — the only ones a booking may touch. */
async function bookingFlowIds(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('automations')
    .select('id, description, is_active')
    .eq('user_id', userId)
    .limit(200);
  return (data ?? [])
    .filter((row: any) => row.is_active !== false && storedTrigger(row.description)?.type === 'trigger_booking_created')
    .map((row: any) => String(row.id));
}

/**
 * Drop everything still waiting for this lead on the given flows.
 *
 * `skipped` rather than delete: the ledger keeps the fact that the step existed and why it was
 * dropped, which is the difference between "we never planned that" and "we planned it and called it
 * off when the meeting moved".
 */
export async function cancelPendingBookingSteps(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
  flowIds: string[],
  reason: string
): Promise<number> {
  if (!flowIds.length) return 0;
  const { data } = await supabase
    .from(SCHEDULES)
    .update({ status: 'skipped', skip_reason: reason })
    .eq('user_id', userId)
    .eq('lead_id', leadId)
    .eq('status', 'pending')
    .in('flow_id', flowIds)
    .select('id');
  return (data ?? []).length;
}

/**
 * Tell the flows that this lead's appointment moved, appeared or went away.
 *
 * Never throws: it is called from a CRM write whose job is to save the booking. A sequence that
 * cannot be scheduled is worth a log line and a note in the result, not a failed booking.
 */
export async function onBookingChanged(
  supabase: SupabaseClient,
  event: BookingEvent
): Promise<BookingTriggerResult> {
  const result: BookingTriggerResult = { action: 'unchanged', started: 0, cancelledSteps: 0, notes: [] };
  const next = toDate(event.bookedTime);
  const previous = toDate(event.previousBookedTime ?? null);

  try {
    const flowIds = await bookingFlowIds(supabase, event.userId);
    if (!flowIds.length) {
      result.notes.push('no flow on this account listens for a booking, so nothing was scheduled');
      return result;
    }

    const cancelled = next === null;
    const rescheduled = next !== null && previous !== null && next.getTime() !== previous.getTime();

    // A first booking has nothing queued; a reschedule or a cancellation does.
    if (rescheduled || cancelled) {
      result.cancelledSteps = await cancelPendingBookingSteps(
        supabase,
        event.userId,
        event.leadId,
        flowIds,
        cancelled ? 'booking_cancelled' : 'booking_rescheduled'
      );
      result.action = cancelled ? 'cancelled' : 'replanned';
      result.notes.push(
        cancelled
          ? `cancelled ${result.cancelledSteps} scheduled step(s) because the appointment was called off`
          : `cancelled ${result.cancelledSteps} scheduled step(s) and re-planned against the new time`
      );
    } else if (previous !== null) {
      // Same time again — a re-save must not double-schedule, because the ledger's unique key would
      // silently drop the duplicate and the owner would think nothing happened.
      result.action = 'unchanged';
      result.notes.push('the appointment time did not change, so nothing was re-scheduled');
      return result;
    }

    if (cancelled) return result;

    const fired = await fireFlowTrigger(supabase, {
      userId: event.userId,
      trigger: 'trigger_booking_created',
      leadId: event.leadId,
      anchorAt: next,
      // The run key is the appointment time itself: a reschedule is a NEW run of the same sequence
      // (today's reminders are wrong for a new time), while a replayed webhook with the same time is
      // the same run and cannot fire twice.
      runKey: `booking:${next.toISOString()}`,
      now: event.now,
    });

    result.started = fired.started.length;
    if (fired.started.length) {
      result.action = previous !== null ? 'replanned' : 'started';
      const first = fired.started[0];
      result.notes.push(`started "${first.title}" with ${first.queued} step(s), first at ${first.firstRunAt ?? 'unknown'}`);
    }
    for (const skip of fired.skipped) {
      result.notes.push(`${skip.title}: ${skip.why}`);
    }
  } catch (error: any) {
    result.notes.push(`could not schedule the appointment sequence: ${error?.message || error}`);
  }

  return result;
}
