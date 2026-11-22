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
  type ApprovalPolicy,
  type BusinessRoutine,
  type Cadence,
} from '@/lib/agent/routines';
import { describeSchedule, nextRunAt } from '@/lib/agent/routine-schedule';
import { upcomingObservances } from '@/lib/automation/observance-calendar';
import { enqueueRun } from '@/lib/agent/harness/runs';
import { availableCredits, hasBalance, CREDIT_COSTS } from '@/utils/credits';

/**
 * The floor a routine must clear before it is allowed to start.
 *
 * A routine immediately begins composing creatives and films, so on an empty balance it queues a
 * run that spends its whole life failing every billable step — and the owner sees "routine started"
 * followed by nothing. One generated image is the smallest thing a routine produces, so that is the
 * floor: below it there is no point starting.
 */
const ROUTINE_MIN_CREDITS = CREDIT_COSTS.AI_IMAGE_GENERATION;

/**
 * Refuse to start a routine this account cannot pay for.
 *
 * Returns `null` when it may start. An UNKNOWN balance (`null`) is allowed rather than blocked: a
 * missing credits row must not read as "no money", which is the mistake `hasBalance(0)` invites.
 *
 * Exported so the decision can be checked against a real funded account without starting any work.
 */
export async function creditsRefusal(db: any, userId: string) {
  const credits = await availableCredits(db, userId);
  if (credits === null) return null;
  if (hasBalance(credits, ROUTINE_MIN_CREDITS)) return null;

  return {
    ok: false as const,
    insufficientCredits: true as const,
    credits,
    required: ROUTINE_MIN_CREDITS,
    error:
      `This account has ${credits} credit${credits === 1 ? '' : 's'} and a routine needs at least ` +
      `${ROUTINE_MIN_CREDITS} (one generated image) before it can produce anything. Nothing was ` +
      'started, so no run was queued and no credit was spent. Top up from Billing, then run it again.',
  };
}

// ── the routine row: readable, and editable in words ─────────────────────────

/** Cadences the executor understands. */
export const ROUTINE_CADENCES: Cadence[] = ['daily', 'weekly', 'monthly'];

/** Approval policies the composer understands: who signs off on the day's output. */
export const ROUTINE_APPROVAL_POLICIES: ApprovalPolicy[] = ['always', 'auto_images', 'never'];

/** Channels a routine may publish to. Anything else is a typo, not a new channel. */
export const ROUTINE_CHANNELS = ['whatsapp', 'calls', 'email', 'social', 'site', 'ads'] as const;

/** A routine this large a daily ceiling is almost certainly a typo in the owner's units. */
const MAX_DAILY_CREDIT_CAP = 100_000;

export interface RoutinePatchResult {
  ok: boolean;
  error?: string;
  patch?: Record<string, unknown>;
}

/**
 * Validate a natural-language routine change before anything is written.
 *
 * Pure and exported so the rejections can be tested without a database: a routine that runs at
 * "7pm" spelled `19`, in a timezone that does not exist, or with approval switched to `never`, is
 * exactly the kind of quiet misconfiguration that spends money unattended.
 */
export function validateRoutinePatch(input: any): RoutinePatchResult {
  const patch: Record<string, unknown> = {};
  const src = input || {};

  if (src.name !== undefined) {
    const name = String(src.name).trim();
    if (!name) return { ok: false, error: 'name cannot be empty' };
    patch.name = name.slice(0, 120);
  }

  if (src.intent !== undefined) {
    const intent = String(src.intent).trim();
    if (intent.length < 10) {
      return {
        ok: false,
        error: 'intent is too short: say what the routine should actually do each day, in one or two sentences.',
      };
    }
    patch.intent = intent.slice(0, 2000);
  }

  if (src.cadence !== undefined) {
    const cadence = String(src.cadence).trim().toLowerCase();
    if (!ROUTINE_CADENCES.includes(cadence as Cadence)) {
      return { ok: false, error: `cadence must be one of ${ROUTINE_CADENCES.join(', ')} (got "${src.cadence}")` };
    }
    patch.cadence = cadence;
  }

  if (src.runAtHour !== undefined) {
    const hour = Number(src.runAtHour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return { ok: false, error: `runAtHour must be a whole hour 0-23 in 24-hour time (got "${src.runAtHour}"). 7pm is 19.` };
    }
    patch.run_at_hour = hour;
  }

  if (src.timezone !== undefined) {
    const tz = String(src.timezone).trim();
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    } catch {
      return { ok: false, error: `"${tz}" is not a timezone I can resolve. Use an IANA name such as Asia/Kolkata.` };
    }
    patch.timezone = tz;
  }

  if (src.dailyCreditCap !== undefined) {
    const cap = Number(src.dailyCreditCap);
    if (!Number.isFinite(cap) || cap < 0) {
      return { ok: false, error: `dailyCreditCap must be a number of credits, zero or more (got "${src.dailyCreditCap}")` };
    }
    if (cap > MAX_DAILY_CREDIT_CAP) {
      return {
        ok: false,
        error: `dailyCreditCap of ${cap} is above the ${MAX_DAILY_CREDIT_CAP} ceiling. If that is really intended, raise it in the CEO tab.`,
      };
    }
    patch.daily_credit_cap = Math.round(cap);
  }

  if (src.approvalPolicy !== undefined) {
    const policy = String(src.approvalPolicy).trim().toLowerCase();
    if (!ROUTINE_APPROVAL_POLICIES.includes(policy as ApprovalPolicy)) {
      return {
        ok: false,
        error: `approvalPolicy must be one of ${ROUTINE_APPROVAL_POLICIES.join(', ')} (got "${src.approvalPolicy}")`,
      };
    }
    patch.approval_policy = policy;
  }

  if (src.channels !== undefined) {
    if (!Array.isArray(src.channels)) return { ok: false, error: 'channels must be a list, e.g. ["whatsapp"]' };
    const cleaned: string[] = Array.from(
      new Set<string>(
        (src.channels as unknown[])
          .map((c) => String(c ?? '').trim().toLowerCase())
          .filter(Boolean)
      )
    );
    const unknown = cleaned.filter((c) => !(ROUTINE_CHANNELS as readonly string[]).includes(c));
    if (unknown.length) {
      return {
        ok: false,
        error: `unknown channel(s): ${unknown.join(', ')}. Available: ${ROUTINE_CHANNELS.join(', ')}.`,
      };
    }
    if (cleaned.length > ROUTINE_CHANNELS.length) return { ok: false, error: 'too many channels' };
    patch.channels = cleaned;
  }

  if (src.toolGroups !== undefined) {
    if (!Array.isArray(src.toolGroups)) return { ok: false, error: 'toolGroups must be a list of group names' };
    patch.tool_groups = [...new Set(src.toolGroups.map((g: unknown) => String(g || '').trim()).filter(Boolean))];
  }

  if (src.enabled !== undefined) patch.enabled = src.enabled === true;

  if (!Object.keys(patch).length) {
    return { ok: false, error: 'Nothing to change: supply at least one of cadence, runAtHour, timezone, intent, name, dailyCreditCap, approvalPolicy, channels, toolGroups or enabled.' };
  }

  return { ok: true, patch };
}

/** One readable line per setting, for the confirmation the agent shows the owner. */
export function describeRoutine(routine: Partial<BusinessRoutine> | null): string[] {
  if (!routine) return [];
  return [
    `name: ${routine.name}`,
    `runs: ${routine.cadence} at ${String(routine.run_at_hour).padStart(2, '0')}:00 ${routine.timezone}`,
    `on: ${routine.enabled === false ? 'no' : 'yes'}`,
    `daily ceiling: ${Number(routine.daily_credit_cap ?? 0)} credits`,
    `approval: ${routine.approval_policy}`,
    `channels: ${(routine.channels || []).join(', ') || 'none'}`,
    routine.intent ? `intent: ${String(routine.intent).slice(0, 300)}` : '',
  ].filter(Boolean);
}

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
    get_routine: tool({
      description:
        'Read this business\'s standing routine: whether it is on, its cadence and the hour it runs in its own timezone, what it is for (the intent), the daily credit ceiling, who approves the output, the channels it may use, and when it last ran and will run next. Call this before changing it, and before answering "what does the agent do every day?".',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const routine = await loadRoutine();
          if (!routine) {
            return {
              ok: true,
              exists: false,
              message:
                'This business has no standing routine yet. Say what it should do each day and it can be created here - update_routine creates it on first write.',
              defaultsIfCreated: defaultRoutine(null, null),
            };
          }

          const now = new Date();
          const period = periodKey(now, routine.timezone, routine.cadence);
          let todayRun: any = null;
          try {
            const { data } = await db
              .from('routine_runs')
              .select('id, status, period_key, run_id, session_id, created_at')
              .eq('routine_id', routine.id)
              .eq('period_key', period)
              .maybeSingle();
            todayRun = data || null;
          } catch {
            todayRun = null;
          }

          return {
            ok: true,
            exists: true,
            routineId: routine.id,
            enabled: routine.enabled !== false,
            cadence: routine.cadence,
            runAtHour: routine.run_at_hour,
            timezone: routine.timezone,
            intent: routine.intent,
            dailyCreditCap: Number(routine.daily_credit_cap ?? 0),
            approvalPolicy: routine.approval_policy,
            channels: routine.channels || [],
            toolGroups: routine.tool_groups || [],
            lastRunAt: routine.last_run_at,
            nextRunAt: routine.next_run_at,
            thisPeriod: period,
            thisPeriodRun: todayRun ? { status: todayRun.status, runId: todayRun.run_id } : null,
            summary: describeRoutine(routine),
            // The observance days the brief will raise, so "what is coming up?" is answerable from
            // the routine itself rather than by waiting for a run or guessing.
            observanceDays: upcomingObservances(now, { withinDays: 21, timezone: routine.timezone }).map((o) => ({
              name: o.name,
              date: o.date,
              daysAway: o.daysAway,
              angle: o.angle,
              needsCreativeNow: o.needsCreativeNow,
            })),
            observanceNote:
              'Festival and observance creatives are part of every routine run: anything inside its lead time is produced before the day, not on it.',
            available: {
              cadences: ROUTINE_CADENCES,
              approvalPolicies: ROUTINE_APPROVAL_POLICIES,
              channels: [...ROUTINE_CHANNELS],
            },
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'Could not read the routine' };
        }
      },
    }),

    /**
     * `update_routine` — change the standing routine, in words.
     *
     * The routines endpoint deliberately exposes only create + list, on the grounds that cadence
     * changes should arrive as words ("stop doing reels daily"). That path did not exist: the agent
     * could START a routine and nothing else, so "make it weekly at 6pm" was answered with a
     * settings screen it could not reach. This closes it. Every value is validated first, and a
     * newly created routine is scheduled for its next real slot rather than firing immediately.
     */
    update_routine: tool({
      description:
        'Change this business\'s standing routine: cadence (daily/weekly/monthly), the hour it runs, its timezone, what it is for, the daily credit ceiling, who approves the output, which channels it may use, and whether it is switched on at all. Creates the routine if the business has none. Turning it ON, or relaxing approval away from "always", needs the owner\'s approval first; every other edit applies immediately. Show the owner what changed and when it will next run.',
      inputSchema: z.object({
        cadence: z.enum(['daily', 'weekly', 'monthly']).optional().describe('How often the routine runs'),
        runAtHour: z.number().optional().describe('Hour of the day to run, 0-23 in 24-hour time, in its own timezone. 7pm = 19.'),
        timezone: z.string().optional().describe('IANA timezone, e.g. Asia/Kolkata'),
        intent: z.string().optional().describe('What the routine should do each period, in the owner\'s words'),
        name: z.string().optional().describe('Short name for the routine'),
        dailyCreditCap: z.number().optional().describe('Most credits one run may spend'),
        approvalPolicy: z.enum(['always', 'auto_images', 'never']).optional().describe('Who signs off on the output'),
        channels: z.array(z.string()).optional().describe(`Channels it may use: ${ROUTINE_CHANNELS.join(', ')}`),
        toolGroups: z.array(z.string()).optional().describe('Tool groups the run may load'),
        enabled: z.boolean().optional().describe('Switch the routine on or off'),
        reason: z.string().optional().describe('One short sentence on why it is being changed, stored on the row'),
      }),
      execute: async (input: any) => {
        try {
          const checked = validateRoutinePatch(input);
          if (!checked.ok || !checked.patch) return { ok: false, error: checked.error };
          const patch = checked.patch as Record<string, any>;

          const existing = await loadRoutine();
          const now = new Date();

          // Which edits change WHEN it runs, and so need the next slot recomputed.
          const timingChanged =
            patch.cadence !== undefined ||
            patch.run_at_hour !== undefined ||
            patch.timezone !== undefined ||
            patch.enabled === true;

          if (!existing) {
            const { data: profile } = await db
              .from('profiles')
              .select('business_name, industry')
              .eq('id', userId)
              .maybeSingle();

            const row: Record<string, any> = {
              user_id: userId,
              name: patch.name || 'Daily marketing',
              intent:
                patch.intent ||
                defaultRoutineIntent(profile?.business_name || 'the business', profile?.industry || null),
              cadence: patch.cadence || 'daily',
              run_at_hour: patch.run_at_hour ?? 7,
              timezone: patch.timezone || 'Asia/Kolkata',
              daily_credit_cap: patch.daily_credit_cap ?? 200,
              approval_policy: patch.approval_policy || 'always',
              channels: patch.channels || ['whatsapp'],
              tool_groups: patch.tool_groups || [],
              enabled: patch.enabled === true,
            };
            // The hour and the timezone are honoured here, not just stored: the schedule resolves the
            // routine's own wall-clock hour in its own zone (see lib/agent/routine-schedule.ts).
            const next = nextRunAt(now, {
              cadence: row.cadence,
              run_at_hour: row.run_at_hour,
              timezone: row.timezone,
            });
            row.next_run_at = next.toISOString();

            const { data: created, error } = await db
              .from('business_routines')
              .insert(row)
              .select('*')
              .maybeSingle();
            if (error) return { ok: false, error: `Could not create the routine: ${error.message}` };

            return {
              ok: true,
              created: true,
              routineId: created?.id ?? null,
              enabled: row.enabled,
              nextRunAt: row.next_run_at,
              schedule: describeSchedule({ cadence: row.cadence, run_at_hour: row.run_at_hour, timezone: row.timezone }, next),
              summary: describeRoutine((created || row) as any),
              message:
                `Created: ${describeSchedule({ cadence: row.cadence, run_at_hour: row.run_at_hour, timezone: row.timezone }, next)}. ` +
                `${row.enabled ? 'It is switched ON' : 'It is switched OFF until you turn it on'}, ` +
                `daily ceiling ${row.daily_credit_cap} credits, approval ${row.approval_policy}.`,
            };
          }

          const before = describeRoutine(existing);
          const update: Record<string, any> = { ...patch };
          let nextDate: Date | null = null;
          if (timingChanged) {
            const merged = { ...existing, ...patch } as BusinessRoutine;
            nextDate = nextRunAt(now, {
              cadence: merged.cadence,
              run_at_hour: merged.run_at_hour,
              timezone: merged.timezone,
            });
            update.next_run_at = nextDate.toISOString();
          }

          const { error } = await db.from('business_routines').update(update).eq('id', existing.id);
          if (error) return { ok: false, error: `Could not update the routine: ${error.message}` };

          const after = { ...existing, ...update } as BusinessRoutine;
          const schedule = describeSchedule(
            { cadence: after.cadence, run_at_hour: after.run_at_hour, timezone: after.timezone },
            nextDate || new Date(String(after.next_run_at || now.toISOString()))
          );
          return {
            ok: true,
            routineId: existing.id,
            before,
            after: describeRoutine(after),
            nextRunAt: after.next_run_at,
            schedule,
            timingChanged,
            reason: input.reason || null,
            message: `Updated. ${schedule}.`,
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'Could not update the routine' };
        }
      },
    }),

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

          // Money first, before anything is claimed or queued.
          const refused = await creditsRefusal(db, userId);
          if (refused) return refused;

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
          // Same rule as run_routine: do not queue work this account cannot pay to finish.
          const refused = await creditsRefusal(db, userId);
          if (refused) return refused;

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
