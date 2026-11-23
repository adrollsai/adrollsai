/**
 * Where the auth flows are allowed to send someone.
 *
 * WHY THIS IS ITS OWN MODULE
 * The login page asked Supabase to send password-reset emails pointing at
 * `/auth/callback?next=/update-password`. No such page has ever existed. The consequence was the worst
 * shape a bug can take: the email arrived, the link was clicked, the token was VERIFIED and spent, and
 * only then did the app redirect to a 404 — so the user could not even retry with the same link, and
 * the app looked broken rather than the route.
 *
 * Two rules now live here, in one place, so they can be tested without a browser and cannot drift:
 *   1. a `next` target must be an internal path (no scheme, no `//`, no backslash);
 *   2. anything that smells of password recovery lands on the ONE page that can actually set a
 *      password — which also rehabilitates the links already sitting in people's inboxes.
 *
 * `scripts/verify-auth-links.ts` asserts this file, and separately asserts that every literal
 * destination the auth code uses resolves to a page or route that exists on disk.
 */

/** The only page in this app that can set a new password. */
export const RECOVERY_PATH = '/auth/reset-password';

/** Where an auth flow goes when it has no usable destination of its own. */
export const DEFAULT_NEXT = '/dashboard/profile';

/**
 * Is this `next` an internal path we are willing to redirect to?
 *
 * `next` is concatenated onto our own origin, so an absolute URL, a protocol-relative `//evil.com`
 * or a backslash trick must not survive the trip.
 */
export function safeNext(raw: string | null | undefined): string {
  const value = String(raw ?? '').trim();
  if (!value.startsWith('/')) return DEFAULT_NEXT;
  if (value.startsWith('//') || value.startsWith('/\\')) return DEFAULT_NEXT;
  if (/[:\\]/.test(value)) return DEFAULT_NEXT;
  return value;
}

/**
 * Does this request mean "I am recovering a password"?
 *
 * `type=recovery` is the honest signal. The path is the fallback, and it deliberately accepts the
 * dead `update-password` names: emails already sent carry them, and those links should work rather
 * than 404.
 */
export function isRecoveryTarget(next: string | null | undefined, type: string | null | undefined): boolean {
  if (String(type ?? '') === 'recovery') return true;
  const value = String(next ?? '');
  if (value === RECOVERY_PATH) return true;
  return /(^|\/)(update-password|reset-password|resetPassword)(\/|$|\?)/i.test(value);
}

/** The destination a verified auth callback should use, given what it was asked for. */
export function resolveRedirectTarget(raw: string | null | undefined, type: string | null | undefined): string {
  const requested = safeNext(raw);
  return isRecoveryTarget(requested, type) ? RECOVERY_PATH : requested;
}
