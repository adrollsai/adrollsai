// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/post-youtube/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToYouTube } from '@/utils/external-apis' // <--- NEW IMPORT

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
  
  // 4. Post directly to YouTube (REPLACING N8N WEBHOOK CALL)
  try {
    const result = await postToYouTube(
        profile.youtube_token,
        videoUrl,
        title || "New Real Estate Listing",
        description ? `${description}\n\n#Shorts #RealEstate` : "#Shorts #RealEstate",
        "public"
    );

    return NextResponse.json({ success: true, videoId: result.id })

  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: error.message || 'Posting failed' }, { status: 500 })
  }
}