const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  // Check the transfer history records around 2026-10-01 15:23
  const { data: transfers } = await supabase
    .from('lead_history')
    .select('id, lead_id, description, created_at')
    .gte('created_at', '2026-10-01T15:00:00+00:00')
    .lte('created_at', '2026-10-01T16:00:00+00:00')
    .ilike('description', '%Gunheer%');

  console.log('Total transfers in that batch:', transfers.length);

  // For the first 10 leads in that batch, check all history records EVER
  for (let i = 0; i < 5; i++) {
    const leadId = transfers[i].lead_id;
    const { data: lead } = await supabase
      .from('leads')
      .select('id, name, pipeline_stage, status, created_at, custom_fields')
      .eq('id', leadId)
      .single();

    const { data: history } = await supabase
      .from('lead_history')
      .select('action_type, description, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: true });

    console.log(`\n--- Lead: ${lead.name} (${lead.id}) Current stage: ${lead.pipeline_stage} ---`);
    console.log('History trace:');
    history.forEach(h => console.log(`  [${h.created_at}] [${h.action_type}] ${h.description}`));
  }
}

run().catch(console.error);
