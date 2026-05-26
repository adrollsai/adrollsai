import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    
    // 1. Authenticate user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { targetUserId, updates } = body

    if (!targetUserId || !updates) {
      return NextResponse.json({ error: 'Missing targetUserId or updates' }, { status: 400 })
    }

    // 2. Validate permissions of requester
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, agency_id, parent_id')
      .eq('id', user.id)
      .single()

    let authorized = false

    // Check if updating own profile
    if (targetUserId === user.id) {
      authorized = true
    }

    // Check if staff/impersonation rights exist
    if (!authorized) {
      const currentAuthRole = profile?.role || 'admin'
      
      // If agency/admin/agent, verify the target is their sub-account
      if (['super_admin', 'agency', 'admin', 'agent'].includes(currentAuthRole)) {
        if (currentAuthRole !== 'super_admin') {
          const { data: subAccount } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', targetUserId)
            .eq('agency_id', profile?.agency_id || user.id)
            .single()
          
          if (subAccount) {
            authorized = true
          }
        } else {
          // Super admin is authorized for everything
          authorized = true
        }
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Forbidden: Unauthorized profile update' }, { status: 403 })
    }

    // Remove any fields that should not be updated via profile page
    const allowedUpdates = { ...updates }
    delete allowedUpdates.id
    delete allowedUpdates.created_at
    delete allowedUpdates.role
    delete allowedUpdates.agency_id
    delete allowedUpdates.parent_id

    // 3. Perform update using service role client to bypass RLS restrictions
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(allowedUpdates)
      .eq('id', targetUserId)
      .select()
      .single()

    if (error) {
      console.error("[Profile Update API] Database update error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, profile: data })

  } catch (error: any) {
    console.error("[Profile Update API] General error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
