const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

async function fetchFacebookLeads(accessToken, pageId) {
    const formsUrl = `${FB_MARKETING_URL}/${pageId}/leadgen_forms?fields=id,name&limit=100&access_token=${accessToken}`;
    const formsRes = await fetch(formsUrl);
    const formsData = await formsRes.json();
    if (formsData.error) throw new Error(formsData.error.message);
    
    const forms = formsData.data || [];
    console.log(`Retrieved ${forms.length} forms from Meta.`);
    
    const allLeads = [];
    for (const form of forms) {
        let nextUrl = `${FB_MARKETING_URL}/${form.id}/leads?fields=id,created_time,field_data,ad_id,ad_name&limit=100&access_token=${accessToken}`;
        let formLeadsCount = 0;
        while (nextUrl) {
            const leadsRes = await fetch(nextUrl);
            const leadsData = await leadsRes.json();
            
            if (leadsData.error) {
                console.error(`Meta Leads Error for form ${form.name}:`, leadsData.error);
                break;
            }

            if (leadsData.data && leadsData.data.length > 0) {
                formLeadsCount += leadsData.data.length;
                leadsData.data.forEach(l => {
                    const customFields = {};
                    let name = 'Unknown', email = '', phone = '';
                    let firstName = '', lastName = '';

                    l.field_data?.forEach(field => {
                        if (!field.name || !field.values || field.values.length === 0) return;
                        const fn = field.name.toLowerCase();
                        const fv = field.values[0];
                        if (fn === 'full_name' || fn === 'name') name = fv;
                        else if (fn === 'first_name') firstName = fv;
                        else if (fn === 'last_name') lastName = fv;
                        else if (fn === 'email') email = fv;
                        else if (fn === 'phone_number' || fn === 'phone' || fn === 'mobile_number' || fn === 'whatsapp_number') phone = fv;
                        else customFields[field.name] = fv;
                    });

                    if (name === 'Unknown' && (firstName || lastName)) {
                        name = `${firstName} ${lastName}`.trim();
                    }

                    const sourceTag = l.ad_name ? `${l.ad_name} | ${form.name}` : form.name;
                    allLeads.push({
                        facebook_lead_id: l.id,
                        name,
                        email,
                        phone,
                        source: 'Facebook Ads',
                        form_id: form.id,
                        form_name: form.name,
                        custom_fields: customFields,
                        ad_name: sourceTag, 
                        facebook_created_at: l.created_time
                    });
                });
            }
            nextUrl = leadsData.paging?.next || null;
        }
        if (formLeadsCount > 0) {
            console.log(`- Form "${form.name}" (${form.id}): fetched ${formLeadsCount} leads from Meta.`);
        }
    }
    return allLeads;
}

async function run() {
    const userId = 'c890a11f-84ce-4592-ab8f-8682927b1a9d'; // Realty Nation
    
    // Get the page token and ID from profiles
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('selected_page_token, selected_page_id, enable_distribution')
        .eq('id', userId)
        .single();
        
    if (error || !profile || !profile.selected_page_token) {
        console.error("Profile or page token not found:", error);
        return;
    }

    const pageId = profile.selected_page_id;
    const token = profile.selected_page_token;

    console.log(`Fetching all leads from Meta for Realty Nation...`);
    const fbLeads = await fetchFacebookLeads(token, pageId);
    console.log(`Total leads fetched from Meta: ${fbLeads.length}`);

    // Query all existing leads from database for this user (using pagination to bypass 1000 limit)
    console.log("Fetching existing leads from CRM database...");
    const dbLeadIds = new Set();
    let start = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data: dbLeads, error: dbErr } = await supabaseAdmin
            .from('leads')
            .select('facebook_lead_id')
            .eq('user_id', userId)
            .range(start, start + step - 1);

        if (dbErr) {
            console.error("Error fetching DB leads:", dbErr);
            return;
        }

        if (dbLeads && dbLeads.length > 0) {
            dbLeads.forEach(l => {
                if (l.facebook_lead_id) dbLeadIds.add(l.facebook_lead_id);
            });
            if (dbLeads.length < step) hasMore = false;
            else start += step;
        } else {
            hasMore = false;
        }
    }
    console.log(`Loaded ${dbLeadIds.size} existing Facebook Lead IDs from CRM database.`);

    const trulyNewLeads = fbLeads.filter(l => !dbLeadIds.has(l.facebook_lead_id));
    console.log(`Truly new leads to sync: ${trulyNewLeads.length}`);

    if (trulyNewLeads.length === 0) {
        console.log("No missing leads to sync.");
        return;
    }

    // Distribute leads if enabled
    let agentIds = [];
    let currentAgentIndex = 0;

    if (profile.enable_distribution) {
        const { data: teamData } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .or(`agency_id.eq.${userId},parent_id.eq.${userId}`)
            .in('role', ['admin', 'agent'])
            .neq('id', userId);

        if (teamData && teamData.length > 0) {
            agentIds = teamData.map(t => t.id);
            console.log(`Distribution pool contains ${agentIds.length} agents.`);

            // Find last assigned agent
            const { data: lastAssignedLead } = await supabaseAdmin
                .from('leads')
                .select('assigned_to')
                .in('assigned_to', agentIds)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            const lastAssignedId = lastAssignedLead?.assigned_to;
            if (lastAssignedId) {
                const lastIdx = agentIds.indexOf(lastAssignedId);
                if (lastIdx !== -1) {
                    currentAgentIndex = (lastIdx + 1) % agentIds.length;
                }
            }
        }
    }

    let syncedCount = 0;
    for (const lead of trulyNewLeads) {
        let assignedTo = null;
        if (agentIds.length > 0) {
            assignedTo = agentIds[currentAgentIndex];
            currentAgentIndex = (currentAgentIndex + 1) % agentIds.length;
        }

        const { data: newLead, error: insertError } = await supabaseAdmin
            .from('leads')
            .insert({
                user_id: userId,
                name: lead.name,
                phone: lead.phone,
                email: lead.email,
                source: lead.source,
                facebook_lead_id: lead.facebook_lead_id,
                facebook_created_at: lead.facebook_created_at,
                form_id: lead.form_id,
                form_name: lead.form_name,
                custom_fields: lead.custom_fields,
                pipeline_stage: 'New',
                status: 'New',
                ad_name: lead.ad_name,
                assigned_to: assignedTo
            })
            .select()
            .single();

        if (insertError) {
            console.error(`❌ Failed to sync lead ${lead.facebook_lead_id}:`, insertError.message);
        } else {
            console.log(`✅ Synced lead: ${lead.name} (ID: ${newLead.id})`);
            syncedCount++;
        }
    }

    console.log(`Sync completed. Successfully synced ${syncedCount} new leads.`);
}

run().catch(console.error);
