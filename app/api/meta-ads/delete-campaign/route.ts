import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const FB_GRAPH_URL = "https://graph.facebook.com/v19.0";

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const { campaignId } = body;
        if (!campaignId) return NextResponse.json({ error: 'Missing Campaign ID' }, { status: 400 });

        const url = new URL(request.url);
        const impersonateId = url.searchParams.get('impersonate');

        const { data: profile } = await supabase.from('profiles').select('role, facebook_token, agency_id, parent_id').eq('id', user.id).single();
        let targetUserId = (['admin', 'agent'].includes(profile?.role || '') && (profile?.agency_id || profile?.parent_id)) 
            ? (profile.agency_id || profile.parent_id) 
            : user.id;

        if (impersonateId && ['super_admin', 'agency', 'admin'].includes(profile?.role || '')) {
            if (profile?.role !== 'super_admin') {
                const isParent = (profile?.agency_id === impersonateId || profile?.parent_id === impersonateId);
                const { data: subAccount } = await supabase
                    .from('profiles')
                    .select('id')
                    .eq('id', impersonateId)
                    .eq('agency_id', profile?.agency_id || user.id)
                    .single();

                if (isParent || subAccount) {
                    targetUserId = impersonateId;
                } else {
                    return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
                }
            } else {
                targetUserId = impersonateId;
            }
        }

        const { data: targetProfile } = await supabase
            .from('profiles')
            .select('facebook_token')
            .eq('id', targetUserId)
            .single();

        let token = targetProfile?.facebook_token;
        if (!token) {
            token = profile?.facebook_token;
        }

        if (!token && (profile?.agency_id || profile?.parent_id)) {
            const { data: parentProfile } = await supabase
                .from('profiles')
                .select('facebook_token')
                .eq('id', profile.agency_id || profile.parent_id)
                .single();
            token = parentProfile?.facebook_token;
        }

        if (!token) {
            return NextResponse.json({ error: 'Meta Ad Account not fully connected.' }, { status: 400 });
        }

        console.log(`[Delete Campaign] Requesting delete for campaign ${campaignId} under target user ${targetUserId}`);

        const fbUrl = `${FB_GRAPH_URL}/${campaignId}?access_token=${token}`;
        const response = await fetch(fbUrl, { method: 'DELETE' });
        const data = await response.json();

        if (data.error) {
            console.error("[Delete Campaign] Meta API Error:", data.error);
            throw new Error(data.error.message || "Failed to delete campaign on Meta");
        }

        return NextResponse.json({ success: true, message: 'Campaign deleted successfully.' });

    } catch (error: any) {
        console.error("[Delete Campaign] Error:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
