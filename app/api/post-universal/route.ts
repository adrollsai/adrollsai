import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToFacebook, postToInstagram, postToLinkedin } from '@/utils/external-apis'
import { sendPushNotification } from '@/utils/notification-helper'

export const maxDuration = 300

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

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  const userProfile = profile;

  // 3. EXECUTE BACKGROUND DISPATCH (Instant response, zero UI waiting)
  (async () => {
    const results: Record<string, string> = {}
    const promises: Promise<void>[] = []

    const sendToPlatform = async (platform: string, fn: () => Promise<any>) => {
      try {
        await fn()
        results[platform] = 'success'
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown Error'
        console.error(`[Universal Post Background] ${platform} failed:`, errorMessage)
        results[platform] = `Failed: ${errorMessage.substring(0, 100)}...`
      }
    }

    if (platforms.includes('facebook') && userProfile.selected_page_token) {
      promises.push(sendToPlatform('facebook', () => postToFacebook(userProfile.selected_page_token!, imageUrl, caption, type)))
    }
    if (platforms.includes('instagram') && userProfile.selected_page_token && userProfile.selected_page_id) {
      promises.push(sendToPlatform('instagram', () => postToInstagram(userProfile.selected_page_token!, userProfile.selected_page_id!, imageUrl, caption, type)))
    }
    if (platforms.includes('linkedin') && userProfile.linkedin_token && userProfile.linkedin_id) {
      const authorUrn = userProfile.linkedin_urn || `urn:li:person:${userProfile.linkedin_id}`
      promises.push(sendToPlatform('linkedin', () => postToLinkedin(userProfile.linkedin_token!, authorUrn, imageUrl, caption, type)))
    }

    await Promise.all(promises)

    const hasSuccess = Object.values(results).some(val => val === 'success' || val === 'scheduled')
    if (hasSuccess) {
      await supabase.from('posts').insert({
        user_id: targetUserId,
        title: 'Social Post',
        content: caption || '',
        image_url: imageUrl || null,
        status: 'social_published'
      })
    }

    const successCount = Object.values(results).filter(v => v === 'success' || v === 'scheduled').length;
    await sendPushNotification(
      targetUserId,
      `📲 Social Broadcast Published!`,
      `Your media post has been published to ${successCount} platform(s) in the background.`,
      "/dashboard/assets",
      "social_post"
    ).catch(() => {});
  })();

  // Immediate 10ms HTTP response to browser UI
  return NextResponse.json({ 
    success: true, 
    results: { status: 'dispatched_in_background' },
    message: "Social media broadcast scheduled in background successfully!" 
  })
}