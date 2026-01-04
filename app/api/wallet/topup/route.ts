import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js' // Changed import
import { sendNotification } from '@/utils/notification-helper'

export async function POST(request: Request) {
  // 1. Standard Client (for Auth Check)
  const supabase = await createClient()

  // 2. Admin Client (for bypassing RLS during Top-Up & Notification)
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
  )

  // 3. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { targetUserId, amount } = await request.json()
    const topUpValue = parseFloat(amount)

    if (!targetUserId || !topUpValue || topUpValue <= 0) {
        return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    }

    // 4. Get Requester Profile (Admin)
    const { data: requester } = await supabase
        .from('profiles')
        .select('organization_id, role')
        .eq('id', user.id)
        .single()

    if (requester?.role !== 'admin' && requester?.role !== 'super_user') {
        return NextResponse.json({ error: 'Only Admins can top up wallets' }, { status: 403 })
    }

    // 5. Get Target Profile (Agent) - Use Admin Client to ensure visibility
    const { data: targetUser } = await supabaseAdmin
        .from('profiles')
        .select('organization_id, ad_credits')
        .eq('id', targetUserId)
        .single()
    
    if (!targetUser) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    // 6. Security Check: Must belong to same Org (unless Super User)
    if (requester.role !== 'super_user') {
        if (targetUser.organization_id !== requester.organization_id) {
            return NextResponse.json({ error: 'Agent belongs to a different organization' }, { status: 403 })
        }
    }

    const newBalance = (targetUser.ad_credits || 0) + topUpValue

    // 7. Update Balance (Using Admin Client to be safe, though RLS might allow Org Admin update)
    const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ ad_credits: newBalance })
        .eq('id', targetUserId)

    if (updateError) throw updateError

    // 8. Log Transaction
    await supabaseAdmin.from('transactions').insert({
        user_id: targetUserId,
        amount: topUpValue * 100, // Store in paise
        status: 'SUCCESS',
        type: 'CREDIT',
        order_id: `ADMIN_TOPUP_${Date.now()}`,
    })

    // 9. Send Notification (CRITICAL FIX: Use supabaseAdmin)
    // This allows inserting into the Agent's notification table and reading their push subs
    await sendNotification(
        supabaseAdmin,
        targetUserId,
        "💰 Wallet Top Up",
        `Admin added ₹${topUpValue.toLocaleString()} to your wallet. New Balance: ₹${newBalance.toLocaleString()}`,
        "system",
        "/dashboard/wallet"
    )

    return NextResponse.json({ success: true, newBalance })

  } catch (error: any) {
    console.error("Top Up Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}