import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { leadId, actionType, description, nextFollowup } = await request.json()

    // 1. Save History Log
    const { error: historyError } = await supabase.from('lead_history').insert({
        lead_id: leadId,
        user_id: user.id,
        action_type: actionType,
        description: description
    })

    if (historyError) throw historyError;

    // 2. If it's a reminder setting, update the lead table
    if (nextFollowup) {
        await supabase.from('leads').update({ next_followup: nextFollowup }).eq('id', leadId)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}