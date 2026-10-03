const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const gunheerId = 'ac1d3d22-1c96-462f-b2b5-9bc26ada4bab';

  // Find all lead_history around 2026-10-01T15:23:07
  const { data: transfers } = await supabase
    .from('lead_history')
    .select('id, lead_id, description, created_at')
    .gte('created_at', '2026-10-01T15:00:00+00:00')
    .lte('created_at', '2026-10-01T16:00:00+00:00')
    .ilike('description', '%Gunheer%');

  console.log(`Transfers to Gunheer around 2026-10-01 15:23: count = ${transfers?.length}`);

  if (transfers && transfers.length > 0) {
    const leadIds = transfers.map(t => t.lead_id);
    console.log(`Checking current state of these ${leadIds.length} transferred leads...`);

    // Fetch current state of these transferred leads
    const { data: transferredLeads } = await supabase
      .from('leads')
      .select('id, name, assigned_to, pipeline_stage, status, notes, custom_fields')
      .in('id', leadIds);

    const stagesCount = {};
    const assignedCount = {};
    for (const l of (transferredLeads || [])) {
      const st = l.pipeline_stage || l.status || '(blank)';
      stagesCount[st] = (stagesCount[st] || 0) + 1;
      assignedCount[l.assigned_to] = (assignedCount[l.assigned_to] || 0) + 1;
    }
    console.log('Stages of transferred leads now:', stagesCount);
    console.log('Assigned_to of transferred leads now:', assignedCount);
  }
}

run().catch(console.error);
