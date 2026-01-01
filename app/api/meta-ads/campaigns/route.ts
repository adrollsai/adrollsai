import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getOrgAdminCredentials } from '@/utils/org-helper';

// --- FORCE DYNAMIC TO PREVENT CACHING DELETED DATA ---
export const dynamic = 'force-dynamic'; 

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const isAdminMode = searchParams.get('admin') === 'true';

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        // 1. Get User Profile & Role
        const { data: profile } = await supabase
            .from('profiles')
            .select('id, role, organization_id, ad_account_id, facebook_token')
            .eq('id', user.id)
            .single();

        if (!profile) return NextResponse.json({ campaigns: [] });

        // --- MODE A: ADMIN MAPPING (Show All FB Campaigns) ---
        if (isAdminMode) {
            if (!profile.facebook_token || !profile.ad_account_id) return NextResponse.json({ campaigns: [] });
            
            const fbUrl = `${FB_MARKETING_URL}/${profile.ad_account_id}/campaigns?fields=id,name,status,objective&limit=50&access_token=${profile.facebook_token}`;
            const fbRes = await fetch(fbUrl);
            const fbData = await fbRes.json();
            return NextResponse.json({ campaigns: fbData.data || [] });
        }

        // --- MODE B: AGENT DASHBOARD ---
        
        // 2. Fetch the Agent's Campaigns from Supabase
        const { data: myCampaigns } = await supabase
            .from('campaigns')
            .select('*')
            .eq('user_id', user.id)
            .neq('status', 'ARCHIVED') // Filter out archived ones on DB level too
            .order('created_at', { ascending: false });

        if (!myCampaigns || myCampaigns.length === 0) {
            return NextResponse.json({ campaigns: [] });
        }

        // 3. Get Admin Token for Status Check
        let viewerToken = profile.facebook_token;
        if (profile.role === 'agent' && profile.organization_id) {
            try {
                const creds = await getOrgAdminCredentials(profile.organization_id);
                viewerToken = creds.facebookToken;
            } catch (e) {
                // If token fails, just return what we have in DB
                return NextResponse.json({ 
                    campaigns: myCampaigns.map(c => ({ ...c, status: c.status || 'UNKNOWN' })) 
                });
            }
        }

        // 4. Enrich with Live Status
        const enrichedCampaigns = await Promise.all(myCampaigns.map(async (camp) => {
            try {
                const res = await fetch(`${FB_MARKETING_URL}/${camp.meta_campaign_id}?fields=status,name,objective&access_token=${viewerToken}`);
                const metaData = await res.json();
                
                if (metaData.id) {
                    return {
                        id: camp.meta_campaign_id, 
                        name: camp.name,
                        status: metaData.status, 
                        objective: metaData.objective || 'OUTCOME_LEADS',
                        db_id: camp.id 
                    };
                }
                
                // If FB returns error, it's likely deleted on FB.
                // We should mark it ARCHIVED in our DB so we don't fetch it again.
                await supabase.from('campaigns').update({ status: 'ARCHIVED' }).eq('id', camp.id);
                return null; // Filter this out below

            } catch (e) {
                return { id: camp.meta_campaign_id, name: camp.name, status: 'UNKNOWN', objective: 'OUTCOME_LEADS' };
            }
        }));

        // Filter out nulls (deleted campaigns)
        return NextResponse.json({ campaigns: enrichedCampaigns.filter(Boolean) });

    } catch (error: any) {
        console.error("Fetch Campaigns Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}