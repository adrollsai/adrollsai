import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToFacebook, postToInstagram, postToLinkedin } from '@/utils/external-apis'
import { sendPushNotification } from '@/utils/notification-helper'

export const maxDuration = 300

const CLOUD_RUN_WORKER_URL = process.env.CLOUD_RUN_WORKER_URL || 'https://adrolls-stitcher-worker-805895515412.us-central1.run.app/publish-social';

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

    const workerPayload = { targetUserId, imageUrl, caption, type, platforms };

    // 2. OPTION A: QUEUE VIA UPSTASH QSTASH (Guaranteed queue, rate limiting & automatic retries)
    const qstashToken = process.env.QSTASH_TOKEN;
    if (qstashToken) {
      try {
        console.log(`[Post Universal] Queueing social post via Upstash QStash for user: ${targetUserId}`);
        const qstashPublishUrl = `https://qstash.upstash.io/v2/publish/${CLOUD_RUN_WORKER_URL}`;
        const qstashRes = await fetch(qstashPublishUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${qstashToken}`,
            'Content-Type': 'application/json',
            'Upstash-Retries': '3'
          },
          body: JSON.stringify(workerPayload)
        });

        if (qstashRes.ok) {
          return NextResponse.json({
            success: true,
            status: 'queued',
            message: 'Social broadcast queued in QStash message queue! Your posts are publishing asynchronously in the background.'
          }, { status: 202 });
        }
      } catch (qstashErr: any) {
        console.warn("[Post Universal] QStash publishing error, falling back to direct Cloud Run worker:", qstashErr?.message);
      }
    }

    // 3. OPTION B: DIRECT DISPATCH TO CLOUD RUN WORKER (Scale-ready, 0 Vercel limits)
    try {
      console.log(`[Post Universal] Dispatching async social post payload directly to Cloud Run worker for user: ${targetUserId}`);
      const workerRes = await fetch(CLOUD_RUN_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workerPayload)
      });

      if (workerRes.status === 202 || workerRes.ok) {
        return NextResponse.json({
          success: true,
          status: 'queued',
          message: 'Social broadcast dispatched to Cloud Run background worker! Your posts are publishing asynchronously.'
        }, { status: 202 });
      }
    } catch (workerError: any) {
      console.warn("[Post Universal] Cloud Run worker dispatch warning, continuing with fallback execution:", workerError?.message);
    }

    // 4. FALLBACK: Synchronous Serverless Execution
    const { data: profile } = await supabase
      .from('profiles')
      .select('selected_page_token, selected_page_id, linkedin_token, linkedin_id, linkedin_urn')
      .eq('id', targetUserId)
      .single()

    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    const userProfile = profile;

    const results: Record<string, string> = {}
    const promises: Promise<void>[] = []

    const sendToPlatform = async (platform: string, fn: () => Promise<any>) => {
      try {
        const res = await fn()
        results[platform] = res?.status || 'success'
      } catch (error: any) {
        const errorMessage = error.message || 'Unknown Error'
        console.error(`[Universal Post Fallback] ${platform} failed:`, errorMessage)
        results[platform] = `Failed: ${errorMessage.substring(0, 150)}`
      }
    }

    if (platforms.includes('facebook') && userProfile.selected_page_token) {
      promises.push(sendToPlatform('facebook', () => postToFacebook(userProfile.selected_page_token!, imageUrl, caption, type, userProfile.selected_page_id || undefined)))
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
      try {
        await supabase.from('posts').insert({
          user_id: targetUserId,
          title: 'Social Post',
          content: caption || '',
          image_url: imageUrl || null,
          status: 'social_published'
        })
      } catch (insertErr) {
        console.error("[Universal Post Fallback] Insert post record error:", insertErr)
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