const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const gunheerId = 'ac1d3d22-1c96-462f-b2b5-9bc26ada4bab';
  
  // 1. Get Gunheer profile
  const { data: gunheerProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', gunheerId)
    .single();

  console.log('--- GUNHEER PROFILE ---');
  console.log({
    id: gunheerProfile?.id,
    email: gunheerProfile?.email,
    full_name: gunheerProfile?.full_name,
    role: gunheerProfile?.role,
    parent_id: gunheerProfile?.parent_id,
    agency_id: gunheerProfile?.agency_id,
    custom_pipeline_stages: gunheerProfile?.custom_pipeline_stages
  });

  // 2. Get Bluesquare parent/agency profile if any
  let parentProfile = null;
  if (gunheerProfile?.parent_id) {
    const { data: p } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', gunheerProfile.parent_id)
      .single();
    parentProfile = p;
    console.log('--- PARENT PROFILE ---');
    console.log({
      id: p?.id,
      email: p?.email,
      business_name: p?.business_name,
      custom_pipeline_stages: p?.custom_pipeline_stages
    });
  }

  // 3. Count all leads assigned to Gunheer
  const { count: totalAssigned, error: countErr } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('assigned_to', gunheerId);

  console.log('\n--- TOTAL LEADS ASSIGNED TO GUNHEER ---');
  console.log('Total count:', totalAssigned);

  // 4. Also check if there are leads with user_id = gunheerId or parent_id
  const { count: totalOwned } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', gunheerId);
  console.log('Total leads owned by Gunheer (user_id):', totalOwned);

  // 5. Fetch all leads assigned to Gunheer to inspect stages and remarks
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, name, phone, pipeline_stage, status, created_at, next_followup, notes, custom_fields')
    .eq('assigned_to', gunheerId);

  if (!leads) {
    console.log('No leads returned:', leadsErr);
    return;
  }

  // Count by pipeline_stage / status
  const stageCounts = {};
  let withRemarks = 0;
  let withoutRemarks = 0;
  let dnpCount = 0;

  for (const l of leads) {
    const st = l.pipeline_stage || l.status || '(blank)';
    stageCounts[st] = (stageCounts[st] || 0) + 1;

    let cf = l.custom_fields;
    if (typeof cf === 'string') {
      try { cf = JSON.parse(cf); } catch (e) { cf = {}; }
    }
    const hasRemark = (cf?.last_remark || cf?.last_followup_remark || (l.notes && l.notes.includes('Remark')) || (l.notes && l.notes.includes('Followup')));
    if (hasRemark) {
      withRemarks++;
    } else {
      withoutRemarks++;
    }
    if (l.notes && (l.notes.includes('DNP') || l.notes.includes('Call Not Picked'))) {
      dnpCount++;
    }
  }

  console.log('\n--- STAGE BREAKDOWN FOR GUNHEER ASSIGNED LEADS ---');
  console.log(stageCounts);
  console.log('\nLeads with remarks/followup notes:', withRemarks);
  console.log('Leads without remarks/followup notes:', withoutRemarks);
  console.log('Leads with DNP notes:', dnpCount);

  // Check recent lead_history by Gunheer in the last 7 days
  const { data: recentHistory } = await supabase
    .from('lead_history')
    .select('id, lead_id, action_type, description, created_at')
    .eq('user_id', gunheerId)
    .order('created_at', { ascending: false })
    .limit(20);

  console.log('\n--- GUNHEER RECENT 20 ACTIONS IN LEAD_HISTORY ---');
  console.log(recentHistory);
}

main().catch(console.error);
