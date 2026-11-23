/**
 * Ask Meta whether it would accept the object BEFORE we create it.
 *
 * WHY THIS EXISTS
 * The launcher's first real Graph call created the campaign. So every rejection
 * Meta had — a budget under its floor, an objective it no longer serves, a targeting
 * combination it will not publish — arrived after a campaign shell already existed
 * and after the customer's launch credit had been spent. `execution_options:
 * ["validate_only"]` is Meta's own answer to this: it runs the full validation and
 * creates nothing, spends nothing.
 *
 * Two rejections this catches, both confirmed live on Blue Square Infra's account:
 *   - `daily_budget: 500` (₹5/day) → subcode 2446375 "Budget is too small"
 *   - `objective: OUTCOME_TELEPORT`    → "Objective is invalid"
 *
 * Everything here is intentionally dumb: build the payload, ask, return the answer.
 */

import { META_GRAPH_URL } from './graph-version';

export interface GraphError {
  code?: number;
  subcode?: number;
  title?: string;
  message: string;
  /** Meta's own field pointer, when it gives one. */
  blameField?: string;
}

export interface PreflightResult {
  ok: boolean;
  error?: GraphError;
  /** The exact params that were validated, so a failure can be logged verbatim. */
  sent: Record<string, unknown>;
}

const ACCESS_TOKEN = 'access_token';
const EXECUTION_OPTIONS = 'execution_options';

/**
 * POST `/{edge}` with `validate_only` and report what Meta says.
 *
 * `edge` is e.g. `act_123/campaigns` or `act_123/adsets`. The access token is moved
 * out of the body into the form encoding so it never lands in a log line.
 */
export async function validateOnly(
  edge: string,
  params: Record<string, any>,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<PreflightResult> {
  const body = new URLSearchParams();
  const sent: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === ACCESS_TOKEN || value === undefined) continue;
    const encoded = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
    body.set(key, encoded);
    sent[key] = typeof value === 'object' && value !== null ? value : encoded;
  }
  body.set(EXECUTION_OPTIONS, JSON.stringify(['validate_only']));
  body.set(ACCESS_TOKEN, accessToken);

  try {
    const res = await fetchImpl(`${META_GRAPH_URL}/${edge.replace(/^\/+/, '')}`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      cache: 'no-store',
    });
    const json: any = await res.json().catch(() => ({}));
    const err = json?.error;
    if (!res.ok || err) {
      return {
        ok: false,
        sent,
        error: {
          code: err?.code,
          subcode: err?.error_subcode,
          title: err?.error_user_title || undefined,
          message:
            err?.error_user_msg ||
            err?.message ||
            `Meta refused the request (HTTP ${res.status})`,
          blameField: err?.error_data?.blame_field_specs?.[0]?.[0] || undefined,
        },
      };
    }
    return { ok: true, sent };
  } catch (networkErr: any) {
    // A network failure is NOT a validation failure: the real call may still work,
    // so the caller decides. Returning ok:false with the reason keeps it honest.
    return {
      ok: false,
      sent,
      error: { message: `Could not reach Meta to validate: ${networkErr?.message || 'network error'}` },
    };
  }
}

/** Validate a campaign payload against the ad account. */
export function validateCampaign(
  adAccountId: string,
  campaignPayload: Record<string, any>,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<PreflightResult> {
  return validateOnly(`${adAccountId}/campaigns`, campaignPayload, accessToken, fetchImpl);
}

/** Validate an ad-set payload (needs a real `campaign_id` to point at). */
export function validateAdSet(
  adAccountId: string,
  adSetPayload: Record<string, any>,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<PreflightResult> {
  return validateOnly(`${adAccountId}/adsets`, adSetPayload, accessToken, fetchImpl);
}

/** One line a human can act on, e.g. for the launch-failure notification. */
export function describePreflightFailure(result: PreflightResult, what: string): string {
  const err = result.error;
  if (!err) return `${what} was refused by Meta.`;
  const bits = [err.title, err.message].filter(Boolean).join(': ');
  const code = err.subcode ? ` (code ${err.code ?? '?'}/${err.subcode})` : err.code ? ` (code ${err.code})` : '';
  return `Meta would not accept this ${what}: ${bits}${code}`;
}
