const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const gunheerId = 'ac1d3d22-1c96-462f-b2b5-9bc26ada4bab';

  console.log(`=== RESTORING GUNHEER FRESH LEADS (Mode: ${isDryRun ? 'DRY RUN' : 'LIVE RESTORATION'}) ===\n`);

  // 1. Fetch the 254 transfer entries from 2026-10-01 15:23
  const { data: transfers, error: transferErr } = await supabase
    .from('lead_history')
    .select('id, lead_id, action_type, description, created_at')
    .gte('created_at', '2026-10-01T15:00:00+00:00')
    .lte('created_at', '2026-10-01T16:00:00+00:00')
    .ilike('description', '%Gunheer%');

  if (transferErr || !transfers) {
    console.error('Failed to fetch transfers:', transferErr);
    return;
  }

  const transferIds = transfers.map(t => t.lead_id);
  console.log(`Found ${transferIds.length} transferred leads in the Oct 1 transfer batch.`);

  // 2. Fetch all history entries for these leads AFTER the transfer
  const { data: postHistory } = await supabase
    .from('lead_history')
    .select('lead_id, user_id, action_type, description, created_at')
    .in('lead_id', transferIds)
    .gt('created_at', '2026-10-01T15:24:00+00:00')
    .order('created_at', { ascending: true });

  const postHistoryMap = new Map();
  postHistory?.forEach(h => {
    if (!postHistoryMap.has(h.lead_id)) postHistoryMap.set(h.lead_id, []);
    postHistoryMap.get(h.lead_id).push(h);
  });

  console.log(`Unique leads with post-transfer activity: ${postHistoryMap.size}`);

  // 3. Fetch current status of all 254 leads
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, name, phone, pipeline_stage, status, custom_fields, notes, assigned_to')
    .in('id', transferIds);

  if (leadsErr || !leads) {
    console.error('Failed to fetch leads:', leadsErr);
    return;
  }

  // Untouched leads are those that had NO actions after transfer
  const untouchedLeads = leads.filter(l => !postHistoryMap.has(l.id));
  const touchedLeads = leads.filter(l => postHistoryMap.has(l.id));

  console.log(`Untouched leads count: ${untouchedLeads.length}`);
  console.log(`Touched leads count: ${touchedLeads.length}`);

  // Leads to restore: Untouched leads that are currently sitting in 'Contacted' because of the faulty script
  const leadsToRestore = untouchedLeads.filter(l => l.pipeline_stage === 'Contacted' || l.status === 'Contacted');
  console.log(`\nLeads to restore from 'Contacted' back to 'New Lead' (Fresh): ${leadsToRestore.length}`);

  if (isDryRun) {
    console.log('\n[DRY RUN] Would restore the following leads (showing first 5):');
    leadsToRestore.slice(0, 5).forEach(l => {
      console.log(` - ${l.name} (${l.id}) currently stage: ${l.pipeline_stage}`);
    });
    console.log(`\nDry run complete. Run without --dry-run to apply updates.`);
    return;
  }

  // Execute restore in batches of 50
  const BATCH_SIZE = 50;
  let restoredCount = 0;

  for (let i = 0; i < leadsToRestore.length; i += BATCH_SIZE) {
    const chunk = leadsToRestore.slice(i, i + BATCH_SIZE);
    await Promise.all(chunk.map(async (lead) => {
      let cf = lead.custom_fields || {};
      if (typeof cf === 'string') {
        try { cf = JSON.parse(cf); } catch (e) { cf = {}; }
      }
      if (!cf || typeof cf !== 'object' || Array.isArray(cf)) cf = {};

      cf.pipeline_stage = 'New Lead';
      cf.status = 'New Lead';
      cf.followup_count = 0;
      delete cf.last_remark;
      delete cf.last_followup_remark;
      delete cf.last_followup_at;
      delete cf.last_call_remark;
      delete cf.last_call_dnp;
      delete cf.dnp_count;

      const { error: updErr } = await supabase
        .from('leads')
        .update({
          pipeline_stage: 'New Lead',
          status: 'New Lead',
          custom_fields: cf
        })
        .eq('id', lead.id);

      if (updErr) {
        console.error(`Error updating lead ${lead.id}:`, updErr.message);
      } else {
        restoredCount++;
      }
    }));
    console.log(`Restored batch ${Math.min(i + BATCH_SIZE, leadsToRestore.length)} / ${leadsToRestore.length}...`);
  }

  console.log(`\n✅ Successfully restored ${restoredCount} leads to 'New Lead' (Fresh) for Gunheer!`);

  // Verification: Count Gunheer's current Fresh leads across entire DB
  const { count: freshCount } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('assigned_to', gunheerId)
    .in('pipeline_stage', ['New Lead', 'New', 'fresh', 'uncontacted']);

  console.log(`Gunheer's total Fresh count now: ${freshCount}`);
}

main().catch(console.error);
