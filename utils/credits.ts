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
 * Checks if a profile has enough credits for a required amount.
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
      .select('credits, business_name, role, subscription_status, email')
      .eq('id', primaryUserId)
      .single()

    if (error || !profile) return false

    // Unlimited bypass check (rchopra489, infobluesquare)
    const isUnlimited = ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com'].includes(profile.email || '')
    if (isUnlimited) return true

    // Check if base subscription plan is active
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
    if (!isSubscriptionActive) {
      console.warn(`[CREDITS HELPER] Action blocked. User ${primaryUserId} has credits but no active base subscription plan. Status: ${subscriptionStatus}`)
      return false
    }

    return (profile.credits || 0) >= requiredAmount
  } catch (e) {
    console.error('[CREDITS HELPER] hasEnoughCredits error:', e)
    return false
  }
}

/**
 * Deducts credits from a user's balance and records the transaction in the ledger.
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
    
    // 1. Fetch current credits
    const { data: profile, error: fetchErr } = await supabaseAdmin
      .from('profiles')
      .select('credits, business_name, role, email')
      .eq('id', primaryUserId)
      .single()

    if (fetchErr || !profile) {
      console.error('[CREDITS HELPER] Failed to fetch profile credits for deduction:', fetchErr)
      return false
    }

    const currentCredits = profile.credits || 0
    const isUnlimited = ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com'].includes(profile.email || '')

    if (!isUnlimited && currentCredits < amount) {
      console.warn(`[CREDITS HELPER] Overdraft prevented. User ${primaryUserId} has ${currentCredits} credits; trying to deduct ${amount}.`)
      return false
    }

    const newCredits = currentCredits - amount

    // 2. Perform updates
    const [updateRes, insertRes] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .update({ credits: newCredits })
        .eq('id', primaryUserId),
      supabaseAdmin
        .from('credit_transactions')
        .insert({
          user_id: primaryUserId,
          amount: -amount,
          category,
          description
        })
    ])

    if (updateRes.error) {
      console.error('[CREDITS HELPER] Failed to update user credits:', updateRes.error)
      return false
    }

    if (insertRes.error) {
      console.error('[CREDITS HELPER] Failed to insert credit transaction:', insertRes.error)
    }

    console.log(`[CREDITS HELPER] Deducted ${amount} credits from user ${primaryUserId} for ${category}. New balance: ${newCredits}`)
    return true
  } catch (e) {
    console.error('[CREDITS HELPER] deductCredits Exception:', e)
    return false
  }
}

/**
 * Adds credits to a user's balance (used for top-ups, recharges, and subscriptions).
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
    
    const { data: profile, error: fetchErr } = await supabaseAdmin
      .from('profiles')
      .select('credits')
      .eq('id', primaryUserId)
      .single()

    if (fetchErr || !profile) {
      console.error('[CREDITS HELPER] Failed to fetch profile credits for increment:', fetchErr)
      return false
    }

    const currentCredits = profile.credits || 0
    const newCredits = currentCredits + amount

    const [updateRes, insertRes] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .update({ credits: newCredits })
        .eq('id', primaryUserId),
      supabaseAdmin
        .from('credit_transactions')
        .insert({
          user_id: primaryUserId,
          amount: amount,
          category,
          description
        })
    ])

    if (updateRes.error) {
      console.error('[CREDITS HELPER] Failed to update user credits:', updateRes.error)
      return false
    }

    if (insertRes.error) {
      console.error('[CREDITS HELPER] Failed to insert credit transaction:', insertRes.error)
    }

    console.log(`[CREDITS HELPER] Added ${amount} credits to user ${primaryUserId} for ${category}. New balance: ${newCredits}`)
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

