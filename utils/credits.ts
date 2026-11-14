import { createClient } from '@supabase/supabase-js'

export const CREDIT_COSTS = {
  VOICE_CALL_MINUTE: 5,        // 5 credits per minute for connected calls (rounded up to nearest minute)
  VOICE_CALL_UNCONNECTED: 0.02, // 0.02 credits per unconnected attempt (busy, no answer, rejected)
  AI_VIDEO_15SEC_CHUNK: 50,   // 50 credits per 15-second video (e.g. 45s = 150 credits)
  AI_IMAGE_GENERATION: 10,    // 10 credits per image generated
  WHATSAPP_INBOUND: 0.2,       // Rs. 0.20 priced to customer (2x markup of Rs. 0.10 cost)
  WHATSAPP_OUTBOUND: 0.4,      // Rs. 0.40 priced to customer (2x markup of Rs. 0.20 cost)
  AI_COPY_GENERATION: 1.0,     // Rs. 1.00 priced to customer (2x markup of Rs. 0.50 cost)
  META_CAMPAIGN_LAUNCH: 10     // Rs. 10.00 priced to customer (2x markup of Rs. 5.00 cost)
};

/**
 * Resolves the primary admin user ID who holds the credit balance for a workspace.
 */
async function getPrimaryUserId(supabaseAdmin: any, userId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id, parent_id, agency_id, credits')
      .eq('id', userId)
      .single()
      
    if (data) {
      // If user has their own dedicated credit balance (e.g. client has dedicated credits), deduct from them directly
      if (typeof data.credits === 'number' && data.credits > 0) {
        return data.id
      }
      return data.parent_id || data.agency_id || data.id
    }
  } catch (e) {
    console.error('[CREDITS HELPER] getPrimaryUserId exception:', e)
  }
  return userId
}

/**
 * Postgres raises 42883 for a missing function; PostgREST uses PGRST202.
 * Kept local (not imported from lib/automation/billing.ts) so that module can
 * keep importing CREDIT_COSTS from here without a circular import.
 */
function isMissingFunction(error: any): boolean {
  if (!error) return false
  const code = String(error.code || '')
  return code === 'PGRST202' || code === '42883' || /could not find the function|schema cache/i.test(String(error.message || ''))
}

/**
 * Spendable credits: balance minus whatever open holds have reserved.
 *
 * Falls back to the raw balance when the RPC is not deployed, because "no holds
 * exist" and "we cannot read holds" are the same answer in practice.
 */
export async function availableCredits(supabaseAdmin: any, userId: string): Promise<number | null> {
  try {
    const primaryUserId = await getPrimaryUserId(supabaseAdmin, userId)
    const { data, error } = await supabaseAdmin.rpc('available_credits', { p_user_id: primaryUserId })
    if (error) {
      if (!isMissingFunction(error)) {
        console.warn('[CREDITS HELPER] available_credits failed:', error.message)
      }
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('credits')
        .eq('id', primaryUserId)
        .maybeSingle()
      return profile ? Number(profile.credits || 0) : null
    }
    if (data === null || data === undefined) return null
    return Number(data)
  } catch (e) {
    console.error('[CREDITS HELPER] availableCredits exception:', e)
    return null
  }
}

/**
 * Does this account have money at all — ignoring subscription state?
 *
 * The old predicate conflated two different questions and answered the funding
 * one with the subscription one, which blocked ~75 of 92 tenants who had a
 * positive balance but no active plan.
 */
export function hasBalance(credits: number | null | undefined, requiredAmount: number): boolean {
  return Number(credits || 0) >= requiredAmount
}

/** True when the 5,000-credit welcome grant funded this account. */
export function welcomeGrantActive(profile: any): boolean {
  return Boolean(profile?.client_features?.welcome_credits_granted)
}

/**
 * Checks if a profile has enough credits for a required amount.
 *
 * FUNDING IS THE QUESTION. It used to require an active `subscription_status` as
 * well, so an account holding 5,000 welcome credits was refused any paid tool
 * because onboarding had written `subscription_status = 'free'`. Two separate
 * facts were collapsed into one boolean:
 *
 *   subscription  — is a plan running?            (billing relationship)
 *   balance       — can this specific work be paid for? (funding)
 *
 * Only the second authorises work. A plan grants credits; the credits are what
 * pays. So: hasBalance && (subscriptionActive || welcomeGrantActive) — and in
 * practice, a positive balance is sufficient, since credits can only come from a
 * plan, a top-up, or the welcome grant.
 */
export async function hasEnoughCredits(
  supabaseAdmin: any,
  userId: string,
  requiredAmount: number
): Promise<boolean> {
  try {
    const primaryUserId = await getPrimaryUserId(supabaseAdmin, userId)
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('credits, business_name, role, subscription_status, email, client_features')
      .eq('id', primaryUserId)
      .single()

    if (error || !profile) return false

    // Unlimited bypass check (rchopra489, infobluesquare)
    const isUnlimited = ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com'].includes(profile.email || '')
    if (isUnlimited) return true

    const subscriptionStatus = profile.subscription_status?.toLowerCase() || ''
    const whitelistedClients = [
      'rchopra489@gmail.com',
      'infobluesquareinfra@gmail.com',
      'khushiramrealtor@gmail.com',
      'rajivkumaraggarwal81@gmail.com',
      'gnrhomes97@gmail.com',
      'alpinenesthomes01@gmail.com',
      'pawan@pipixel.io',
      'umangassociates5@gmail.com'
    ]
    const isClientWhitelisted = whitelistedClients.includes(profile.email || '')
    const isSubscriptionActive = ['active', 'trialing', 'pro', 'growth', 'enterprise'].includes(subscriptionStatus) || isClientWhitelisted

    // Funding, not billing: held credits do not count, because they are already
    // promised to a job that is running.
    const spendable = (await availableCredits(supabaseAdmin, primaryUserId)) ?? Number(profile.credits || 0)
    const funded = hasBalance(spendable, requiredAmount)

    if (!funded) {
      console.warn(
        `[CREDITS HELPER] Not funded. User ${primaryUserId} has ${spendable} spendable credits; needs ${requiredAmount}.`
      )
      return false
    }

    if (!isSubscriptionActive && !welcomeGrantActive(profile)) {
      // Logged, not blocked: the balance is real money and can only have arrived
      // as a grant, a top-up or a plan.
      console.warn(
        `[CREDITS HELPER] User ${primaryUserId} is funded (${spendable} credits) with subscription_status="${subscriptionStatus}". Allowing: funding authorises work.`
      )
    }

    return true
  } catch (e) {
    console.error('[CREDITS HELPER] hasEnoughCredits error:', e)
    return false
  }
}

/**
 * Deducts credits from a user's balance and records the transaction in the ledger.
 *
 * The balance move and the check are ONE statement now. The previous version read
 * `credits`, compared it, then wrote `credits - amount`; two concurrent 60-credit
 * jobs against a 100-credit wallet both passed the comparison and both wrote, so
 * the balance went to -20 and the ledger no longer described reality.
 */
export async function deductCredits(
  supabaseAdmin: any,
  userId: string,
  amount: number,
  category: 'calling' | 'whatsapp' | 'ai_generation' | 'campaign_launch' | 'topup' | 'subscription',
  description: string
): Promise<boolean> {
  if (amount <= 0) return false

  try {
    const primaryUserId = await getPrimaryUserId(supabaseAdmin, userId)

    const { data: profile, error: fetchErr } = await supabaseAdmin
      .from('profiles')
      .select('credits, business_name, role, email')
      .eq('id', primaryUserId)
      .single()

    if (fetchErr || !profile) {
      console.error('[CREDITS HELPER] Failed to fetch profile credits for deduction:', fetchErr)
      return false
    }

    const isUnlimited = ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com'].includes(profile.email || '')

    // 1. Atomic guarded decrement. NULL = the wallet could not cover it.
    let newCredits = await atomicSpend(supabaseAdmin, primaryUserId, amount)

    if (newCredits === null) {
      if (!isUnlimited) {
        console.warn(
          `[CREDITS HELPER] Overdraft prevented. User ${primaryUserId} cannot cover ${amount} credits.`
        )
        return false
      }
      // Unlimited accounts are allowed to go past zero: record the usage without
      // driving the balance negative.
      newCredits = Number(profile.credits || 0)
    }

    // 2. Ledger row. A missing ledger row is worth shouting about but must not
    //    undo a charge that already happened.
    const { error: insertErr } = await supabaseAdmin.from('credit_transactions').insert({
      user_id: primaryUserId,
      amount: -amount,
      category,
      description
    })
    if (insertErr) {
      console.error('[CREDITS HELPER] Failed to insert credit transaction:', insertErr)
    }

    console.log(
      `[CREDITS HELPER] Deducted ${amount} credits from user ${primaryUserId} for ${category}. New balance: ${newCredits}`
    )
    return true
  } catch (e) {
    console.error('[CREDITS HELPER] deductCredits Exception:', e)
    return false
  }
}

/** Atomic decrement via RPC, with a compare-and-swap fallback. NULL = refused. */
async function atomicSpend(supabaseAdmin: any, userId: string, amount: number): Promise<number | null> {
  const { data, error } = await supabaseAdmin.rpc('spend_credits', {
    p_user_id: userId,
    p_amount: amount
  })

  if (!error) return data === null || data === undefined ? null : Number(data)

  if (!isMissingFunction(error)) {
    console.warn('[CREDITS HELPER] spend_credits failed:', error.message)
    return null
  }

  // Fallback for a database without the RPC: optimistic concurrency on the exact
  // value we read, so a concurrent writer makes us retry instead of losing its
  // change.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .maybeSingle()
    if (!profile) return null

    const current = Number(profile.credits ?? 0)
    if (current < amount) return null

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({ credits: current - amount })
      .eq('id', userId)
      .eq('credits', profile.credits)
      .select('credits')

    if (!updateErr && Array.isArray(updated) && updated.length > 0) return current - amount
  }

  console.warn('[CREDITS HELPER] compare-and-swap spend gave up')
  return null
}

/**
 * Adds credits to a user's balance (used for top-ups, recharges, and subscriptions).
 *
 * Increment, not read-then-write: two payments landing together used to read the
 * same starting balance and one of them was lost.
 */
export async function addCredits(
  supabaseAdmin: any,
  userId: string,
  amount: number,
  category: 'calling' | 'whatsapp' | 'ai_generation' | 'campaign_launch' | 'topup' | 'subscription',
  description: string
): Promise<boolean> {
  if (amount <= 0) return false

  try {
    const primaryUserId = await getPrimaryUserId(supabaseAdmin, userId)

    const { data, error } = await supabaseAdmin.rpc('add_credits_atomic', {
      p_user_id: primaryUserId,
      p_amount: amount
    })

    let newCredits: number | null = error ? null : data === null || data === undefined ? null : Number(data)

    if (error) {
      if (!isMissingFunction(error)) {
        console.error('[CREDITS HELPER] add_credits_atomic failed:', error.message)
        return false
      }
      // No RPC: fall back to a read-then-write, which is what this used to do.
      const { data: profile, error: fetchErr } = await supabaseAdmin
        .from('profiles')
        .select('credits')
        .eq('id', primaryUserId)
        .single()
      if (fetchErr || !profile) {
        console.error('[CREDITS HELPER] Failed to fetch profile credits for increment:', fetchErr)
        return false
      }
      newCredits = Number(profile.credits || 0) + amount
      const { error: updateErr } = await supabaseAdmin
        .from('profiles')
        .update({ credits: newCredits })
        .eq('id', primaryUserId)
      if (updateErr) {
        console.error('[CREDITS HELPER] Failed to update user credits:', updateErr)
        return false
      }
    }

    const { error: insertErr } = await supabaseAdmin.from('credit_transactions').insert({
      user_id: primaryUserId,
      amount: amount,
      category,
      description
    })
    if (insertErr) {
      console.error('[CREDITS HELPER] Failed to insert credit transaction:', insertErr)
    }

    console.log(
      `[CREDITS HELPER] Added ${amount} credits to user ${primaryUserId} for ${category}. New balance: ${newCredits}`
    )
    return true
  } catch (e) {
    console.error('[CREDITS HELPER] addCredits Exception:', e)
    return false
  }
}

/**
 * DEPRECATED rate table — kept only so imports keep compiling.
 *
 * It under-billed badly: output was priced at ₹0.0238/1k for DeepSeek and
 * ₹0.0252/1k for Gemini, against a real ₹0.1056 and ₹0.22 — a 4x to 9x
 * shortfall, and with no cache tier at all, which for an agent turn is most of
 * the input. `calculateLLMCost` now delegates to the canonical table in
 * lib/agent/pricing.ts so the same Gemini call costs the same no matter which
 * route made it.
 */
export const MODEL_RATES: Record<string, { inputPerK: number; outputPerK: number }> = {
  'gemini-1.5-flash': { inputPerK: 0.0063, outputPerK: 0.0252 },
  'gemini-2.0-flash': { inputPerK: 0.0063, outputPerK: 0.0252 },
  'gemini-3.5-flash': { inputPerK: 0.0063, outputPerK: 0.0252 },
  'deepseek-v4-flash': { inputPerK: 0.0119, outputPerK: 0.0238 },
  'deepseek-flash': { inputPerK: 0.0119, outputPerK: 0.0238 },
  'deepseek-chat': { inputPerK: 0.0119, outputPerK: 0.0238 },
  'deepseek': { inputPerK: 0.0119, outputPerK: 0.0238 },
  'default': { inputPerK: 0.0063, outputPerK: 0.0252 }
};

/**
 * Calculates LLM generation cost in INR based on input and output token counts.
 *
 * Delegates to the canonical, cache-aware table in lib/agent/pricing.ts. This
 * used to read MODEL_RATES above, which priced output 4x-9x below our real cost
 * and ignored cache hits entirely — so the same Gemini call was billed
 * differently depending on which route happened to make it.
 */
export function calculateLLMCost(
  modelName: string,
  promptTokens: number,
  completionTokens: number
): number {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { priceForTextModel } = require('@/lib/agent/pricing') as typeof import('@/lib/agent/pricing')
  const rates = priceForTextModel(modelName)
  const inputCost = (Math.max(0, promptTokens) / 1000) * rates.cacheMissPer1k
  const outputCost = (Math.max(0, completionTokens) / 1000) * rates.outputPer1k
  return inputCost + outputCost; // Cost in INR
}

/**
 * Deducts credits based on actual rupee cost with a 2x markup (1 Rupee cost to us = 2 Credits deducted).
 */
export async function deductCreditsByCost(
  supabaseAdmin: any,
  userId: string,
  rupeeCost: number,
  category: 'calling' | 'whatsapp' | 'ai_generation' | 'campaign_launch' | 'topup' | 'subscription',
  description: string
): Promise<boolean> {
  if (rupeeCost <= 0) return false;
  // Convert actual rupee cost to credits with a 2x markup (1 rupee cost = 2 credits)
  const creditsToDeduct = rupeeCost * 2;
  // Round to 2 decimal places to keep ledger neat
  const roundedCredits = Math.round(creditsToDeduct * 100) / 100;
  return deductCredits(supabaseAdmin, userId, roundedCredits, category, description);
}

