import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { deductCreditsByCost } from '@/utils/credits'

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
    const activeProvider = voiceProvider || profile.voice_provider || 'elevenlabs'

    if (!twilioSid || !twilioToken) {
      console.error('[BILL-CALL] Twilio credentials not configured')
      return NextResponse.json({ error: 'Twilio not configured' }, { status: 400 })
    }

    // 2. Fetch Lead Details for logging description
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('name, phone')
      .eq('id', leadId)
      .single()

    const leadName = lead?.name || 'Lead'
    const leadPhone = lead?.phone || ''

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

    let finalCostInr = 0
    let billingMethod = ''

    if (isLivePrice && actualPriceUsd > 0) {
      // Conversion rule: USD to INR (e.g. 84 INR)
      const twilioCostInr = actualPriceUsd * 84
      // Blended AI Voice Engine cost (Kie.ai/Gemini is cheaper, ElevenLabs is standard)
      const aiCostPerMinute = activeProvider === 'elevenlabs' ? 12.50 : 1.25 // ElevenLabs = Rs.12.50/min, Gemini = Rs.1.25/min
      const aiCostInr = durationMinutes * aiCostPerMinute

      finalCostInr = twilioCostInr + aiCostInr
      billingMethod = `Live Twilio Carrier Cost (Rs. ${twilioCostInr.toFixed(2)}) + AI Voice Overhead (Rs. ${aiCostInr.toFixed(2)})`
    } else {
      // Fallback cost: Rs. 1.50 per minute (covers Twilio trunking + AI runtime)
      finalCostInr = durationMinutes * 1.50
      billingMethod = `Fallback Cost (Rs. 1.50 / minute)`
    }

    console.log(`[BILL-CALL] Call Billing Summary: Duration=${durationMinutes} min(s), Total INR Cost=${finalCostInr.toFixed(4)}, Method: ${billingMethod}`);

    // 4. Deduct the credits
    const success = await deductCreditsByCost(
      supabaseAdmin,
      userId,
      finalCostInr,
      'calling',
      `Outbound call to ${leadName} (${leadPhone}) - Duration: ${durationMinutes} min(s) [${billingMethod}]`
    )

    return NextResponse.json({ success, finalCostInr, durationMinutes, billingMethod })
  } catch (err: any) {
    console.error('[BILL-CALL] Exception during billing:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
