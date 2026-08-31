const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OWNER_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
const BHAVDEEP_ID = '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe';

const TEAM_MAP = {
  'bhavdeep': '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe',
  'bhavdeep singh': '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe',
  'amish': 'd9c567eb-1b2d-43bc-bbbc-33e0b8d05e83',
  'amish randev': 'd9c567eb-1b2d-43bc-bbbc-33e0b8d05e83',
  'harman': '7ce0408f-b03f-4af8-a32d-852b6c22da2a',
  'harman bajwa': '7ce0408f-b03f-4af8-a32d-852b6c22da2a',
  'aashish': 'ab87dd53-0bfd-4270-9241-fc84c5a6fd1d',
  'nirvan': 'c481c730-c1a5-480c-9fa3-92a923f7e5f1',
  'rahul juneja': 'a2a09a5e-8a30-4bfa-81f3-53b48a27e8fc',
  'munender': '17cd53d4-fed6-4d71-87c3-ad69ab052553',
  'simran': '7450e6d5-6443-4078-8cbb-0939fc8619ac',
  'harpreet': '30c660c8-9474-43d1-a935-be93b88f05f0',
  'meghna': '399b2252-ebd6-41c6-a70f-c46a005104c5',
  'gunheer': 'ac1d3d22-1c96-462f-b2b5-9bc26ada4bab',
  'shubha': '07db7180-6fac-4055-86ee-8b3748590f56',
  'shubha baweja gulati': '07db7180-6fac-4055-86ee-8b3748590f56'
};

async function cleanAndDeduplicateAll() {
  console.log('=== Step 1: Read Workveu Excel Files ===');
  const dir = 'C:\\Users\\Adrolls\\Downloads\\workveu data new';
  const files = ['1-6000.xlsx', '6001-12000.xlsx', '12001-15697.xlsx'].map(f => path.join(dir, f));

  const excelMap = new Map();
  let totalBhavdeepInExcel = 0;

  files.forEach(f => {
    const wb = XLSX.readFile(f);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    rows.forEach(r => {
      const p = String(r['Contacts'] || '').replace(/\D/g, '').slice(-10);
      if (p.length >= 7) {
        const owner = String(r['Lead Owner'] || r['Owner'] || '').trim().toLowerCase();
        if (owner.includes('bhavdeep') || owner.includes('deep')) {
          totalBhavdeepInExcel++;
        }
        if (!excelMap.has(p)) {
          excelMap.set(p, r);
        }
      }
    });
  });

  console.log(`Total Unique Phones in Excel: ${excelMap.size}`);
  console.log(`Bhavdeep Rows in Excel: ${totalBhavdeepInExcel}`);

  // Fetch all leads from DB
  console.log('\n=== Step 2: Fetch all DB leads for Blue Square ===');
  const { data: team } = await supabase.from('profiles').select('id').or(`parent_id.eq.${OWNER_ID},agency_id.eq.${OWNER_ID},id.eq.${OWNER_ID}`);
  const teamIds = team.map(t => t.id);

  let allDb = [];
  let page = 0;
  while (true) {
    const { data } = await supabase
      .from('leads')
      .select('id, name, phone, notes, status, pipeline_stage, assigned_to, user_id, custom_fields, created_at')
      .in('user_id', teamIds)
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allDb = allDb.concat(data);
    page++;
    if (data.length < 1000) break;
  }
  console.log(`Total DB leads loaded: ${allDb.length}`);

  // Group DB leads by phone
  const phoneGroups = {};
  allDb.forEach(l => {
    const p = (l.phone || '').replace(/\D/g, '').slice(-10);
    const key = p.length >= 7 ? p : 'INVALID_' + l.id;
    if (!phoneGroups[key]) phoneGroups[key] = [];
    phoneGroups[key].push(l);
  });

  const idsToDelete = [];
  const leadsToUpdate = [];

  for (const [phone, group] of Object.entries(phoneGroups)) {
    if (phone.startsWith('INVALID_')) continue;

    const excelRow = excelMap.get(phone);
    const excelOwner = excelRow ? String(excelRow['Lead Owner'] || excelRow['Owner'] || '').trim().toLowerCase() : '';
    const isBhavdeepInExcel = excelOwner.includes('bhavdeep') || excelOwner.includes('deep');

    if (group.length === 1) {
      const single = group[0];
      if (isBhavdeepInExcel && single.assigned_to !== BHAVDEEP_ID) {
        leadsToUpdate.push({ id: single.id, assigned_to: BHAVDEEP_ID });
      }
    } else {
      // Pick the BEST lead to keep
      let best = group[0];
      let bestScore = -1;

      group.forEach(lead => {
        let score = 0;
        const notes = lead.notes || '';
        if (notes.includes('[📝 Followup') || notes.includes('[⚠️ Call Not Picked') || notes.includes('Bhavdeep Singh') || notes.includes('Gunheer')) {
          score += 1000;
        }
        score += notes.length;
        if (isBhavdeepInExcel && lead.assigned_to === BHAVDEEP_ID) {
          score += 500;
        }
        if (score > bestScore) {
          bestScore = score;
          best = lead;
        }
      });

      // Merge any notes from other copies
      let mergedNotes = best.notes || '';
      group.forEach(lead => {
        if (lead.id !== best.id && lead.notes && !mergedNotes.includes(lead.notes.trim())) {
          mergedNotes = (mergedNotes ? mergedNotes + '\n\n' : '') + lead.notes.trim();
        }
      });

      const finalAssignedTo = isBhavdeepInExcel ? BHAVDEEP_ID : (best.assigned_to || (excelOwner ? TEAM_MAP[excelOwner] : null));

      leadsToUpdate.push({
        id: best.id,
        notes: mergedNotes,
        assigned_to: finalAssignedTo
      });

      // Mark duplicate copies for deletion
      group.forEach(lead => {
        if (lead.id !== best.id) {
          idsToDelete.push(lead.id);
        }
      });
    }
  }

  console.log('\n=== Step 3: Executing Deduplication & Assignments ===');
  console.log(`Duplicate rows to delete: ${idsToDelete.length}`);
  console.log(`Leads to update assignment / notes: ${leadsToUpdate.length}`);

  // Delete duplicates in batches of 500
  for (let i = 0; i < idsToDelete.length; i += 500) {
    const batch = idsToDelete.slice(i, i + 500);
    await supabase.from('leads').delete().in('id', batch);
  }
  console.log('✅ Deleted all duplicate extra rows.');

  // Update assignments in batches of 50
  for (let i = 0; i < leadsToUpdate.length; i += 50) {
    const batch = leadsToUpdate.slice(i, i + 50);
    await Promise.all(batch.map(item => {
      const updateData = {};
      if (item.assigned_to) updateData.assigned_to = item.assigned_to;
      if (item.notes) updateData.notes = item.notes;
      return supabase.from('leads').update(updateData).eq('id', item.id);
    }));
  }
  console.log('✅ Updated all lead assignments and notes.');

  // Verify final count
  const { count: finalTotal } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .in('user_id', teamIds);

  const { count: finalBhavdeep } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('assigned_to', BHAVDEEP_ID);

  console.log('\n=== FINAL CLEAN STATE ===');
  console.log(`Total Unique Leads in Blue Square CRM: ${finalTotal}`);
  console.log(`Total Leads Assigned to Bhavdeep Singh: ${finalBhavdeep}`);
}

cleanAndDeduplicateAll().catch(console.error);
