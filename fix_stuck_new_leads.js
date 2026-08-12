/**
 * Fix stuck leads: leads with next_followup set but still in "New Lead" / "New" stage
 * should be moved to "Ongoing" for both Harman and Bhavdeep accounts.
 * 
 * This is a one-time data fix script.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ACCOUNTS = [
  { name: 'Harman Bajwa', id: '7ce0408f-b03f-4af8-a32d-852b6c22da2a' },
  { name: 'Bhavdeep Singh', id: '2f62a259-f23b-48ee-a920-c436f36eaa4b' }
];

async function fixStuckLeads() {
  for (const account of ACCOUNTS) {
    console.log(`\n🔍 Checking ${account.name} (${account.id})...`);

    // Find leads that have next_followup set but are still in New Lead/New stage
    // Check both user_id (owner) and assigned_to (agent) since Harman is an agent
    const { data: stuckLeadsOwned, error: err1 } = await supabaseAdmin
      .from('leads')
      .select('id, name, phone, status, pipeline_stage, next_followup, custom_fields')
      .eq('user_id', account.id)
      .not('next_followup', 'is', null)
      .in('pipeline_stage', ['New Lead', 'New', 'new', 'new lead']);

    const { data: stuckLeadsAssigned, error: err2 } = await supabaseAdmin
      .from('leads')
      .select('id, name, phone, status, pipeline_stage, next_followup, custom_fields')
      .eq('assigned_to', account.id)
      .not('next_followup', 'is', null)
      .in('pipeline_stage', ['New Lead', 'New', 'new', 'new lead']);

    if (err1) console.error(`  Error fetching owned leads:`, err1.message);
    if (err2) console.error(`  Error fetching assigned leads:`, err2.message);

    // Also check leads where status = 'New Lead' but pipeline_stage differs
    const { data: statusMismatch } = await supabaseAdmin
      .from('leads')
      .select('id, name, phone, status, pipeline_stage, next_followup, custom_fields')
      .eq('user_id', account.id)
      .not('next_followup', 'is', null)
      .in('status', ['New Lead', 'New', 'new', 'new lead']);

    const { data: statusMismatchAssigned } = await supabaseAdmin
      .from('leads')
      .select('id, name, phone, status, pipeline_stage, next_followup, custom_fields')
      .eq('assigned_to', account.id)
      .not('next_followup', 'is', null)
      .in('status', ['New Lead', 'New', 'new', 'new lead']);

    // Merge all and deduplicate
    const allStuck = new Map();
    for (const lead of [...(stuckLeadsOwned || []), ...(stuckLeadsAssigned || []), ...(statusMismatch || []), ...(statusMismatchAssigned || [])]) {
      allStuck.set(lead.id, lead);
    }

    const stuckLeads = Array.from(allStuck.values());

    if (stuckLeads.length === 0) {
      console.log(`  ✅ No stuck leads found for ${account.name}`);
      continue;
    }

    console.log(`  ⚠️  Found ${stuckLeads.length} stuck leads with next_followup but still in New Lead stage:`);
    
    for (const lead of stuckLeads) {
      console.log(`    - ${lead.name || 'Unnamed'} (${lead.phone || 'no phone'}) | status: "${lead.status}" | pipeline_stage: "${lead.pipeline_stage}" | next_followup: ${lead.next_followup}`);
    }

    // Fix them: move to Ongoing
    const leadIds = stuckLeads.map(l => l.id);

    const { error: updateErr, count } = await supabaseAdmin
      .from('leads')
      .update({ status: 'Ongoing', pipeline_stage: 'Ongoing' })
      .in('id', leadIds)
      .select('id', { count: 'exact', head: true });

    if (updateErr) {
      console.error(`  ❌ Error updating leads for ${account.name}:`, updateErr.message);
    } else {
      console.log(`  ✅ Successfully moved ${leadIds.length} leads to "Ongoing" stage for ${account.name}`);
    }
  }

  console.log('\n🎉 Done! All stuck leads have been fixed.');
}

fixStuckLeads().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
