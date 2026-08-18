import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const CLOUD_RUN_WORKER_URL = process.env.CLOUD_RUN_WORKER_URL || 'https://adrolls-stitcher-worker-805895515412.us-central1.run.app';

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

    // 2. Dispatch to Cloud Run Worker (fire-and-forget — Cloud Run has no timeout)
    // Cloud Run reads credentials from Supabase, posts to all platforms,
    // records the post in DB, and sends a push notification when done.
    const workerPayload = {
      targetUserId,
      imageUrl,
      caption: caption || 'Automated Post via AdRolls AI 🚀',
      type: type || 'image',
      platforms,
    };

    console.log(`[Universal Post] Dispatching async social broadcast for user ${targetUserId} to Cloud Run:`, platforms.join(', '));

    fetch(`${CLOUD_RUN_WORKER_URL}/publish-social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workerPayload),
    }).catch(err => {
      console.error('[Universal Post] Cloud Run dispatch failed:', err.message);
    });

    // 3. Return immediately — Cloud Run handles the rest
    return NextResponse.json({
      success: true,
      status: 'queued',
      message: 'Your post is being published in the background. You\'ll receive a notification when it\'s done.',
      platforms,
    }, { status: 202 });

  } catch (err: any) {
    console.error("[Universal Post Error]:", err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}