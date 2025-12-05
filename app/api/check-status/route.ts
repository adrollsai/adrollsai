import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export async function POST(request: Request) {
  // 1. Auth Check
  const session = await auth.api.getSession({
      headers: await headers()
  });
  
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Get Task ID
  const body = await request.json()
  const { taskId } = body

  if (!taskId) {
    return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })
  }

  try {
    // 3. Ask Kie.ai
    const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.KIE_API_KEY}`
      }
    })

    if (!response.ok) {
      throw new Error(`Kie API Error: ${response.statusText}`)
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error: any) {
    console.error("Check Status Error:", error)
    return NextResponse.json({ error: 'Failed to check status' }, { status: 500 })
  }
}