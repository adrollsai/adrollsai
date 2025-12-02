import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { requirementId, query } = body // Accepting 'query' directly

    if (!requirementId) {
      return NextResponse.json({ error: 'Missing requirement ID' }, { status: 400 })
    }

    // Prepare Payload for n8n
    const agentPayload = {
      userId: user.id,
      requirementId: requirementId,
      searchQuery: query, // Pass the raw user query
      // We rely on n8n to parse location/budget if needed, 
      // or just search with the raw string which is often better for Serper.
    }

    const n8nUrl = process.env.N8N_AGENT_HUNT_WEBHOOK_URL
    
    if (n8nUrl) {
        console.log("🚀 Triggering Agent Hunt for:", query)
        // Fire and forget (don't await response to keep UI snappy)
        fetch(n8nUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(agentPayload)
        }).catch(err => console.error("n8n Trigger Failed:", err))
    }

    return NextResponse.json({ success: true, message: 'Agent dispatched' })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}