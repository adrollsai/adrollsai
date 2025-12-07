// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/check-status/route.ts

import { NextResponse } from 'next/server'

// The check-status route must call Kie.ai directly
export async function POST(request: Request) {
  // 1. Get the Task ID from the frontend
  const body = await request.json()
  const { taskId } = body

  if (!taskId) {
    return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })
  }

  try {
    // 2. Ask Kie.ai: "Is this task done?"
    // We use the KIE_API_KEY from your .env.local file
    const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.KIE_API_KEY}` // <-- Ensure this is still correct
      }
    })

    if (!response.ok) {
      throw new Error(`Kie API Error: ${response.statusText}`)
    }

    const data = await response.json()
    
    // 3. Send the answer back to the frontend
    return NextResponse.json(data)

  } catch (error: any) {
    console.error("Check Status Error:", error)
    return NextResponse.json({ error: 'Failed to check status' }, { status: 500 })
  }
}