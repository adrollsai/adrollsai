const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('facebook_token, ad_account_id, selected_page_token')
        .eq('id', userId)
        .single();
        
    if (error || !profile || !profile.facebook_token || !profile.ad_account_id) {
        console.error("Profile or facebook credentials not found:", error);
        return;
    }

    const token = profile.facebook_token;
    const adAccountId = profile.ad_account_id;
    const pageToken = profile.selected_page_token;

    // Fetch all leads from database
    const { data: dbLeads, error: dbErr } = await supabaseAdmin
        .from('leads')
        .select('id, name, email, phone, facebook_lead_id')
        .eq('user_id', userId);

    if (dbErr) {
        console.error("Error fetching DB leads:", dbErr);
        return;
    }

    const dbLeadIds = new Set(dbLeads.map(l => l.facebook_lead_id).filter(Boolean));
    console.log(`Loaded ${dbLeads.length} leads from CRM database (matching ${dbLeadIds.size} unique Facebook lead IDs).`);

    // Fetch campaigns
    const campaignsUrl = `https://graph.facebook.com/v19.0/${adAccountId}/campaigns?fields=id,name,status,effective_status&access_token=${token}`;
    const campaignsRes = await fetch(campaignsUrl);
    const campaignsData = await campaignsRes.json();

    if (campaignsData.error) {
        console.error("Error fetching campaigns:", campaignsData.error);
        return;
    }

    const campaigns = campaignsData.data || [];
    console.log(`Found ${campaigns.length} campaigns in Ad Account.`);

    let totalFbLeads = 0;
    let missingLeads = [];

    for (const c of campaigns) {
        console.log(`Checking Campaign: "${c.name}" (${c.status}/${c.effective_status})...`);
        
        // Fetch ads
        const adsUrl = `https://graph.facebook.com/v19.0/${c.id}/ads?fields=id,name,status&access_token=${token}`;
        const adsRes = await fetch(adsUrl);
        const adsData = await adsRes.json();
        
        const ads = adsData.data || [];
        for (const ad of ads) {
            // Fetch leads for ad
            const adLeadsUrl = `https://graph.facebook.com/v19.0/${ad.id}/leads?fields=id,created_time,field_data,form_id&access_token=${pageToken || token}`;
            const adLeadsRes = await fetch(adLeadsUrl);
            const adLeadsData = await adLeadsRes.json();

            if (adLeadsData.error) {
                // Some ads might not support leads or have errors
                continue;
            }

            const adLeads = adLeadsData.data || [];
            totalFbLeads += adLeads.length;

            for (const lead of adLeads) {
                const exists = dbLeadIds.has(lead.id);
                if (!exists) {
                    let name = 'Unknown', phone = '', email = '';
                    lead.field_data?.forEach(field => {
                        const fieldName = field.name.toLowerCase();
                        const fieldValue = field.values ? field.values[0] : '';
                        if (fieldName === 'full_name' || fieldName === 'name') name = fieldValue;
                        else if (fieldName === 'email') email = fieldValue;
                        else if (fieldName === 'phone_number' || fieldName === 'phone' || fieldName === 'mobile_number') phone = fieldValue;
                    });

                    missingLeads.push({
                        campaignName: c.name,
                        adName: ad.name,
                        leadId: lead.id,
                        createdTime: lead.created_time,
                        name,
                        email,
                        phone,
                        formId: lead.form_id
                    });
                }
            }
        }
    }

    console.log(`\n======================================================`);
    console.log(`Total Leads found on Meta: ${totalFbLeads}`);
    console.log(`Missing Leads in CRM: ${missingLeads.length}`);
    if (missingLeads.length > 0) {
        console.log(JSON.stringify(missingLeads, null, 2));
    } else {
        console.log("No missing Facebook lead ads found in the scanned campaigns!");
    }
}

run().catch(console.error);
