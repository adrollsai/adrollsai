const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeClean() {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, facebook_token, ad_account_id')
    .eq('email', 'infobluesquareinfra@gmail.com')
    .single();

  const token = profile.facebook_token;
  const adsetId = '120246747062630424'; // D+I

  // Fetch ads
  const adsRes = await fetch(`https://graph.facebook.com/v20.0/${adsetId}/ads?fields=id,name,status&limit=50`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const adsData = await adsRes.json();

  let metaLeads = [];
  for (const ad of adsData.data || []) {
    let url = `https://graph.facebook.com/v20.0/${ad.id}/leads?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data&limit=100&access_token=${token}`;
    while (url) {
      const res = await fetch(url);
      const d = await res.json();
      if (d.data) metaLeads.push(...d.data);
      url = d.paging?.next || null;
    }
  }

  // Also fetch directly from adset if supported
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${adsetId}/leads?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data&limit=100&access_token=${token}`);
    const d = await res.json();
    if (d.data) {
      for (const l of d.data) {
        if (!metaLeads.some(m => m.id === l.id)) metaLeads.push(l);
      }
    }
  } catch (e) {}

  console.log(`Found ${metaLeads.length} leads in Meta for adset D+I.`);

  // Sort by created_time desc
  metaLeads.sort((a, b) => new Date(b.created_time) - new Date(a.created_time));

  const reports = [];

  for (let i = 0; i < metaLeads.length; i++) {
    const ml = metaLeads[i];
    const fieldMap = {};
    for (const f of ml.field_data || []) {
      fieldMap[f.name] = f.values?.[0] || '';
    }

    const name = fieldMap.full_name || fieldMap.name || 'Unknown';
    const phone = fieldMap.whatsapp_number || fieldMap.phone_number || fieldMap.phone || '';
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);

    // Query DB strictly
    let dbLead = null;
    if (ml.id) {
      const { data } = await supabaseAdmin.from('leads').select('*').eq('facebook_lead_id', ml.id);
      if (data && data.length > 0) dbLead = data[0];
    }
    if (!dbLead && cleanPhone) {
      const { data } = await supabaseAdmin.from('leads').select('*').ilike('phone', `%${cleanPhone}%`);
      if (data && data.length > 0) dbLead = data[0];
    }

    reports.push({
      index: i + 1,
      meta_lead_id: ml.id,
      created_time: ml.created_time,
      ad_name: ml.ad_name,
      name,
      phone,
      form_responses: fieldMap,
      in_crm: !!dbLead,
      crm_id: dbLead?.id,
      crm_status: dbLead?.status,
      crm_pipeline_stage: dbLead?.pipeline_stage,
      crm_notes: dbLead?.notes,
      crm_custom_fields: dbLead?.custom_fields ? (typeof dbLead.custom_fields === 'string' ? JSON.parse(dbLead.custom_fields) : dbLead.custom_fields) : null,
      voice_call_status: dbLead?.voice_call_status,
      voice_call_summary: dbLead?.voice_call_summary,
      voice_call_transcript: dbLead?.voice_call_transcript,
      assigned_to: dbLead?.assigned_to
    });
  }

  console.log(JSON.stringify(reports, null, 2));
}

analyzeClean().catch(console.error);
