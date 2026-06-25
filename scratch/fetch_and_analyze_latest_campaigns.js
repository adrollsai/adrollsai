const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

const subAccounts = [
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

async function fetchLeadsForAd(adId, adName, token) {
    const leadsUrl = `${FB_MARKETING_URL}/${adId}/leads?fields=id,created_time,field_data,form_id&access_token=${token}&limit=100`;
    try {
        const res = await fetch(leadsUrl);
        const json = await res.json();
        if (json.error) {
            console.error(`  Error fetching leads for Ad ${adId}:`, json.error.message);
            return [];
        }
        const leads = json.data || [];
        return leads.map(l => {
            let name = 'Unknown', email = '', phone = '';
            const customFields = {};
            l.field_data?.forEach(field => {
                const fn = field.name.toLowerCase();
                const fv = field.values ? field.values[0] : '';
                if (fn === 'full_name' || fn === 'name') name = fv;
                else if (fn === 'email') email = fv;
                else if (fn === 'phone_number' || fn === 'phone' || fn === 'mobile_number' || fn === 'whatsapp_number') phone = fv;
                else customFields[field.name] = fv;
            });
            return {
                facebook_lead_id: l.id,
                name,
                email,
                phone,
                form_id: l.form_id,
                ad_id: adId,
                ad_name: adName,
                facebook_created_at: l.created_time,
                custom_fields: customFields
            };
        });
    } catch (e) {
        console.error(`  Exception fetching leads for Ad ${adId}:`, e.message);
        return [];
    }
}

async function run() {
    console.log("=== STARTING LATEST CAMPAIGN ANALYSIS & CRM SYNC ===");
    
    for (const acc of subAccounts) {
        console.log(`\n======================================================`);
        console.log(`SUBACCOUNT: ${acc.name}`);
        console.log(`======================================================`);
        
        // 1. Fetch Profile Info
        const { data: profile, error: pError } = await supabaseAdmin
            .from('profiles')
            .select('facebook_token, selected_page_token, selected_page_id, enable_distribution')
            .eq('id', acc.userId)
            .single();
            
        if (pError || !profile) {
            console.error(`❌ Failed to fetch profile for ${acc.name}:`, pError?.message || "No profile data");
            continue;
        }
        
        const userToken = profile.facebook_token;
        const pageToken = profile.selected_page_token || userToken;
        
        if (!userToken) {
            console.error(`❌ No facebook token for ${acc.name}`);
            continue;
        }

        // 2. Fetch Campaign details from Meta
        console.log(`Querying Campaign: ${acc.campaignId} on Facebook...`);
        const campaignUrl = `${FB_MARKETING_URL}/${acc.campaignId}?fields=id,name,status,effective_status,created_time,objective,buying_type&access_token=${userToken}`;
        const campaignRes = await fetch(campaignUrl);
        const campaignData = await campaignRes.json();
        
        if (campaignData.error) {
            console.error(`❌ Meta Campaign Query Error:`, campaignData.error.message);
            continue;
        }
        
        console.log(`Campaign Name: "${campaignData.name}"`);
        console.log(`Status: ${campaignData.status} (Effective: ${campaignData.effective_status})`);
        console.log(`Created Time: ${campaignData.created_time}`);
        console.log(`Objective: ${campaignData.objective}`);

        // 3. Query Insights
        console.log(`Querying Insights for Campaign...`);
        const insightsUrl = `${FB_MARKETING_URL}/${acc.campaignId}/insights?fields=spend,impressions,clicks,actions,inline_link_clicks,ctr,cpc&date_preset=maximum&access_token=${userToken}`;
        const insightsRes = await fetch(insightsUrl);
        const insightsData = await insightsRes.json();
        
        let spend = 0;
        let impressions = 0;
        let clicks = 0;
        let metaLeadsCount = 0;
        let actions = [];
        let ctr = 0;
        let cpc = 0;

        if (insightsData.data && insightsData.data.length > 0) {
            const ins = insightsData.data[0];
            spend = parseFloat(ins.spend || 0);
            impressions = parseInt(ins.impressions || 0);
            clicks = parseInt(ins.clicks || 0);
            ctr = parseFloat(ins.ctr || 0);
            cpc = parseFloat(ins.cpc || 0);
            actions = ins.actions || [];
            
            // Find lead actions
            const leadAction = actions.find(a => a.action_type === 'lead');
            const leadGroupedAction = actions.find(a => a.action_type === 'onsite_conversion.lead_grouped');
            
            // Meta counts leads by 'lead' action or 'onsite_conversion.lead_grouped' (often they are the same or one is subset)
            metaLeadsCount = leadAction ? parseInt(leadAction.value || '0', 10) : 0;
            const groupedCount = leadGroupedAction ? parseInt(leadGroupedAction.value || '0', 10) : 0;
            
            console.log(`Insights Details:`);
            console.log(`  Spend: INR ${spend}`);
            console.log(`  Impressions: ${impressions}`);
            console.log(`  Clicks: ${clicks}`);
            console.log(`  CTR: ${ctr}% | CPC: INR ${cpc}`);
            console.log(`  Meta Leads count (lead action): ${metaLeadsCount}`);
            console.log(`  Meta Leads count (lead_grouped action): ${groupedCount}`);
        } else {
            console.log(`⚠️ No insights data returned by Meta (zero spend or pending).`);
        }

        // 4. Fetch Ads
        console.log(`Querying Ads in Campaign...`);
        const adsUrl = `${FB_MARKETING_URL}/${acc.campaignId}/ads?fields=id,name,status,effective_status&access_token=${userToken}`;
        const adsRes = await fetch(adsUrl);
        const adsData = await adsRes.json();
        const ads = adsData.data || [];
        console.log(`Found ${ads.length} ads:`);
        
        const allMetaLeads = [];
        for (const ad of ads) {
            console.log(`  - Ad: "${ad.name}" (ID: ${ad.id}) | Status: ${ad.effective_status}`);
            const adLeads = await fetchLeadsForAd(ad.id, ad.name, pageToken);
            console.log(`    Fetched ${adLeads.length} leads from Meta API for this Ad.`);
            allMetaLeads.push(...adLeads);
        }
        
        // Deduplicate leads just in case
        const uniqueMetaLeads = [];
        const seenLeadIds = new Set();
        for (const lead of allMetaLeads) {
            if (!seenLeadIds.has(lead.facebook_lead_id)) {
                seenLeadIds.add(lead.facebook_lead_id);
                uniqueMetaLeads.push(lead);
            }
        }
        console.log(`Total unique leads fetched from Meta for this campaign: ${uniqueMetaLeads.length}`);

        // 5. Check CRM Database Status
        const fbLeadIds = uniqueMetaLeads.map(l => l.facebook_lead_id).filter(Boolean);
        let dbLeadsFound = [];
        if (fbLeadIds.length > 0) {
            const { data: queryDbLeads, error: dbError } = await supabaseAdmin
                .from('leads')
                .select('id, name, facebook_lead_id, created_at')
                .in('facebook_lead_id', fbLeadIds);
            if (dbError) {
                console.error("❌ Database query error:", dbError.message);
            } else {
                dbLeadsFound = queryDbLeads || [];
            }
        }
        
        const dbLeadIdsSet = new Set(dbLeadsFound.map(l => l.facebook_lead_id));
        console.log(`Leads already in CRM: ${dbLeadsFound.length} / ${uniqueMetaLeads.length}`);
        
        // 6. Sync if Realty Nation and there are missing leads
        if (acc.name === 'Realty Nation') {
            const missingLeads = uniqueMetaLeads.filter(l => !dbLeadIdsSet.has(l.facebook_lead_id));
            console.log(`Missing leads for Realty Nation to sync: ${missingLeads.length}`);
            
            if (missingLeads.length > 0) {
                // Fetch agents for distribution if enabled
                let agentIds = [];
                let currentAgentIndex = 0;
                if (profile.enable_distribution) {
                    const { data: teamData } = await supabaseAdmin
                        .from('profiles')
                        .select('id')
                        .or(`agency_id.eq.${acc.userId},parent_id.eq.${acc.userId}`)
                        .in('role', ['admin', 'agent'])
                        .neq('id', acc.userId);
            
                    if (teamData && teamData.length > 0) {
                        agentIds = teamData.map(t => t.id);
                        console.log(`  Lead distribution enabled. Pool size: ${agentIds.length} agents.`);
                        
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
                
                let synced = 0;
                for (const lead of missingLeads) {
                    let assignedTo = null;
                    if (agentIds.length > 0) {
                        assignedTo = agentIds[currentAgentIndex];
                        currentAgentIndex = (currentAgentIndex + 1) % agentIds.length;
                    }
                    
                    const { data: newLead, error: insertError } = await supabaseAdmin
                        .from('leads')
                        .insert({
                            user_id: acc.userId,
                            name: lead.name,
                            phone: lead.phone,
                            email: lead.email,
                            source: 'Facebook Ads',
                            facebook_lead_id: lead.facebook_lead_id,
                            facebook_created_at: lead.facebook_created_at,
                            form_id: lead.form_id,
                            form_name: lead.ad_name, // fallback or set as ad_name
                            custom_fields: lead.custom_fields,
                            pipeline_stage: 'New',
                            status: 'New',
                            ad_name: lead.ad_name,
                            assigned_to: assignedTo
                        })
                        .select()
                        .single();
                        
                    if (insertError) {
                        console.error(`  ❌ Failed to sync lead ${lead.facebook_lead_id}:`, insertError.message);
                    } else {
                        console.log(`  ✅ Synced lead: ${lead.name} (CRM ID: ${newLead.id})`);
                        synced++;
                    }
                }
                console.log(`Realty Nation sync completed. Synced ${synced} leads.`);
            } else {
                console.log("All Realty Nation latest campaign leads are already synced in the CRM.");
            }
        }
        
        // 7. Calculate CPL (use greater of meta action lead or uniqueMetaLeads)
        const finalLeadCount = Math.max(metaLeadsCount, uniqueMetaLeads.length);
        const cpl = finalLeadCount > 0 ? (spend / finalLeadCount).toFixed(2) : 'N/A';
        console.log(`Summary metrics for ${acc.name}:`);
        console.log(`  - Total Spend: INR ${spend}`);
        console.log(`  - Total Leads: ${finalLeadCount} (Meta Insights: ${metaLeadsCount}, Fetched: ${uniqueMetaLeads.length})`);
        console.log(`  - Cost Per Lead (CPL): INR ${cpl}`);
    }
}

run().catch(console.error);
