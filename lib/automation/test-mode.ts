/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows and provider payloads are untyped (stale generated types), matching utils/credits.ts. */
/**
 * Outbound test mode.
 *
 * While we are still proving the workflow we must not message real leads or real
 * owners. When OUTBOUND_TEST_MODE is on, every recipient address is swapped for
 * OUTBOUND_TEST_NUMBER / OUTBOUND_TEST_EMAIL, so the full pipeline (generation,
 * template, email, notifications) runs unchanged and every artefact lands on the
 * founder's own phone instead of a customer's.
 *
 * Deliberately a single choke point: any new channel must call outboundRecipient()
 * or it will bypass test mode — that is the one reviewable rule.
 */

export function isOutboundTestMode(): boolean {
  return String(process.env.OUTBOUND_TEST_MODE || '').toLowerCase() === 'true'
}

/** Phone numbers: returns the test number in test mode, else the real one. */
export function outboundRecipient(realPhone?: string | null): string {
  const real = String(realPhone || '')
  if (!isOutboundTestMode()) return real

  const test = String(process.env.OUTBOUND_TEST_NUMBER || '').replace(/\D/g, '')
  if (!test) {
    // Fail loud rather than silently sending to the customer.
    console.error('[TEST MODE] OUTBOUND_TEST_MODE is on but OUTBOUND_TEST_NUMBER is unset — refusing to send.')
    return ''
  }
  // Preserve the 91 country prefix convention used across the codebase.
  return test.length === 10 ? `91${test}` : test
}

/** Email: returns the test inbox in test mode, else the real one. */
export function outboundEmail(realEmail?: string | null): string {
  const real = String(realEmail || '')
  if (!isOutboundTestMode()) return real
  return String(process.env.OUTBOUND_TEST_EMAIL || '').trim() || real
}

/** Marks payloads so a received artefact is obviously a test. */
export function testBanner(): string {
  return isOutboundTestMode() ? '\n\n— TEST MODE: this was sent to the founder, not a customer.' : ''
}
