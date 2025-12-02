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
    const { requirementId, query } = body 

    if (!requirementId) {
      return NextResponse.json({ error: 'Missing requirement ID' }, { status: 400 })
    }

    const agentPayload = {
      userId: user.id,
      requirementId: requirementId,
      searchQuery: query || "Real Estate Investment", 
    }

    const n8nUrl = process.env.N8N_AGENT_HUNT_WEBHOOK_URL
    
    if (n8nUrl) {
        console.log("🚀 Triggering Agent Hunt for:", agentPayload.searchQuery)
        
        // FIX: Added 'await' here. 
        // This ensures the request is actually sent before Vercel kills the function.
        try {
            await fetch(n8nUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(agentPayload)
            })
        } catch (fetchError) {
            console.error("n8n Trigger Failed:", fetchError)
            // We don't throw here to ensure the user still gets a success UI response
        }
    }

    return NextResponse.json({ success: true, message: 'Agent dispatched' })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}