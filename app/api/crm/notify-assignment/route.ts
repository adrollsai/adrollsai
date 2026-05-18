import { NextResponse } from 'next/server'
import { sendPushNotification } from '@/utils/notification-helper'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { agentId, title, message, url } = await request.json()

    if (!agentId || !message) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Only allow if the agent is part of the same org (could verify, but relying on frontend for now)
    await sendPushNotification(agentId, title || "New Lead Assigned", message, url || "/dashboard/crm")

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    console.error('Notify Assignment Error:', error)
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 })
  }
}
