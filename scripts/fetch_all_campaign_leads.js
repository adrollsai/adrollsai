const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAllCampaignLeads() {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, facebook_token')
    .eq('email', 'infobluesquareinfra@gmail.com')
    .single();

  const token = profile.facebook_token;
  const campaignId = '120246747062620424'; // Ananta Targetted | 15-10-2026

  // Fetch campaign leads
  const res = await fetch(`https://graph.facebook.com/v20.0/${campaignId}/leads?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_name,field_data&limit=100&access_token=${token}`);
  const d = await res.json();
  console.log('Campaign-level leads count:', d.data ? d.data.length : d.error);
  
  // Also check all adsets in this campaign
  const adsetsRes = await fetch(`https://graph.facebook.com/v20.0/${campaignId}/adsets?fields=id,name&access_token=${token}`);
  const adsets = await adsetsRes.json();
  console.log('Adsets in campaign:', adsets.data);

  const allLeads = [];
  for (const adset of adsets.data || []) {
    const lRes = await fetch(`https://graph.facebook.com/v20.0/${adset.id}/leads?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_name,field_data&limit=100&access_token=${token}`);
    const lData = await lRes.json();
    console.log(`Adset [${adset.name} (${adset.id})]: leads count = ${lData.data?.length || 0}`);
    if (lData.data) {
      allLeads.push(...lData.data);
    }
  }

  // Also fetch by ads
  const adsRes = await fetch(`https://graph.facebook.com/v20.0/${campaignId}/ads?fields=id,name,adset{id,name}&access_token=${token}`);
  const ads = await adsRes.json();
  for (const ad of ads.data || []) {
    const lRes = await fetch(`https://graph.facebook.com/v20.0/${ad.id}/leads?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_name,field_data&limit=100&access_token=${token}`);
    const lData = await lRes.json();
    console.log(`Ad [${ad.name} in ${ad.adset?.name}]: leads count = ${lData.data?.length || 0}`);
    if (lData.data) {
      for (const l of lData.data) {
        if (!allLeads.some(x => x.id === l.id)) allLeads.push(l);
      }
    }
  }

  console.log(`\nTOTAL UNIQUE LEADS IN CAMPAIGN: ${allLeads.length}`);
  
  // Now for each lead, fetch DB status, calls, followups, team notes
  const detailed = [];
  for (const l of allLeads) {
    const fieldMap = {};
    for (const f of l.field_data || []) {
      fieldMap[f.name] = f.values?.[0] || '';
    }
    const name = fieldMap.full_name || fieldMap.name || 'Unknown';
    const phone = fieldMap.whatsapp_number || fieldMap.phone_number || fieldMap.phone || '';
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);

    // Look in leads table
    let dbLead = null;
    const { data: dbByMeta } = await supabaseAdmin.from('leads').select('*').eq('facebook_lead_id', l.id);
    if (dbByMeta && dbByMeta.length > 0) dbLead = dbByMeta[0];
    if (!dbLead && cleanPhone) {
      const { data: dbByPhone } = await supabaseAdmin.from('leads').select('*').ilike('phone', `%${cleanPhone}%`);
      if (dbByPhone && dbByPhone.length > 0) dbLead = dbByPhone[0];
    }

    // Check assignee profile name
    let assigneeName = null;
    if (dbLead?.assigned_to) {
      const { data: prof } = await supabaseAdmin.from('profiles').select('full_name, email').eq('id', dbLead.assigned_to).single();
      assigneeName = prof?.full_name || prof?.email;
    }

    detailed.push({
      meta_lead_id: l.id,
      created_time: l.created_time,
      adset_name: l.adset_name,
      ad_name: l.ad_name,
      name,
      phone,
      fieldMap,
      dbLead: dbLead ? {
        id: dbLead.id,
        name: dbLead.name,
        phone: dbLead.phone,
        status: dbLead.status,
        pipeline_stage: dbLead.pipeline_stage,
        notes: dbLead.notes,
        custom_fields: dbLead.custom_fields,
        voice_call_status: dbLead.voice_call_status,
        voice_call_summary: dbLead.voice_call_summary,
        voice_call_transcript: dbLead.voice_call_transcript,
        assigned_to: assigneeName,
        created_at: dbLead.created_at
      } : null
    });
  }

  // Print full detailed report
  console.log('\n--- DETAILED LEADS DUMP ---');
  detailed.forEach((d, idx) => {
    console.log(`\n================== LEAD #${idx + 1} ==================`);
    console.log(`Name: ${d.name} | Phone: ${d.phone}`);
    console.log(`Adset: ${d.adset_name} | Ad: ${d.ad_name} | Created: ${d.created_time}`);
    console.log(`Form Data:`, d.fieldMap);
    if (d.dbLead) {
      console.log(`CRM Status: ${d.dbLead.status} | Pipeline: ${d.dbLead.pipeline_stage} | Assignee: ${d.dbLead.assigned_to}`);
      console.log(`CRM Notes:`, d.dbLead.notes);
      const cf = typeof d.dbLead.custom_fields === 'string' ? JSON.parse(d.dbLead.custom_fields || '{}') : (d.dbLead.custom_fields || {});
      console.log(`Last Remark:`, cf.last_followup_remark || cf.last_remark);
      console.log(`Next Action:`, cf.next_action_type, cf.next_action_date, cf.next_action_remark);
      console.log(`Voice Call Status: ${d.dbLead.voice_call_status}`);
      if (d.dbLead.voice_call_summary) console.log(`Voice Summary:`, d.dbLead.voice_call_summary);
      if (d.dbLead.voice_call_transcript && d.dbLead.voice_call_transcript.length > 0) {
        console.log(`Transcript:`, JSON.stringify(d.dbLead.voice_call_transcript, null, 2));
      }
    } else {
      console.log(`CRM Status: NOT FOUND IN CRM`);
    }
  });
}

checkAllCampaignLeads().catch(console.error);
