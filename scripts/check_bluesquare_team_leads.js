const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const gunheerId = 'ac1d3d22-1c96-462f-b2b5-9bc26ada4bab';
  const bluesquareId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

  // 1. Check all team members of Bluesquare
  const { data: team } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .or(`parent_id.eq.${bluesquareId},id.eq.${bluesquareId}`);

  console.log('=== BLUESQUARE TEAM MEMBERS ===');
  console.log(team);

  // 2. Count leads per team member
  console.log('\n=== LEAD COUNTS PER TEAM MEMBER ===');
  for (const m of (team || [])) {
    const { count } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('assigned_to', m.id);
    
    // Also count New Lead stage for each
    const { count: freshCount } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('assigned_to', m.id)
      .in('pipeline_stage', ['New Lead', 'new lead', 'New', 'fresh', 'uncontacted']);

    console.log(`${m.full_name || m.email} (${m.role}): Total = ${count}, New Lead = ${freshCount}`);
  }

  // Also unassigned leads under bluesquare
  const { count: unassignedCount } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', bluesquareId)
    .is('assigned_to', null);
  console.log(`Unassigned (assigned_to IS NULL) under bluesquare: ${unassignedCount}`);

  // 3. Search for recent script runs or transfers in lead_history or git commits
  // Let's check lead_history for any BULK actions or transfers in the last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: bulkHistory } = await supabase
    .from('lead_history')
    .select('*')
    .gte('created_at', sevenDaysAgo)
    .ilike('description', '%transfer%')
    .order('created_at', { ascending: false })
    .limit(20);

  console.log('\n=== RECENT TRANSFERS IN LEAD_HISTORY (Last 7 days) ===');
  console.log(bulkHistory);

  // 4. Check all leads in bluesquare where notes contain 'Gunheer'
  const { data: gunheerNotesLeads, error: gnErr } = await supabase
    .from('leads')
    .select('id, name, assigned_to, pipeline_stage, status, created_at, notes')
    .ilike('notes', '%Gunheer%')
    .limit(100);

  console.log(`\nSample leads with 'Gunheer' in notes: count fetched = ${gunheerNotesLeads?.length}`);
  const assignedDistribution = {};
  for (const l of (gunheerNotesLeads || [])) {
    assignedDistribution[l.assigned_to] = (assignedDistribution[l.assigned_to] || 0) + 1;
  }
  console.log('Assigned distribution of Gunheer-noted leads:', assignedDistribution);
}

run().catch(console.error);
