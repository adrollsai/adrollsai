const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function backfillMissingLeads() {
  const ownerId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', ownerId).single();
  const pageToken = profile.selected_page_token;
  const pageId = profile.selected_page_id;

  // Let's get active automations for assignment
  const { data: automations } = await supabase.from('automations').select('*').eq('user_id', ownerId).eq('is_active', true);
  
  // Target leads to sync/reopen
  const missingFbLeads = [
    {
      fb_id: '1145489671251382',
      form_id: '1602385004210100',
      form_name: 'Anmol Avenue - 12-03-2026-50000',
      name: 'Arvind Kumar',
      phone: '+919780050508',
      email: 'arvindgupta160022@gmail.com',
      created_time: '2026-09-27T17:39:08+00:00',
      ad_name: 'Anmol Avenue - 12-03-2026 / Anmol Avenue -12-03-2026 – Copy',
      campaign_name: 'Anmol Avenue - 12-03-2026',
      campaign_id: '120238351754510424',
      existing_id: '81472b03-c7a2-484b-a8c8-cae6e71c4b8c',
      assigned_to: '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe' // Bhavdeep Singh (Anmol group)
    },
    {
      fb_id: '1736636777600374',
      form_id: '1602385004210100',
      form_name: 'Anmol Avenue - 12-03-2026-50000',
      name: 'Rajkumar Malik',
      phone: '+919417482682',
      email: '',
      created_time: '2026-09-26T11:39:43+00:00',
      ad_name: 'Anmol Avenue - 12-03-2026 / Anmol Avenue -12-03-2026 – Copy',
      campaign_name: 'Anmol Avenue - 12-03-2026',
      campaign_id: '120238351754510424',
      existing_id: '4a51f4e8-f0ae-4f70-92d5-daf26a607236',
      assigned_to: '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe'
    },
    {
      fb_id: '1753800949284805',
      form_id: '1602385004210100',
      form_name: 'Anmol Avenue - 12-03-2026-50000',
      name: 'Sonu',
      phone: '+919416481881',
      email: 'ajitkohardis@gmail.com',
      created_time: '2026-09-25T15:37:44+00:00',
      ad_name: 'Anmol Avenue - 12-03-2026 / Anmol Avenue -12-03-2026 – Copy',
      campaign_name: 'Anmol Avenue - 12-03-2026',
      campaign_id: '120238351754510424',
      existing_id: '7e38116c-79bf-4372-9929-7119ab782d41',
      assigned_to: '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe'
    },
    {
      fb_id: '1112507664795208',
      form_id: '1602385004210100',
      form_name: 'Anmol Avenue - 12-03-2026-50000',
      name: 'Gurpreet Kaur',
      phone: '+919855025225',
      email: '',
      created_time: '2026-09-25T13:21:17+00:00',
      ad_name: 'Anmol Avenue - 12-03-2026 / Anmol Avenue -12-03-2026 – Copy',
      campaign_name: 'Anmol Avenue - 12-03-2026',
      campaign_id: '120238351754510424',
      existing_id: '14a0f65c-d9ff-4e22-9b02-b9da2c9f233e',
      assigned_to: '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe'
    },
    {
      fb_id: '1063218746761828',
      form_id: '1602385004210100',
      form_name: 'Anmol Avenue - 12-03-2026-50000',
      name: 'Shivinder Partap Kaur',
      phone: '+917087614000',
      email: '',
      created_time: '2026-09-24T06:00:54+00:00',
      ad_name: 'Anmol Avenue - 12-03-2026 / Anmol Avenue -12-03-2026 – Copy',
      campaign_name: 'Anmol Avenue - 12-03-2026',
      campaign_id: '120238351754510424',
      existing_id: '75417781-3e34-43db-b19a-fb5e0cc63b01',
      assigned_to: '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe'
    },
    {
      fb_id: '1557671905674074',
      form_id: '1602385004210100',
      form_name: 'Anmol Avenue - 12-03-2026-50000',
      name: 'Raman',
      phone: '+919910104097',
      email: '',
      created_time: '2026-09-24T05:54:30+00:00',
      ad_name: 'Anmol Avenue - 12-03-2026 / Anmol Avenue -12-03-2026 – Copy',
      campaign_name: 'Anmol Avenue - 12-03-2026',
      campaign_id: '120238351754510424',
      existing_id: '6d55d133-7fec-4595-aeba-8c2260a62176',
      assigned_to: '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe'
    }
  ];

  console.log(`Starting backfill for ${missingFbLeads.length} leads...`);

  for (const item of missingFbLeads) {
    const { data: existingLead } = await supabase.from('leads').select('*').eq('id', item.existing_id).single();
    if (!existingLead) {
      console.error(`Existing lead not found for ID: ${item.existing_id}`);
      continue;
    }

    let cf = existingLead.custom_fields || {};
    if (typeof cf === 'string') {
      try { cf = JSON.parse(cf); } catch { cf = {}; }
    }

    if (!cf.original_created_at) {
      cf.original_created_at = existingLead.created_at;
    }

    const currentSource = item.ad_name;
    const reopenedCount = (cf.reopened_count || 0) + 1;
    const previousSources = Array.isArray(cf.reopened_sources) ? cf.reopened_sources : [];
    const updatedSources = [...previousSources, currentSource];

    cf = {
      ...cf,
      is_instant_form: true,
      qualification_completed: true,
      reopened_count: reopenedCount,
      reopened_sources: updatedSources,
      last_reopened_at: item.created_time,
      last_reopened_source: currentSource
    };

    const updatePayload = {
      name: item.name || existingLead.name,
      email: item.email || existingLead.email,
      facebook_lead_id: item.fb_id,
      form_id: item.form_id,
      form_name: item.form_name,
      ad_name: item.ad_name,
      campaign_id: item.campaign_id,
      pipeline_stage: 'New Lead',
      status: 'New Lead',
      assigned_to: item.assigned_to,
      created_at: item.created_time, // Bumps to top of CRM
      custom_fields: cf
    };

    const { error: updErr } = await supabase
      .from('leads')
      .update(updatePayload)
      .eq('id', existingLead.id);

    if (updErr) {
      console.error(`Failed to update lead ${existingLead.id}:`, updErr);
      continue;
    }

    // Insert history
    const reopenDesc = `The lead was reopened from Meta Ads Submission\nLead Name : ${item.name}\nContact no : ${item.phone}\nSource : Facebook Ads\nDetails : ${item.ad_name}\nReopened Count : ${reopenedCount}\nCurrent Stage : New Lead`;
    await supabase.from('lead_history').insert({
      lead_id: existingLead.id,
      user_id: item.assigned_to,
      action_type: 'REOPENED',
      performed_by: 'System / Meta Ads Backfill',
      actor_name: 'Meta Ads',
      description: reopenDesc,
      details: {
        source: 'Facebook Ads',
        ad_name: item.ad_name,
        form_name: item.form_name,
        campaign_id: item.campaign_id,
        reopened_count: reopenedCount,
        all_sources: updatedSources,
        timestamp: new Date().toISOString()
      },
      created_at: new Date().toISOString()
    });

    console.log(`✅ Successfully backfilled & reopened: "${item.name}" (${item.phone}) -> Assigned to Bhavdeep Singh, stage set to "New Lead", created_at set to ${item.created_time}`);
  }

  console.log('\nAll 6 missing leads backfilled successfully!');
}

backfillMissingLeads().catch(console.error);
