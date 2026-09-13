import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToFacebook, postToInstagram, postToLinkedin } from '@/utils/external-apis'
import { sendPushNotification } from '@/utils/notification-helper'

export const maxDuration = 60 // Allow full execution window for social media video uploads

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

    if (!imageUrl) return NextResponse.json({ error: 'Missing media URL (imageUrl)' }, { status: 400 })
    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return NextResponse.json({ error: 'No social platforms selected' }, { status: 400 })
    }

    // 2. Fetch target account profile credentials
    const { data: profile } = await supabase
      .from('profiles')
      .select('selected_page_token, selected_page_id, selected_page_name, facebook_token, linkedin_token, linkedin_id, linkedin_urn')
      .eq('id', targetUserId)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const fbToken = profile.selected_page_token || profile.facebook_token
    const pageId = profile.selected_page_id

    // Check if at least one selected platform is connected
    const hasFb = platforms.includes('facebook') && !!fbToken
    const hasIg = platforms.includes('instagram') && !!fbToken && !!pageId
    const hasLi = platforms.includes('linkedin') && !!profile.linkedin_token && !!profile.linkedin_id

    if (!hasFb && !hasIg && !hasLi) {
      const missingReason = platforms.map(p => {
        if (p === 'facebook') return !fbToken ? 'Facebook Page not connected' : null
        if (p === 'instagram') return !pageId ? 'Instagram Business Account not linked to Facebook Page' : null
        if (p === 'linkedin') return !profile.linkedin_token ? 'LinkedIn account not connected' : null
        return null
      }).filter(Boolean).join('; ')

      const errorMsg = `No connected accounts found for selected platforms. (${missingReason}). Please connect accounts in Settings.`
      
      await sendPushNotification(
        targetUserId,
        '⚠️ Social Broadcast Cancelled',
        errorMsg,
        '/dashboard/profile',
        'social_post'
      )

      return NextResponse.json({ error: errorMsg }, { status: 400 })
    }

    // 3. Execute broadcasting across selected platforms
    const results: Record<string, string> = {}
    const promises: Promise<void>[] = []

    if (platforms.includes('facebook')) {
      if (fbToken) {
        promises.push(
          postToFacebook(fbToken, imageUrl, caption, type, pageId)
            .then(() => { results.facebook = 'published'; })
            .catch(err => {
              console.error('[Universal Post] Facebook error:', err.message);
              results.facebook = `Failed: ${err.message}`;
            })
        )
      } else {
        results.facebook = 'Skipped: Facebook Page not connected';
      }
    }

    if (platforms.includes('instagram')) {
      if (fbToken && pageId) {
        promises.push(
          postToInstagram(fbToken, pageId, imageUrl, caption, type)
            .then(() => { results.instagram = 'published'; })
            .catch(err => {
              console.error('[Universal Post] Instagram error:', err.message);
              results.instagram = `Failed: ${err.message}`;
            })
        )
      } else {
        results.instagram = `Skipped: ${!fbToken ? 'Facebook token missing' : 'Facebook Page ID missing'}`;
      }
    }

    if (platforms.includes('linkedin')) {
      if (profile.linkedin_token && profile.linkedin_id) {
        const authorUrn = profile.linkedin_urn || `urn:li:person:${profile.linkedin_id}`
        promises.push(
          postToLinkedin(profile.linkedin_token, authorUrn, imageUrl, caption, type)
            .then(() => { results.linkedin = 'published'; })
            .catch(err => {
              console.error('[Universal Post] LinkedIn error:', err.message);
              results.linkedin = `Failed: ${err.message}`;
            })
        )
      } else {
        results.linkedin = 'Skipped: LinkedIn account not connected';
      }
    }

    await Promise.allSettled(promises)

    const succeeded = Object.entries(results).filter(([_, status]) => status === 'published').map(([p]) => p)
    const failed = Object.entries(results).filter(([_, status]) => status.startsWith('Failed:')).map(([p, msg]) => `${p}: ${msg.replace('Failed: ', '')}`)

    // 4. Save published post in posts table
    if (succeeded.length > 0) {
      try {
        await supabase.from('posts').insert({
          user_id: targetUserId,
          title: 'Social Post',
          content: caption || '',
          image_url: imageUrl || null,
          status: 'social_published'
        })
      } catch (insertErr: any) {
        console.warn('[Universal Post] DB Post record insert non-fatal error:', insertErr?.message)
      }
    }

    // 5. Always record in in-app notification center
    let notifTitle = '📲 Social Broadcast Published!'
    let notifBody = `Your post was successfully published to: ${succeeded.join(', ')}.`

    if (failed.length > 0) {
      if (succeeded.length === 0) {
        notifTitle = '⚠️ Social Broadcast Failed'
        notifBody = `Could not publish post to: ${failed.join('; ')}.`
      } else {
        notifTitle = '⚠️ Social Broadcast Partially Published'
        notifBody = `Published to: ${succeeded.join(', ')}. Failed on: ${failed.join('; ')}.`
      }
    }

    await sendPushNotification(
      targetUserId,
      notifTitle,
      notifBody,
      '/dashboard/assets',
      'social_post'
    )

    const hasAnySuccess = succeeded.length > 0

    return NextResponse.json({
      success: hasAnySuccess,
      results,
      succeeded,
      failed,
      message: notifBody,
    }, { status: hasAnySuccess ? 200 : 400 })

  } catch (err: any) {
    console.error("[Universal Post Error]:", err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}