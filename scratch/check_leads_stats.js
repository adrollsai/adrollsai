const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

const accounts = [
    {
        name: 'Realty Nation',
        userId: 'c890a11f-84ce-4592-ab8f-8682927b1a9d',
        campaignId: '120249015633660295'
    },
    {
        name: 'GNR Homes',
        userId: '42d2e0c5-4fe6-4738-8a9f-63f09be01f12',
        campaignId: '52547215473044'
    },
    {
        name: 'The ProEstate',
        userId: '29937131-1975-4c5f-9b78-e5b28f918d32',
        campaignId: '120248729046110642'
    }
];

async function run() {
    for (const acc of accounts) {
        console.log(`\n======================================================`);
        console.log(`CHECKING LEADS STATS: ${acc.name}`);
        console.log(`======================================================`);

        // 1. Get profile token
        const { data: p, error: pErr } = await supabaseAdmin
            .from('profiles')
            .select('facebook_token')
            .eq('id', acc.userId)
            .single();

        if (pErr || !p || !p.facebook_token) {
            console.error("❌ Failed to fetch facebook token for profile:", pErr);
            continue;
        }

        const token = p.facebook_token;

        // 2. Count leads in DB
        const { data: leadsData, error: dbErr } = await supabaseAdmin
            .from('leads')
            .select('id, facebook_lead_id, campaign_id')
            .eq('user_id', acc.userId);

        if (dbErr) {
            console.error("❌ DB Leads error:", dbErr);
        } else {
            const allLeads = leadsData || [];
            console.log(`Total Leads in DB for this subaccount: ${allLeads.length}`);
            const campaignLeads = allLeads.filter(l => l.campaign_id === acc.campaignId);
            console.log(`Leads in Database for campaign ${acc.campaignId}: ${campaignLeads.length}`);
            campaignLeads.forEach(l => {
                console.log(`  - Lead ID: ${l.id} | FB Lead ID: ${l.facebook_lead_id}`);
            });
        }

        // 3. Query Meta Campaign Insights
        try {
            const insightsUrl = `${FB_MARKETING_URL}/${acc.campaignId}/insights?fields=spend,impressions,clicks,actions&date_preset=maximum&access_token=${token}`;
            const res = await fetch(insightsUrl);
            const data = await res.json();

            if (data.error) {
                console.error("❌ Meta Insights Error:", data.error.message);
                continue;
            }

            if (data.data && data.data.length > 0) {
                const ins = data.data[0];
                console.log(`Meta Insights: Spend=${ins.spend} | Impressions=${ins.impressions} | Clicks=${ins.clicks}`);
                const actions = ins.actions || [];
                console.log("Actions returned by Meta:");
                actions.forEach(a => {
                    console.log(`  - ${a.action_type}: ${a.value}`);
                });

                // Compute different metrics logic
                const leadAction = actions.find(a => a.action_type === 'lead');
                const leadGroupedAction = actions.find(a => a.action_type === 'onsite_conversion.lead_grouped');

                const leadCount = leadAction ? parseInt(leadAction.value || '0', 10) : 0;
                const leadGroupedCount = leadGroupedAction ? parseInt(leadGroupedAction.value || '0', 10) : 0;

                console.log(`Leads computed by explorer logic (only 'lead'): ${leadCount}`);
                console.log(`Leads computed by stats logic ('lead' + 'onsite_conversion.lead_grouped'): ${leadCount + leadGroupedCount}`);
            } else {
                console.log("Meta Insights: No delivery data (spend = 0)");
            }
        } catch (e) {
            console.error("❌ Fetch Error:", e.message);
        }
    }
}

run().catch(console.error);
