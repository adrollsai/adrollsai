// adrollsai/adrollsai/adrollsai-adrollsai-bsi/app/api/post-universal/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToFacebook, postToInstagram, postToLinkedin } from '@/utils/external-apis'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Auth Check
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
  const { imageUrl, caption, type, platforms } = body

  // 2. Get User Credentials
  const { data: profile } = await supabase
    .from('profiles')
    .select('selected_page_token, selected_page_id, linkedin_token, linkedin_id, linkedin_urn')
    .eq('id', targetUserId)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const results: Record<string, string> = {}
  const promises: Promise<void>[] = []

  // --- HELPER ---
  const sendToPlatform = async (platform: string, fn: () => Promise<any>) => {
    try {
      await fn()
      results[platform] = 'success'
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown Error'
      console.error(`[Universal Post] ${platform} failed:`, errorMessage)
      results[platform] = `Failed: ${errorMessage.substring(0, 100)}...`
    }
  }

  // --- FACEBOOK ---
  if (platforms.includes('facebook')) {
    if (profile.selected_page_token) {
      promises.push(sendToPlatform('facebook', () => postToFacebook(
        profile.selected_page_token!, 
        imageUrl, 
        caption
      )))
    } else {
      results.facebook = 'skipped_no_token'
    }
  }

  // --- INSTAGRAM ---
  if (platforms.includes('instagram')) {
    if (profile.selected_page_token && profile.selected_page_id) {
      promises.push(sendToPlatform('instagram', () => postToInstagram(
        profile.selected_page_token!, 
        profile.selected_page_id!, 
        imageUrl, 
        caption
      )))
    } else {
      results.instagram = 'skipped_no_token_or_page_id' 
    }
  }

  // --- LINKEDIN ---
  if (platforms.includes('linkedin')) {
    if (profile.linkedin_token && profile.linkedin_id) {
      const authorUrn = profile.linkedin_urn || `urn:li:person:${profile.linkedin_id}`
      promises.push(sendToPlatform('linkedin', () => postToLinkedin(
        profile.linkedin_token!,
        authorUrn,
        imageUrl,
        caption,
        type
      )))
    } else {
      results.linkedin = 'skipped_no_token'
    }
  }

  await Promise.all(promises)

  // Log successful post log if at least one platform dispatch succeeded
  const hasSuccess = Object.values(results).some(val => val === 'success');
  if (hasSuccess) {
    await supabase.from('posts').insert({
      user_id: targetUserId,
      title: 'Social Post',
      content: caption || '',
      image_url: imageUrl || null,
      status: 'social_published'
    })
  }

  return NextResponse.json({ 
    success: true, 
    results,
    message: "Universal post processed" 
  })
}