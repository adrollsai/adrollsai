import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { sendNotification } from '@/utils/notification-helper'

export async function POST(req: Request) {
  // 1. Regular client for Auth check
  const supabase = await createClient()
  
  // 2. Admin client for DB Updates & Notifications (Bypasses RLS)
  const supabaseAdmin = createAdminClient()

  try {
    // --- AUTHENTICATION ---
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (adminProfile?.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden: Admins Only' }, { status: 403 })
    }

    // --- INPUT PARSING ---
    const { agentId, amount, type } = await req.json()
    
    if (!agentId || amount === undefined) {
        return NextResponse.json({ error: "Missing Agent ID or Amount" }, { status: 400 })
    }
    
    const changeAmount = parseFloat(amount.toString())
    if (isNaN(changeAmount)) {
        return NextResponse.json({ error: "Invalid Amount Format" }, { status: 400 })
    }

    // --- GET CURRENT BALANCE ---
    const { data: agentProfile, error: fetchError } = await supabaseAdmin
        .from('profiles')
        .select('ad_credits, business_name')
        .eq('id', agentId)
        .single()
    
    if (fetchError || !agentProfile) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 })
    }

    // --- CALCULATE NEW BALANCE ---
    const oldBalance = Number(agentProfile.ad_credits || 0)
    let newBalance = 0

    if (type === 'add') {
        newBalance = oldBalance + changeAmount
    } else {
        newBalance = changeAmount // 'set' mode
    }

    console.log(`[ADMIN] User ${user.id} updating Agent ${agentId}. Old: ${oldBalance} -> New: ${newBalance}`)

    // --- UPDATE DATABASE ---
    const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ ad_credits: newBalance })
        .eq('id', agentId)

    if (updateError) throw updateError

    // --- LOG TRANSACTION (Legacy Table - Primary Source) ---
    const diff = newBalance - oldBalance
    // Only log if there's a real change
    if (Math.abs(diff) > 0) {
        // We encode the type in the order_id so the frontend can parse it
        // Format: ADMIN_ADJ_[CREDIT|DEBIT]_[TIMESTAMP]
        const typeStr = diff > 0 ? 'CREDIT' : 'DEBIT'
        const orderId = `ADMIN_ADJ_${typeStr}_${Date.now()}`

        await supabaseAdmin.from('transactions').insert({
            user_id: agentId,
            amount: Math.abs(diff) * 100, // Store in cents/paisa
            status: 'SUCCESS',
            order_id: orderId
        })

        // (Optional) We still write to wallet_transactions for future proofing, 
        // but the frontend will rely on 'transactions' for now.
        await supabaseAdmin.from('wallet_transactions').insert({
            user_id: agentId,
            amount: Math.abs(diff) * 100,
            status: 'SUCCESS',
            type: typeStr,
            description: type === 'add' 
                ? `Admin adjustment: Added ${changeAmount}` 
                : `Admin adjustment: Balance set to ${newBalance}`,
            provider_reference_id: orderId
        })
    }

    // --- SEND NOTIFICATION ---
    await sendNotification(
        supabaseAdmin, 
        agentId,
        "💰 Wallet Update",
        `Your ad wallet balance has been updated. New Balance: ₹${newBalance.toLocaleString()}`,
        'system',
        '/dashboard/wallet'
    )

    return NextResponse.json({ 
        success: true, 
        newBalance, 
        oldBalance,
        message: "Balance updated and notification sent."
    })

  } catch (error: any) {
    console.error("[CREDIT UPDATE ERROR]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}