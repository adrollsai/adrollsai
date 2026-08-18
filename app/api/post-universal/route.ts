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

    // 2. Offload to Google Cloud Run Worker (0% dependence on Vercel timeouts)
    // Cloud Run runs in the background indefinitely, polls status as long as needed,
    // saves the post in DB, and triggers a web push notification when complete.
    const workerPayload = {
      targetUserId,
      imageUrl,
      caption: caption || 'Automated Post via Nobogent AI 🚀',
      type: type || 'image',
      platforms,
    };

    console.log(`[Universal Post] Offloading async broadcast for user ${targetUserId} to Cloud Run:`, platforms.join(', '));

    // Fire-and-forget to Cloud Run
    fetch(`${CLOUD_RUN_WORKER_URL}/publish-social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workerPayload),
    }).catch(err => {
      console.error('[Universal Post] Cloud Run dispatch error:', err.message);
    });

    // 3. Immediate 202 Accepted response to client (instant UI, no timeout risk)
    return NextResponse.json({
      success: true,
      status: 'queued',
      message: 'Your broadcast has been queued in the background worker. You will receive a push notification once published across all platforms.',
      platforms,
    }, { status: 202 });

  } catch (err: any) {
    console.error("[Universal Post Error]:", err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}