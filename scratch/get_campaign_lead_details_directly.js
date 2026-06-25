const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

const subAccounts = [
    { name: 'Realty Nation', userId: 'c890a11f-84ce-4592-ab8f-8682927b1a9d', campaignId: '120249015633660295' },
    { name: 'GNR Homes', userId: '42d2e0c5-4fe6-4738-8a9f-63f09be01f12', campaignId: '52547215473044' },
    { name: 'The ProEstate', userId: '29937131-1975-4c5f-9b78-e5b28f918d32', campaignId: '120248729046110642' }
];

async function run() {
    for (const acc of subAccounts) {
        console.log(`\n======================================================`);
        console.log(`Leads for Campaign: ${acc.name} (${acc.campaignId})`);
        console.log(`======================================================`);
        
        const { data: p } = await supabaseAdmin
            .from('profiles')
            .select('facebook_token, selected_page_token')
            .eq('id', acc.userId)
            .single();

        if (!p || !p.facebook_token) {
            console.log(`No token for ${acc.name}`);
            continue;
        }

        const token = p.selected_page_token || p.facebook_token;

        // Fetch ads under campaign
        const adsRes = await fetch(`${FB_MARKETING_URL}/${acc.campaignId}/ads?fields=id,name&access_token=${p.facebook_token}`);
        const adsData = await adsRes.json();
        const ads = adsData.data || [];

        for (const ad of ads) {
            const leadsUrl = `${FB_MARKETING_URL}/${ad.id}/leads?fields=id,created_time,field_data,form_id&access_token=${token}`;
            const leadsRes = await fetch(leadsUrl);
            const leadsData = await leadsRes.json();
            const leads = leadsData.data || [];

            for (const lead of leads) {
                let name = 'Unknown', email = '', phone = '';
                lead.field_data?.forEach(field => {
                    const fn = field.name.toLowerCase();
                    const fv = field.values ? field.values[0] : '';
                    if (fn === 'full_name' || fn === 'name') name = fv;
                    else if (fn === 'email') email = fv;
                    else if (fn === 'phone_number' || fn === 'phone' || fn === 'mobile_number') phone = fv;
                });

                // Find in DB
                const { data: dbLead } = await supabaseAdmin
                    .from('leads')
                    .select('id, created_at, status')
                    .eq('facebook_lead_id', lead.id)
                    .maybeSingle();

                console.log(`- Lead FB ID: ${lead.id}`);
                console.log(`  Name: ${name}`);
                console.log(`  Phone: ${phone}`);
                console.log(`  Email: ${email || 'N/A'}`);
                console.log(`  Ad Name: ${ad.name}`);
                console.log(`  FB Created At: ${lead.created_time}`);
                console.log(`  CRM Match: ${dbLead ? `Yes (ID: ${dbLead.id}, Status: ${dbLead.status}, Created in CRM: ${dbLead.created_at})` : 'No ❌'}`);
            }
        }
    }
}

run().catch(console.error);
