// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/post-social/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToFacebook } from '@/utils/external-apis' // <--- NEW IMPORT

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Get Current User
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { imageUrl, caption } = body

  // 2. GET THE SPECIFIC PAGE TOKEN FROM DB
  const { data: profile } = await supabase
    .from('profiles')
    .select('selected_page_token, selected_page_name')
    .eq('id', user.id)
    .single()

  if (!profile?.selected_page_token) {
    return NextResponse.json({ 
      error: 'No Facebook Page selected. Please go to Profile -> Social Accounts and select a page.' 
    }, { status: 400 })
  }

  // 3. Post directly to Facebook (REPLACING N8N WEBHOOK CALL)
  try {
    const result = await postToFacebook(
      profile.selected_page_token,
      imageUrl,
      caption
    );
    
    return NextResponse.json({ success: true, postId: result.id })

  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: error.message || 'Posting failed' }, { status: 500 })
  }
}