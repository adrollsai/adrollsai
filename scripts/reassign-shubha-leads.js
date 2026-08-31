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
const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';
const SIMRAN_ID = '7450e6d5-6443-4078-8cbb-0939fc8619ac';

const STAGE_MAP = {
  'new lead': 'New Lead',
  'new': 'New Lead',
  'requirement taken': 'Requirement Taken',
  'visit planned': 'Visit Planned',
  'visit done': 'Visit Done',
  'revisit done': 'Revisit Done',
  'meeting planned': 'Meeting Planned',
  'meeting done': 'Meeting Done',
  'never picked': 'Never Picked',
  'lost/ni': 'Lost/NI',
  'dealer': 'Dealer',
  'plan postponed': 'Plan Postponed',
  'already purchased': 'Already Purchased',
  'different requirement': 'Different Requirement',
  'negotiation': 'Negotiation',
  'deal/token': 'Deal/Token'
};

async function executeShubhaTransfer() {
  console.log('=== Step 1: Read Workveu Master Files ===');
  const dir = 'C:\\Users\\Adrolls\\Downloads\\workveu data new';
  const files = ['1-6000.xlsx', '6001-12000.xlsx', '12001-15697.xlsx'].map(f => path.join(dir, f));

  const excelRows = [];
  files.forEach(file => {
    const wb = XLSX.readFile(file);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    excelRows.push(...rows);
  });
  console.log(`Read ${excelRows.length} Excel rows.`);

  const excelPhoneMap = new Map();
  excelRows.forEach(r => {
    const p = String(r['Contacts'] || '').replace(/\D/g, '').slice(-10);
    if (p.length >= 7) excelPhoneMap.set(p, r);
  });

  console.log('\n=== Step 2: Fetch all DB leads for Blue Square ===');
  const { data: team } = await supabase.from('profiles').select('id, full_name, email').or('parent_id.eq.' + OWNER_ID + ',agency_id.eq.' + OWNER_ID + ',id.eq.' + OWNER_ID);
  const teamIds = team.map(t => t.id);

  let allDbLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').in('user_id', teamIds).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allDbLeads = allDbLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }
  console.log(`Total DB leads fetched: ${allDbLeads.length}`);

  const dbPhoneMap = new Map();
  allDbLeads.forEach(l => {
    const p = (l.phone || '').replace(/\D/g, '').slice(-10);
    if (p.length >= 7) dbPhoneMap.set(p, l);
  });

  // Step 3: Identify 516 leads to transfer to Shubha
  console.log('\n=== Step 3: Identify leads to transfer to Shubha ===');
  const toShubhaUpdates = [];

  excelPhoneMap.forEach((r, phone) => {
    const owner = String(r['Lead Owner'] || r['Owner'] || '').trim().toLowerCase();
    if (owner.includes('shubha')) {
      const dbLead = dbPhoneMap.get(phone);
      if (dbLead) {
        const rawStage = String(r['Lead Status'] || r['Status'] || 'New Lead').trim();
        let targetStage = STAGE_MAP[rawStage.toLowerCase()] || rawStage;

        // If lead is New Lead but has followups/remarks, promote to Contacted
        const notes = dbLead.notes || '';
        const hasFollowups = notes.includes('[📝') || notes.includes('[⚠️') || notes.includes('[Last Remarks]') || Number(r['Followup Taken'] || 0) > 0;
        if (targetStage === 'New Lead' && hasFollowups) {
          targetStage = 'Contacted';
        }

        let cf = dbLead.custom_fields || {};
        if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) { cf = {}; } }
        delete cf.next_action_date;
        delete cf.next_action_type;
        delete cf.next_followup;

        toShubhaUpdates.push({
          id: dbLead.id,
          assigned_to: SHUBHA_ID,
          pipeline_stage: targetStage,
          status: targetStage,
          next_followup: null,
          custom_fields: cf
        });
      }
    }
  });

  console.log(`Total Shubha Workveu leads identified for assignment: ${toShubhaUpdates.length}`);

  // Step 4: Transfer 66 Simran leads back to Simran
  console.log('\n=== Step 4: Transfer Simran leads back to Simran ===');
  const toSimranLeadIds = [];
  allDbLeads.forEach(l => {
    if (l.assigned_to === SHUBHA_ID) {
      const p = (l.phone || '').replace(/\D/g, '').slice(-10);
      const ex = excelPhoneMap.get(p);
      if (ex) {
        const exOwner = String(ex['Lead Owner'] || ex['Owner'] || '').trim().toLowerCase();
        if (exOwner.includes('simran')) {
          toSimranLeadIds.push(l.id);
        }
      }
    }
  });

  if (toSimranLeadIds.length > 0) {
    for (let i = 0; i < toSimranLeadIds.length; i += 50) {
      const chunk = toSimranLeadIds.slice(i, i + 50);
      await supabase.from('leads').update({ assigned_to: SIMRAN_ID }).in('id', chunk);
    }
    console.log(`✅ Returned ${toSimranLeadIds.length} leads to Simran.`);
  }

  // Step 5: Fast Parallel Updates to Shubha
  console.log('\n=== Step 5: Executing Shubha Assignments in Parallel Chunks ===');
  const CHUNK_SIZE = 50;
  for (let i = 0; i < toShubhaUpdates.length; i += CHUNK_SIZE) {
    const chunk = toShubhaUpdates.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map(u => 
      supabase.from('leads').update({
        assigned_to: u.assigned_to,
        pipeline_stage: u.pipeline_stage,
        status: u.status,
        next_followup: u.next_followup,
        custom_fields: u.custom_fields
      }).eq('id', u.id)
    ));
    process.stdout.write(`Updated ${Math.min(i + CHUNK_SIZE, toShubhaUpdates.length)} / ${toShubhaUpdates.length} leads...\r`);
  }
  console.log(`\n✅ Successfully updated all ${toShubhaUpdates.length} Shubha leads.`);

  // Step 6: Clear all pending next action dates on all leads currently assigned to Shubha
  console.log('\n=== Step 6: Clearing all pending next actions for Shubha ===');
  const { data: currentShubhaLeads } = await supabase.from('leads').select('id, custom_fields').eq('assigned_to', SHUBHA_ID);
  console.log(`Total leads now assigned to Shubha: ${currentShubhaLeads?.length}`);

  for (let i = 0; i < currentShubhaLeads.length; i += CHUNK_SIZE) {
    const chunk = currentShubhaLeads.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map(l => {
      let cf = l.custom_fields || {};
      if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) { cf = {}; } }
      delete cf.next_action_date;
      delete cf.next_action_type;
      delete cf.next_followup;

      return supabase.from('leads').update({
        next_followup: null,
        custom_fields: cf
      }).eq('id', l.id);
    }));
  }
  console.log(`✅ Cleared all pending next action dates across all ${currentShubhaLeads?.length} Shubha leads.`);

  console.log('\n=== Final Verification ===');
  const { data: finalShubha } = await supabase.from('leads').select('id, pipeline_stage, status, next_followup, custom_fields').eq('assigned_to', SHUBHA_ID);
  let pendingCount = 0;
  const stageCounts = {};

  finalShubha.forEach(l => {
    let cf = l.custom_fields;
    if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) {} }
    const st = l.pipeline_stage || l.status;
    stageCounts[st] = (stageCounts[st] || 0) + 1;
    if (l.next_followup || cf?.next_action_date) pendingCount++;
  });

  console.log('Final Shubha Total Leads:', finalShubha.length);
  console.log('Final Shubha Pending Next Actions:', pendingCount);
  console.log('Final Shubha Stage Breakdown:', stageCounts);
}

executeShubhaTransfer().catch(console.error);
