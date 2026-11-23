/**
 * Is this tenant's Meta connection still usable?
 *
 * WHY THIS EXISTS
 * Five accounts on this platform currently cannot publish anything, and nobody was
 * told: four return *"Error validating access token: The session has been invalidated
 * because the user changed their password or Facebook has changed the session for
 * security reasons"* and one ad account is simply "not writable" (status ineligible).
 * The client only finds out by pressing Launch and reading a Meta error, which is the
 * worst possible channel for it — they waited for a campaign that was never going to
 * be created.
 *
 * The watchdog already walks every account every six hours, so it now probes the
 * connection first and tells the owner what to do about it. This module is pure: a
 * probe result in, a verdict and a message out.
 */

/** The probe result, as far as this module cares. */
export interface TokenProbe {
  ok: boolean;
  /** Meta error code, when it answered with one. */
  code?: number;
  subcode?: number;
  message?: string;
  /** `account_status` from the ad account read, when the read worked. */
  accountStatus?: number;
  currency?: string;
  /** HTTP status, when the failure was not a JSON error body. */
  httpStatus?: number;
}

export type ConnectionVerdict =
  | 'healthy'
  | 'token_invalid'
  | 'token_expired'
  | 'missing_permission'
  | 'account_ineligible'
  | 'account_unsettled'
  | 'unreachable';

export interface ConnectionHealth {
  verdict: ConnectionVerdict;
  /** True when the owner has to do something before a campaign can be created. */
  needsAction: boolean;
  /** Short headline. */
  title: string;
  /** What happened, in Meta's own terms, and what to do next. */
  body: string;
  /** Stable identity, so the same problem is not re-sent every six hours. */
  key: string;
}

/** Meta ad-account statuses that block creating or editing ads. */
const ACCOUNT_STATUS_LABEL: Record<number, string> = {
  1: 'active',
  2: 'disabled',
  3: 'unsettled',
  7: 'pending review',
  8: 'pending closure',
  9: 'in grace period',
  100: 'pending closure',
  101: 'closed',
};

const BLOCKING_ACCOUNT_STATUSES = [2, 3, 7, 8, 9, 100, 101];

export function accountStatusLabel(status: number | undefined): string {
  if (status === undefined) return 'unknown';
  return ACCOUNT_STATUS_LABEL[status] || `status ${status}`;
}

/**
 * Read Meta's answer and say what it means for the person who owns the account.
 *
 * Each branch names the concrete next step. "Something went wrong" is what the
 * launcher used to say after the fact; this is meant to be actionable before it.
 */
export function diagnoseConnection(probe: TokenProbe): ConnectionHealth {
  const message = String(probe.message || '').toLowerCase();

  if (probe.ok) {
    const status = probe.accountStatus;
    if (status !== undefined && BLOCKING_ACCOUNT_STATUSES.includes(status)) {
      const label = accountStatusLabel(status);
      return {
        verdict: status === 3 ? 'account_unsettled' : 'account_ineligible',
        needsAction: true,
        key: `account_status:${status}`,
        title: `⚠️ Meta ad account is ${label}`,
        body:
          `Meta reports your ad account as ${label}, so campaigns cannot be created or ` +
          `edited until that is resolved. Open Meta Business Support from Ads Manager → ` +
          `Account Quality to clear it, then launch again.`,
      };
    }
    return {
      verdict: 'healthy',
      needsAction: false,
      key: 'healthy',
      title: '',
      body: '',
    };
  }

  // Invalidated / expired session: the token died, usually because the password
  // changed, the app was removed, or Meta reset the session for security.
  if (message.includes('session has been invalidated') || probe.subcode === 460 || probe.code === 460) {
    return {
      verdict: 'token_invalid',
      needsAction: true,
      key: 'token_invalid',
      title: '⚠️ Meta connection expired — reconnect to launch ads',
      body:
        'Meta invalidated the saved Meta connection (usually after a password change, ' +
        'or because the app was removed from the Facebook account). Ad campaigns cannot ' +
        'be created until you reconnect: Dashboard → Settings → Connect Facebook again. ' +
        'Existing campaigns on Meta keep running; only new launches are blocked.',
    };
  }

  if (probe.code === 190 || message.includes('access token') || message.includes('session has expired')) {
    return {
      verdict: probe.subcode === 463 || message.includes('expired') ? 'token_expired' : 'token_invalid',
      needsAction: true,
      key: 'token_invalid',
      title: '⚠️ Meta connection expired — reconnect to launch ads',
      body:
        'The saved Meta access token is no longer valid, so new campaigns cannot be ' +
        'created. Reconnect the Facebook account from Dashboard → Settings, then launch again.',
    };
  }

  if (probe.code === 200 || message.includes('permission') || (probe.code !== undefined && probe.code >= 10 && probe.code <= 12)) {
    return {
      verdict: 'missing_permission',
      needsAction: true,
      key: 'missing_permission',
      title: '⚠️ Meta permissions missing for ads',
      body:
        'The connected Facebook user no longer has permission to manage this ad account ' +
        '(the ad account may have been moved, or the person was removed from the Business). ' +
        'Reconnect with a user who has ads access, or ask the Business admin to grant it.',
    };
  }

  if (message.includes('not writable') || message.includes('ineligible')) {
    return {
      verdict: 'account_ineligible',
      needsAction: true,
      key: 'account_ineligible',
      title: '⚠️ Meta ad account is not writable',
      body:
        'Meta has restricted this ad account, so campaigns cannot be created or edited. ' +
        'Resolve the account status in Meta (Ads Manager → Account Quality → Business Support), ' +
        'then launch again.',
    };
  }

  return {
    verdict: 'unreachable',
    needsAction: true,
    key: 'unreachable',
    title: '⚠️ Could not reach Meta for this account',
    body:
      `Meta did not answer the connection check${probe.httpStatus ? ` (HTTP ${probe.httpStatus})` : ''}. ` +
      'This is usually temporary; if it persists, reconnect the Facebook account from Dashboard → Settings.',
  };
}

/**
 * How long to stay quiet about the same connection problem.
 *
 * Twenty-four hours: a dead token will still be dead tomorrow, and a daily reminder is
 * enough to get it fixed without becoming noise.
 */
export const CONNECTION_ALERT_DEDUPE_HOURS = 24;

/** Notification category for these alerts (reuses the ads failure preference). */
export const CONNECTION_ALERT_TYPE = 'campaign_failure';
