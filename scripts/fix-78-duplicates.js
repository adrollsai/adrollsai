const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OWNER_IDS = [
  '2f62a259-f23b-48ee-a920-c436f36eaa4b',
  'd838c956-1761-4bce-9d91-32f3abecc222'
];

async function fixAll78Duplicates() {
  const { data: team } = await supabase.from('profiles').select('id, parent_id, agency_id');
  const blueSquareTeamIds = new Set(OWNER_IDS);
  team?.forEach(t => {
    if (OWNER_IDS.includes(t.parent_id) || OWNER_IDS.includes(t.agency_id) || OWNER_IDS.includes(t.id)) {
      blueSquareTeamIds.add(t.id);
    }
  });

  const teamList = Array.from(blueSquareTeamIds);
  console.log('All Blue Square Workspace User IDs:', teamList);

  let allLeads = [];
  let page = 0;
  const seenIds = new Set();

  while (true) {
    const { data } = await supabase
      .from('leads')
      .select('id, name, phone, notes, status, pipeline_stage, assigned_to, user_id, custom_fields, created_at')
      .in('user_id', teamList)
      .order('id')
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    
    data.forEach(l => {
      if (!seenIds.has(l.id)) {
        seenIds.add(l.id);
        allLeads.push(l);
      }
    });

    page++;
    if (data.length < 1000) break;
  }
  console.log('Total Distinct DB Leads loaded:', allLeads.length);

  // Group by 10-digit phone
  const phoneMap = {};
  allLeads.forEach(l => {
    const p = (l.phone || '').replace(/\D/g, '').slice(-10);
    if (p.length >= 7) {
      if (!phoneMap[p]) phoneMap[p] = [];
      phoneMap[p].push(l);
    }
  });

  const duplicateGroups = Object.entries(phoneMap).filter(([p, list]) => list.length > 1);
  console.log('Actual duplicate phone groups with distinct lead IDs:', duplicateGroups.length);

  let totalDuplicateLeads = 0;
  duplicateGroups.forEach(([p, list]) => totalDuplicateLeads += list.length);
  console.log('Total duplicate lead rows in Analytics:', totalDuplicateLeads);

  const idsToDelete = [];
  const leadsToUpdate = [];

  for (const [phone, group] of duplicateGroups) {
    let best = group[0];
    let bestScore = -1;

    group.forEach(lead => {
      let score = 0;
      const notes = lead.notes || '';
      if (notes.includes('[📝 Followup') || notes.includes('[⚠️ Call Not Picked') || notes.includes('Bhavdeep Singh') || notes.includes('Gunheer')) {
        score += 1000;
      }
      score += notes.length;
      if (lead.user_id === '2f62a259-f23b-48ee-a920-c436f36eaa4b') score += 100;
      if (score > bestScore) {
        bestScore = score;
        best = lead;
      }
    });

    // Merge notes
    let mergedNotes = best.notes || '';
    group.forEach(lead => {
      if (lead.id !== best.id && lead.notes && !mergedNotes.includes(lead.notes.trim())) {
        mergedNotes = (mergedNotes ? mergedNotes + '\n\n' : '') + lead.notes.trim();
      }
    });

    leadsToUpdate.push({
      id: best.id,
      notes: mergedNotes,
      user_id: '2f62a259-f23b-48ee-a920-c436f36eaa4b',
      assigned_to: best.assigned_to
    });

    group.forEach(lead => {
      if (lead.id !== best.id) {
        idsToDelete.push(lead.id);
      }
    });
  }

  console.log(`Deleting ${idsToDelete.length} duplicate copies...`);
  for (let i = 0; i < idsToDelete.length; i += 100) {
    const batch = idsToDelete.slice(i, i + 100);
    const { error } = await supabase.from('leads').delete().in('id', batch);
    if (error) console.error('Delete error:', error);
  }

  console.log(`Updating ${leadsToUpdate.length} retained master leads...`);
  for (let i = 0; i < leadsToUpdate.length; i += 50) {
    const batch = leadsToUpdate.slice(i, i + 50);
    await Promise.all(batch.map(item => {
      return supabase.from('leads').update({
        notes: item.notes,
        user_id: item.user_id
      }).eq('id', item.id);
    }));
  }

  console.log('✅ Merged and purged all duplicate copies across all workspace IDs!');

  // Final verification
  let checkLeads = [];
  page = 0;
  const verifySeenIds = new Set();
  while (true) {
    const { data } = await supabase
      .from('leads')
      .select('id, phone')
      .in('user_id', teamList)
      .order('id')
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach(l => {
      if (!verifySeenIds.has(l.id)) {
        verifySeenIds.add(l.id);
        checkLeads.push(l);
      }
    });
    page++;
    if (data.length < 1000) break;
  }

  const checkMap = {};
  checkLeads.forEach(l => {
    const p = (l.phone || '').replace(/\D/g, '').slice(-10);
    if (p.length >= 7) {
      if (!checkMap[p]) checkMap[p] = [];
      checkMap[p].push(l);
    }
  });
  const remainingDups = Object.entries(checkMap).filter(([p, list]) => list.length > 1);
  console.log('\n=== VERIFICATION ===');
  console.log('Remaining Duplicate Groups in DB:', remainingDups.length);
  console.log('Total Unique Leads in DB:', checkLeads.length);
}

fixAll78Duplicates().catch(console.error);
