import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { sendNotification } from '@/utils/notification-helper'

export async function POST(req: Request) {
  const supabase = await createClient()
  const supabaseAdmin = createAdminClient()

  try {
    // 1. Verify Admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (adminProfile?.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 2. Parse & Validate
    const { agentId, amount, type } = await req.json()
    
    // Strict Validation
    if (!agentId || !amount) throw new Error("Missing Agent ID or Amount")
    
    const changeAmount = parseFloat(amount.toString())
    if (isNaN(changeAmount)) throw new Error("Invalid Amount Format")

    // 3. Get Current Balance
    const { data: agentProfile, error: fetchError } = await supabaseAdmin
        .from('profiles')
        .select('ad_credits, business_name')
        .eq('id', agentId)
        .single()
    
    if (fetchError || !agentProfile) throw new Error("Agent not found in Database")

    // 4. Calculate Logic
    const oldBalance = Number(agentProfile.ad_credits || 0)
    let newBalance = 0

    if (type === 'add') {
        newBalance = oldBalance + changeAmount
    } else {
        newBalance = changeAmount // Set mode
    }

    console.log(`[ADMIN] Updating Agent ${agentId} | Old: ${oldBalance} | Mode: ${type} ${changeAmount} | Target: ${newBalance}`)

    // 5. Perform Update
    const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ ad_credits: newBalance })
        .eq('id', agentId)

    if (updateError) throw updateError

    // 6. VERIFICATION (Double Check)
    const { data: verify } = await supabaseAdmin.from('profiles').select('ad_credits').eq('id', agentId).single()
    
    if (verify?.ad_credits !== newBalance) {
        throw new Error(`DB Update Failed. Expected ${newBalance}, got ${verify?.ad_credits}`)
    }

    // 7. Transaction Log
    const diff = newBalance - oldBalance
    if (diff !== 0) {
        await supabaseAdmin.from('transactions').insert({
            user_id: agentId,
            amount: Math.abs(diff) * 100, // Store in lowest denomination (e.g. paise)
            status: 'SUCCESS',
            type: diff > 0 ? 'CREDIT' : 'DEBIT',
            order_id: `ADMIN_${Date.now()}_${Math.floor(Math.random()*1000)}`
        })
    }

    // 8. Send Notification
    await sendNotification(
        supabaseAdmin,
        agentId,
        "💰 Wallet Update",
        `Admin has updated your balance. Old: ₹${oldBalance} ➝ New: ₹${newBalance}`,
        'system',
        '/dashboard/wallet'
    )

    return NextResponse.json({ success: true, newBalance, oldBalance })

  } catch (error: any) {
    console.error("[ADMIN UPDATE ERROR]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}