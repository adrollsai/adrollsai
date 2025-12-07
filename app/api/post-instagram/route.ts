// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/post-instagram/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToInstagram } from '@/utils/external-apis' // <--- NEW IMPORT

export async function POST(request: Request) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { imageUrl, caption } = body

  // 1. Get Credentials
  const { data: profile } = await supabase
    .from('profiles')
    .select('selected_page_token, selected_page_id')
    .eq('id', user.id)
    .single()

  if (!profile?.selected_page_token || !profile?.selected_page_id) {
    return NextResponse.json({ 
      error: 'No Page selected or token missing. Please go to Profile settings.' 
    }, { status: 400 })
  }

  // 2. Post directly to Instagram (REPLACING N8N WEBHOOK CALL)
  try {
    const result = await postToInstagram(
        profile.selected_page_token,
        profile.selected_page_id,
        imageUrl,
        caption
    );

    return NextResponse.json({ success: true, id: result.id })

  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: error.message || 'Posting failed' }, { status: 500 })
  }
}