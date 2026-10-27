const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // 1. All Bluesquare profiles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, business_name, role, voice_twilio_number, voice_provider, business_info')
    .or('business_name.ilike.%bluesquare%,email.ilike.%bluesquare%');

  console.log('=== BLUESQUARE PROFILES ===');
  profiles.forEach(p => {
    console.log(`ID: ${p.id} | Email: ${p.email} | Name: ${p.business_name} | Role: ${p.role} | Provider: ${p.voice_provider}`);
    if (p.business_info) {
      console.log('Business Info:', JSON.stringify(p.business_info));
    }
  });

  const blueSquareUserIds = profiles.map(p => p.id);

  // 2. Check voice campaigns across all users or bluesquare users
  const { data: allVoiceCampaigns } = await supabase
    .from('voice_campaigns')
    .select('*')
    .order('created_at', { ascending: false });

  console.log(`\n=== ALL VOICE CAMPAIGNS (${allVoiceCampaigns?.length || 0}) ===`);
  allVoiceCampaigns?.forEach(c => {
    console.log(`ID: ${c.id} | Name: ${c.name} | Status: ${c.status} | User: ${c.user_id} | Created: ${c.created_at}`);
    console.log('Audience Filter:', JSON.stringify(c.audience_filter));
  });

  // 3. Check leads for all bluesquare user IDs
  const { data: bsLeads, error: lErr } = await supabase
    .from('leads')
    .select('id, name, phone, pipeline_stage, source, voice_campaign_id, voice_call_status, voice_call_retry_count, voice_call_summary, voice_call_scheduled_at, voice_recording_url, created_at, user_id, assigned_to')
    .in('user_id', blueSquareUserIds);

  console.log(`\n=== TOTAL LEADS UNDER BLUESQUARE USER IDS: ${bsLeads?.length || 0} ===`);
  if (bsLeads && bsLeads.length > 0) {
    const statusMap = {};
    bsLeads.forEach(l => {
      const s = l.voice_call_status || 'null';
      statusMap[s] = (statusMap[s] || 0) + 1;
    });
    console.log('Status map:', statusMap);

    const withCampaign = bsLeads.filter(l => l.voice_campaign_id);
    console.log(`Leads with voice_campaign_id: ${withCampaign.length}`);
    if (withCampaign.length > 0) {
      const campMap = {};
      withCampaign.forEach(l => {
        campMap[l.voice_campaign_id] = (campMap[l.voice_campaign_id] || 0) + 1;
      });
      console.log('Campaign map:', campMap);
    }
  }

  // 4. Also check ANY leads in the entire database that have voice_call_status or voice_campaign_id or were updated/called yesterday
  const { data: recentCalledLeads } = await supabase
    .from('leads')
    .select('id, name, phone, user_id, assigned_to, voice_campaign_id, voice_call_status, voice_call_summary, voice_call_scheduled_at, voice_recording_url, created_at')
    .not('voice_call_status', 'is', null)
    .limit(100);

  console.log(`\n=== LEADS WITH NON-NULL voice_call_status IN DB (${recentCalledLeads?.length || 0}) ===`);
  const statusSummary = {};
  recentCalledLeads?.forEach(l => {
    statusSummary[l.voice_call_status] = (statusSummary[l.voice_call_status] || 0) + 1;
  });
  console.log('Status summary across all DB:', statusSummary);

  // Group by user_id
  const userMap = {};
  recentCalledLeads?.forEach(l => {
    userMap[l.user_id] = (userMap[l.user_id] || 0) + 1;
  });
  console.log('User ID breakdown for called leads:', userMap);

  // 5. Let's check lead_history for any call events yesterday (2026-10-24)
  const { data: historyEvents, error: hErr } = await supabase
    .from('lead_history')
    .select('*')
    .gte('created_at', '2026-10-24T00:00:00Z')
    .lte('created_at', '2026-10-25T00:00:00Z')
    .order('created_at', { ascending: false })
    .limit(50);

  console.log(`\n=== LEAD HISTORY EVENTS ON 2026-10-24 (${historyEvents?.length || 0}) ===`);
  const actionCounts = {};
  historyEvents?.forEach(h => {
    actionCounts[h.action_type] = (actionCounts[h.action_type] || 0) + 1;
  });
  console.log('Action type breakdown on 2026-10-24:', actionCounts);
  if (historyEvents && historyEvents.length > 0) {
    console.log('Sample history events:');
    historyEvents.slice(0, 5).forEach(h => {
      console.log(`- [${h.created_at}] [user: ${h.user_id}] ${h.action_type}: ${h.description?.slice(0, 100)}`);
    });
  }
}

main().catch(console.error);
