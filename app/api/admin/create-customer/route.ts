import { createAdminClient } from '@/utils/supabase/admin'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createAdminClient()
    const { email, password, name, phone, organization_id } = await request.json()

    // 1. Create the User in Supabase Auth
    const { data: user, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm so they can login immediately
      user_metadata: { name }
    })

    if (createError) throw createError
    if (!user.user) throw new Error("Failed to generate user")

    // 2. Update the Profile (Assumes a Trigger creates the row, otherwise use .insert)
    // We use upsert to be safe in case the trigger didn't fire yet or fire at all
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: user.user.id,
        role: 'customer',
        business_name: name, // Using business_name for Customer Name
        contact_number: phone,
        organization_id: organization_id,
        email: email
      })

    if (profileError) throw profileError

    return NextResponse.json({ success: true, user: user.user })

  } catch (error: any) {
    console.error("Create Customer Error:", error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}