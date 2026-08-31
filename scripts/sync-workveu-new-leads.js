const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OWNER_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra

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

function parseCustomDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim();
  try {
    const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
    if (match) {
      let day = parseInt(match[1], 10), month = parseInt(match[2], 10) - 1, year = parseInt(match[3], 10);
      let hour = parseInt(match[4], 10), minute = parseInt(match[5], 10);
      const ampm = match[6]?.toLowerCase();
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      const d = new Date(Date.UTC(year, month, day, hour - 5, minute - 30));
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    const fallback = new Date(s);
    if (!isNaN(fallback.getTime())) return fallback.toISOString();
  } catch (e) {}
  return null;
}

async function syncWorkveuNewLeads() {
  console.log('=== Step 1: Read all Workveu Excel files ===');
  const dir = 'C:\\Users\\Adrolls\\Downloads\\workveu data new';
  const files = ['1-6000.xlsx', '6001-12000.xlsx', '12001-15697.xlsx'].map(f => path.join(dir, f));

  const excelRows = [];
  files.forEach(file => {
    console.log(`Reading ${file}...`);
    const wb = XLSX.readFile(file);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    excelRows.push(...rows);
  });
  console.log(`Total Excel Rows: ${excelRows.length}`);

  // Deduplicate Excel rows by clean 10-digit phone
  const excelPhoneMap = new Map();
  let bhavdeepExcelCount = 0;

  excelRows.forEach(r => {
    const rawPhone = String(r['Contacts'] || '').replace(/\D/g, '').slice(-10);
    if (rawPhone.length >= 7) {
      const ownerKey = String(r['Lead Owner'] || r['Owner'] || '').trim().toLowerCase();
      if (ownerKey.includes('bhavdeep') || ownerKey.includes('deep')) {
        bhavdeepExcelCount++;
      }
      if (!excelPhoneMap.has(rawPhone)) {
        excelPhoneMap.set(rawPhone, r);
      }
    }
  });

  console.log(`Unique Phone Numbers in Excel: ${excelPhoneMap.size}`);
  console.log(`Bhavdeep entries in Excel: ${bhavdeepExcelCount}`);

  // Step 2: Fetch all DB leads for Blue Square Infra
  console.log('\n=== Step 2: Fetch all existing DB leads ===');
  const { data: team } = await supabase.from('profiles').select('id').or(`parent_id.eq.${OWNER_ID},agency_id.eq.${OWNER_ID},id.eq.${OWNER_ID}`);
  const teamIds = team.map(t => t.id);

  let allDbLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase
      .from('leads')
      .select('id, phone, name, status, pipeline_stage, assigned_to, user_id, notes, custom_fields, created_at')
      .in('user_id', teamIds)
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allDbLeads = allDbLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }
  console.log(`Total DB leads for Blue Square Infra: ${allDbLeads.length}`);

  const dbPhoneMap = new Map();
  allDbLeads.forEach(l => {
    const p = (l.phone || '').replace(/\D/g, '').slice(-10);
    if (p.length >= 7) dbPhoneMap.set(p, l);
  });

  // Step 3: Identify operations
  console.log('\n=== Step 3: Analyze Matching & Re-assignments ===');
  let bhavdeepReassigned = 0;
  let bhavdeepAlreadyAssigned = 0;
  const missingToInsert = [];

  excelPhoneMap.forEach((r, phone) => {
    const dbLead = dbPhoneMap.get(phone);
    const ownerKey = String(r['Lead Owner'] || r['Owner'] || '').trim().toLowerCase();
    const isBhavdeep = ownerKey.includes('bhavdeep') || ownerKey.includes('deep');
    const targetAgentId = isBhavdeep ? TEAM_MAP['bhavdeep'] : (TEAM_MAP[ownerKey] || null);

    if (dbLead) {
      // Existing lead in Nobogent: DO NOT OVERWRITE followups/notes/stages!
      // Only reassign to Bhavdeep if it is Bhavdeep's lead and currently assigned elsewhere
      if (isBhavdeep) {
        if (dbLead.assigned_to !== TEAM_MAP['bhavdeep']) {
          bhavdeepReassigned++;
        } else {
          bhavdeepAlreadyAssigned++;
        }
      }
    } else {
      // Missing lead: Prepare for insert
      missingToInsert.push({ r, phone, targetAgentId });
    }
  });

  console.log(`Bhavdeep leads already correctly assigned: ${bhavdeepAlreadyAssigned}`);
  console.log(`Bhavdeep leads to re-assign (returning from other agents): ${bhavdeepReassigned}`);
  console.log(`Missing leads to insert into Nobogent: ${missingToInsert.length}`);

  // Step 4: Reassign Bhavdeep leads that are currently assigned to others
  if (bhavdeepReassigned > 0) {
    console.log('\n=== Step 4: Re-assigning Bhavdeep leads to Bhavdeep Singh ===');
    const bhavdeepLeadIdsToReassign = [];
    excelPhoneMap.forEach((r, phone) => {
      const dbLead = dbPhoneMap.get(phone);
      const ownerKey = String(r['Lead Owner'] || r['Owner'] || '').trim().toLowerCase();
      const isBhavdeep = ownerKey.includes('bhavdeep') || ownerKey.includes('deep');
      if (dbLead && isBhavdeep && dbLead.assigned_to !== TEAM_MAP['bhavdeep']) {
        bhavdeepLeadIdsToReassign.push(dbLead.id);
      }
    });

    console.log(`Updating ${bhavdeepLeadIdsToReassign.length} leads in batches of 100...`);
    for (let i = 0; i < bhavdeepLeadIdsToReassign.length; i += 100) {
      const chunk = bhavdeepLeadIdsToReassign.slice(i, i + 100);
      await supabase.from('leads').update({ assigned_to: TEAM_MAP['bhavdeep'] }).in('id', chunk);
    }
    console.log(`✅ Reassigned ${bhavdeepLeadIdsToReassign.length} leads to Bhavdeep Singh.`);
  }

  // Step 5: Insert missing leads
  if (missingToInsert.length > 0) {
    console.log(`\n=== Step 5: Inserting ${missingToInsert.length} missing leads ===`);
    const insertPayloads = missingToInsert.map(({ r, phone, targetAgentId }) => {
      const rawStage = String(r['Lead Status'] || r['Status'] || 'New Lead').trim();
      const normalizedStage = STAGE_MAP[rawStage.toLowerCase()] || rawStage;
      const isVisited = String(r['Visited'] || '').toLowerCase().includes('visited');

      const customFields = {
        client_status: r['Client Status'] || null,
        property_type: r['Property Type'] || null,
        budget: r['Budget'] || null,
        opening_comments: r['Openning Remarks'] || null,
        last_followup_remark: r['Last Remarks'] || null,
        last_remark: r['Last Remarks'] || null,
        has_visited: isVisited,
        meeting_date: parseCustomDate(r['Meeting Date'])
      };

      const nextActionDate = parseCustomDate(r['Next Followup Date'] || r['Next Followup']);
      if (nextActionDate) {
        customFields.next_action_date = nextActionDate;
        customFields.next_action_type = 'Call';
      }

      let notes = '';
      if (r['Openning Remarks']) notes += `[Opening Remarks]: ${r['Openning Remarks']}\n\n`;
      if (r['Last Remarks']) notes += `[Last Remarks]: ${r['Last Remarks']}\n\n`;
      if (r['Followup Taken']) notes += `[Followups Taken]: ${r['Followup Taken']}`;

      return {
        user_id: OWNER_ID,
        assigned_to: targetAgentId,
        name: r['Lead Name'] || 'Lead',
        phone: r['Contacts'] ? String(r['Contacts']).trim() : `+91 ${phone}`,
        email: r['Email'] || null,
        source: r['Lead Source'] || 'Facebook',
        ad_name: r['Source Details'] || 'Workveu Import',
        form_name: r['Source Details'] || 'Workveu CRM',
        pipeline_stage: normalizedStage,
        status: normalizedStage,
        notes: notes.trim(),
        custom_fields: customFields,
        next_followup: nextActionDate,
        created_at: parseCustomDate(r['Created Date']) || new Date().toISOString()
      };
    });

    console.log(`Inserting ${insertPayloads.length} new leads in batches of 50...`);
    for (let i = 0; i < insertPayloads.length; i += 50) {
      const batch = insertPayloads.slice(i, i + 50);
      const { error } = await supabase.from('leads').insert(batch);
      if (error) console.error('Insert error:', error.message);
    }
    console.log(`✅ Successfully inserted ${insertPayloads.length} missing leads into Nobogent.`);
  }

  // Step 6: Final Verification
  const { count: finalBhavdeepCount } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('assigned_to', TEAM_MAP['bhavdeep']);

  const { count: finalTotalCount } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .in('user_id', teamIds);

  console.log('\n=== FINAL VERIFICATION SUMMARY ===');
  console.log(`Total Leads in Blue Square Infra CRM: ${finalTotalCount}`);
  console.log(`Total Leads Assigned to Bhavdeep Singh: ${finalBhavdeepCount}`);
}

syncWorkveuNewLeads().catch(console.error);
