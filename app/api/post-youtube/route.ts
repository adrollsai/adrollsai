import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()

  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { videoUrl, title, description, type } = body

  // 2. Validation: Video Only
  if (type !== 'video' || !videoUrl) {
      return NextResponse.json({ error: 'YouTube uploads are strictly for video content.' }, { status: 400 })
  }

  // 3. Get YouTube Token
  const { data: profile } = await supabase
    .from('profiles')
    .select('youtube_token')
    .eq('id', user.id)
    .single()

  if (!profile?.youtube_token) {
    return NextResponse.json({ error: 'No YouTube account linked. Go to Profile to connect.' }, { status: 400 })
  }

  // 4. Prepare Payload (Direct Video Upload)
  const payload = {
    accessToken: profile.youtube_token,
    videoUrl: videoUrl,
    title: title || "New Real Estate Listing",
    description: description ? `${description}\n\n#Shorts #RealEstate` : "#Shorts #RealEstate",
    privacy: "public"
  }

  // 5. Send to n8n Workflow
  try {
    const n8nResponse = await fetch(process.env.N8N_YOUTUBE_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!n8nResponse.ok) {
      const text = await n8nResponse.text()
      throw new Error(`n8n error: ${text}`)
    }

    const result = await n8nResponse.json()
    return NextResponse.json(result)

  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: error.message || 'Posting failed' }, { status: 500 })
  }
}