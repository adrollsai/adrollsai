const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyze() {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, facebook_token, ad_account_id, selected_page_token, selected_page_id')
    .eq('email', 'infobluesquareinfra@gmail.com')
    .single();

  const token = profile.facebook_token;
  const adsetId = '120246747062630424'; // D+I under Ananta Targetted | 15-10-2026

  console.log('Fetching ads for adset:', adsetId);
  const adsRes = await fetch(`https://graph.facebook.com/v20.0/${adsetId}/ads?fields=id,name,status,creative{id,name}&limit=50`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const adsData = await adsRes.json();
  console.log('Ads in adset:', adsData.data);

  // Fetch leads for this adset directly or via ads
  console.log('\nFetching leads directly from adset...');
  const leadsRes = await fetch(`https://graph.facebook.com/v20.0/${adsetId}/leads?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data&limit=100`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const leadsData = await leadsRes.json();
  console.log('Leads fetched count:', leadsData.data?.length || 0);

  let metaLeads = leadsData.data || [];

  // If direct adset/leads is empty or needs ad-level query
  if (metaLeads.length === 0 && adsData.data) {
    for (const ad of adsData.data) {
      const adLeadsRes = await fetch(`https://graph.facebook.com/v20.0/${ad.id}/leads?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data&limit=100`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const d = await adLeadsRes.json();
      if (d.data) metaLeads.push(...d.data);
    }
  }

  console.log(`Total Meta leads found: ${metaLeads.length}`);

  const results = [];

  for (const mLead of metaLeads) {
    const fields = {};
    if (mLead.field_data) {
      mLead.field_data.forEach(f => {
        fields[f.name] = f.values?.[0] || '';
      });
    }

    const phoneRaw = fields.phone_number || fields.phone || '';
    const cleanPhone = phoneRaw.replace(/\D/g, '').slice(-10);

    // Find in Supabase leads
    const { data: dbLeads } = await supabaseAdmin
      .from('leads')
      .select('*')
      .or(`facebook_lead_id.eq.${mLead.id},phone.ilike.%${cleanPhone}%`)
      .order('created_at', { ascending: false });

    const dbLead = dbLeads?.[0] || null;

    // Check voice calls table if exists or whatsapp chats
    let voiceCalls = null;
    if (dbLead) {
      const { data: calls } = await supabaseAdmin
        .from('voice_call_logs')
        .select('*')
        .eq('lead_id', dbLead.id);
      voiceCalls = calls;
    }

    // Check whatsapp messages/chats
    let whatsappMessages = null;
    if (dbLead) {
      const { data: chats } = await supabaseAdmin
        .from('chat_messages')
        .select('*')
        .or(`lead_id.eq.${dbLead.id},recipient_phone.ilike.%${cleanPhone}%`)
        .order('created_at', { ascending: true });
      whatsappMessages = chats;
    }

    results.push({
      meta_lead_id: mLead.id,
      created_time: mLead.created_time,
      ad_name: mLead.ad_name,
      adset_name: mLead.adset_name,
      campaign_name: mLead.campaign_name,
      form_fields: fields,
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
        assigned_to: dbLead.assigned_to,
        created_at: dbLead.created_at,
        last_agent_thought: dbLead.last_agent_thought
      } : null,
      voiceCalls,
      whatsappMessagesCount: whatsappMessages?.length || 0,
      whatsappMessages
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

analyze().catch(console.error);
