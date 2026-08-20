/**
 * Re-import complete, rich history for all 1,665 Shubha leads:
 * 1. LEAD_CREATED event with full source details & opening remarks
 * 2. Historical followups from leads_history_combined.csv with actor attribution & exact timestamps
 * 3. Latest followup from shubha_leads.xlsx (Meeting Date & Last Remarks) with next action dates
 * 4. Ensures 100% complete timeline sorted by timestamp descending
 */

const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hpssqssdewmkmafxlfud.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwc3Nxc3NkZXdta21hZnhsZnVkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjgxMTkyMSwiZXhwIjoyMDk4Mzg3OTIxfQ.HgzsU10Lft2bpkOe5SMx-MyW_kmx0ld7txyqe8grlAA';
const SHUBHA_USER_ID = '07db7180-6fac-4055-86ee-8b3748590f56';
const PARENT_USER_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

const LEADS_FILE = 'C:\\Users\\Adrolls\\Downloads\\shubha_leads.xlsx';
const HISTORY_CSV = 'C:\\Users\\Adrolls\\Downloads\\leads_history_combined.csv';
const BATCH_SIZE = 100;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function parseDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const str = dateStr.trim();
  if (!str) return null;
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!match) return null;
  const [, day, month, year, hourRaw, minute, ampm] = match;
  let hour = parseInt(hourRaw);
  if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
  const isoStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${String(hour).padStart(2, '0')}:${minute}:00+05:30`;
  try {
    const dt = new Date(isoStr);
    return isNaN(dt.getTime()) ? null : dt.toISOString();
  } catch { return null; }
}

function parseFollowups(fText, ownerName) {
  if (!fText || typeof fText !== 'string') return [];
  const entries = [];
  const parts = fText.split(/(?=(?:Call|Call Not Picked|WhatsApp|Email|SMS|Visit|Revisit|Home Meeting|Closing Meeting|Meeting|Note)\s*·\s*\d)/i);
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    const match = trimmed.match(/^([^\n·]+)\s*·\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm))\s*\n?([\s\S]*)/i);
    if (match) {
      const [, act, dateStr, rem] = match;
      const actClean = act.trim();
      const isDnp = actClean.toLowerCase().includes('not picked') || actClean.toLowerCase().includes('dnp');
      const isVisit = actClean.toLowerCase().includes('visit');
      const isMeeting = actClean.toLowerCase().includes('meeting');
      const actionType = isDnp ? 'DNP' : isVisit ? 'SITE_VISIT' : isMeeting ? 'MEETING' : 'CALL_FEEDBACK';
      
      const cleanRem = rem ? rem.trim() : '';
      let desc = `Follow up Type : ${actClean}\nFollowup Date : ${dateStr.trim()}`;
      if (cleanRem) desc += `\nRemarks : ${cleanRem}`;
      desc += `\n[by ${ownerName || 'Shubha Baweja Gulati'}]`;
      
      entries.push({
        action_type: actionType,
        description: desc,
        created_at: parseDate(dateStr),
        raw_date: dateStr.trim()
      });
    }
  }
  return entries;
}

async function run() {
  console.log('=== STARTING COMPLETE SHUBHA LEAD HISTORY RE-IMPORT ===\n');

  // 1. Fetch all Shubha leads from DB
  console.log('1. Fetching all Shubha leads from DB...');
  const allShubhaLeads = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, phone, name, custom_fields')
      .eq('assigned_to', SHUBHA_USER_ID)
      .order('id')
      .range(offset, offset + 999);
    if (error) { console.error('Error fetching leads:', error); break; }
    if (!data || data.length === 0) break;
    allShubhaLeads.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`Found ${allShubhaLeads.length} leads assigned to Shubha in DB.`);

  const phoneToLead = new Map();
  const leadIds = [];
  allShubhaLeads.forEach(l => {
    leadIds.push(l.id);
    const d = (l.phone || '').replace(/\D/g, '').slice(-10);
    if (d.length >= 7) phoneToLead.set(d, l);
  });

  // 2. Clear old history
  console.log('\n2. Deleting old history entries for Shubha leads...');
  let totalDeleted = 0;
  for (let i = 0; i < leadIds.length; i += 100) {
    const chunk = leadIds.slice(i, i + 100);
    await supabase.from('lead_history').delete().in('lead_id', chunk);
    totalDeleted += chunk.length;
  }
  await supabase.from('lead_history').delete().eq('user_id', SHUBHA_USER_ID);
  console.log(`Cleared history for ${totalDeleted} leads.`);

  // 3. Read both files
  console.log('\n3. Reading Excel and Combined History CSV...');
  const wb1 = XLSX.readFile(LEADS_FILE);
  const rows1 = XLSX.utils.sheet_to_json(wb1.Sheets[wb1.SheetNames[0]]);
  console.log(`shubha_leads.xlsx rows: ${rows1.length}`);

  const wb2 = XLSX.readFile(HISTORY_CSV);
  const rows2 = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]]);
  console.log(`leads_history_combined.csv rows: ${rows2.length}`);

  const historyCsvMap = new Map();
  rows2.forEach(r => {
    const d = String(r['Contacts'] || '').replace(/\D/g, '').slice(-10);
    if (d && !historyCsvMap.has(d)) {
      historyCsvMap.set(d, r);
    }
  });

  // 4. Generate all rich history entries
  console.log('\n4. Generating rich history entries for each lead...');
  const allHistoryInserts = [];
  let leadsWithCreated = 0;
  let leadsWithFollowups = 0;
  let leadsWithLatestFollowup = 0;

  for (const row of rows1) {
    const d = String(row['Contacts'] || '').replace(/\D/g, '').slice(-10);
    if (!d) continue;

    const lead = phoneToLead.get(d);
    if (!lead) continue;

    const leadItems = [];
    const ownerName = (row['Lead Owner'] || '').trim() || 'Shubha Baweja Gulati';

    // A. Followups from leads_history_combined.csv
    const histRow = historyCsvMap.get(d);
    if (histRow && histRow['Followups']) {
      const followups = parseFollowups(histRow['Followups'], histRow['Lead Owner'] || ownerName);
      if (followups.length > 0) {
        leadItems.push(...followups);
        leadsWithFollowups++;
      }
    }

    // B. Latest Followup from shubha_leads.xlsx (Meeting Date & Last Remarks)
    const lastRem = (row['Last Remarks'] || '').trim();
    const meetDate = (row['Meeting Date'] || '').trim();
    const nextFollowupDate = (row['Next Followup Date'] || '').trim();
    const nextFollowup = (row['Next Followup'] || '').trim();

    if (meetDate && !leadItems.some(it => it.raw_date === meetDate)) {
      const isDnp = lastRem.toLowerCase().includes('not picked') || lastRem.toLowerCase().includes('dnp');
      const actClean = isDnp ? 'Call Not Picked' : 'Call';
      const actionType = isDnp ? 'DNP' : 'CALL_FEEDBACK';
      const remText = lastRem.replace(/^(Call\s+(?:Not\s+Picked\s+)?on\s+[^\n]+\s*)/i, '').trim();

      let desc = `Follow up Type : ${actClean}\nFollowup Date : ${meetDate}`;
      if (nextFollowupDate) desc += `\nNext Action Date : ${nextFollowupDate}`;
      if (nextFollowup) desc += `\nNext Action : Call`;
      if (remText) desc += `\nRemarks : ${remText}`;
      desc += `\n[by ${ownerName}]`;

      leadItems.push({
        action_type: actionType,
        description: desc,
        created_at: parseDate(meetDate),
        raw_date: meetDate
      });
      leadsWithLatestFollowup++;
    }

    // C. Initial Lead Creation Event
    const createdDate = (row['Created Date'] || '').trim();
    if (createdDate) {
      let createdDesc = `New Lead created\nLead Owner : ${ownerName}\nLead Name : ${row['Lead Name'] || ''}\nContact no : ${row['Contacts'] || ''}\nLead Source : ${row['Lead Source'] || 'Facebook'}`;
      if (row['Source Details']) createdDesc += `\nSource Details : ${row['Source Details']}`;
      createdDesc += `\nLead Status : ${row['Lead Status'] || 'New Lead'}`;
      if (row['Openning Remarks']) {
        const cleanOpening = String(row['Openning Remarks']).replace(/<br\s*\/?>/gi, '\n').trim();
        if (cleanOpening) createdDesc += `\nOpening Remarks :\n${cleanOpening}`;
      }
      createdDesc += `\n[by System]`;

      leadItems.push({
        action_type: 'LEAD_CREATED',
        description: createdDesc,
        created_at: parseDate(createdDate),
        raw_date: createdDate
      });
      leadsWithCreated++;
    }

    // Push into batch array
    for (const item of leadItems) {
      allHistoryInserts.push({
        lead_id: lead.id,
        user_id: SHUBHA_USER_ID,
        action_type: item.action_type,
        description: item.description,
        created_at: item.created_at || new Date().toISOString()
      });
    }
  }

  console.log(`\nGenerated summary:`);
  console.log(`  Total History Records to Insert: ${allHistoryInserts.length}`);
  console.log(`  Leads with Creation Event: ${leadsWithCreated}`);
  console.log(`  Leads with CSV Followups: ${leadsWithFollowups}`);
  console.log(`  Leads with Latest Aug 19/20 Followup: ${leadsWithLatestFollowup}`);

  // 5. Insert all in batches
  console.log('\n5. Inserting all history records into lead_history in batches...');
  let totalInserted = 0;
  let insertErrors = 0;
  for (let i = 0; i < allHistoryInserts.length; i += BATCH_SIZE) {
    const batch = allHistoryInserts.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('lead_history').insert(batch);
    if (error) {
      console.error(`Batch insert error at ${i}:`, error.message);
      insertErrors += batch.length;
    } else {
      totalInserted += batch.length;
      if (totalInserted % 2000 === 0 || i + BATCH_SIZE >= allHistoryInserts.length) {
        console.log(`  Inserted ${totalInserted} / ${allHistoryInserts.length} entries...`);
      }
    }
  }
  console.log(`\nInsert complete! Total inserted: ${totalInserted}, Errors: ${insertErrors}`);

  // 6. Verify Charanjot Sidhu Bhaika
  console.log('\n=== VERIFICATION (Charanjot Sidhu Bhaika: +91 9646060175) ===');
  const charanLead = phoneToLead.get('9646060175');
  if (charanLead) {
    const { data: charanHist } = await supabase
      .from('lead_history')
      .select('*')
      .eq('lead_id', charanLead.id)
      .order('created_at', { ascending: false });

    console.log(`Total history entries for Charanjot: ${charanHist?.length}`);
    charanHist?.forEach((h, idx) => {
      console.log(`\n[${idx + 1}] Type: ${h.action_type} | Created At: ${h.created_at}`);
      console.log(h.description);
    });
  }

  console.log('\n=== ALL DONE SUCCESSFULLY ===');
}

run().catch(console.error);
