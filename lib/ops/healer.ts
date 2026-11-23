/**
 * One sweep: look, record, fix what is safe, tell the owner what is not.
 *
 * This is the only place the three halves meet, and the order matters:
 *
 *   detect  →  record  →  repair  →  resolve  →  notify
 *
 * Record before repair, always. If the process dies mid-repair there is still an incident row
 * saying what was attempted, which is the difference between an auditable system and one that
 * changed a customer's row and left no trace. Resolve after repair so an incident fixed this
 * sweep is not also marked resolved by the same sweep's bookkeeping. Notify last, because the
 * message should describe what actually happened, not what was planned.
 *
 * ── one broken detector must not blind the rest ───────────────────────────────
 * Each detector is called inside its own try/catch. A watchdog whose only failure mode is
 * "silence because one query started throwing" is worse than no watchdog, because the silence
 * looks like good news. Failures are collected, returned in the sweep result, and logged.
 *
 * ── what it will never do ─────────────────────────────────────────────────────
 * Nothing here sends a message to a customer, spends money, launches a campaign, or patches
 * code. Detections that need those land as `needs_approval` and wait. The watchdog's whole
 * contribution is to make sure the owner *knows*, which is the part that was missing.
 */

import type {
  Detection,
  Detector,
  DetectorContext,
  OpsConfig,
  RepairLogEntry,
  SweepResult,
} from './types';
import { DETECTORS } from './detectors';
import { fingerprintOf, markNotified, observe, recordRepair, resolveStale, sortIncidents } from './incidents';
import { refusalReason, repairFor } from './repairs';

/**
 * How long before the same incident may alert the owner again.
 *
 * Six hours. A stuck job that nobody has fixed will still be stuck at the next sweep, and an
 * alert every 30 minutes trains the owner to mute the channel — after which the watchdog is
 * decorative. Six hours keeps a live incident visible without becoming noise.
 */
export const NOTIFY_COOLDOWN_HOURS = 6;

/** How many incidents fit in one alert before it becomes a report nobody reads. */
const NOTIFY_TOP_N = 5;

export interface HealOptions {
  /** Injected, so the verify gate can drive the whole sweep from fakes. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  now?: Date;
  config?: Partial<OpsConfig>;
  detectors?: readonly Detector[];
  /** Set false to record incidents without sending anything. Used by the verify gate. */
  notify?: boolean;
  /**
   * Set false to detect and record without applying any repair.
   *
   * This exists because "look but do not touch" is the mode every cautious operator wants on
   * the first run, and it has to be a real flag rather than a promise in a doc comment. When
   * false, incidents are still created and updated — knowing what the detectors would have
   * found is the whole value — but no write leaves the incident table.
   */
  applyRepairs?: boolean;
}

/**
 * Run one full sweep.
 *
 * Returns a structured result rather than logging into the void: the cron route returns it as
 * JSON, and `scripts/verify-ops-watchdog.mjs` asserts against it. A watchdog you cannot test
 * is a rumour.
 */
export async function heal(options: HealOptions): Promise<SweepResult> {
  const now = options.now ?? new Date();
  const detectors = options.detectors ?? DETECTORS;
  const startedAt = now.toISOString();
  const startedMs = Date.now();

  const config: OpsConfig = {
    appUrl: options.config?.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? null,
    lookbackMinutes: options.config?.lookbackMinutes ?? 24 * 60,
  };

  const ctx: DetectorContext = { supabase: options.supabase, now, config };

  // ── 1. detect
  const detections: Detection[] = [];
  const detected: Record<string, number> = {};
  const detectorErrors: { detector: string; error: string }[] = [];

  for (const detector of detectors) {
    try {
      const found = await detector.run(ctx);
      detected[detector.id] = found.length;
      detections.push(...found);
    } catch (error) {
      detected[detector.id] = 0;
      detectorErrors.push({
        detector: detector.id,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`[ops-watchdog] detector ${detector.id} failed:`, error);
    }
  }

  // ── 2. record
  const observed = await observe(ctx.supabase, detections, now);
  const seen = new Set(detections.map((detection) => fingerprintOf(detection)));

  // ── 3. repair what is safe
  const repaired: SweepResult['repaired'] = [];
  const suppressed: SweepResult['suppressed'] = [];
  let awaitingApproval = 0;

  for (const incident of sortIncidents(observed.incidents)) {
    if (incident.status === 'resolved' || incident.status === 'ignored') continue;

    const repair = repairFor(incident.class);
    const refusal = refusalReason(repair, incident, now);

    if (refusal) {
      if (incident.blast_radius === 'needs_approval') {
        awaitingApproval += 1;
      } else {
        // `safe` with no repair registered is not a fault: it means the condition is
        // describable but nothing may act on it yet. Say so rather than pretending it is fine.
        suppressed.push({ fingerprint: incident.fingerprint, reason: refusal });
      }
      continue;
    }

    // `refusal === null` proves the repair exists and every gate passed; the assertion is for
    // the type system, which cannot see that through the null check above.
    if (!repair) continue;

    if (options.applyRepairs === false) {
      suppressed.push({ fingerprint: incident.fingerprint, reason: 'dry-run' });
      continue;
    }

    const at = new Date().toISOString();
    let entry: RepairLogEntry;
    try {
      const outcome = await repair.apply(incident, ctx);
      entry = {
        at,
        outcome: outcome.ok ? 'applied' : 'failed',
        detail: outcome.detail,
        touched: outcome.touched,
      };
    } catch (error) {
      entry = {
        at,
        outcome: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      // A repair that throws still gets the sweep to look at whether the row moved: the
      // condition is re-detected next sweep either way, and a failed attempt must count
      // against MAX_REPAIR_ATTEMPTS or the loop protection is fiction.
      await recordRepair(
        ctx.supabase,
        incident,
        entry,
        entry.outcome === 'applied'
          ? { status: 'repaired', incrementAttempts: true }
          : { status: 'open', incrementAttempts: true },
      );
      repaired.push({ ...entry, fingerprint: incident.fingerprint, class: incident.class });
    } catch (error) {
      console.error(`[ops-watchdog] could not record repair for ${incident.fingerprint}:`, error);
      repaired.push({ ...entry, fingerprint: incident.fingerprint, class: incident.class });
    }
  }

  // ── 4. resolve what stopped happening
  let autoResolved = 0;
  try {
    autoResolved = await resolveStale(ctx.supabase, seen, now);
  } catch (error) {
    console.error('[ops-watchdog] could not resolve stale incidents:', error);
  }

  // ── 5. notify, once per incident per cooldown
  let notified = 0;
  if (options.notify !== false) {
    try {
      notified = await notifyOwner(ctx.supabase, now);
    } catch (error) {
      console.error('[ops-watchdog] could not notify the owner:', error);
    }
  }

  const finishedAt = new Date().toISOString();
  return {
    startedAt,
    finishedAt,
    durationMs: Date.now() - startedMs,
    detected,
    detectorErrors,
    created: observed.created.length,
    recurring: observed.recurring.length,
    repaired,
    awaitingApproval,
    autoResolved,
    notified,
    suppressed,
  };
}

/**
 * Tell the owner, once, about everything that needs a human.
 *
 * One message per sweep rather than one per incident: five separate WhatsApp messages about
 * five stuck runs is how an alerting system gets muted. The message leads with the worst thing
 * and is capped, because a message nobody finishes is a message nobody acts on.
 *
 * Delivery is dynamically imported. `utils/notification-helper.ts` pulls in `google-auth-library`
 * and `node:fs`, and a watchdog must not fail to run because the notifier would not load — the
 * sweep has already done its work by this point, and the incidents are safely on the board
 * whether or not the phone buzzes.
 */
async function notifyOwner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  now: Date,
): Promise<number> {
  const cooldownCutoff = new Date(now.getTime() - NOTIFY_COOLDOWN_HOURS * 3_600_000).toISOString();

  const { data, error } = await supabase
    .from('ops_incidents')
    .select('id, severity, status, title, evidence, notified_at, fingerprint')
    .in('status', ['open', 'needs_approval'])
    .in('severity', ['critical', 'warning'])
    .order('severity', { ascending: true })
    .limit(50);
  if (error) throw new Error(`could not read incidents for notification: ${String(error.message || error)}`);

  const candidates = ((data ?? []) as Record<string, unknown>[]).filter((row) => {
    const notifiedAt = row.notified_at as string | null;
    if (!notifiedAt) return true;
    const since = Date.parse(notifiedAt);
    return !Number.isFinite(since) || notifiedAt < cooldownCutoff;
  });

  // Only things a human must act on are worth a buzz: a critical, or something explicitly
  // parked behind approval. Warnings that we are merely watching stay on the board.
  const worthTelling = candidates.filter(
    (row) => row.severity === 'critical' || row.status === 'needs_approval',
  );
  if (!worthTelling.length) return 0;

  const ownerUserId = await resolveOwnerUserId(supabase);
  if (!ownerUserId) {
    console.warn('[ops-watchdog] no owner to notify; incidents are on the board only.');
    return 0;
  }

  const top = worthTelling.slice(0, NOTIFY_TOP_N);
  const lines = top.map((row, index) => {
    const number = index + 1;
    const needsApproval = row.status === 'needs_approval' ? ' (needs your approval)' : '';
    return `${number}. [${String(row.severity).toUpperCase()}] ${row.title}${needsApproval}\n   ${row.evidence}`;
  });
  const remainder = worthTelling.length - top.length;

  const body =
    `What I found in the last sweep:\n\n${lines.join('\n\n')}` +
    (remainder > 0 ? `\n\n…and ${remainder} more on the board.` : '');

  try {
    const { sendAdminMultiChannelNotification } = await import('@/utils/notification-helper');
    await sendAdminMultiChannelNotification({
      ownerUserId,
      title:
        worthTelling.length === 1
          ? `Watchdog: ${top[0].title}`
          : `Watchdog: ${worthTelling.length} things need you`,
      body,
      url: '/dashboard/ops',
      type: 'ops_incident',
      emailSubject: `Nobogent watchdog — ${worthTelling.length} item(s) need attention`,
      skipWhatsApp: false,
      skipPush: false,
    });
  } catch (error) {
    // Not notified is not the same as not recorded: the board is already correct.
    console.error('[ops-watchdog] notification delivery failed:', error);
    return 0;
  }

  await markNotified(
    supabase,
    worthTelling.map((row) => String(row.id)),
    now,
  );
  return worthTelling.length;
}

/**
 * The owner is whoever the incident board belongs to.
 *
 * `OPS_OWNER_USER_ID` wins when set, because a launch week wants the alerts going to one named
 * phone rather than to whichever super_admin row the query happens to return first.
 */
async function resolveOwnerUserId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<string | null> {
  const configured = (process.env.OPS_OWNER_USER_ID || '').replace(/^["']|["']$/g, '').trim();
  if (configured) return configured;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, created_at')
    .eq('role', 'super_admin')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) {
    console.error('[ops-watchdog] could not resolve an owner profile:', error);
    return null;
  }
  const row = ((data ?? []) as { id?: string }[])[0];
  return row?.id ?? null;
}
