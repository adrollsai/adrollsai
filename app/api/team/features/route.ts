import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const { adminId, targetUserId, features } = await req.json()

    if (!adminId || !targetUserId || !Array.isArray(features)) {
      return NextResponse.json({ error: 'Missing required parameters (adminId, targetUserId, features array)' }, { status: 400 })
    }

    // Verify caller authority
    const { data: adminProfile, error: adminErr } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', adminId)
      .single()

    if (adminErr || !adminProfile) {
      return NextResponse.json({ error: 'Admin profile not found' }, { status: 404 })
    }

    const isSuperAdmin = adminProfile.role === 'super_admin'

    // Fetch target user profile
    const { data: targetProfile, error: targetErr } = await supabaseAdmin
      .from('profiles')
      .select('id, role, agency_id, parent_id, business_name')
      .eq('id', targetUserId)
      .single()

    if (targetErr || !targetProfile) {
      return NextResponse.json({ error: 'Target account not found' }, { status: 404 })
    }

    const isAuthorized =
      isSuperAdmin ||
      targetProfile.agency_id === adminId ||
      targetProfile.parent_id === adminId

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized to configure features for this account' }, { status: 403 })
    }

    // Validate feature keys against supported modules
    const VALID_FEATURES = [
      'analytics',
      'inventory',
      'creation',
      'ads',
      'crm',
      'whatsapp',
      'voice_agent',
      'flows',
      'calendar',
      'billing'
    ]
    const sanitizedFeatures = features.filter(f => typeof f === 'string' && VALID_FEATURES.includes(f))

    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({ client_features: sanitizedFeatures })
      .eq('id', targetUserId)

    if (updateErr) {
      console.error('[FEATURES API] Failed to update client_features:', updateErr)
      return NextResponse.json({ error: 'Failed to update feature permissions' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      targetUserId,
      features: sanitizedFeatures,
      message: `Permissions successfully updated for ${targetProfile.business_name || 'account'}`
    })
  } catch (err: any) {
    console.error('[FEATURES API] Exception:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
