import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId, agentId } = await request.json()

  if (!leadId || !agentId) {
      return NextResponse.json({ error: 'Missing leadId or agentId' }, { status: 400 })
  }

  // 2. Admin Check & Logic
  try {
      // Check if requester is Admin
      const { data: requester } = await supabase
        .from('profiles')
        .select('role, organization_id')
        .eq('id', user.id)
        .single()
      
      if (requester?.role !== 'admin') {
          return NextResponse.json({ error: 'Only Admins can assign leads.' }, { status: 403 })
      }

      // 3. Verify Agent belongs to same Org
      const { data: agent } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', agentId)
        .single()
      
      if (agent?.organization_id !== requester.organization_id) {
          return NextResponse.json({ error: 'Agent is not in your organization.' }, { status: 403 })
      }

      // 4. Update Lead
      const { error } = await supabase
        .from('leads')
        .update({ user_id: agentId }) // Transfer ownership
        .eq('id', leadId)
      
      if (error) throw error

      return NextResponse.json({ success: true })

  } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 })
  }
}