import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/utils/supabase/server';
import { syncVideoTasksForUser } from '@/utils/video-sync-helper';

export async function POST(request: Request) {
    console.log("[Sync Endpoint] Proactive task synchronization initiated.");

    try {
        // 1. Authenticate user
        const supabase = await createServerClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Parse impersonate ID from request URL
        const url = new URL(request.url);
        const impersonateId = url.searchParams.get('impersonate');

        const { data: currentProfile } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', user.id).single();
        let targetUserId = (['admin', 'agent'].includes(currentProfile?.role || '') && (currentProfile?.agency_id || currentProfile?.parent_id)) 
          ? (currentProfile.agency_id || currentProfile.parent_id) 
          : user.id;

        if (impersonateId) {
            if (['super_admin', 'agency', 'admin'].includes(currentProfile?.role || '')) {
                if (currentProfile?.role !== 'super_admin') {
                    const isParent = (currentProfile?.agency_id === impersonateId || currentProfile?.parent_id === impersonateId);
                    const { data: subAccount } = await supabase
                      .from('profiles')
                      .select('id')
                      .eq('id', impersonateId)
                      .eq('agency_id', currentProfile?.agency_id || user.id)
                      .single();

                    if (isParent || subAccount) {
                        targetUserId = impersonateId;
                    } else {
                        return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
                    }
                } else {
                    targetUserId = impersonateId;
                }
            } else {
                return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
            }
        }

        const forwardedHost = request.headers.get('x-forwarded-host');
        const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
        const requestOrigin = new URL(request.url).origin;
        let baseUrl = requestOrigin;
        if (forwardedHost && !forwardedHost.includes('localhost')) {
            baseUrl = `${forwardedProto}://${forwardedHost}`;
        } else if (!requestOrigin.includes('localhost')) {
            baseUrl = requestOrigin;
        }

        const result = await syncVideoTasksForUser(targetUserId, baseUrl);
        return NextResponse.json(result);

    } catch (error: any) {
        console.error("[Sync Endpoint] Fatal error during synchronization:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
