import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { deductCreditsByCost, deductCredits } from '@/utils/credits'
import { callChargeCredits, failedCallHundredths } from '@/lib/automation/call-billing'

// Bypassing RLS with Admin Key
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false }
  }
)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { leadId, userId, callSid, voiceProvider } = body

    if (!leadId || !userId || !callSid) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    console.log(`[BILL-CALL] Processing delayed billing for CallSid: ${callSid}, Lead: ${leadId}, User: ${userId}`);

    // 1. Fetch user credentials to query Twilio call details
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('voice_twilio_sid, voice_twilio_token, voice_provider')
      .eq('id', userId)
      .single()

    if (profErr || !profile) {
      console.error('[BILL-CALL] Failed to fetch user profile:', profErr)
      return NextResponse.json({ error: 'User config not found' }, { status: 404 })
    }

    const twilioSid = process.env.MASTER_TWILIO_SID || process.env.DEV_TWILIO_SID
    const twilioToken = process.env.MASTER_TWILIO_TOKEN || process.env.DEV_TWILIO_TOKEN
    const activeProvider: string = 'gemini' // Force Gemini 3.1 Flash Live API for all accounts

    if (!twilioSid || !twilioToken) {
      console.error('[BILL-CALL] Twilio credentials not configured')
      return NextResponse.json({ error: 'Twilio not configured' }, { status: 400 })
    }

    // 2. Fetch Lead Details for logging description
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('name, phone, source, custom_fields')
      .eq('id', leadId)
      .single()

    const leadName = lead?.name || 'Lead'
    const leadPhone = lead?.phone || ''
    const cf = typeof lead?.custom_fields === 'string' ? JSON.parse(lead.custom_fields || '{}') : (lead?.custom_fields || {})
    const isTestCall = cf.skip_credit_deduction || cf.is_demo_call || cf.is_test_call || lead?.source === 'AI Call Demo' || userId === '68b55a31-a16d-454d-a20f-11adabf590b0' && cf.is_demo_call

    if (isTestCall) {
      console.log(`[BILL-CALL] 🧪 Demo/Test call detected for lead ${leadId}. Skipping credit deduction.`)
      return NextResponse.json({ success: true, skipped: true, reason: 'Demo test call' })
    }

    // 3. Query Twilio API for the call price
    let actualPriceUsd = 0
    let durationSeconds = 0
    let isLivePrice = false

    try {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls/${callSid}.json`
      const authHeader = 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')
      
      const twilioRes = await fetch(twilioUrl, {
        headers: { 'Authorization': authHeader }
      })

      if (twilioRes.ok) {
        const callData = await twilioRes.json()
        durationSeconds = parseInt(callData.duration, 10) || 0
        const rawPrice = parseFloat(callData.price)
        if (!isNaN(rawPrice)) {
          actualPriceUsd = Math.abs(rawPrice)
          isLivePrice = true
          console.log(`[BILL-CALL] Twilio Call details: duration=${durationSeconds}s, price=${actualPriceUsd} USD`);
        } else {
          console.warn(`[BILL-CALL] Twilio price is not yet available for call ${callSid}. Falling back.`);
        }
      } else {
        const errText = await twilioRes.text()
        console.error(`[BILL-CALL] Twilio API call returned status ${twilioRes.status}:`, errText)
      }
    } catch (twErr: any) {
      console.error('[BILL-CALL] Error querying Twilio API:', twErr.message)
    }

    // If duration check is zero, try to look up duration from search parameter if possible or default
    // We'll calculate the minutes based on duration or default to 1 min if no duration found
    const durationMinutes = Math.ceil(durationSeconds / 60) || 1

    // NO SEPARATE AI CHARGE. The owner's tariff is one all-in price: 4 credits for the first 60
    // seconds (1 credit for the minute block + 60 x 0.05), and the Gemini Live token cost is baked
    // into it. This block used to compute a rupee figure — carrier cost plus a per-minute AI overhead
    // of Rs 1.25 (Gemini) or Rs 12.50 (ElevenLabs) — which was returned to the caller but never
    // deducted. Dead arithmetic next to live arithmetic is how a second charge gets added by mistake
    // later, so it is gone rather than left lying around.

    console.log(
      `[BILL-CALL] Call summary: ${durationSeconds}s measured, ${durationMinutes} minute(s) — ` +
        'charges computed below from lib/automation/call-billing.ts',
    );

    // 4. Deduct the credits using the ONE billing model (lib/automation/call-billing.ts):
    //    1 credit per minute block entered + 0.05 credits per second, in integer hundredths.
    //
    // This replaced a flat `durationMinutes * 5`. That was a different tariff to the one the owner
    // specified, and it had a worse fault: `durationSeconds` comes from a TWILIO lookup, so on a
    // Vobiz call the lookup does not apply, duration stayed 0, and `Math.ceil(0/60) || 1` silently
    // billed every single Vobiz call as a full minute. Those three cases are now distinguished:
    //
    //   duration measured      -> charged by the real model
    //   Twilio says 0s         -> the call never connected: 0.02 credits, no minute block
    //   duration NOT measured  -> unknown, not zero. Bill one block as a floor and shout about it,
    //                             because billing nothing would be a silent give-away.
    let creditsToDeduct: number
    let chargeBasis: string
    if (isLivePrice && durationSeconds > 0) {
      creditsToDeduct = callChargeCredits(durationSeconds)
      chargeBasis = `${durationSeconds}s: ${Math.ceil(durationSeconds / 60)} minute block(s) + ${durationSeconds} x 0.05`
    } else if (isLivePrice && durationSeconds === 0) {
      creditsToDeduct = failedCallHundredths() / 100
      chargeBasis = 'never connected — failed-call rate, no minute block'
    } else {
      creditsToDeduct = callChargeCredits(60)
      chargeBasis = 'DURATION UNKNOWN (carrier lookup failed) — billed one minute block as a floor'
      console.warn(
        `[BILL-CALL] duration could not be measured for call ${callSid}; billing one minute block ` +
          'as a floor. Capture the duration from the provider webhook instead of relying on this path.',
      )
    }

    const success = await deductCredits(
      supabaseAdmin,
      userId,
      creditsToDeduct,
      'calling',
      `Outbound AI call to ${leadName} (${leadPhone}) - ${chargeBasis}`
    )

    return NextResponse.json({ success, durationMinutes, durationSeconds, creditsToDeduct, chargeBasis })
  } catch (err: any) {
    console.error('[BILL-CALL] Exception during billing:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
