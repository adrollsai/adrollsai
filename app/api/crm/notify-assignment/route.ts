import { NextResponse } from 'next/server'
import { sendAdminMultiChannelNotification } from '@/utils/notification-helper'
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

    // Dispatch full multi-channel notification (in-app, push & email) to the assigned agent
    await sendAdminMultiChannelNotification({
      ownerUserId: agentId,
      title: title || "🎯 Lead Assigned to You!",
      body: message,
      url: url || "/dashboard/crm",
      type: "lead_assigned"
    })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    console.error('Notify Assignment Error:', error)
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 })
  }
}
