/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows are untyped (stale generated types), matching the other tool modules. */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  defaultRoutineIntent,
  ensurePeriodSession,
  periodKey,
  periodLabel,
  queueRoutineRun,
  type BusinessRoutine,
} from '@/lib/agent/routines';
import { enqueueRun } from '@/lib/agent/harness/runs';

/**
 * `run_routine` — start the daily routine on demand.
 *
 * The cron already turns a due routine into a harness run. What was missing was a
 * way for the agent (or the owner, through the agent) to say "do today's
 * marketing now" without waiting for 9am, and without inventing a second, subtly
 * different path to do it. Both routes go through `queueRoutineRun`, so a manual
 * trigger and a scheduled one produce identical work.
 *
 * It is deliberately a TRIGGER, not a composer: it decides that today's work
 * should exist and hands the brief to the harness. Composing the day is the
 * agent's job, from its own tools and the playbook.
 */
export function createRoutineTools(supabase: SupabaseClient, userId: string) {
  const db = supabase as any;

  /** The tenant's routine, or a conservative default once it is seeded. */
  const loadRoutine = async (): Promise<BusinessRoutine | null> => {
    const { data, error } = await db
      .from('business_routines')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (/does not exist|schema cache/i.test(String(error.message || ''))) return null;
      throw new Error(error.message);
    }
    return (data as BusinessRoutine) || null;
  };

  return {
    run_routine: tool({
      description:
        'Start this business\'s marketing routine for today, right now — the same work the daily cron would do. Reads the playbook (positioning, industry, the owner\'s daily_routine, the first-draft recipes) and starts ONE agent run that composes the day with its own tools (composeCreative, composeVideo, deliverArtefact). Idempotent per day: calling it twice does not produce two runs. Use it when the owner says "do today\'s marketing", "run the routine", "make today\'s posts", or after changing the playbook and wanting it applied immediately.',
      inputSchema: z.object({
        reason: z.string().optional().describe('One short sentence on why it is being run now'),
      }),
      execute: async ({ reason }: any) => {
        try {
          const routine = await loadRoutine();
          if (!routine) {
            return {
              ok: false,
              needsSetup: true,
              error:
                'This business has no daily routine yet. Create one from the CEO tab (Start it), then run it again.',
            };
          }

          const now = new Date();
          const period = periodKey(now, routine.timezone, routine.cadence);

          // Claim the period. The unique key on (routine_id, period_key) is what
          // makes this idempotent, and the check is the same one the cron relies on.
          const { error: claimErr } = await db.from('routine_runs').insert({
            routine_id: routine.id,
            user_id: userId,
            period_key: period,
            status: 'queued',
          });

          if (claimErr) {
            if (claimErr.code === '23505') {
              const { data: existing } = await db
                .from('routine_runs')
                .select('id, status, session_id, run_id, period_key')
                .eq('routine_id', routine.id)
                .eq('period_key', period)
                .maybeSingle();
              return {
                ok: true,
                alreadyRan: true,
                period,
                status: existing?.status || 'queued',
                sessionId: existing?.session_id || null,
                message: `Today's routine (${period}) has already been started. Open that thread rather than starting a second one.`,
              };
            }
            return { ok: false, error: claimErr.message };
          }

          const queued = await queueRoutineRun(db, routine, period, now);

          await db
            .from('business_routines')
            .update({ last_run_at: now.toISOString() })
            .eq('id', routine.id);

          return {
            ok: true,
            started: true,
            period,
            dateLabel: periodLabel(now, routine.timezone),
            sessionId: queued.sessionId,
            runId: queued.runId,
            reason: reason || null,
            message:
              'The day has been queued from the playbook. It will plan, produce and report in the daily thread; approvals will appear in the CEO tab.',
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'Could not start the routine' };
        }
      },
    }),

    /**
     * A one-off brief that is NOT tied to a routine period.
     *
     * "Make me a post about the new batch" is not a routine run, and forcing it
     * into one would burn the day's idempotency key. This starts a plain run with
     * a fresh thread instead, using the same playbook-driven brief.
     */
    run_one_off: tool({
      description:
        'Start a single piece of marketing work now, outside the daily routine (e.g. "make a post about the new batch", "cut me a 15s reel for the open day"). Creates its own thread so it does not consume or duplicate today\'s routine. Use the daily routine (run_routine) for the standing day-to-day work, and this for a specific request.',
      inputSchema: z.object({
        task: z.string().describe('What to make, in the owner\'s own words, with any facts they gave.'),
        title: z.string().optional().describe('Short title for the thread'),
      }),
      execute: async ({ task, title }: any) => {
        const goal = String(task || '').trim();
        if (!goal) return { ok: false, error: 'task is required' };

        try {
          const { data: profile } = await db
            .from('profiles')
            .select('business_name, industry')
            .eq('id', userId)
            .maybeSingle();

          const sessionTitle = title || `One-off: ${goal.slice(0, 40)}`;
          const sessionId = await ensurePeriodSession(db, userId, sessionTitle);

          const run = await enqueueRun(db, {
            sessionId,
            userId,
            goal: [
              `One-off marketing task for ${profile?.business_name || 'this business'}: ${goal}`,
              '',
              'Read the playbook first (get_playbook) so the industry vocabulary and the recipes match this business,',
              'then compose the artefact with composeCreative / composeVideo and deliver it with deliverArtefact.',
              'Quote to the owner before executing anything above ~200 credits. Never spend ad budget.',
            ].join('\n'),
            priority: 3,
          });

          return { ok: true, sessionId, runId: run?.id ?? null, title: sessionTitle };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'Could not start the task' };
        }
      },
    }),
  };
}

/** Seed a default routine for a business that has none (used by the CEO tab). */
export function defaultRoutine(businessName: string | null, industry: string | null) {
  return {
    name: 'Daily marketing',
    intent: defaultRoutineIntent(businessName || '', industry),
    cadence: 'daily' as const,
    channels: ['whatsapp'],
    approval_policy: 'always' as const,
  };
}
