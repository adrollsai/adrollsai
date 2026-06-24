const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

async function run() {
    console.log("Starting missing leads synchronization...");
    const targets = [
        '42d2e0c5-4fe6-4738-8a9f-63f09be01f12', // GNR HOMES
        'c890a11f-84ce-4592-ab8f-8682927b1a9d', // Realty Nation
        '29937131-1975-4c5f-9b78-e5b28f918d32'  // The ProEstate
    ];

    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, business_name, facebook_token, selected_page_token, selected_page_id, enable_distribution');

    if (error) {
        console.error("Query Error:", error);
        return;
    }

    const matched = profiles.filter(p => targets.includes(p.id));

    for (const p of matched) {
        console.log(`\n======================================================`);
        console.log(`SYNCING LEADS FOR: ${p.business_name} (${p.id})`);
        console.log(`======================================================`);
        
        const token = p.selected_page_token || p.facebook_token;
        const pageId = p.selected_page_id;
        if (!token || !pageId) {
            console.log("⚠️ Missing tokens/page ID.");
            continue;
        }

        try {
            // Get all lead gen forms for the page
            const formsUrl = `${FB_MARKETING_URL}/${pageId}/leadgen_forms?fields=id,name,status,created_time&limit=25&access_token=${token}`;
            const formsRes = await fetch(formsUrl);
            const formsData = await formsRes.json();

            if (formsData.error) {
                console.error("❌ Failed to fetch forms:", formsData.error.message);
                continue;
            }

            const forms = formsData.data || [];
            console.log(`Found ${forms.length} forms on page.`);

            // Get all existing Facebook lead IDs in our CRM for this user to avoid duplicates
            const { data: dbLeads, error: dbErr } = await supabaseAdmin
                .from('leads')
                .select('facebook_lead_id')
                .eq('user_id', p.id);

            if (dbErr) {
                console.error("❌ Failed to fetch DB leads:", dbErr.message);
                continue;
            }

            const dbLeadIds = new Set(dbLeads.map(l => l.facebook_lead_id).filter(Boolean));
            console.log(`Current CRM database has ${dbLeadIds.size} Facebook lead records for this user.`);

            let syncedCount = 0;

            for (const form of forms) {
                const leadsUrl = `${FB_MARKETING_URL}/${form.id}/leads?fields=id,created_time,field_data&limit=50&access_token=${token}`;
                const leadsRes = await fetch(leadsUrl);
                const leadsData = await leadsRes.json();

                if (leadsData.error) {
                    console.error(`❌ Failed to fetch leads for form ${form.id}:`, leadsData.error.message);
                    continue;
                }

                const fbLeads = leadsData.data || [];
                const missingLeads = fbLeads.filter(l => !dbLeadIds.has(l.id));

                if (missingLeads.length > 0) {
                    console.log(`Form "${form.name}" has ${missingLeads.length} leads missing from CRM.`);

                    for (const lead of missingLeads) {
                        let name = 'Unknown', phone = '', email = '';
                        const customFields = {};
                        
                        lead.field_data?.forEach(field => {
                            if (!field.name || !field.values || field.values.length === 0) return;
                            const fieldName = field.name.toLowerCase();
                            const fieldValue = field.values[0];

                            if (fieldName === 'full_name' || fieldName === 'name') name = fieldValue;
                            else if (fieldName === 'email') email = fieldValue;
                            else if (fieldName === 'phone_number' || fieldName === 'phone' || fieldName === 'mobile_number') phone = fieldValue;
                            else {
                                customFields[field.name] = fieldValue;
                            }
                        });

                        // Insert the lead into CRM
                        const { data: newLead, error: insertError } = await supabaseAdmin
                            .from('leads')
                            .insert({
                                user_id: p.id,
                                name,
                                phone,
                                email,
                                source: 'Facebook Ads',
                                facebook_lead_id: lead.id,
                                facebook_created_at: lead.created_time,
                                form_id: form.id,
                                form_name: form.name,
                                custom_fields: customFields,
                                pipeline_stage: 'New',
                                status: 'active',
                                ad_name: form.name
                            })
                            .select()
                            .single();

                        if (insertError) {
                            console.error(`❌ Failed to insert lead ${lead.id}:`, insertError.message);
                        } else {
                            console.log(`✅ Successfully synced lead: ${name} (ID: ${newLead.id})`);
                            syncedCount++;
                        }
                    }
                }
            }

            console.log(`Sync completed for ${p.business_name}: Synced ${syncedCount} missing leads.`);
        } catch (e) {
            console.error("Error syncing account:", e.message);
        }
    }
}

run().catch(console.error);
