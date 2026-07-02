import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = new URL(request.url);
        const impersonateId = url.searchParams.get('impersonate');

        const { data: currentProfile } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', user.id).single();
        let targetUserId = (['admin', 'agent'].includes(currentProfile?.role || '') && (currentProfile?.agency_id || currentProfile?.parent_id)) 
          ? (currentProfile.agency_id || currentProfile.parent_id) 
          : user.id;

        if (impersonateId && impersonateId !== user.id) {
            if (['super_admin', 'agency', 'admin', 'agent'].includes(currentProfile?.role || '')) {
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

        let since = url.searchParams.get('since');
        if (since && since.includes(' ') && !since.includes('+')) {
            const parts = since.split(' ');
            const lastPart = parts[parts.length - 1];
            if (lastPart.includes(':')) {
                since = parts.slice(0, -1).join(' ') + '+' + lastPart;
            }
        }

        let query = supabaseAdmin
            .from('assets')
            .select('*')
            .eq('user_id', targetUserId);
            
        if (since) {
            query = query.gt('created_at', since);
        }

        const { data: assetData, error: assetError } = await query.order('created_at', { ascending: false });

        if (assetError) {
            throw assetError;
        }

        return NextResponse.json(assetData || []);

    } catch (error: any) {
        console.error("[Assets API] Fetch error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
