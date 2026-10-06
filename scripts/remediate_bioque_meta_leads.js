const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function remediate() {
  const bioqueUserId = '68b55a31-a16d-454d-a20f-11adabf590b0';
  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', bioqueUserId)
    .single();

  if (profErr || !profile) {
    console.error("Profile not found:", profErr);
    process.exit(1);
  }

  const userId = profile.id;
  const pageToken = profile.selected_page_token || profile.facebook_token;
  const pageId = profile.selected_page_id;

  console.log(`Starting remediation for ${profile.business_name || profile.full_name} (${userId})`);
  console.log(`Page ID: ${pageId}`);

  // Fetch all leadgen forms
  let formsUrl = `https://graph.facebook.com/v20.0/${pageId}/leadgen_forms?fields=id,name,status,created_time&limit=100&access_token=${pageToken}`;
  const forms = [];
  while (formsUrl) {
    const r = await fetch(formsUrl);
    const d = await r.json();
    if (d.data) forms.push(...d.data);
    formsUrl = d.paging?.next || null;
  }
  console.log(`Found ${forms.length} leadgen forms on Meta.`);

  // Map of 10-digit phone number -> Meta submission details
  const metaLeadsByPhone = new Map();

  for (const form of forms) {
    let leadsUrl = `https://graph.facebook.com/v20.0/${form.id}/leads?fields=id,created_time,field_data,campaign_name,campaign_id,ad_name,ad_id,adset_name,adset_id&limit=100&access_token=${pageToken}`;
    while (leadsUrl) {
      const res = await fetch(leadsUrl);
      const data = await res.json();
      if (data.data) {
        for (const ml of data.data) {
          let phone = '';
          let name = '';
          ml.field_data?.forEach(f => {
            const fname = f.name.toLowerCase();
            if (fname.includes('phone')) phone = f.values?.[0] || phone;
            if (fname.includes('name')) name = f.values?.[0] || name;
          });
          const cleanPhone = phone.replace(/\D/g, '').slice(-10);
          if (cleanPhone) {
            // Keep the latest submission if multiple
            if (!metaLeadsByPhone.has(cleanPhone)) {
              metaLeadsByPhone.set(cleanPhone, {
                leadgenId: ml.id,
                createdTime: ml.created_time,
                campaignName: ml.campaign_name,
                campaignId: ml.campaign_id,
                adName: ml.ad_name,
                adId: ml.ad_id,
                formName: form.name,
                formId: form.id,
                name: name,
                phone: phone
              });
            }
          }
        }
      }
      leadsUrl = data.paging?.next || null;
    }
  }

  console.log(`Fetched ${metaLeadsByPhone.size} unique Meta lead submissions across all forms.`);

  // Fetch all DB leads for this account
  const { data: dbLeads, error: dbErr } = await supabase
    .from('leads')
    .select('id, name, phone, source, ad_name, campaign_id, form_id, form_name, facebook_lead_id, created_at')
    .eq('user_id', userId);

  if (dbErr) {
    console.error("Error fetching db leads:", dbErr);
    process.exit(1);
  }

  console.log(`Loaded ${dbLeads.length} leads from database for Bioque Estates.`);

  let updatedCount = 0;
  const updatedRecords = [];

  for (const lead of dbLeads) {
    const rawDigits = (lead.phone || '').replace(/\D/g, '').slice(-10);
    if (!rawDigits) continue;

    const metaMatch = metaLeadsByPhone.get(rawDigits);
    if (metaMatch) {
      // Check if lead has misattribution (e.g. WhatsApp Inbound, WhatsApp Ad, or missing Meta details)
      const isMisattributed = 
        lead.source === 'WhatsApp Inbound' || 
        lead.source === 'WhatsApp Ad' || 
        lead.source === 'WhatsApp' ||
        lead.source === 'CSV Import' ||
        !lead.source ||
        lead.ad_name === 'WhatsApp Ad' ||
        !lead.facebook_lead_id ||
        !lead.campaign_id;

      if (isMisattributed) {
        const adCampaignString = [metaMatch.campaignName, metaMatch.adName || metaMatch.formName].filter(Boolean).join(' / ');
        
        const updatePayload = {
          source: 'Facebook Ads',
          ad_name: adCampaignString,
          campaign_id: metaMatch.campaignId,
          form_id: metaMatch.formId,
          form_name: metaMatch.formName,
          facebook_lead_id: metaMatch.leadgenId
        };

        const { error: upErr } = await supabase
          .from('leads')
          .update(updatePayload)
          .eq('id', lead.id);

        if (upErr) {
          console.error(`Failed to update lead ${lead.id} (${lead.name}):`, upErr);
        } else {
          updatedCount++;
          updatedRecords.push({
            id: lead.id,
            name: lead.name,
            phone: lead.phone,
            previousSource: lead.source,
            previousAdName: lead.ad_name,
            newSource: 'Facebook Ads',
            newCampaign: metaMatch.campaignName,
            newAdName: adCampaignString,
            formName: metaMatch.formName
          });

          // Log in lead_history
          await supabase.from('lead_history').insert({
            lead_id: lead.id,
            user_id: userId,
            action_type: 'ATTRIBUTION_FIX',
            performed_by: 'System / Fix Script',
            actor_name: 'Lead Attribution Correction',
            description: `Corrected lead source attribution from "${lead.source}" to "Facebook Ads" (Campaign: ${metaMatch.campaignName}, Form: ${metaMatch.formName}) based on Meta Lead Gen form submission.`,
            details: {
              old_source: lead.source,
              new_source: 'Facebook Ads',
              campaign_id: metaMatch.campaignId,
              campaign_name: metaMatch.campaignName,
              form_id: metaMatch.formId,
              form_name: metaMatch.formName,
              leadgen_id: metaMatch.leadgenId
            }
          });
        }
      }
    }
  }

  console.log(`\n=== REMEDIATION RESULTS ===`);
  console.log(`Total Leads Corrected: ${updatedCount}`);
  console.log(JSON.stringify(updatedRecords, null, 2));
}

remediate().catch(console.error);
