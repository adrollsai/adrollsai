import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/utils/supabase/server'
import { getUserLimits } from '@/utils/subscription'

// Initialize a privileged client for admin actions
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function POST(req: Request) {
  try {
    const supabaseUser = await createServerSupabase()
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    
    if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { email, password, fullName, contactNumber } = await req.json()

    // 1. Verify the current user is an admin
    const { data: currentProfile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

    if (currentProfile?.role !== 'admin' && currentProfile?.role !== 'super_admin' && currentProfile?.role !== 'agency') {
        return NextResponse.json({ error: "Only admins can create team members" }, { status: 403 })
    }

    // Check team member limit
    const rootParentId = currentProfile?.parent_id || user.id
    let parentProfile = currentProfile
    if (currentProfile?.parent_id) {
      const { data: pProfile } = await supabaseAdmin.from('profiles').select('*').eq('id', currentProfile.parent_id).single()
      if (pProfile) parentProfile = pProfile
    }

    const { count: teamCount } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', rootParentId)
      .in('role', ['admin', 'agent'])
    
    const teamUsed = teamCount || 0
    const limits = getUserLimits(parentProfile)
    const teamLimit = limits.team_members

    if (teamUsed >= teamLimit) {
      return NextResponse.json({
        error: `Your account limit is capped at a maximum of ${teamLimit} team members. Please contact support or upgrade your plan.`
      }, { status: 403 })
    }

    // 2. Create the Auth User securely
    const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true, // Auto-confirm so they can log in immediately
    })

    if (createError) throw createError

    // 3. UPSERT the Agent Profile
    // Using .upsert() instead of .insert() prevents crashes if a Supabase 
    // database trigger has already auto-created a blank profile row for this ID.
    const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
        id: newAuthUser.user.id,
        email: email,
        business_name: fullName, 
        contact_number: contactNumber,
        role: 'agent',
        parent_id: user.id 
    })

    if (profileError) {
        // Rollback auth user if profile creation fails
        await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id)
        throw profileError
    }

    return NextResponse.json({ success: true, message: "Agent created successfully" })

  } catch (error: any) {
    console.error("Team Creation Error:", error)
    return NextResponse.json({ error: error.message || "Failed to create agent" }, { status: 500 })
  }
}