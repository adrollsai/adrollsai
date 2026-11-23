/**
 * One click must not create two campaigns.
 *
 * WHY THIS EXISTS
 * The launch button posted a job and returned. Nothing checked whether the same
 * campaign had just been requested — a double click, a browser retry, or a user who
 * pressed Launch again because the first response took four seconds all produced a
 * second campaign, a second ad set, a second set of ads, and a second draw on the
 * client's launch credits. On a ₹500/day budget that is real money spent twice.
 *
 * The fingerprint is built only from the things that make two launches "the same
 * campaign": who it is for, what it is called, the budget, the goal, the creative and
 * the places it targets. Anything the client changed — a different budget, one more
 * creative, another city — is deliberately a different campaign.
 */

import { createHash } from 'node:crypto';

export interface LaunchFingerprintInput {
  targetUserId?: string | null;
  campaignName?: string | null;
  campaignType?: string | null;
  campaignGoal?: string | null;
  conversionEvent?: string | null;
  dailyBudget?: number | string | null;
  pageId?: string | null;
  adAccountId?: string | null;
  /** Creative identifiers in a stable order: asset ids, inventory ids or URLs. */
  creativeKeys?: string[] | null;
  /** Whatever location payload the modal produced. */
  locations?: unknown;
  /** Pixel or lead-form destination, when present. */
  pixelId?: string | null;
}

/**
 * Normalise the pieces so cosmetic differences do not defeat the check.
 *
 * `creativeKeys` is sorted: the same three creatives picked in a different order are
 * the same launch. Locations are compared as a sorted list of their string form, which
 * survives the JSON shape changing between modal versions.
 */
function stableLocations(locations: unknown): string {
  if (!locations) return '';
  let parsed: unknown = locations;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return String(parsed).trim().toLowerCase();
    }
  }
  try {
    return JSON.stringify(parsed, Object.keys(parsed as object).sort()).toLowerCase();
  } catch {
    return String(locations).toLowerCase();
  }
}

export function launchFingerprint(input: LaunchFingerprintInput): string {
  const parts = [
    String(input.targetUserId || ''),
    String(input.campaignName || '').trim().toLowerCase(),
    String(input.campaignType || '').toLowerCase(),
    String(input.campaignGoal || '').toLowerCase(),
    String(input.conversionEvent || '').toUpperCase(),
    // Budget in minor units so 500 and "500.00" agree.
    String(Math.round(Number(input.dailyBudget || 0) * 100)),
    String(input.pageId || ''),
    String(input.adAccountId || ''),
    String(input.pixelId || ''),
    [...(input.creativeKeys || [])].map((k) => String(k)).sort().join(','),
    stableLocations(input.locations),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/** A launch considered "the same" inside this window is treated as a duplicate. */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export interface PreviousLaunch {
  jobId: string;
  fingerprint: string;
  createdAt: string;
  status?: string | null;
}

/**
 * Was this exact campaign launched a moment ago?
 *
 * A failed job does not block a retry: the client pressing Launch again after an
 * error is the normal repair path, and refusing it would leave them stuck.
 */
export function findDuplicateLaunch(
  fingerprint: string,
  previous: PreviousLaunch[],
  now: number = Date.now(),
  windowMs: number = DUPLICATE_WINDOW_MS
): PreviousLaunch | null {
  for (const job of previous) {
    if (job.fingerprint !== fingerprint) continue;
    const created = Date.parse(job.createdAt);
    if (!Number.isFinite(created)) continue;
    if (now - created > windowMs) continue;
    if (String(job.status || '').toLowerCase() === 'failed') continue;
    return job;
  }
  return null;
}

/** The sentence the client sees instead of a second campaign. */
export function duplicateLaunchMessage(jobId: string): string {
  return (
    `This exact campaign was launched a few minutes ago (job ${jobId.slice(0, 8)}), so it was not ` +
    `created twice. Open Ads to watch it, or change the budget, creative or locations to launch a ` +
    `separate campaign.`
  );
}

// ---------------------------------------------------------------------------
// Retargeting launches
// ---------------------------------------------------------------------------

/**
 * The retargeting launcher is a different animal: it creates everything inline (no
 * `campaign_jobs` row to point at) and its campaign name carries a random suffix, so a
 * fingerprint of the name can never match itself.
 *
 * Instead the check is made against the ad account: the same business, the same
 * "Retargeting" prefix, the same daily budget, inside the same window. That is the
 * state that actually costs money — a second retargeting campaign on the same audience.
 */
export interface RetargetingCampaignRow {
  id: string;
  name?: string;
  created_time?: string;
  daily_budget?: string | number;
}

export function findDuplicateRetargetingCampaign(
  rows: RetargetingCampaignRow[],
  input: { namePrefix: string; dailyBudgetMinor: number; now?: number; windowMs?: number }
): RetargetingCampaignRow | null {
  const now = input.now ?? Date.now();
  const windowMs = input.windowMs ?? DUPLICATE_WINDOW_MS;
  const prefix = input.namePrefix.trim().toLowerCase();
  if (!prefix) return null;

  for (const row of rows) {
    const name = String(row.name || '').trim().toLowerCase();
    if (!name.startsWith(prefix)) continue;
    const created = Date.parse(String(row.created_time || ''));
    if (!Number.isFinite(created)) continue;
    if (now - created > windowMs) continue;
    const budget = Number(row.daily_budget);
    if (Number.isFinite(budget) && budget !== input.dailyBudgetMinor) continue;
    return row;
  }
  return null;
}

/** The sentence the client sees when a retargeting campaign was just created. */
export function duplicateRetargetingMessage(campaignId: string): string {
  return (
    `A retargeting campaign for this audience was created a few minutes ago (${campaignId}), so it ` +
    `was not created twice. Open Ads to watch it, or change the budget or audience to launch a ` +
    `separate campaign.`
  );
}
