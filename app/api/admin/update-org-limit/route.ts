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

    if (profile?.role !== 'super_user') { 
       return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 2. Parse Input
    const body = await req.json()
    const { orgId, agentLimit } = body

    if (!orgId || agentLimit === undefined) {
        return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const limitValue = parseInt(agentLimit)
    if (isNaN(limitValue) || limitValue < 1) {
         return NextResponse.json({ error: 'Invalid limit value' }, { status: 400 })
    }

    // 3. Update Organization
    const { error: updateError } = await supabaseAdmin
        .from('organizations')
        .update({ agent_limit: limitValue })
        .eq('id', orgId)

    if (updateError) throw updateError

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('Update Limit Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}