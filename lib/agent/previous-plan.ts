/**
 * What the job said it would do yesterday, so today can be held to it.
 *
 * THE HALF OF THE LOOP THAT WAS MISSING
 * The brief has always asked the day to end with a digest — "DONE", "SPENT", "NEEDS YOU", "NOT DONE",
 * "TOMORROW" — and then never read it back. So every morning started with no memory of what yesterday
 * promised, which meant a plan could not fail: an aim could be stated, missed, and re-stated forever
 * with nobody the wiser. Measurement without accountability is a dashboard, not a manager.
 *
 * The digest already exists in the durable log (`harness_events`, `assistant.text`). This reads the
 * last one written for this business and pulls out the two lines that matter: what it said it had
 * done, and what it said it would do next. Today's brief then gets both, next to the measured
 * movement, and is told to judge itself honestly against them.
 *
 * Deliberately forgiving about FORM and strict about SUBSTANCE: the model writes markdown, bolds the
 * labels, and occasionally uses a dash, so the parser strips decoration. What it will not do is
 * invent a "TOMORROW" line that was never written — an absent aim is reported as absent, and today's
 * brief then says so instead of pretending there was one.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PreviousPlan {
  /** The day the aim was written for, as the period key ('YYYY-MM-DD'). */
  period: string;
  /** What it promised for the day now starting. Null when it did not say. */
  stated: string | null;
  /** What it claimed to have finished. Null when it did not say. */
  done: string | null;
  /** Anything it flagged as not done, and why. */
  notDone: string | null;
  /** The digest as written, trimmed for the brief. */
  digest: string;
}

/** Strip markdown decoration so `**TOMORROW:**` and `- tomorrow:` read the same. */
function cleanLabelText(text: string): string {
  return text
    .replace(/^[\s>*_#\-–—•]+/, '')
    .replace(/[*_`]/g, '')
    .trim();
}

/**
 * Pull one labelled line out of a digest.
 *
 * The label may be followed by ':' or '-' or an en dash, in any case. The value runs to the end of
 * the line. Returns null when the label is not there at all — which is different from "nothing to
 * report", and the caller is expected to distinguish them.
 */
export function digestLine(digest: string, label: string): string | null {
  const wanted = label.toLowerCase();
  for (const rawLine of String(digest || '').split(/\r?\n/)) {
    const stripped = cleanLabelText(rawLine);
    const lower = stripped.toLowerCase();
    if (!lower.startsWith(wanted)) continue;
    const rest = stripped.slice(wanted.length).replace(/^[\s:\-–—]+/, '').trim();
    return rest.length ? rest : null;
  }
  return null;
}

/** The last thing the model said in a run — which the brief requires to be the digest. */
export function lastAssistantText(events: readonly { type: string; data: any }[]): string | null {
  let text: string | null = null;
  for (const event of events || []) {
    if (event?.type !== 'assistant.text') continue;
    const value = typeof event.data?.text === 'string' ? event.data.text : '';
    if (value.trim()) text = value;
  }
  return text;
}

const MAX_DIGEST_CHARS = 1200;

/**
 * Read the most recent day that finished, and what it promised.
 *
 * Best-effort by construction: a missing table, a pruned session or an unparseable digest all return
 * `null` rather than throwing, because today's work must not depend on yesterday's paperwork.
 */
export async function previousDayPlan(
  supabase: SupabaseClient,
  userId: string,
  beforePeriod: string
): Promise<PreviousPlan | null> {
  try {
    const { data: runs, error } = await supabase
      .from('routine_runs')
      .select('period_key, session_id, run_id')
      .eq('user_id', userId)
      .lt('period_key', beforePeriod)
      .not('run_id', 'is', null)
      .order('period_key', { ascending: false })
      .limit(1);
    if (error || !runs?.length) return null;

    const period = String(runs[0].period_key || '');
    const sessionId = runs[0].session_id ? String(runs[0].session_id) : '';
    if (!sessionId) return null;

    const { data: events, error: eventsError } = await supabase
      .from('harness_events')
      .select('seq, type, data')
      .eq('session_id', sessionId)
      .eq('type', 'assistant.text')
      .order('seq', { ascending: true })
      .limit(500);
    if (eventsError) return null;

    const digest = lastAssistantText((events as any[]) || []);
    if (!digest) return null;

    return {
      period,
      stated: digestLine(digest, 'tomorrow'),
      done: digestLine(digest, 'done'),
      notDone: digestLine(digest, 'not done'),
      digest: digest.length > MAX_DIGEST_CHARS ? `${digest.slice(0, MAX_DIGEST_CHARS)}…` : digest,
    };
  } catch {
    return null;
  }
}
