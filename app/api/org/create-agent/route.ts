import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'

export async function POST(req: Request) {
  const supabase = await createClient()
  const supabaseAdmin = createAdminClient()

  try {
    // 1. Verify Caller is Admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single()

    if (adminProfile?.role !== 'admin' || !adminProfile.organization_id) {
        return NextResponse.json({ error: 'Forbidden: Admins only' }, { status: 403 })
    }

    // --- CHANGE START: ENFORCE LIMIT ---
    
    // A. Fetch Organization Limit
    const { data: orgData, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('agent_limit')
        .eq('id', adminProfile.organization_id)
        .single()
    
    if (orgError || !orgData) throw new Error("Organization not found")

    // B. Count Existing Agents
    const { count, error: countError } = await supabaseAdmin
        .from('profiles')
        .select('*', { count: 'exact', head: true }) // head: true means don't fetch data, just count
        .eq('organization_id', adminProfile.organization_id)
        .eq('role', 'agent')

    if (countError) throw countError

    const limit = orgData.agent_limit || 5 // Default fallback
    const currentCount = count || 0

    if (currentCount >= limit) {
        return NextResponse.json({ 
            error: `Agent limit reached (${currentCount}/${limit}). Please contact support to upgrade.` 
        }, { status: 403 })
    }

    // --- CHANGE END ---

    const body = await req.json()
    const { email, password, name, phone } = body

    if (!email || !password || !name) {
        return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // 2. Create User in Auth
    const { data: newUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: {
            full_name: name
        }
    })

    if (authError) throw authError
    if (!newUser.user) throw new Error("Failed to create user")

    // 3. Create Agent Profile linked to Org
    await supabaseAdmin.from('profiles').upsert({
        id: newUser.user.id,
        email: email,
        role: 'agent',
        organization_id: adminProfile.organization_id,
        business_name: name,
        contact_number: phone || '',
        ad_credits: 0
    })

    // 4. Add to Members
    await supabaseAdmin.from('organization_members').insert({
        user_id: newUser.user.id,
        organization_id: adminProfile.organization_id,
        role: 'agent'
    })

    return NextResponse.json({ success: true, user: newUser.user })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}