// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/chat/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createKieTask } from '@/utils/external-apis'; 

export async function POST(request: Request) {
  console.log("--- API/CHAT DEBUG START ---")
  
  try {
    // 1. Check Auth
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      console.log("Auth Failed: No user")
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Inspect Incoming Data
    const body = await request.json()
    
    // LOGGING EXACTLY WHAT FRONTEND SENT
    console.log("Received Body Keys:", Object.keys(body))
    console.log("User Instructions:", body.userInstructions)
    console.log("Prop Desc:", body.propertyDescription ? "Present" : "Missing")
    console.log("Images Count:", body.imageUrls?.length)
    console.log("Aspect Ratio:", body.aspectRatio)

    // 3. Construct Payload (REPLACING n8n CODE NODE)
    const masterPrompt = `
CONTEXT FROM USER:
"${body.userInstructions || ''}"

PROPERTY DETAILS:
"${body.propertyDescription || ''}"

MANDATORY INCLUSIONS:
- Include the Contact Number: "${body.contactNumber || ''}"
- Include the Brand logo.

design a facebook ad graphic from the provided images, whatever info you see in photos and provided description that is provided, use that, include the contact number, the creative should be attention grabbing and readable, only use the relevant and essential info in the creative, don't clutter it too much, if there is any specific user instruction, give that high priority.
`;

    const payload = {
      "model": "nano-banana-pro",
      "input": {
        "prompt": masterPrompt,
        "image_input": body.imageUrls || [],
        "aspect_ratio": body.aspectRatio || "1:1",
        "resolution": "1K",
        "output_format": "png"
      }
    };
    
    // 4. Send to Kie.ai directly (REPLACING N8N WEBHOOK CALL)
    console.log(`Sending task to Kie.ai...`)
    
    // FIX START: Capture the result object and check if 'error' property exists.
    const kieResult = await createKieTask(payload);

    if ('error' in kieResult) {
      throw new Error(`Kie AI Task creation failed: ${kieResult.error}`)
    }
    
    const taskId = kieResult.taskId;
    // FIX END
    
    // 5. Return taskId for polling
    console.log("--- API/CHAT DEBUG END (Success - Polling Started) ---")
    return NextResponse.json({ taskId })

  } catch (error: any) {
    console.error("!!! API CRASHED !!!")
    console.error(error)
    return NextResponse.json(
      { error: error.message || "Internal Server Error" }, 
      { status: 500 }
    )
  }
}