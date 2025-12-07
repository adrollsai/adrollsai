// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/post-linkedin/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToLinkedIn } from '@/utils/external-apis' // <--- NEW IMPORT

export async function POST(request: Request) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { imageUrl, caption } = body

  // 1. Get Token
  const { data: profile } = await supabase
    .from('profiles')
    .select('linkedin_token')
    .eq('id', user.id)
    .single()

  if (!profile?.linkedin_token) {
    return NextResponse.json({ 
      error: 'No LinkedIn account linked. Please go to Profile settings.' 
    }, { status: 400 })
  }

  // 2. Post directly to LinkedIn (REPLACING N8N WEBHOOK CALL)
  try {
    const result = await postToLinkedIn(
        profile.linkedin_token,
        imageUrl,
        caption
    );

    return NextResponse.json({ success: true, id: result.id })

  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: error.message || 'Posting failed' }, { status: 500 })
  }
}