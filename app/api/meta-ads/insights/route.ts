import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getOrgAdminCredentials } from '@/utils/org-helper';

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const campaignId = searchParams.get('campaignId');

        if (!campaignId) return NextResponse.json({ error: 'Campaign ID required' }, { status: 400 });

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        // 1. Get Agent Profile
        const { data: profile } = await supabase
            .from('profiles')
            .select('role, organization_id')
            .eq('id', user.id)
            .single();

        if (!profile?.organization_id) return NextResponse.json({ error: 'No Organization Found' }, { status: 400 });

        // 2. Get Admin Token (We need the Admin's token to read insights)
        // Note: Even if the ad account belongs to the org, the token must have permission to read it.
        const creds = await getOrgAdminCredentials(profile.organization_id);
        const accessToken = creds.facebookToken;

        // 3. Fetch Insights from Facebook
        // We request: Spend, Impressions, Clicks, CPC, CTR, and Actions (to find Leads)
        const fields = 'spend,impressions,clicks,cpc,ctr,actions';
        const url = `${FB_MARKETING_URL}/${campaignId}/insights?fields=${fields}&date_preset=maximum&access_token=${accessToken}`;

        const fbRes = await fetch(url);
        const fbData = await fbRes.json();

        if (fbData.error) {
            console.error("FB Insights Error:", fbData.error);
            return NextResponse.json({ error: fbData.error.message }, { status: 500 });
        }

        // 4. Parse Data
        const data = fbData.data && fbData.data.length > 0 ? fbData.data[0] : null;
        
        if (!data) {
             // No data yet (campaign might be new)
             return NextResponse.json({ 
                 insights: { 
                     spend: 0, 
                     impressions: 0, 
                     clicks: 0, 
                     cpc: 0, 
                     ctr: 0, 
                     leads: 0, 
                     cost_per_lead: 0 
                 } 
             });
        }

        // Extract Leads from "actions" array
        const leadAction = data.actions?.find((a: any) => a.action_type === 'lead');
        const leads = leadAction ? parseInt(leadAction.value) : 0;
        const spend = parseFloat(data.spend || '0');

        return NextResponse.json({
            insights: {
                spend: spend,
                impressions: parseInt(data.impressions || '0'),
                clicks: parseInt(data.clicks || '0'),
                cpc: parseFloat(data.cpc || '0'),
                ctr: parseFloat(data.ctr || '0'),
                leads: leads,
                cost_per_lead: leads > 0 ? spend / leads : 0
            }
        });

    } catch (error: any) {
        console.error("Insights API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}