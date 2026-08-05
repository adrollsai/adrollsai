const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugDuplicates() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram account
  const campaignId = '21a9103d-03ba-41c7-8625-7923b4f792ce'; // Current campaign

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, voice_campaign_id, created_at')
    .eq('user_id', userId);

  console.log(`Total DB Lead Rows for Khushi Ram: ${leads?.length || 0}`);

  const phoneMap = {};
  for (const l of leads || []) {
    if (!l.phone) continue;
    const normPhone = l.phone.replace(/\D/g, '').slice(-10); // last 10 digits
    if (!phoneMap[normPhone]) phoneMap[normPhone] = [];
    phoneMap[normPhone].push(l);
  }

  const uniquePhones = Object.keys(phoneMap);
  console.log(`Total Unique Phone Numbers in DB: ${uniquePhones.length}`);

  // Check current campaign assigned leads
  const campaignLeads = (leads || []).filter(l => l.voice_campaign_id === campaignId);
  console.log(`\nTotal Assigned Rows for current campaign (${campaignId}): ${campaignLeads.length}`);

  const campaignPhoneMap = {};
  for (const l of campaignLeads) {
    if (!l.phone) continue;
    const normPhone = l.phone.replace(/\D/g, '').slice(-10);
    if (!campaignPhoneMap[normPhone]) campaignPhoneMap[normPhone] = [];
    campaignPhoneMap[normPhone].push(l);
  }

  const uniqueCampaignPhones = Object.keys(campaignPhoneMap);
  console.log(`Unique Phone Numbers for current campaign: ${uniqueCampaignPhones.length}`);

  // Find top duplicate phone numbers
  const duplicates = Object.entries(phoneMap).filter(([num, list]) => list.length > 1);
  console.log(`\nPhone numbers with duplicates in DB: ${duplicates.length}`);
  console.log("Top 5 duplicate phone numbers:\n", duplicates.slice(0, 5).map(([num, list]) => ({
    phone: num,
    count: list.length,
    names: list.map(x => x.name)
  })));
}

debugDuplicates();
