/**
 * Who is allowed to use the product without paying, and who is not.
 *
 * WHY THIS FILE EXISTS
 * The paywall used to be decided in more than one place, from more than one list, and one of those places
 * (`app/dashboard/layout.tsx`) only redirected when the role happened to be one of the "admin-like" ones.
 * A brand-new signup has no role at all, so the redirect never fired and the dashboard opened for free.
 *
 * The rules below are the *only* rules. They are deliberately pure functions on plain data: no Supabase
 * client, no React, no side effects. That means the same decision can be made by the client layout and by
 * the edge middleware, and it can be tested without either of them.
 *
 * The default is deny. If a field is missing, the answer is "must pay".
 */

/**
 * Accounts the platform runs itself. These never see a paywall.
 *
 * This list was copied in three different files with three different contents before this module existed
 * (`app/dashboard/layout.tsx`, `utils/subscription.ts`, `utils/credits.ts`), which meant the same person
 * could be treated as paid by one code path and unpaid by another. There is one list now.
 */
export const WHITELISTED_EMAILS = [
  'rchopra489@gmail.com',
  'infobluesquareinfra@gmail.com',
  'khushiramrealtor@gmail.com',
  'rajivkumaraggarwal81@gmail.com',
  'gnrhomes97@gmail.com',
  'alpinenesthomes01@gmail.com',
  'meta-reviewer@nobogent.com',
  'pawan@pipixel.io',
] as const;

/** Statuses that mean the subscription is currently paid for. Anything else is not paid. */
const PAID_STATUSES = ['active', 'trialing', 'pro', 'enterprise'] as const;

export interface EntitlementProfile {
  email?: string | null;
  role?: string | null;
  parent_id?: string | null;
  agency_id?: string | null;
  subscription_status?: string | null;
  subscription_valid_until?: string | null;
}

/** The minimum a parent/agency row must expose to decide whether it pays for its team. */
export interface EntitlementParent {
  email?: string | null;
  subscription_status?: string | null;
  subscription_valid_until?: string | null;
}

export function normaliseEmail(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

export function isWhitelistedEmail(email?: string | null): boolean {
  const wanted = normaliseEmail(email);
  if (!wanted) return false;
  return (WHITELISTED_EMAILS as readonly string[]).includes(wanted);
}

/** A status that is paid, after the chronological expiry rule has been applied. */
export function isPaidStatus(status?: string | null): boolean {
  return (PAID_STATUSES as readonly string[]).includes((status ?? '').trim().toLowerCase());
}

/**
 * Has the paid-for period ended?
 *
 * A row can still say "active" long after the money ran out, so the date is the authority. An unparseable
 * or missing date is NOT treated as expired: that would expire every customer whose row was written
 * without one.
 */
export function isChronologicallyExpired(validUntil?: string | null, now: Date = new Date()): boolean {
  if (!validUntil) return false;
  const when = new Date(validUntil);
  if (Number.isNaN(when.getTime())) return false;
  return when < now;
}

/**
 * The effective status for entitlement purposes: an expired date downgrades to "expired" unless the account
 * is whitelisted (the platform's own accounts do not get locked out by a date).
 */
export function effectiveStatus(
  profile: EntitlementProfile | null | undefined,
  now: Date = new Date(),
): string {
  const status = (profile?.subscription_status ?? '').trim().toLowerCase();
  if (status === 'expired') return 'expired';
  if (isChronologicallyExpired(profile?.subscription_valid_until, now) && !isWhitelistedEmail(profile?.email)) {
    return 'expired';
  }
  return status;
}

export type PaywallDecisionReason =
  | 'whitelisted'
  | 'paid'
  | 'team-member'
  | 'unpaid'
  | 'no-profile';

export interface PaywallDecision {
  /** True when this account must be shown the paywall before it can use the product. */
  mustPay: boolean;
  reason: PaywallDecisionReason;
  /** True when the person running the account is a team member whose agency pays. */
  isTeamMember: boolean;
  isWhitelisted: boolean;
  status: string;
}

/**
 * The decision.
 *
 * Exemptions are narrow and explicit, and there is deliberately **no role test anywhere in this function**.
 * The original bug was a role test: `['super_admin', ...].includes(profile.role)` is false when the role is
 * null, and null is exactly what a fresh signup has, so the check that was meant to gate access instead
 * waved the newest, least-entitled account straight through.
 *
 * `parent` is the agency/owner row for a team member. Pass it when you have it; a team member with no
 * readable parent is treated as unpaid rather than trusted.
 */
export function decidePaywall(
  profile: EntitlementProfile | null | undefined,
  parent?: EntitlementParent | null,
  now: Date = new Date(),
): PaywallDecision {
  if (!profile) {
    // No profile row yet. A money gate may never be decided from data it failed to read.
    return { mustPay: true, reason: 'no-profile', isTeamMember: false, isWhitelisted: false, status: '' };
  }

  const whitelisted = isWhitelistedEmail(profile.email) || isWhitelistedEmail(parent?.email);
  const isTeamMember = Boolean(profile.parent_id || profile.agency_id);

  if (whitelisted) {
    return {
      mustPay: false,
      reason: 'whitelisted',
      isTeamMember,
      isWhitelisted: true,
      status: effectiveStatus(profile, now),
    };
  }

  // A team member's entitlement belongs to the agency that pays for them, so the agency row is preferred when
  // we have it. NOTE: a member is exempt on membership alone, which matches the gate that is live today.
  // That is a known soft spot (setting someone's parent_id is enough to admit them), but tightening it now
  // would newly paywall 39 existing profiles - several of them real customers whose agency row simply has an
  // "inactive" or missing status - so it is reported rather than changed in the same fix.
  const statusSource =
    isTeamMember && parent
      ? {
          email: parent.email,
          subscription_status: parent.subscription_status,
          subscription_valid_until: parent.subscription_valid_until,
        }
      : profile;

  const status = effectiveStatus(statusSource, now);

  if (isPaidStatus(status)) {
    return {
      mustPay: false,
      reason: isTeamMember ? 'team-member' : 'paid',
      isTeamMember,
      isWhitelisted: false,
      status,
    };
  }

  if (isTeamMember) {
    return { mustPay: false, reason: 'team-member', isTeamMember, isWhitelisted: false, status };
  }

  return { mustPay: true, reason: 'unpaid', isTeamMember, isWhitelisted: false, status };
}

/**
 * Routes that an unpaid account is still allowed to reach. Everything else in the product is behind payment.
 *
 * Onboarding is on this list because that is where the paywall itself lives: step one of onboarding is
 * choosing and buying a plan, so an unpaid user sent there is looking at the paywall, not past it.
 */
export const PAYWALL_EXEMPT_PREFIXES = [
  '/dashboard/onboarding',
  '/dashboard/billing',
  '/dashboard/profile',
] as const;

export function isPaywallExemptPath(pathname: string): boolean {
  return PAYWALL_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
