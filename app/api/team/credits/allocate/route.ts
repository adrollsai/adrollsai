import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const { adminId, targetUserId, amount } = await req.json()
    const transferAmount = Number(amount)

    if (!adminId || !targetUserId || isNaN(transferAmount) || transferAmount <= 0) {
      return NextResponse.json(
        { error: 'Valid adminId, targetUserId, and positive amount are required.' },
        { status: 400 }
      )
    }

    // 1. Fetch admin/agency profile
    const { data: adminProfile, error: adminErr } = await supabaseAdmin
      .from('profiles')
      .select('id, role, credits, business_name')
      .eq('id', adminId)
      .single()

    if (adminErr || !adminProfile) {
      return NextResponse.json({ error: 'Admin / Agency profile not found.' }, { status: 404 })
    }

    const isSuperAdmin = adminProfile.role === 'super_admin'

    // 2. Fetch target client profile
    const { data: targetProfile, error: targetErr } = await supabaseAdmin
      .from('profiles')
      .select('id, role, agency_id, parent_id, credits, business_name')
      .eq('id', targetUserId)
      .single()

    if (targetErr || !targetProfile) {
      return NextResponse.json({ error: 'Target client account not found.' }, { status: 404 })
    }

    const isAuthorized =
      isSuperAdmin ||
      targetProfile.agency_id === adminId ||
      targetProfile.parent_id === adminId

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized to allocate credits to this client account.' },
        { status: 403 }
      )
    }

    // 3. Balance verification for agency
    const currentAdminCredits = adminProfile.credits || 0
    if (!isSuperAdmin && currentAdminCredits < transferAmount) {
      return NextResponse.json(
        {
          error: `Insufficient agency balance. You currently have ${currentAdminCredits} credits, but attempted to allocate ${transferAmount}.`
        },
        { status: 400 }
      )
    }

    const currentClientCredits = targetProfile.credits || 0
    const newAdminCredits = isSuperAdmin ? currentAdminCredits : currentAdminCredits - transferAmount
    const newClientCredits = currentClientCredits + transferAmount

    // 4. Update balances and insert audit ledger records
    const updates: Promise<any>[] = [
      supabaseAdmin
        .from('profiles')
        .update({ credits: newClientCredits })
        .eq('id', targetUserId),
      supabaseAdmin.from('credit_transactions').insert({
        user_id: targetUserId,
        amount: transferAmount,
        category: 'topup',
        description: `Credits allocated by ${adminProfile.business_name || 'Agency'}`
      })
    ]

    if (!isSuperAdmin) {
      updates.push(
        supabaseAdmin
          .from('profiles')
          .update({ credits: newAdminCredits })
          .eq('id', adminId),
        supabaseAdmin.from('credit_transactions').insert({
          user_id: adminId,
          amount: -transferAmount,
          category: 'topup',
          description: `Allocated ${transferAmount} credits to ${targetProfile.business_name || 'client'}`
        })
      )
    }

    await Promise.all(updates)

    return NextResponse.json({
      success: true,
      allocatedAmount: transferAmount,
      agencyBalance: newAdminCredits,
      clientBalance: newClientCredits,
      message: `Successfully allocated ${transferAmount} credits to ${targetProfile.business_name || 'client'}.`
    })
  } catch (err: any) {
    console.error('[CREDIT ALLOCATION API] Exception:', err)
    return NextResponse.json({ error: err.message || 'Failed to allocate credits' }, { status: 500 })
  }
}
