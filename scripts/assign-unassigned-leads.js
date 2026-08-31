const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function assignUnassignedLeads() {
  console.log('=== Starting Campaign Lead Assignment to Group Rule Members ===');

  const ownerId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra

  // 1. Fetch Group-Distribution automation rule
  const { data: aut, error: autErr } = await supabase
    .from('automations')
    .select('*')
    .eq('id', '4d5cedf2-aef6-4dea-bb3b-287b5846a79c')
    .single();

  if (autErr || !aut) {
    console.error('Error fetching group automation rule:', autErr);
    return;
  }

  const parsedGroup = JSON.parse(aut.description || '{}');
  const groupMembers = parsedGroup.members || [];
  console.log(`Group: ${parsedGroup.group_name}`);
  console.log(`Members count: ${groupMembers.length}`, groupMembers.map(m => m.name));

  if (groupMembers.length === 0) {
    console.error('No group members found in automation rule!');
    return;
  }

  // 2. Build weighted member sequence
  const weightedPool = [];
  groupMembers.forEach(m => {
    for (let i = 0; i < Math.max(1, m.weight || 1); i++) {
      weightedPool.push(m);
    }
  });

  // 3. Fetch all unassigned leads for Blue Square Infra
  let unassignedLeads = [];
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, phone, email, ad_name, form_name, campaign_id, source, pipeline_stage, status, created_at, custom_fields')
      .eq('user_id', ownerId)
      .is('assigned_to', null)
      .order('created_at', { ascending: false })
      .range(page * 1000, (page + 1) * 1000 - 1);

    if (error || !data || data.length === 0) break;
    unassignedLeads = unassignedLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }

  console.log(`Found ${unassignedLeads.length} unassigned leads.`);

  let poolIdx = 0;
  if (parsedGroup.last_assigned_user_id) {
    const lastIdx = weightedPool.findIndex(m => m.userId === parsedGroup.last_assigned_user_id);
    if (lastIdx !== -1) {
      poolIdx = (lastIdx + 1) % weightedPool.length;
    }
  }

  const memberAssignedCount = {};
  groupMembers.forEach(m => { memberAssignedCount[m.name] = 0; });

  const BATCH_SIZE = 50;
  for (let i = 0; i < unassignedLeads.length; i += BATCH_SIZE) {
    const batch = unassignedLeads.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async (lead) => {
      const selectedMember = weightedPool[poolIdx];
      poolIdx = (poolIdx + 1) % weightedPool.length;

      memberAssignedCount[selectedMember.name] = (memberAssignedCount[selectedMember.name] || 0) + 1;

      // Update lead
      await supabase
        .from('leads')
        .update({
          assigned_to: selectedMember.userId
        })
        .eq('id', lead.id);

      // Log assignment history
      const desc = `Lead automatically assigned to ${selectedMember.name} via Campaign Group Distribution rule (${parsedGroup.group_name})`;
      await supabase
        .from('lead_history')
        .insert({
          lead_id: lead.id,
          user_id: selectedMember.userId,
          action_type: 'ASSIGNMENT',
          performed_by: 'System / Campaign Auto-Assignment',
          actor_name: 'Group Distribution Rule',
          description: desc,
          created_at: new Date().toISOString()
        });
    }));
  }

  // 4. Update last assigned state on automation rule
  const lastSelected = weightedPool[(poolIdx - 1 + weightedPool.length) % weightedPool.length];
  parsedGroup.last_assigned_user_id = lastSelected.userId;
  parsedGroup.last_assigned_user_name = lastSelected.name;
  parsedGroup.last_assigned_at = new Date().toISOString();

  await supabase
    .from('automations')
    .update({ description: JSON.stringify(parsedGroup) })
    .eq('id', aut.id);

  console.log('=== Assignment Complete ===');
  console.log(`Total leads assigned: ${unassignedLeads.length}`);
  console.log('Breakdown per member:', memberAssignedCount);
}

assignUnassignedLeads().catch(console.error);
