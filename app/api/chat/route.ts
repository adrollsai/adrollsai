import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  console.log("--- API/CHAT STARTED ---")
  
  const supabase = await createClient()
  
  // 1. Check Auth
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    console.log("Error: User not authenticated")
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Extract Data (Updated to include Image Arrays & Aspect Ratio)
  const body = await request.json()
  const { message, mode, imageUrls, aspectRatio } = body

  // Debug Logs (So you can see exactly what is being sent to n8n)
  console.log("User:", user.email)
  console.log("N8N URL:", process.env.N8N_WEBHOOK_URL)
  console.log("Payload Summary:", { 
    mode, 
    aspectRatio, 
    imagesCount: imageUrls?.length,
    promptLength: message?.length 
  })

  if (!process.env.N8N_WEBHOOK_URL) {
    console.error("CRITICAL: N8N_WEBHOOK_URL is missing in .env.local")
    return NextResponse.json({ error: 'Server Configuration Error: Missing Webhook URL' }, { status: 500 })
  }

  try {
    // 3. Send to n8n
    console.log("Sending request to n8n...")
    
    const n8nResponse = await fetch(process.env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: user.id,
        userEmail: user.email,
        prompt: message,       // The full text prompt
        mode: mode,            // 'image' or 'video'
        imageUrls: imageUrls,  // Array of strings [img1, img2, logo]
        aspectRatio: aspectRatio // "1:1" or "9:16"
      }),
    })

    // 4. Check n8n Response
    const responseText = await n8nResponse.text()
    console.log("n8n Response Status:", n8nResponse.status)
    
    if (!n8nResponse.ok) {
      console.error("n8n Error Body:", responseText)
      throw new Error(`n8n failed with ${n8nResponse.status}: ${responseText}`)
    }

    // Try parsing JSON safely
    let data
    try {
      data = JSON.parse(responseText)
    } catch (e) {
      // If n8n returned plain text (not JSON), handle it gracefully
      console.warn("n8n returned non-JSON text:", responseText)
      data = { taskId: responseText, text: responseText }
    }
    
    return NextResponse.json(data)

  } catch (error: any) {
    console.error('Error in API Route:', error)
    return NextResponse.json(
      { error: error.message || "Internal Server Error" }, 
      { status: 500 }
    )
  }
}