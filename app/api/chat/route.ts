import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  try {
    // 1. Auth Check
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 2. Parse Input
    const body = await request.json()
    const { 
      userInstructions, 
      propertyDescription, 
      contactNumber, 
      imageUrls, 
      aspectRatio 
    } = body

    // 3. Construct the Prompt (Logic ported from n8n)
    const masterPrompt = `
CONTEXT FROM USER:
"${userInstructions || ''}"

PROPERTY DETAILS:
"${propertyDescription || ''}"

MANDATORY INCLUSIONS:
- Include the Contact Number: "${contactNumber || ''}"
- Include the Brand logo.

design a facebook ad graphic from the provided images, whatever info you see in photos and provided description that is provided, use that, include the contact number, the creative should be attention grabbing and readable, only use the relevant and essential info in the creative, don't clutter it too much, if there is any specific user instruction, give that high priority.
`

    // 4. Prepare Kie.ai Payload
    // Ensure we have at least one image if possible, or undefined if empty
    const finalImages = (imageUrls && imageUrls.length > 0) ? imageUrls : undefined

    const payload = {
      model: "nano-banana-pro",
      input: {
        prompt: masterPrompt,
        image_input: finalImages,
        aspect_ratio: aspectRatio || "1:1",
        resolution: "1K",
        output_format: "png"
      }
    }

    // 5. Call Kie.ai to START the job
    const kieResponse = await fetch('https://api.kie.ai/api/v1/jobs/createTask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.KIE_API_KEY}`
      },
      body: JSON.stringify(payload)
    })

    if (!kieResponse.ok) {
      const errText = await kieResponse.text()
      throw new Error(`Kie.ai Error: ${errText}`)
    }

    const kieData = await kieResponse.json()

    // 6. Return the Task ID to Frontend
    // The frontend will now automatically poll /api/check-status
    return NextResponse.json({ 
      success: true, 
      taskId: kieData.data.taskId 
    })

  } catch (error: any) {
    console.error("Generate Error:", error)
    return NextResponse.json({ error: error.message || 'Generation failed' }, { status: 500 })
  }
}