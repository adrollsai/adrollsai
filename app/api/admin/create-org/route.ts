import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'

export async function POST(req: Request) {
  const supabase = await createClient()
  const supabaseAdmin = createAdminClient()
  
  try {
    // 1. Verify Super User
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    // Assuming you have a specific role or you can check specific email
    if (profile?.role !== 'super_user' && user.email !== 'admin@adrolls.ai') { // Replace with your logic
       return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { orgName, adminEmail, adminPassword, adminName } = body

    if (!orgName || !adminEmail || !adminPassword) {
        return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // 2. Create Organization
    const { data: newOrg, error: orgError } = await supabaseAdmin
        .from('organizations')
        .insert({ name: orgName })
        .select()
        .single()
    
    if (orgError) throw orgError

    // 3. Create User in Auth (Auto-confirm email)
    const { data: newUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true, // Auto-confirm so they can login immediately
        user_metadata: {
            full_name: adminName,
            business_name: orgName
        }
    })

    if (authError) throw authError
    if (!newUser.user) throw new Error("Failed to create user")

    // 4. Create Profile & Member Entry
    // Note: We use upsert to handle cases where a user might already exist in Auth but not Profile
    await supabaseAdmin.from('profiles').upsert({
        id: newUser.user.id,
        email: adminEmail,
        role: 'admin',
        organization_id: newOrg.id,
        business_name: adminName || 'Admin',
        ad_credits: 0
    })

    await supabaseAdmin.from('organization_members').insert({
        user_id: newUser.user.id,
        organization_id: newOrg.id,
        role: 'admin'
    })

    return NextResponse.json({ success: true, org: newOrg, user: newUser.user })

  } catch (error: any) {
    console.error('Create Org Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}