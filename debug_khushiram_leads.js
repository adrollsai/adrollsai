const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugKhushiRamLeads() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram account

  // 1. Fetch profile details
  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
  console.log("Khushi Ram Profile:", { id: profile.id, email: profile.email, business_name: profile.business_name });

  // 2. Fetch all leads for this user
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, campaign_id, source, custom_fields, created_at')
    .eq('user_id', userId);

  console.log(`\nTotal Leads in DB for Khushi Ram: ${leads?.length || 0}`);
  if (leads && leads.length > 0) {
    console.log("Sample leads:\n", leads.slice(0, 10));

    // Group leads by campaign_id or source
    const byCampaign = {};
    for (const l of leads) {
      const key = l.campaign_id || l.source || 'No Campaign ID';
      byCampaign[key] = (byCampaign[key] || 0) + 1;
    }
    console.log("Leads grouped by campaign_id / source:", byCampaign);
  }

  // 3. Check campaign_jobs or Meta Ad campaigns for this user
  const { data: cJobs } = await supabaseAdmin
    .from('campaign_jobs')
    .select('id, name, status, created_at')
    .eq('user_id', userId);
  console.log(`\nCampaign Jobs in DB (${cJobs?.length || 0}):\n`, cJobs);
}

debugKhushiRamLeads();
