import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(request: Request) {
    try {
        const { createClient: createAdminClient } = await import('@supabase/supabase-js');
        const supabaseAdmin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        let user = null;
        const mockUserHeader = request.headers.get('X-Mock-User');
        if (mockUserHeader && !process.env.VERCEL) {
            user = { id: mockUserHeader };
        } else {
            const clientSupabase = await createClient();
            const { data: { user: authUser } } = await clientSupabase.auth.getUser();
            user = authUser;
        }

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = new URL(request.url);
        const impersonateId = url.searchParams.get('impersonate');
        let targetUserId = user.id;

        const { data: ownProfile } = await supabaseAdmin.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single();
        if (['admin', 'agent'].includes(ownProfile?.role || '') && (ownProfile?.parent_id || ownProfile?.agency_id)) {
            targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string;
        }
        if (impersonateId && ['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
            targetUserId = impersonateId;
        }

        const { data: profile } = await supabaseAdmin.from('profiles')
            .select('facebook_token, selected_page_id, selected_page_token')
            .eq('id', targetUserId)
            .single();

        const pageId = url.searchParams.get('pageId') || profile?.selected_page_id;
        const pageToken = profile?.selected_page_token || profile?.facebook_token;

        if (!pageId || !pageToken) {
            return NextResponse.json({ forms: [] });
        }

        const metaUrl = `https://graph.facebook.com/v20.0/${pageId}/leadgen_forms?fields=id,name,status,created_time,questions&limit=50&access_token=${pageToken}`;
        const res = await fetch(metaUrl);
        const json = await res.json();

        if (json.error) {
            console.error('Error fetching page lead forms from Meta:', json.error);
            return NextResponse.json({ forms: [], error: json.error.message });
        }

        const forms = (json.data || []).filter((f: any) => f.status === 'ACTIVE' || !f.status);

        return NextResponse.json({ forms });
    } catch (err: any) {
        console.error('Error in page-lead-forms route:', err);
        return NextResponse.json({ forms: [], error: err.message }, { status: 500 });
    }
}
