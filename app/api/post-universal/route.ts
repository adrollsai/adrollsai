import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToFacebook, postToInstagram, postToLinkedin } from '@/utils/external-apis'
import { sendPushNotification } from '@/utils/notification-helper'

export const maxDuration = 300

export async function POST(request: Request) {
  try {
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

    if (!imageUrl) return NextResponse.json({ error: 'Missing imageUrl' }, { status: 400 })
    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json({ error: 'No social platforms selected' }, { status: 400 })
    }

    // 2. Get User Credentials
    const { data: profile } = await supabase
      .from('profiles')
      .select('selected_page_token, selected_page_id, linkedin_token, linkedin_id, linkedin_urn')
      .eq('id', targetUserId)
      .single()

    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    const userProfile = profile;

    // 3. EXECUTE SYNCHRONOUS PUBLISHING (Awaited to ensure Vercel serverless execution does not freeze)
    const results: Record<string, string> = {}
    const promises: Promise<void>[] = []

    const sendToPlatform = async (platform: string, fn: () => Promise<any>) => {
      try {
        const res = await fn()
        results[platform] = res?.status || 'success'
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown Error'
        console.error(`[Universal Post] ${platform} failed:`, errorMessage)
        results[platform] = `Failed: ${errorMessage.substring(0, 150)}`
      }
    }

    if (platforms.includes('facebook')) {
      if (userProfile.selected_page_token) {
        promises.push(sendToPlatform('facebook', () => postToFacebook(userProfile.selected_page_token!, imageUrl, caption, type, userProfile.selected_page_id || undefined)))
      } else {
        results.facebook = 'Failed: Facebook Page Access Token missing in profile.'
      }
    }

    if (platforms.includes('instagram')) {
      if (userProfile.selected_page_token && userProfile.selected_page_id) {
        promises.push(sendToPlatform('instagram', () => postToInstagram(userProfile.selected_page_token!, userProfile.selected_page_id!, imageUrl, caption, type)))
      } else {
        results.instagram = 'Failed: Facebook/Instagram Page connection missing in profile.'
      }
    }

    if (platforms.includes('linkedin')) {
      if (userProfile.linkedin_token && userProfile.linkedin_id) {
        const authorUrn = userProfile.linkedin_urn || `urn:li:person:${userProfile.linkedin_id}`
        promises.push(sendToPlatform('linkedin', () => postToLinkedin(userProfile.linkedin_token!, authorUrn, imageUrl, caption, type)))
      } else {
        results.linkedin = 'Failed: LinkedIn account connection missing in profile.'
      }
    }

    await Promise.all(promises)

    const hasSuccess = Object.values(results).some(val => val === 'success' || val === 'scheduled')
    if (hasSuccess) {
      try {
        await supabase.from('posts').insert({
          user_id: targetUserId,
          title: 'Social Post',
          content: caption || '',
          image_url: imageUrl || null,
          status: 'social_published'
        })
      } catch (insertErr) {
        console.error("[Universal Post] Insert post record error:", insertErr)
      }
    }

    const successCount = Object.values(results).filter(v => v === 'success' || v === 'scheduled').length;
    await sendPushNotification(
      targetUserId,
      `📲 Social Broadcast Published!`,
      `Your media post has been published to ${successCount} platform(s).`,
      "/dashboard/assets",
      "social_post"
    ).catch(() => {});

    return NextResponse.json({ 
      success: hasSuccess, 
      results,
      message: `Social media broadcast finished! Published to ${successCount} platform(s).` 
    })
  } catch (err: any) {
    console.error("[Universal Post Error]:", err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}