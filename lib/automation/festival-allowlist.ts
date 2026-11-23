/**
 * Who is allowed to receive an automatic festival creative.
 *
 * WHY AN ALLOWLIST AND NOT "EVERYONE WITH AUTOMATION ON"
 * A festival greeting is a paid image generation plus a WhatsApp send, and every tenant
 * has `daily_creative` switched on, so a plain "is automation enabled" test would bill all
 * 106 accounts the first time this cron runs. The owner's instruction was to start with
 * named active accounts. That list lives here, in code, so it is reviewable and diffable —
 * a silent env change on Vercel should not be the only record of who gets billed.
 *
 * TWO WAYS IN, ON PURPOSE
 *   - `userId` is the stable key: a renamed business still matches.
 *   - `businessName` is the human key: an account recreated from scratch, or a fresh
 *     client added by name, still matches. Matching is case- and punctuation-insensitive
 *     and containment-based, so "HOMCOM REALTORS" matches "homcom".
 *
 * OVERRIDE
 * `FESTIVAL_AUTOMATION_TENANTS` replaces the list with a comma-separated mix of user ids
 * and business-name fragments. `FESTIVAL_AUTOMATION_ALL=true` means every tenant with
 * automation on, which is the switch you throw once the pilot is trusted.
 */

export interface FestivalTenant {
  /** profiles.id — stable across renames. */
  userId: string;
  /** What the owner calls this client. Used in logs and in the allowlist response. */
  label: string;
  /** A fragment of profiles.business_name, used when the id is not the one that matches. */
  businessName: string;
}

/**
 * The pilot list: the active accounts the owner named, resolved against the live database.
 *
 * Keep the `label` as the owner writes it and the `businessName` as the database has it.
 * When a client is added here, they start receiving festival greetings on the next
 * festival day — nothing else needs changing.
 */
export const DEFAULT_FESTIVAL_TENANTS: FestivalTenant[] = [
  { userId: '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2', label: 'Homcom Realtors', businessName: 'HOMCOM REALTORS' },
  { userId: '68b55a31-a16d-454d-a20f-11adabf590b0', label: 'Bioque Estates', businessName: 'Bioque Estates' },
  { userId: '29937131-1975-4c5f-9b78-e5b28f918d32', label: 'Pro Estate', businessName: 'ProEstate' },
  { userId: '9c0748de-e3da-4ea1-b323-4ce736b5ca7c', label: 'Pro Color', businessName: 'Procolor' },
  { userId: '42d2e0c5-4fe6-4738-8a9f-63f09be01f12', label: 'GNR Homes', businessName: 'GNR HOMES' },
  // "Blue Square Infra" is the onboarded account; two older "BlueSquare Infra" rows exist
  // and were never onboarded, so the id matters here more than the name.
  { userId: '2f62a259-f23b-48ee-a920-c436f36eaa4b', label: 'Bluesquareinfra', businessName: 'Blue Square Infra' },
  { userId: 'd838c956-1761-4bce-9d91-32f3abecc222', label: 'Khushi Ram Realtors', businessName: 'Khushi Ram Realtors' },
  { userId: 'c3893924-5a57-4da3-b4bc-7c70d8ee7c59', label: 'Red Rose City', businessName: 'Red Rose City' },
  { userId: 'b685d287-7d54-4c9c-ae03-a46bb96ebdde', label: 'Umang Associates', businessName: 'Umang Associates' },
  { userId: 'f0ae1d0b-57e1-42fd-9438-7f9aa2cc5b8f', label: 'Raj Abhijna (Amritha Vana)', businessName: 'RAJ ABHIJNA' },
];

/** Lowercase, strip anything that is not a letter or digit, collapse spaces. */
export function normaliseName(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse `FESTIVAL_AUTOMATION_TENANTS`.
 *
 * Accepts a comma-separated mix of user ids and business-name fragments. A fragment
 * shorter than four characters is ignored, because "raj" would silently match half the
 * database.
 */
export function parseFestivalAllowlist(raw?: string | null): FestivalTenant[] {
  const text = String(raw ?? '').trim();
  if (!text) return [...DEFAULT_FESTIVAL_TENANTS];

  const entries: FestivalTenant[] = [];
  for (const piece of text.split(',')) {
    const item = piece.trim();
    if (!item) continue;
    if (UUID.test(item)) {
      entries.push({ userId: item.toLowerCase(), label: item, businessName: '' });
      continue;
    }
    const fragment = normaliseName(item);
    if (fragment.length < 4) continue;
    entries.push({ userId: '', label: item, businessName: fragment });
  }
  return entries.length ? entries : [...DEFAULT_FESTIVAL_TENANTS];
}

export interface FestivalEligibility {
  enabled: boolean;
  /** A reason a human can read, for the cron's response and the logs. */
  reason: string;
  /** The allowlist entry that matched, when one did. */
  matched?: FestivalTenant;
}

/**
 * Should this tenant get an automatic festival creative?
 *
 * Pure: pass the allowlist in. The cron resolves the allowlist once from env, then asks
 * this per tenant.
 */
export function isFestivalAutomationEnabled(
  tenant: { userId?: string | null; businessName?: string | null },
  allowlist: FestivalTenant[] = DEFAULT_FESTIVAL_TENANTS,
  opts: { all?: boolean } = {},
): FestivalEligibility {
  if (opts.all) return { enabled: true, reason: 'all_tenants_enabled' };

  const userId = String(tenant.userId || '').toLowerCase();
  const name = normaliseName(tenant.businessName);

  for (const entry of allowlist) {
    if (entry.userId && userId && entry.userId.toLowerCase() === userId) {
      return { enabled: true, reason: 'listed_by_id', matched: entry };
    }
  }
  for (const entry of allowlist) {
    const fragment = normaliseName(entry.businessName);
    if (fragment.length < 4 || !name) continue;
    if (name.includes(fragment) || fragment.includes(name)) {
      return { enabled: true, reason: 'listed_by_name', matched: entry };
    }
  }

  return { enabled: false, reason: 'not_in_festival_allowlist' };
}

/** Read the operator switches out of the environment, once per cron run. */
export function festivalAutomationConfig(env: Record<string, string | undefined> = process.env): {
  all: boolean;
  allowlist: FestivalTenant[];
  source: 'env_allowlist' | 'env_all' | 'default';
} {
  const all = String(env.FESTIVAL_AUTOMATION_ALL ?? '').trim().toLowerCase();
  if (all === 'true' || all === '1' || all === 'yes') {
    return { all: true, allowlist: [...DEFAULT_FESTIVAL_TENANTS], source: 'env_all' };
  }
  const raw = String(env.FESTIVAL_AUTOMATION_TENANTS ?? '').trim();
  if (raw) {
    return { all: false, allowlist: parseFestivalAllowlist(raw), source: 'env_allowlist' };
  }
  return { all: false, allowlist: [...DEFAULT_FESTIVAL_TENANTS], source: 'default' };
}
