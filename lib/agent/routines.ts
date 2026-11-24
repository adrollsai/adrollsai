import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueueRun } from './harness/runs';
import { getActivePlaybook } from '@/lib/automation/ceo';
import { availableCredits } from '@/lib/automation/billing';
import { composeRoutineBrief } from '@/lib/automation/routine-composer';
import { nextRunAt } from './routine-schedule';
import { resolveCountry, upcomingFestivals } from '@/utils/festival-helper';
import { supabaseMetricsReader } from './ceo-metrics';
import { weekRecap } from './weekly-recap';
import { loadAccountPerformance, type AccountPerformance } from '@/lib/ads/account-performance';

/**
 * Business routines — the daily loop.
 *
 * The old cron routes decided in code that every business gets an image a day and a
 * video every third day. A routine is the same job expressed as data instead: a
 * standing brief, a cadence, a spend ceiling and an approval policy. The materialiser
 * below turns a due routine into an ordinary harness run inside that day's session,
 * which means retries, leases, resume, checkpointing and dead-lettering are already
 * someone else's solved problem.
 */

export type Cadence = 'daily' | 'weekly' | 'monthly';
export type ApprovalPolicy = 'always' | 'auto_images' | 'never';

export interface BusinessRoutine {
  id: string;
  user_id: string;
  name: string;
  intent: string;
  cadence: Cadence;
  run_at_hour: number;
  timezone: string;
  daily_credit_cap: number | string;
  approval_policy: ApprovalPolicy;
  tool_groups: string[];
  channels: string[];
  enabled: boolean;
  version: number;
  last_run_at: string | null;
  next_run_at: string | null;
}

export interface RoutineMaterialiseResult {
  checked: number;
  queued: Array<{ routineId: string; periodKey: string; sessionId: string; runId: string | null }>;
  skipped: Array<{ routineId: string; reason: string }>;
}

// ---------------------------------------------------------------- time helpers

/** 'YYYY-MM-DD' in the business's own timezone, which is what "today" means to them. */
export function periodKey(now: Date, timezone: string, cadence: Cadence = 'daily'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const y = get('year');
  const m = get('month');
  const d = get('day');
  if (cadence === 'monthly') return `${y}-${m}`;
  if (cadence === 'weekly') {
    // ISO-ish week label; good enough for an idempotency key.
    const day = new Date(`${y}-${m}-${d}T12:00:00Z`);
    const jan1 = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((day.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7);
    return `${y}-W${String(week).padStart(2, '0')}`;
  }
  return `${y}-${m}-${d}`;
}

/** Human label for the thread title: "Tuesday, 12 Nov". */
export function periodLabel(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(now);
}

export function nextRunAfter(now: Date, routine: BusinessRoutine): Date {
  // Delegates to the real scheduler. The version this replaces added days to `now` and read neither
  // `run_at_hour` nor `timezone`, so a routine whose row said "weekly at 18:00" fired at whatever
  // clock time it happened to be created or last bumped - the hour was decoration.
  return nextRunAt(now, {
    cadence: routine.cadence,
    run_at_hour: routine.run_at_hour,
    timezone: routine.timezone,
  });
}

// ---------------------------------------------------------------- the brief

export interface BriefContext {
  businessName?: string | null;
  industry?: string | null;
  todaysDate: string;
  timezone: string;
  festivals?: string[];
  recentOutputs?: string[];
  pendingApprovals?: number;
  creditsLeft?: number | null;
  lastWeekNotes?: string | null;
}

/**
 * The standing prompt for the day's run.
 *
 * Written as a brief to a chief of staff: it sets the role, forces it to look before it
 * plans, gives the money rules, and states the exact shape of what it must report. The
 * cadence lives in here as guidance, not as a hardcoded schedule, so a festival week or
 * a dead property can change the plan without a deploy.
 */
export function dailyBrief(routine: BusinessRoutine, ctx: BriefContext): string {
  const lines: string[] = [];
  lines.push(
    `You are running marketing for ${ctx.businessName || 'this business'} today (${ctx.todaysDate}, ${ctx.timezone}).`
  );
  lines.push('');
  lines.push('STANDING BRIEF (this is the job, not a suggestion):');
  lines.push(routine.intent.trim());
  lines.push('');
  lines.push('BEFORE YOU PLAN, LOOK AT THE BUSINESS — with tools, not memory:');
  lines.push('- new and open leads, what stage they are in, and anything waiting on a reply');
  lines.push('- the catalogue: what is actually for sale right now');
  lines.push('- what we published in the last 7 days and what happened to it');
  lines.push('- the calendar: any festival, holiday or event today or tomorrow');
  lines.push('- credits left and what today is allowed to spend');
  if (ctx.festivals?.length) lines.push(`- known for today: ${ctx.festivals.join(', ')}`);
  if (ctx.lastWeekNotes) lines.push(`- last week's conclusion: ${ctx.lastWeekNotes}`);
  lines.push('');
  lines.push('THEN DO THE DAY:');
  lines.push('- decide what today actually needs, and say why in one line');
  lines.push('- do the routine work yourself; only ask the owner for decisions that are his');
  lines.push('- make the cheap preparation first (copy, voice, reference), then stop ONCE at');
  lines.push('  request_human_approval immediately before the first billable generation');
  lines.push(`- approval policy for today: ${routine.approval_policy}`);
  lines.push(
    `- spend ceiling for today: ${routine.daily_credit_cap} credits. If the day would cost more, do the cheaper version and say what you skipped.`
  );
  lines.push(`- channels available: ${routine.channels.join(', ')}`);
  lines.push('');
  lines.push('RULES THAT DO NOT BEND:');
  lines.push('- never invent a price, a RERA number, an availability or a performance figure');
  lines.push('- a reference creative is a style guide, never this business\'s property');
  lines.push('- nothing goes to a paid channel or a broadcast without approval');
  lines.push('- if nothing needs doing today, say so plainly and stop; a quiet day is a valid outcome');
  lines.push('');
  lines.push('FINISH WITH A DIGEST in exactly this shape, because it becomes the email and the push:');
  lines.push('  DONE: what you made, with links');
  lines.push('  SPENT: credits used today');
  lines.push('  NEEDS YOU: approvals pending, missing inputs, decisions (or "nothing")');
  lines.push('  NOT DONE: what you skipped and why (or "nothing")');
  lines.push('  TOMORROW: one line on what is next');

  if (ctx.pendingApprovals) {
    lines.push('');
    lines.push(`There are already ${ctx.pendingApprovals} approval(s) waiting — do not duplicate them.`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- materialiser

/**
 * Create (or reuse) the thread this routine's period belongs to.
 *
 * One thread per day is deliberate: the day's work, the argument about it and the
 * corrections all stay in one place, and the CEO tab stays a separate, permanent
 * conversation about the business.
 */
export async function ensurePeriodSession(
  supabase: SupabaseClient,
  userId: string,
  title: string
): Promise<string> {
  const workspace = 'daily';
  const { data: existing } = await supabase
    .from('harness_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('workspace_id', workspace)
    .eq('title', title)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await supabase
    .from('harness_sessions')
    .insert({ user_id: userId, workspace_id: workspace, title, status: 'idle' })
    .select('id')
    .single();
  if (error || !created?.id) {
    throw new Error(`could not create the day's session: ${error?.message || 'unknown'}`);
  }
  return created.id as string;
}

/**
 * One run per business per sweep, whatever the table contains.
 *
 * The schema allows a business to hold several routine rows, but nothing in the product means
 * that: `loadRoutine()` picks the oldest row and the CEO tab treats the routine as singular.
 * So duplicates were invisible dead weight — except to this cron, which queued one run per row
 * per period, each with its own `routineId:period` idempotency key and therefore no dedupe.
 * Measured on production before this: six runs for one tenant on a single day, and three on the
 * day the ops watchdog first ran.
 *
 * The caller's query is ordered by `next_run_at`, so the row kept per business is the most
 * overdue one, which is the one a person would have expected to run.
 *
 * Pure and exported so `scripts/verify-routine-once-per-day.ts` can prove it without a database.
 */
export function pickRoutinesToMaterialise<T extends { user_id: string }>(due: readonly T[]): T[] {
  const seen = new Set<string>();
  const picked: T[] = [];
  for (const routine of due) {
    if (!routine?.user_id || seen.has(routine.user_id)) continue;
    seen.add(routine.user_id);
    picked.push(routine);
  }
  return picked;
}

export async function materialiseDueRoutines(
  supabase: SupabaseClient,
  now = new Date(),
  limit = 50
): Promise<RoutineMaterialiseResult> {
  const result: RoutineMaterialiseResult = { checked: 0, queued: [], skipped: [] };

  const { data: routines, error } = await supabase
    .from('business_routines')
    .select('*')
    .eq('enabled', true)
    .lte('next_run_at', now.toISOString())
    .order('next_run_at', { ascending: true })
    .limit(limit);

  if (error) {
    // A missing table is not an error the cron should shout about on a fresh install.
    if (/does not exist|schema cache/i.test(error.message)) return result;
    throw new Error(error.message);
  }
  if (!routines?.length) return result;

  const due = pickRoutinesToMaterialise(routines as BusinessRoutine[]);
  const extra = (routines as BusinessRoutine[]).length - due.length;
  if (extra > 0) {
    // Say it out loud rather than silently ignoring the duplicates: an operator reading the cron
    // log should learn that this business holds rows the product will never use.
    console.warn(
      `[routines] ${extra} duplicate routine row(s) ignored — one run is queued per business per period`
    );
  }

  for (const routine of due) {
    result.checked++;
    const period = periodKey(now, routine.timezone, routine.cadence);

    // Claim the period first. Two unique keys protect this: `(routine_id, period_key)` from the
    // original design, and `(user_id, period_key)` added because the first one cannot see a
    // duplicate routine row. If another worker — or another routine of the same business — got
    // here first, we simply move on.
    const { error: claimErr } = await supabase.from('routine_runs').insert({
      routine_id: routine.id,
      user_id: routine.user_id,
      period_key: period,
      status: 'queued',
    });
    if (claimErr) {
      if (claimErr.code === '23505') {
        result.skipped.push({ routineId: routine.id, reason: `period ${period} already ran` });
        await bumpNextRun(supabase, routine, now);
        continue;
      }
      result.skipped.push({ routineId: routine.id, reason: claimErr.message });
      continue;
    }

    try {
      const queued = await queueRoutineRun(supabase, routine, period, now);
      await bumpNextRun(supabase, routine, now);
      result.queued.push({
        routineId: routine.id,
        periodKey: period,
        sessionId: queued.sessionId,
        runId: queued.runId,
      });
    } catch (e: any) {
      await supabase
        .from('routine_runs')
        .update({ status: 'failed', error: String(e?.message || e) })
        .eq('routine_id', routine.id)
        .eq('period_key', period);
      result.skipped.push({ routineId: routine.id, reason: String(e?.message || e) });
    }
  }

  return result;
}

/**
 * Turn one routine period into one harness run.
 *
 * Shared by the cron (`materialiseDueRoutines`) and the `run_routine` agent tool,
 * so "do today's marketing now" and "the 9am cron fired" produce byte-identical
 * work rather than two dialects of the same idea.
 *
 * The caller is responsible for having claimed the (routine_id, period_key) row:
 * that unique key is the only thing standing between a retried cron and a
 * duplicate run.
 */
export async function queueRoutineRun(
  supabase: SupabaseClient,
  routine: BusinessRoutine,
  period: string,
  now = new Date()
): Promise<{ sessionId: string; runId: string | null }> {
  const title = periodLabel(now, routine.timezone);
  const sessionId = await ensurePeriodSession(supabase, routine.user_id, title);

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, industry, credits')
    .eq('id', routine.user_id)
    .single();

  // The day is composed from the playbook, not from a hardcoded schedule:
  // positioning, industry vocabulary, the owner's own daily_routine and the
  // first-draft recipes all go into the brief. The routine row supplies the
  // cadence, the approval policy, the ceiling and the channels.
  const playbook = await getActivePlaybook(supabase, routine.user_id);

  const [{ count: pendingApprovals }, available] = await Promise.all([
    supabase
      .from('agent_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', routine.user_id)
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .eq('status', 'pending'),
    availableCredits(supabase, routine.user_id),
  ]);

  // The brief tells the agent to check "the calendar: any festival, holiday or event
  // today or tomorrow" — but nothing ever filled the slot in, so it had to guess. A
  // guessed festival is exactly what the brief forbids inventing, so the calendar is
  // resolved here and stated as fact.
  const { data: countryProfile } = await supabase
    .from('profiles')
    .select('address, currency, client_features')
    .eq('id', routine.user_id)
    .single();
  const country = resolveCountry({
    clientFeaturesCountry: (countryProfile as any)?.client_features?.country,
    address: (countryProfile as any)?.address,
    currency: (countryProfile as any)?.currency,
  });

  /**
   * WHAT ACTUALLY HAPPENED, BEFORE TODAY IS PLANNED.
   *
   * Two reads, both cheap next to a generation, and both were missing from this exact call site:
   *
   *   1. Last week, measured — `lastWeekNotes` had a slot in the brief and no supplier, so the
   *      line never printed and every morning started from zero. Now the week is computed from
   *      the numbers we own (enquiries, ad money, calls, content) and compared with the week
   *      before, so today's plan can answer what yesterday's could not.
   *   2. The per-argument verdicts — `creativeLearnings` likewise had a slot and no supplier, so
   *      the brief always printed "not read yet" and the day depended on the model choosing to
   *      call the optimiser mid-run. Now the measured winners and losers are in the brief before
   *      a single token of today's plan is written.
   *
   * Both are best-effort by design: Meta being down must degrade the brief to "we could not read
   * it", never block the day. `measured: false` is passed through as an absence, not as a zero.
   */
  const [performance, recap] = await Promise.all([
    loadAccountPerformance(supabase, routine.user_id, { datePreset: 'last_7d', level: 'ad' }).catch(
      (e: any): AccountPerformance => ({
        measured: false,
        currency: 'INR',
        spendPaise: 0,
        results: 0,
        costPerResultPaise: null,
        previousCostPerResultPaise: null,
        rows: 0,
        learnings: null,
        error: String(e?.message || e),
      })
    ),
    weekRecap(supabaseMetricsReader(supabase, routine.user_id), now, routine.timezone).catch(() => null),
  ]);

  const compiled = composeRoutineBrief({
    businessName: profile?.business_name,
    industry: profile?.industry,
    playbook,
    routine: {
      name: routine.name,
      intent: routine.intent,
      cadence: routine.cadence,
      approval_policy: routine.approval_policy,
      daily_credit_cap: routine.daily_credit_cap,
      channels: routine.channels || [],
      timezone: routine.timezone,
    },
    todaysDate: period,
    now,
    creditsLeft: profile?.credits ?? null,
    availableCredits: available,
    pendingApprovals: pendingApprovals || 0,
    festivals: upcomingFestivals(country.code, now, 1),
    lastWeekNotes: recap?.text ?? null,
    creativeLearnings: performance.learnings,
    adPerformance: {
      measured: performance.measured,
      currency: performance.currency,
      spendPaise: performance.spendPaise,
      results: performance.results,
      costPerResultPaise: performance.costPerResultPaise,
      previousCostPerResultPaise: performance.previousCostPerResultPaise,
    },
  });

  const run = await enqueueRun(supabase, {
    sessionId,
    userId: routine.user_id,
    goal: compiled.text,
    // Same routine, same period → at most one run, however many times it is asked.
    idempotencyKey: `${routine.id}:${period}`,
    priority: 5,
  });

  await supabase
    .from('routine_runs')
    .update({ session_id: sessionId, run_id: run?.id ?? null, status: 'queued' })
    .eq('routine_id', routine.id)
    .eq('period_key', period);

  return { sessionId, runId: run?.id ?? null };
}

async function bumpNextRun(supabase: SupabaseClient, routine: BusinessRoutine, now: Date) {
  const next = nextRunAfter(now, routine);
  await supabase
    .from('business_routines')
    .update({ last_run_at: now.toISOString(), next_run_at: next.toISOString() })
    .eq('id', routine.id);
}

/**
 * Seed the default routine for a business that has none.
 *
 * Deliberately conservative: one image a day, video only when the day calls for it,
 * always ask before spending. The owner (or the CEO, weekly) can then change the
 * cadence in words rather than us shipping a new flag.
 */
export function defaultRoutineIntent(businessName: string, industry: string | null): string {
  const niche = industry ? `${industry} business` : 'business';
  return [
    `Grow ${businessName || 'the business'} — a ${niche} — one day at a time.`,
    'Each day: keep the pipeline moving (nobody left without a follow-up),',
    'put one strong creative in front of the right local audience,',
    'and make a short video only when there is something worth filming —',
    'a festival, a new listing, a price change, or a week with no video yet.',
    'Report honestly: if a format is not bringing enquiries, propose spending the',
    'effort somewhere else instead of producing it again.',
  ].join(' ');
}
