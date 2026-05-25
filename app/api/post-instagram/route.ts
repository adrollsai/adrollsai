// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/post-instagram/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToInstagram } from '@/utils/external-apis' // <--- NEW IMPORT

export async function POST(request: Request) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve Target User ID
  const url = new URL(request.url);
  const impersonateId = url.searchParams.get('impersonate');
  const { data: ownProfile } = await supabase.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single();
  let targetUserId = user.id;

  if (['admin', 'agent'].includes(ownProfile?.role || '') && (ownProfile?.parent_id || ownProfile?.agency_id)) {
      targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string;
  }

  if (impersonateId && ['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
      if (ownProfile?.role !== 'super_admin') {
          const { data: subAccount } = await supabase.from('profiles').select('id').eq('id', impersonateId).eq('agency_id', user.id).single();
          if (subAccount) targetUserId = impersonateId;
          else return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
      } else {
          targetUserId = impersonateId;
      }
  }

  const body = await request.json()
  const { imageUrl, caption } = body

  // 1. Get Credentials
  const { data: profile } = await supabase
    .from('profiles')
    .select('selected_page_token, selected_page_id')
    .eq('id', targetUserId)
    .single()

  if (!profile?.selected_page_token || !profile?.selected_page_id) {
    return NextResponse.json({ 
      error: 'Target account has no Meta Page/Token selected. Please ensure the client has connected their social accounts.' 
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

    // Log successful post in database
    await supabase.from('posts').insert({
      user_id: targetUserId,
      title: 'Social Post',
      content: caption || '',
      image_url: imageUrl || null,
      status: 'social_published'
    })

    return NextResponse.json({ success: true, id: result.id })

  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: error.message || 'Posting failed' }, { status: 500 })
  }
}