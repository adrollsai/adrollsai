const xlsx = require('xlsx');
const path = 'C:/Users/Adrolls/.gemini/antigravity/brain/13a1651a-8804-4d97-b2f3-424ea5866ab5/.user_uploaded/media_1795174015141_396e1800.csv';
const wb = xlsx.readFile(path);
const propRows = xlsx.utils.sheet_to_json(wb.Sheets['Property']).map(r => ({ ...r, _sheet: 'Property' }));
const projRows = xlsx.utils.sheet_to_json(wb.Sheets['Project']).map(r => ({ ...r, _sheet: 'Project' }));
const allUploaded = [...propRows, ...projRows];

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const supabase = createClient(env.NEXT_PUBLIC_supabase_URL || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function cleanPhone(p) {
  if (!p) return '';
  return String(p).replace(/[^0-9]/g, '').slice(-10);
}

async function detailedAudit() {
  const { data: teamProfiles } = await supabase.from('profiles').select('id, full_name, email, role');
  const profMap = new Map();
  teamProfiles.forEach(p => profMap.set(p.id, p));

  const blueSquareUserId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
  const bluesquareAgents = teamProfiles.filter(p => p.email && p.email.includes('bluesquare')).map(p => p.id);
  const bsIds = new Set([blueSquareUserId, ...bluesquareAgents]);

  const report = [];

  for (let i = 0; i < allUploaded.length; i++) {
    const row = allUploaded[i];
    const rawMobile = row.Mobile;
    const digits10 = cleanPhone(rawMobile);
    const rowName = (row.Name || '').trim();
    const targetProject = (row['Project Name'] || row['Locality Name'] || row.Locality || '').trim();

    // Query DB
    const { data: matched } = await supabase
      .from('leads')
      .select('*')
      .ilike('phone', `%${digits10}`);

    const bsLeads = (matched || []).filter(l => bsIds.has(l.user_id) || bsIds.has(l.assigned_to));

    report.push({
      rowIdx: i + 1,
      sheet: row._sheet,
      name: rowName,
      phone: rawMobile,
      digits10,
      targetProject,
      row,
      bsLeads
    });
  }

  // Check how many unique leads were matched
  const leadIdToRows = new Map();
  for (const item of report) {
    for (const l of item.bsLeads) {
      if (!leadIdToRows.has(l.id)) leadIdToRows.set(l.id, []);
      leadIdToRows.get(l.id).push(item);
    }
  }

  console.log(`Uploaded rows: ${allUploaded.length}`);
  console.log(`Unique DB leads matched: ${leadIdToRows.size}`);

  for (const [leadId, rows] of leadIdToRows.entries()) {
    const l = rows[0].bsLeads.find(x => x.id === leadId);
    const u = profMap.get(l.user_id)?.email || l.user_id;
    const a = l.assigned_to ? (profMap.get(l.assigned_to)?.email || l.assigned_to) : 'unassigned';
    console.log(`\nDB Lead [${leadId}]:`);
    console.log(`  Name: "${l.name}" | Phone: "${l.phone}" | Email: "${l.email}"`);
    console.log(`  Account (user_id): ${u} | Assigned To: ${a}`);
    console.log(`  Stage: ${l.pipeline_stage} | Source: ${l.source} | Current ad_name: "${l.ad_name}"`);
    console.log(`  Created: ${l.created_at}`);
    console.log(`  Followups / Notes: ${(l.notes || '').length} chars | Followup count in notes: ${(l.notes || '').includes('Followup') ? 'YES' : 'NO'}`);
    console.log(`  Matched CSV rows count: ${rows.length}`);
    rows.forEach(r => {
      console.log(`    - Row #${r.rowIdx} [${r.sheet}]: Project="${r.targetProject}", Name="${r.name}", Mobile="${r.phone}"`);
    });
  }
}

detailedAudit();

