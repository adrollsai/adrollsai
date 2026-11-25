import { NextResponse } from 'next/server';
import { META_GRAPH_URL } from '@/lib/ads/graph-version'
import { classifyMetaError, describeMetaError } from '@/lib/ads/graph-error'
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
        if (ownProfile?.role === 'agent' && (ownProfile?.parent_id || ownProfile?.agency_id)) {
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

        if (!pageId) {
            return NextResponse.json({ forms: [] });
        }

        /**
         * A page-level edge needs a PAGE token.
         *
         * This used to fall back to `facebook_token` — the user token — which Meta refuses
         * with "(#190) This method must be called with a Page Access Token". That read as a
         * permissions failure when the page token on the account was fine, and an agent
         * looking for existing lead forms got a dead end instead of an answer.
         */
        let pageToken = profile?.selected_page_token || null;
        if (!pageToken && profile?.facebook_token) {
            try {
                const exchange = await fetch(
                    `${META_GRAPH_URL}/${pageId}?fields=access_token&access_token=${profile.facebook_token}`
                );
                const exchanged = await exchange.json();
                if (exchanged?.access_token) pageToken = exchanged.access_token;
            } catch {
                /* fall through to the explicit error below */
            }
        }

        if (!pageToken) {
            return NextResponse.json({
                forms: [],
                needsOwnerAction: true,
                error:
                    'No page access token is stored for this Page, and Meta requires one to read lead forms (#190). ' +
                    'Reconnect Facebook from Profile → Connections and grant the Page permission.',
            });
        }

        const metaUrl = `${META_GRAPH_URL}/${pageId}/leadgen_forms?fields=id,name,status,created_time,questions&limit=50&access_token=${pageToken}`;
        const res = await fetch(metaUrl);
        const json = await res.json();

        if (json.error) {
            const described = describeMetaError(json, 'Meta refused to list this Page’s lead forms');
            console.error('Error fetching page lead forms from Meta:', described);
            return NextResponse.json({
                forms: [],
                error: described,
                meta: classifyMetaError(json),
            });
        }

        const forms = (json.data || []).filter((f: any) => f.status === 'ACTIVE' || !f.status);

        return NextResponse.json({ forms });
    } catch (err: any) {
        console.error('Error in page-lead-forms route:', err);
        return NextResponse.json({ forms: [], error: err.message }, { status: 500 });
    }
}
