/**
 * The calling queue: which leads are in it, in what order, and why the rest are not.
 *
 * WHAT THE OWNER ASKED FOR, IN THEIR WORDS
 * "All the leads in the CRM who have not given a certain yes or no, that sit in fresh section or the agent hasn't
 * contacted yet, should be in the calling queue always. Also just-arrived leads should be given priority."
 *
 * So this module answers two questions and refuses to be vague about either:
 *   - IN or OUT, with a reason a human can read ("already said not interested", "called 3 times, limit is 3",
 *     "no phone number", "asked not to be called", "on the phone right now");
 *   - ORDER, where a lead that arrived in the last day and has never been touched goes first, ahead of the
 *     backlog and well ahead of retries.
 *
 * WHY THE ORDER MATTERS AND WAS WRONG
 * The candidates query ordered by `created_at` ascending — oldest lead first. With a few hundred fresh leads that
 * means the person who enquired three weeks ago is called before the one who enquired ten minutes ago, which is
 * both the worst conversion and the worst experience: the newest enquiry is the hottest and the one still
 * remembering your ad. Priority here is newest-uncontacted first, then never-contacted backlog, then retries
 * oldest-first (longest since last attempt).
 *
 * PURE: rows in, decisions out. No database, no clock of its own, so every rule below is testable.
 */

export type SkipReason =
  | 'no_phone'
  | 'not_indian'
  | 'opted_out'
  | 'unsubscribed'
  | 'in_flight'
  | 'booked'
  | 'max_attempts'
  | 'too_old'
  | 'stage_not_fresh'
  | 'locked'
  | 'decided';

export type QueueBucket = 'just-arrived' | 'never-contacted' | 'retry-due';

export interface QueueLeadRow {
  id: string;
  user_id?: string;
  phone: string | null;
  name?: string | null;
  created_at: string;
  voice_call_retry_count?: number | null;
  voice_call_status?: string | null;
  pipeline_stage?: string | null;
  last_call_at?: string | null;
  scheduled_at?: string | null;
  custom_fields?: any;
  booked_time?: string | null;
  processing_lock_until?: string | null;
}

export interface QueueOptions {
  now?: Date;
  /** A lead this new counts as "just arrived". Default 24 h. */
  freshHours?: number;
  /** Attempts allowed per lead. */
  maxAttempts?: number;
  /** Leads older than this are left alone. */
  maxAgeDays?: number;
  /** Stages that count as "fresh". Empty/absent means do not filter by stage. */
  freshStages?: string[] | null;
  /** Explicit decisions — a lead that has said yes or no is out of the queue. Defaults below. */
  decidedStatuses?: string[];
  decidedStages?: string[];
}

export interface QueueDecision {
  id: string;
  inQueue: boolean;
  bucket: QueueBucket | null;
  /** Lower sorts first. */
  priority: number;
  /** Readable reason, for the owner or the agent to say out loud. */
  reason: string;
  /** Machine code for why a lead was left out; absent when it is in the queue. */
  reasonCode?: SkipReason;
  attempts: number;
  minutesSinceArrival: number;
  minutesSinceContact: number | null;
  phone: string | null;
  name: string | null;
  stage: string | null;
  createdAt: string;
}

/** Statuses that mean the person has given a definite yes or no, so calling again is wrong. */
const DEFAULT_DECIDED_STATUSES = [
  'interested',
  'not_interested',
  'not interested',
  'converted',
  'won',
  'closed',
  'closed_won',
  'closed_lost',
  'junk',
  'invalid',
  'dnc',
  'do_not_call',
  'refused',
  'dead',
];

/** Pipeline stages that mean the same thing. */
const DEFAULT_DECIDED_STAGES = [
  'won',
  'lost',
  'closed',
  'junk',
  'not interested',
  'not_interested',
  'invalid',
  'booked',
  'visit done',
  'handed over',
];

const INDIAN = /^(\+?91|0)?[6-9]\d{9}$/;

const minutesBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 60000);

/**
 * Decide every lead's fate and its place in the queue.
 *
 * Returns a decision for EVERY row, including the skipped ones, because "42 leads, 9 in the queue, 33 skipped:
 * 12 already decided, 11 called the maximum number of times, 10 with no phone" is a far more useful answer than a
 * bare list of 9 ids — and it is the answer to "what is the state of calling?".
 */
export function prioritiseCallQueue(rows: QueueLeadRow[], options: QueueOptions = {}): QueueDecision[] {
  const now = options.now ?? new Date();
  const freshHours = options.freshHours ?? 24;
  const maxAttempts = options.maxAttempts ?? 3;
  const maxAgeDays = options.maxAgeDays ?? 365;
  const freshStages = (options.freshStages ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  const decidedStatuses = (options.decidedStatuses ?? DEFAULT_DECIDED_STATUSES).map((s) => s.toLowerCase());
  const decidedStages = (options.decidedStages ?? DEFAULT_DECIDED_STAGES).map((s) => s.toLowerCase());

  const decisions = rows.map((rawRow): QueueDecision => {
    // Normalise first: custom_fields arrives as TEXT from the candidates RPC, and an opt-out hidden in a string used
    // to be read as an object, found empty, and called anyway. This module's own fixtures proved it.
    const row = toQueueRow(rawRow);
    const createdAt = new Date(row.created_at);
    const attempts = Number(row.voice_call_retry_count) || 0;
    const status = String(row.voice_call_status ?? '').trim().toLowerCase();
    const stage = String(row.pipeline_stage ?? '').trim().toLowerCase();
    const fields = row.custom_fields ?? {};
    const lastCallAt = row.last_call_at ? new Date(row.last_call_at) : null;
    const minutesSinceArrival = Number.isFinite(createdAt.getTime()) ? minutesBetween(createdAt, now) : 0;
    const minutesSinceContact = lastCallAt && Number.isFinite(lastCallAt.getTime()) ? minutesBetween(lastCallAt, now) : null;

    const base = {
      id: row.id,
      inQueue: false,
      bucket: null,
      priority: Number.MAX_SAFE_INTEGER,
      attempts,
      minutesSinceArrival,
      minutesSinceContact,
      phone: row.phone ?? null,
      name: row.name ?? null,
      stage: row.pipeline_stage ?? null,
      createdAt: row.created_at,
    };

    const skip = (reason: SkipReason, text: string): QueueDecision => ({ ...base, reason: text, reasonCode: reason });

    const digits = String(row.phone ?? '').replace(/[^\d+]/g, '');
    if (!digits || digits.replace(/\D/g, '').length < 10) return skip('no_phone', 'no phone number on the lead');
    if (!INDIAN.test(digits.replace(/^\+/, ''))) return skip('not_indian', 'not an Indian mobile number');

    if (fields?.opt_out === true || String(fields?.opt_out) === 'true') return skip('opted_out', 'asked not to be called');
    if (fields?.unsubscribed_at) return skip('unsubscribed', 'unsubscribed');
    if (status === 'calling') return skip('in_flight', 'on a call right now');
    if (row.booked_time) return skip('booked', 'has already booked');
    if (row.processing_lock_until && new Date(row.processing_lock_until) > now) return skip('locked', 'being processed by another job');
    if (attempts >= maxAttempts) return skip('max_attempts', `called ${attempts} time${attempts === 1 ? '' : 's'}, limit is ${maxAttempts}`);
    if (decidedStatuses.includes(status)) return skip('decided', `already ${status.replace(/_/g, ' ')}`);
    if (decidedStages.includes(stage)) return skip('decided', `stage is "${row.pipeline_stage}"`);
    if (freshStages.length && !freshStages.includes(stage)) {
      return skip('stage_not_fresh', `stage "${row.pipeline_stage ?? 'unset'}" is not a fresh stage`);
    }
    if (minutesSinceArrival > maxAgeDays * 24 * 60) return skip('too_old', `older than ${maxAgeDays} days`);

    // In the queue. A lead that arrived recently AND has never been contacted is the hottest thing in the CRM.
    const neverContacted = attempts === 0 && minutesSinceContact === null;
    const justArrived = neverContacted && minutesSinceArrival <= freshHours * 60;

    if (justArrived) {
      return {
        ...base,
        inQueue: true,
        bucket: 'just-arrived',
        // Newest first: 0 minutes old sorts above 90 minutes old, and both above everything else.
        priority: minutesSinceArrival,
        reason: `arrived ${formatAge(minutesSinceArrival)} ago and never contacted`,
      };
    }
    if (neverContacted) {
      return {
        ...base,
        inQueue: true,
        bucket: 'never-contacted',
        priority: 1_000_000 + minutesSinceArrival,
        reason: 'never contacted',
      };
    }
    return {
      ...base,
      inQueue: true,
      bucket: 'retry-due',
      // Longest since last contact first, so nobody is left rotting at the back of the retry pile.
      priority: 2_000_000 + (minutesSinceContact ?? 0) * -1,
      reason: `attempt ${attempts + 1} of ${maxAttempts}, last contacted ${formatAge(minutesSinceContact ?? 0)} ago`,
    };
  });

  // Queue members first, by priority; skipped leads after them, most-recently-touched first so the tail is readable.
  return decisions.sort((a, b) => {
    if (a.inQueue !== b.inQueue) return a.inQueue ? -1 : 1;
    if (a.inQueue) return a.priority - b.priority;
    return a.minutesSinceArrival - b.minutesSinceArrival;
  });
}

/** "3 minutes", "4 hours", "6 days" — because "4123 minutes ago" is not an answer. */
export function formatAge(minutes: number): string {
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${Math.round(minutes)} minute${Math.round(minutes) === 1 ? '' : 's'}`;
  if (minutes < 60 * 24) {
    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.round(minutes / (60 * 24));
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Totals for a report, so the state of calling can be stated without listing every lead. */
export function summariseQueue(decisions: QueueDecision[]): {
  total: number;
  inQueue: number;
  justArrived: number;
  neverContacted: number;
  retryDue: number;
  skipped: Record<string, number>;
} {
  const skipped: Record<string, number> = {};
  let justArrived = 0;
  let neverContacted = 0;
  let retryDue = 0;

  for (const decision of decisions) {
    if (decision.inQueue) {
      if (decision.bucket === 'just-arrived') justArrived += 1;
      else if (decision.bucket === 'never-contacted') neverContacted += 1;
      else retryDue += 1;
    } else {
      const code = decision.reasonCode ?? 'other';
      skipped[code] = (skipped[code] ?? 0) + 1;
    }
  }

  return {
    total: decisions.length,
    inQueue: justArrived + neverContacted + retryDue,
    justArrived,
    neverContacted,
    retryDue,
    skipped,
  };
}

/**
 * Accept a row straight from Postgres, where `custom_fields` may arrive as TEXT rather than JSON.
 *
 * The candidates RPC returns `custom_fields text`, and a queue that silently ignores an opt-out because the field
 * was a string instead of an object is exactly the bug that calls somebody who asked not to be called.
 */
export function toQueueRow(raw: any): QueueLeadRow {
  let fields = raw?.custom_fields;
  if (typeof fields === 'string') {
    try {
      fields = JSON.parse(fields);
    } catch {
      fields = {};
    }
  }
  return {
    id: String(raw?.id ?? ''),
    user_id: raw?.user_id ? String(raw.user_id) : undefined,
    phone: raw?.phone ?? null,
    name: raw?.name ?? null,
    created_at: String(raw?.created_at ?? new Date(0).toISOString()),
    voice_call_retry_count: raw?.voice_call_retry_count ?? 0,
    voice_call_status: raw?.voice_call_status ?? null,
    pipeline_stage: raw?.pipeline_stage ?? null,
    last_call_at: raw?.last_call_at ?? null,
    scheduled_at: raw?.scheduled_at ?? null,
    custom_fields: fields ?? {},
    booked_time: raw?.booked_time ?? null,
    processing_lock_until: raw?.processing_lock_until ?? null,
  };
}