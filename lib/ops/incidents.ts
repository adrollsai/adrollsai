/**
 * The incident store: one row per condition, however many times the sweep sees it.
 *
 * THE PROBLEM THIS SOLVES
 * The sweep runs every 30 minutes. Without identity, a job that has been stuck since
 * Tuesday is "discovered" 48 times a day, the owner is alerted 48 times, and there is no
 * way to tell a brand-new fault from the same old one. So every detection gets a
 * deterministic `fingerprint`, and this module turns "seen again" into an update rather
 * than an insert.
 *
 * AUTO-RESOLUTION IS THE OTHER HALF OF SELF-HEALING
 * A watchdog that only ever adds rows produces a wall of red that nobody reads, and the
 * owner stops trusting it. So a condition that the detectors no longer report is resolved
 * automatically, with `resolved_at` as the record. The console then shows what is true now,
 * not everything that has ever been true.
 *
 * WHY BATCHED READS AND WRITES
 * The first live sweep found 36 dead runs sharing one error. A per-row round trip would
 * have been 36 reads and 36 writes on every sweep, for one condition. Detections are
 * therefore grouped by cause before they reach here (see `detectors.ts`), and this module
 * does one read of the fingerprints in play, then one batched insert plus targeted updates.
 */

import type { Detection, Incident, IncidentStatus, RepairLogEntry, Severity } from './types';

/**
 * How long a condition may go unreported before it is considered gone.
 *
 * Three sweeps at 30 minutes. Long enough that a single skipped cron invocation does not
 * resolve everything and then re-create it (which would look like a new fault and re-alert
 * the owner), short enough that a fixed problem leaves the board within an hour and a half.
 */
export const RESOLVE_AFTER_MINUTES = 90;

/**
 * Stable identity for a condition: the class plus whatever distinguishes one of its
 * subjects from another.
 *
 * Deliberately built from data and not from the title or the evidence: those carry counts
 * and timestamps, so a fingerprint derived from them would be new every sweep and the
 * dedupe would do nothing.
 */
export function fingerprintOf(detection: Detection): string {
  const subject =
    detection.fingerprintKey ?? detection.subjectId ?? detection.subjectTable ?? 'platform';
  // Collapse whitespace and bound the length: this is an index key, not a sentence.
  const cleanSubject = String(subject).replace(/\s+/g, ' ').trim().slice(0, 180);
  const cleanClass = String(detection.class).replace(/\s+/g, '-').trim().slice(0, 80);
  return `${cleanClass}:${cleanSubject}`;
}

/** The subset of columns this module reads back. */
const INCIDENT_COLUMNS =
  'id, fingerprint, class, severity, title, evidence, suggested_fix, blast_radius, status, ' +
  'subject_table, subject_id, user_id, occurrences, repair_attempts, repair_log, first_seen_at, ' +
  'last_seen_at, last_repaired_at, resolved_at, notified_at, detail';

export interface ObserveResult {
  /** Fingerprints inserted for the first time. */
  created: string[];
  /** Fingerprints that already existed and were seen again. */
  recurring: string[];
  /** The rows as they now stand, for repairs to act on. */
  incidents: Incident[];
}

/**
 * Record what the detectors found, and return the incidents that are now live.
 *
 * Note what is *not* here: no repairs, no notifications. This function only answers "what
 * is true, and is it new?" — so it can be reasoned about (and tested) on its own.
 */
export async function observe(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  detections: readonly Detection[],
  now: Date,
): Promise<ObserveResult> {
  if (!detections.length) return { created: [], recurring: [], incidents: [] };

  // Dedupe within the sweep too: two detectors can legitimately describe the same subject,
  // and a battery of them would otherwise collide on the unique fingerprint.
  const byFingerprint = new Map<string, Detection>();
  for (const detection of detections) {
    const fingerprint = fingerprintOf(detection);
    if (!byFingerprint.has(fingerprint)) byFingerprint.set(fingerprint, detection);
  }

  const fingerprints = [...byFingerprint.keys()];
  const nowIso = now.toISOString();

  const { data: existingRows, error: readError } = await supabase
    .from('ops_incidents')
    .select(INCIDENT_COLUMNS)
    .in('fingerprint', fingerprints);
  if (readError) throw new Error(`could not read ops_incidents: ${String(readError.message || readError)}`);

  const existing = new Map<string, Incident>(
    ((existingRows ?? []) as Incident[]).map((row) => [row.fingerprint, row]),
  );

  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: { fingerprint: string; patch: Record<string, unknown> }[] = [];
  const created: string[] = [];
  const recurring: string[] = [];

  for (const [fingerprint, detection] of byFingerprint) {
    const prior = existing.get(fingerprint);

    if (!prior) {
      created.push(fingerprint);
      toInsert.push({
        fingerprint,
        class: detection.class,
        severity: detection.severity,
        title: detection.title,
        evidence: detection.evidence,
        suggested_fix: detection.suggestedFix,
        blast_radius: detection.blastRadius,
        // A condition that needs a human starts life in exactly that state, so the console
        // can be filtered to "waiting on me" without cross-referencing the repair registry.
        status: detection.blastRadius === 'safe' ? 'open' : 'needs_approval',
        subject_table: detection.subjectTable ?? null,
        subject_id: detection.subjectId ?? null,
        user_id: detection.userId ?? null,
        detail: detection.detail ?? null,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
      });
      continue;
    }

    recurring.push(fingerprint);

    // Only count a recurrence once per sweep. Two detectors describing the same subject in
    // the same run is one sighting, not two, and a number that inflates on every tick is a
    // number the owner learns to ignore.
    const lastSeen = Date.parse(prior.last_seen_at || '');
    const sameSweep = Number.isFinite(lastSeen) && now.getTime() - lastSeen < 60_000;
    const occurrences = prior.occurrences + (sameSweep ? 0 : 1);

    // A condition that came back after being resolved is open again, and its old
    // `resolved_at` would otherwise claim it is still fixed.
    const status: IncidentStatus =
      prior.status === 'resolved' || prior.status === 'ignored' ? 'open' : prior.status;

    toUpdate.push({
      fingerprint,
      patch: {
        severity: detection.severity,
        title: detection.title,
        evidence: detection.evidence,
        suggested_fix: detection.suggestedFix,
        blast_radius: detection.blastRadius,
        status,
        last_seen_at: nowIso,
        occurrences,
        detail: detection.detail ?? prior.detail ?? null,
        ...(status === 'open' && prior.status !== 'open' ? { resolved_at: null } : {}),
      },
    });
  }

  if (toInsert.length) {
    const { error } = await supabase.from('ops_incidents').insert(toInsert);
    // A concurrent sweep may have inserted the same fingerprint between our read and this
    // write. That is a race, not a fault: fall through and let the update path own the row.
    if (error) {
      const message = String(error.message || error);
      if (!/duplicate key|unique constraint/i.test(message)) {
        throw new Error(`could not insert ops_incidents: ${message}`);
      }
    }
  }

  for (const update of toUpdate) {
    const { error } = await supabase
      .from('ops_incidents')
      .update(update.patch)
      .eq('fingerprint', update.fingerprint);
    if (error) {
      throw new Error(
        `could not update ops_incident ${update.fingerprint}: ${String(error.message || error)}`,
      );
    }
  }

  // Read back rather than reconstruct: repairs and the report want the stored row (its id,
  // its repair_attempts, its status), not our idea of what the row should be.
  const { data: after, error: afterError } = await supabase
    .from('ops_incidents')
    .select(INCIDENT_COLUMNS)
    .in('fingerprint', fingerprints)
    .order('severity', { ascending: true });
  if (afterError) throw new Error(`could not re-read ops_incidents: ${String(afterError.message || afterError)}`);

  return { created, recurring, incidents: (after ?? []) as Incident[] };
}

/**
 * Resolve every incident the detectors did not report this sweep, once it has been quiet
 * long enough.
 *
 * `seen` is the set of fingerprints the sweep produced; anything open that is not in it and
 * whose `last_seen_at` is older than `RESOLVE_AFTER_MINUTES` is treated as gone. The age
 * check is what stops a single missed sweep from resolving the entire board and then
 * re-alerting on the next one.
 */
export async function resolveStale(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  seen: ReadonlySet<string>,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - RESOLVE_AFTER_MINUTES * 60_000).toISOString();

  const { data, error } = await supabase
    .from('ops_incidents')
    .select('id, fingerprint')
    .in('status', ['open', 'needs_approval', 'repaired'])
    .lt('last_seen_at', cutoff)
    .limit(500);
  if (error) throw new Error(`could not list stale incidents: ${String(error.message || error)}`);

  const stale = ((data ?? []) as { id: string; fingerprint: string }[]).filter(
    (row) => !seen.has(row.fingerprint),
  );
  if (!stale.length) return 0;

  const { error: updateError } = await supabase
    .from('ops_incidents')
    .update({ status: 'resolved', resolved_at: now.toISOString() })
    .in(
      'id',
      stale.map((row) => row.id),
    );
  if (updateError) throw new Error(`could not resolve stale incidents: ${String(updateError.message || updateError)}`);

  return stale.length;
}

/**
 * Append what a repair did and move the incident to its new state.
 *
 * Append-only on purpose: `repair_log` is evidence, and evidence that can be rewritten is
 * not evidence. The status transition travels with it so the board and the log can never
 * disagree about what happened.
 */
export async function recordRepair(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  incident: Incident,
  entry: RepairLogEntry,
  options: { status: IncidentStatus; incrementAttempts: boolean },
): Promise<Incident> {
  const log = Array.isArray(incident.repair_log) ? incident.repair_log : [];
  // Bound the log: an incident repaired every sweep for a month must not grow a row into
  // a megabyte of JSON. The newest 20 attempts are the ones anybody reads.
  const nextLog = [...log, entry].slice(-20);

  const patch: Record<string, unknown> = {
    repair_log: nextLog,
    status: options.status,
    ...(options.incrementAttempts ? { repair_attempts: (incident.repair_attempts ?? 0) + 1 } : {}),
    ...(entry.outcome === 'applied' ? { last_repaired_at: entry.at } : {}),
    ...(options.status === 'resolved' ? { resolved_at: entry.at } : {}),
  };

  const { data, error } = await supabase
    .from('ops_incidents')
    .update(patch)
    .eq('id', incident.id)
    .select(INCIDENT_COLUMNS)
    .single();
  if (error) throw new Error(`could not record repair for ${incident.fingerprint}: ${String(error.message || error)}`);

  return data as Incident;
}

/** Remember that the owner was told, so the same fault does not alert again in an hour. */
export async function markNotified(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  incidentIds: readonly string[],
  now: Date,
): Promise<void> {
  if (!incidentIds.length) return;
  const { error } = await supabase
    .from('ops_incidents')
    .update({ notified_at: now.toISOString() })
    .in('id', [...incidentIds]);
  if (error) throw new Error(`could not mark incidents notified: ${String(error.message || error)}`);
}

/** Everything currently open, newest and worst first — the console's list. */
export async function listIncidents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  options: { status?: IncidentStatus | 'all'; limit?: number } = {},
): Promise<Incident[]> {
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
  let query = supabase
    .from('ops_incidents')
    .select(INCIDENT_COLUMNS)
    .order('last_seen_at', { ascending: false })
    .limit(limit);

  if (options.status && options.status !== 'all') query = query.eq('status', options.status);

  const { data, error } = await query;
  if (error) throw new Error(`could not list ops_incidents: ${String(error.message || error)}`);
  return (data ?? []) as Incident[];
}

/** The severity order a person would want to read: critical first. */
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Sort stored rows the way the console and the digest present them. */
export function sortIncidents(incidents: readonly Incident[]): Incident[] {
  return [...incidents].sort((a, b) => {
    const statusRank = (incident: Incident) => (incident.status === 'needs_approval' ? 0 : 1);
    return (
      statusRank(a) - statusRank(b) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at)
    );
  });
}
