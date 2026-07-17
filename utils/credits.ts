import { createClient } from '@supabase/supabase-js'

export const CREDIT_COSTS = {
  VOICE_CALL_MINUTE: 10,      // Rs. 10.00 / minute priced to customer
  WHATSAPP_INBOUND: 0.2,      // Rs. 0.20 priced to customer (2x markup of Rs. 0.10 cost)
  WHATSAPP_OUTBOUND: 0.4,     // Rs. 0.40 priced to customer (2x markup of Rs. 0.20 cost)
  AI_COPY_GENERATION: 1.0,    // Rs. 1.00 priced to customer (2x markup of Rs. 0.50 cost)
  AI_IMAGE_GENERATION: 30,    // Rs. 30.00 priced to customer
  AI_VIDEO_RENDER: 20,        // Rs. 20.00 priced to customer
  META_CAMPAIGN_LAUNCH: 10    // Rs. 10.00 priced to customer (2x markup of Rs. 5.00 cost)
};

/**
 * Resolves the primary admin user ID who holds the credit balance for a workspace.
 */
async function getPrimaryUserId(supabaseAdmin: any, userId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id, parent_id, agency_id')
      .eq('id', userId)
      .single()
      
    if (data) {
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

    // Unlimited bypass check (rchopra489, infobluesquare, khushiram)
    const isUnlimited = ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com', 'khushiramrealtor@gmail.com'].includes(profile.email || '')
    if (isUnlimited) return true

    // Check if base subscription plan is active
    const subscriptionStatus = profile.subscription_status?.toLowerCase() || ''
    const isSubscriptionActive = ['active', 'trialing', 'pro', 'growth'].includes(subscriptionStatus)
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
    const isUnlimited = ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com', 'khushiramrealtor@gmail.com'].includes(profile.email || '')

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

export const MODEL_RATES: Record<string, { inputPerK: number; outputPerK: number }> = {
  'gemini-1.5-flash': { inputPerK: 0.0063, outputPerK: 0.0252 },
  'gemini-2.0-flash': { inputPerK: 0.0063, outputPerK: 0.0252 },
  'gemini-3.5-flash': { inputPerK: 0.0063, outputPerK: 0.0252 },
  'gemini-3.5-flash-preview': { inputPerK: 0.0063, outputPerK: 0.0252 },
  'deepseek-v4-flash': { inputPerK: 0.0119, outputPerK: 0.0238 },
  'deepseek': { inputPerK: 0.0119, outputPerK: 0.0238 },
  'default': { inputPerK: 0.0063, outputPerK: 0.0252 }
};

/**
 * Calculates LLM generation cost in INR based on input and output token counts.
 */
export function calculateLLMCost(
  modelName: string,
  promptTokens: number,
  completionTokens: number
): number {
  const model = (modelName || 'default').toLowerCase();
  let rates = MODEL_RATES.default;
  for (const key of Object.keys(MODEL_RATES)) {
    if (model.includes(key)) {
      rates = MODEL_RATES[key];
      break;
    }
  }
  const inputCost = (promptTokens / 1000) * rates.inputPerK;
  const outputCost = (completionTokens / 1000) * rates.outputPerK;
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

