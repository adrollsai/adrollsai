/* eslint-disable @typescript-eslint/no-explicit-any --
 * The generated supabase/database.types.ts is stale (it is missing tables and
 * columns this code legitimately uses), so typing these Supabase calls against
 * it would produce false errors. `any` is the same choice utils/credits.ts and
 * utils/voice-helper.ts make for the same reason.
 *//**
 * Credit gating for automated (unattended) generation.
 *
 * WHY NOT `hasEnoughCredits()` FROM utils/credits.ts
 * That helper answers a different question: "may this user make a request right
 * now?" It returns false unless `subscription_status` is one of
 * active/trialing/pro/growth/enterprise, OR the account appears in a hardcoded
 * 8-email whitelist. In production only 17 of 92 owners have an active status
 * (39 inactive, 29 null, 7 suspended), so gating unattended generation on it
 * would silently stop the daily creative for almost every tenant — turning a
 * metering concern into a feature outage.
 *
 * Automation needs the narrower question: "is there balance to pay for this?"
 * That is what this module answers.
 *
 * SAFETY RULE: every failure path returns `true`. An accounting read must never
 * be the reason a customer's marketing silently stops. If we cannot read the
 * balance, we deliver and log.
 */

/** Resolve who actually pays: team members spend the owner's balance. */
export async function resolveBillingOwner(supabaseAdmin: any, userId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id, parent_id, agency_id')
      .eq('id', userId)
      .maybeSingle()

    if (!data) return userId
    return data.parent_id || data.agency_id || data.id || userId
  } catch {
    return userId
  }
}

export async function creditBalance(supabaseAdmin: any, userId: string): Promise<number | null> {
  try {
    const ownerId = await resolveBillingOwner(supabaseAdmin, userId)
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('credits')
      .eq('id', ownerId)
      .maybeSingle()
    if (!data) return null
    return Number(data.credits ?? 0)
  } catch {
    return null
  }
}

/**
 * True when the tenant can pay for this run. Defaults to true whenever the
 * balance cannot be determined.
 */
export async function canAffordAutomation(
  supabaseAdmin: any,
  userId: string,
  amount: number
): Promise<{ ok: boolean; balance: number | null }> {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: true, balance: null }
  const balance = await creditBalance(supabaseAdmin, userId)
  if (balance === null) return { ok: true, balance: null }
  return { ok: balance >= amount, balance }
}
