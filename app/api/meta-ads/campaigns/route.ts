import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const isAdminMode = searchParams.get('admin') === 'true';

        const supabase = await createClient();
        
        // 1. Auth Check
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        // 2. Get User's Ad Account ID & Token
        const { data: profile } = await supabase
            .from('profiles')
            .select('ad_account_id, facebook_token')
            .eq('id', user.id)
            .single();

        if (!profile?.ad_account_id || !profile?.facebook_token) {
            return NextResponse.json({ campaigns: [] }); // User hasn't connected FB yet
        }

        // --- NEW LOGIC: ADMIN MAPPING MODE ---
        if (isAdminMode) {
            // Fetch ALL Campaigns directly from Facebook (for the Mapping Dropdown)
            // We want everything: Active, Paused, etc.
            const fbUrl = `${FB_MARKETING_URL}/${profile.ad_account_id}/campaigns?fields=id,name,status,objective&limit=50&access_token=${profile.facebook_token}`;
            
            const fbRes = await fetch(fbUrl);
            const fbData = await fbRes.json();
            
            if (fbData.error) throw new Error(fbData.error.message);

            return NextResponse.json({ campaigns: fbData.data || [] });
        }

        // --- EXISTING LOGIC: AGENT VIEW ---
        // Fetch ONLY this user's campaigns from Supabase (Isolation)
        const { data: myCampaigns } = await supabase
            .from('campaigns')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (!myCampaigns || myCampaigns.length === 0) {
            return NextResponse.json({ campaigns: [] });
        }

        // Enrich with Live Status
        const enrichedCampaigns = await Promise.all(myCampaigns.map(async (camp) => {
            try {
                const res = await fetch(`${FB_MARKETING_URL}/${camp.meta_campaign_id}?fields=status,name,objective&access_token=${profile.facebook_token}`);
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
                return { id: camp.meta_campaign_id, name: camp.name, status: 'ARCHIVED', objective: 'OUTCOME_LEADS' };
            } catch (e) {
                return { id: camp.meta_campaign_id, name: camp.name, status: 'UNKNOWN', objective: 'OUTCOME_LEADS' };
            }
        }));

        return NextResponse.json({ campaigns: enrichedCampaigns.filter(Boolean) });

    } catch (error: any) {
        console.error("Fetch Campaigns Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}