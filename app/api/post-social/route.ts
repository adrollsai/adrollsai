// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/post-social/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToFacebook } from '@/utils/external-apis' // <--- NEW IMPORT

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Get Current User
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve Target User ID
  const url = new URL(request.url);
  const impersonateId = url.searchParams.get('impersonate');
  let targetUserId = user.id;

  if (impersonateId) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (['super_admin', 'agency', 'admin'].includes(profile?.role || '')) {
          if (profile?.role !== 'super_admin') {
              const { data: subAccount } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', impersonateId)
                .eq('agency_id', user.id)
                .single();
              if (subAccount) targetUserId = impersonateId;
              else return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
          } else {
              targetUserId = impersonateId;
          }
      }
  }

  const body = await request.json()
  const { imageUrl, caption } = body

  // 2. GET THE SPECIFIC PAGE TOKEN FROM DB
  const { data: profile } = await supabase
    .from('profiles')
    .select('selected_page_token, selected_page_name')
    .eq('id', targetUserId)
    .single()

  if (!profile?.selected_page_token) {
    return NextResponse.json({ 
      error: 'Target account has no Facebook Page selected. Please ensure the client has connected their Meta account.' 
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