const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: transfers } = await supabase
    .from('lead_history')
    .select('id, lead_id, description, created_at')
    .gte('created_at', '2026-10-01T15:00:00+00:00')
    .lte('created_at', '2026-10-01T16:00:00+00:00')
    .ilike('description', '%Gunheer%');

  const leadIds = transfers.map(t => t.lead_id);

  // Check the lead_history of these leads AFTER the transfer (after 2026-10-01T15:23:07)
  const { data: postTransferHistory } = await supabase
    .from('lead_history')
    .select('*')
    .in('lead_id', leadIds)
    .gt('created_at', '2026-10-01T15:24:00+00:00')
    .order('created_at', { ascending: false });

  console.log(`History entries after transfer on these 254 leads: ${postTransferHistory?.length || 0}`);
  
  // Also check if the leads themselves still have their stage updated
  const { data: contactedLeads } = await supabase
    .from('leads')
    .select('id, name, pipeline_stage, status, notes, custom_fields')
    .in('id', leadIds)
    .eq('pipeline_stage', 'Contacted');

  console.log(`Currently in 'Contacted': ${contactedLeads?.length || 0}`);
  
  console.log('\nSample 5 post-transfer history records:');
  (postTransferHistory || []).slice(0, 10).forEach(h => {
    console.log(`[${h.created_at}] [${h.action_type}] User: ${h.user_id} - ${h.description}`);
  });

  // What about the notes on these Contacted leads?
  console.log('\nSample 3 Contacted leads notes & custom_fields:');
  (contactedLeads || []).slice(0, 3).forEach(l => {
    console.log({
      id: l.id,
      name: l.name,
      stage: l.pipeline_stage,
      status: l.status,
      notes: l.notes ? l.notes.substring(0, 120) : null,
      cf: l.custom_fields
    });
  });
}

run().catch(console.error);
