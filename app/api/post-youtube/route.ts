import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()

  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { videoUrl, imageUrl, title, description, type } = body

  // 2. Get YouTube Token
  const { data: profile } = await supabase
    .from('profiles')
    .select('youtube_token')
    .eq('id', user.id)
    .single()

  if (!profile?.youtube_token) {
    return NextResponse.json({ error: 'No YouTube account linked. Go to Profile to connect.' }, { status: 400 })
  }

  // 3. Prepare Payload
  const payload: any = {
    accessToken: profile.youtube_token,
    description: description || "#RealEstate #Shorts",
    privacy: "public"
  }

  if (type === 'image' || imageUrl) {
      // IMAGE MODE -> CONVERT TO SHORT
      // We tell n8n: "Take this image, make it a 15s video, then upload it."
      payload.convertImageToVideo = true
      payload.imageUrl = imageUrl || videoUrl 
      payload.title = title || "New Listing Alert! 🏡"
      // Ensure #Shorts is in the description so YouTube treats it as a Short
      payload.description = `${payload.description}\n\n#Shorts`
      
      console.log("Requesting Image-to-Short Conversion:", payload.imageUrl)
  } else {
      // VIDEO MODE (Native Upload)
      payload.videoUrl = videoUrl
      payload.title = title || "New Real Estate Listing"
      payload.description = description ? `${description}\n\n#Shorts #RealEstate` : "#Shorts #RealEstate"
  }

  // 4. Send to n8n Workflow
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