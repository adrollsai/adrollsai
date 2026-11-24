/* eslint-disable @typescript-eslint/no-explicit-any -- stale generated Supabase types, same choice as lib/automation/billing.ts. */
/**
 * Everything the CEO tab needs for today, loaded once.
 *
 * This used to live inline in `app/api/agent/ceo/today/route.ts`, which ran five
 * queries one after another: profile, routines, today's run, approvals, CEO
 * session. Five serial round trips to a database in another region is why the tab
 * felt slow even before the client had painted anything.
 *
 * Four of those five do not depend on each other, so they go out together. Only
 * today's run depends on the routines list (there is nothing to look up when the
 * tenant has no routines), so the cost is two round trips instead of five.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { periodKey, periodLabel } from '@/lib/agent/routines';

export interface CeoApproval {
  actionId?: string;
  title?: string;
  description?: string;
  estimatedCost?: string;
  spec?: unknown;
  createdAt?: string;
}

export interface CeoToday {
  businessName: string | null;
  credits: number | null;
  /** The voice wallet. A separate pot: calls draw on calling_credits, never on the AI balance. */
  callingCredits: number | null;
  period: string;
  dateLabel: string;
  needsMigration: boolean;
  routines: any[];
  todayRun: any;
  approvals: CeoApproval[];
  ceoSession: any;
}

export const DEFAULT_TENANT_TIMEZONE = 'Asia/Kolkata';

/** The shape returned when the caller is not signed in. */
export function emptyCeoToday(now = new Date()): CeoToday {
  return {
    businessName: null,
    credits: null,
    callingCredits: null,
    period: periodKey(now, DEFAULT_TENANT_TIMEZONE, 'daily'),
    dateLabel: periodLabel(now, DEFAULT_TENANT_TIMEZONE),
    needsMigration: false,
    routines: [],
    todayRun: null,
    approvals: [],
    ceoSession: null,
  };
}

export async function loadCeoToday(
  supabase: SupabaseClient,
  userId: string,
  now = new Date()
): Promise<CeoToday> {
  const tz = DEFAULT_TENANT_TIMEZONE;
  const period = periodKey(now, tz, 'daily');

  // --- independent: four queries in one round trip ---
  const [profileRes, routinesRes, approvalsRes, sessionRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('business_name, credits, calling_credits, timezone')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('business_routines')
      .select('id, name, cadence, enabled, next_run_at, last_run_at, daily_credit_cap, approval_policy')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    supabase
      .from('agent_events')
      .select('id, payload, created_at')
      .eq('user_id', userId)
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10),
    // The permanent CEO conversation lives in its own workspace so it is never
    // buried under the daily threads.
    supabase
      .from('harness_sessions')
      .select('id, title, updated_at')
      .eq('user_id', userId)
      .eq('workspace_id', 'ceo')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // A tenant whose database predates the routines migration should be told, not
  // given an empty state that looks like "switched off".
  const routinesError = (routinesRes as any).error;
  const needsMigration = Boolean(
    routinesError && /does not exist|schema cache/i.test(String(routinesError.message || ''))
  );
  const routines = (routinesRes as any).data || [];

  // --- dependent: today's run only exists if there are routines ---
  let todayRun: any = null;
  if (routines.length > 0) {
    const { data: run } = await supabase
      .from('routine_runs')
      .select('id, period_key, status, digest, credits_spent, error, created_at')
      .in('routine_id', routines.map((r: any) => r.id))
      .eq('period_key', period)
      .maybeSingle();
    todayRun = run || null;
  }

  const pending = (approvalsRes as any).data || [];
  const profile = (profileRes as any).data;

  return {
    businessName: profile?.business_name || null,
    credits: profile?.credits ?? null,
    callingCredits: (profile as any)?.calling_credits ?? null,
    period,
    dateLabel: periodLabel(now, tz),
    needsMigration,
    routines,
    todayRun,
    approvals: pending.map((p: any) => ({
      actionId: p.payload?.actionId,
      title: p.payload?.title,
      description: p.payload?.description,
      estimatedCost: p.payload?.estimatedCost,
      spec: p.payload?.spec || null,
      createdAt: p.created_at,
    })),
    ceoSession: (sessionRes as any).data || null,
  };
}
