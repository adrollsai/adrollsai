/**
 * Fix and re-import Shubha's lead history with:
 * 1. Proper individual followup separation (no bundling of multiple calls)
 * 2. Exact action types and timestamps
 * 3. history_visible_from set to null so history modal shows all entries
 * 4. Correct sorting (latest at top)
 */

const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://hpssqssdewmkmafxlfud.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwc3Nxc3NkZXdta21hZnhsZnVkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjgxMTkyMSwiZXhwIjoyMDk4Mzg3OTIxfQ.HgzsU10Lft2bpkOe5SMx-MyW_kmx0ld7txyqe8grlAA';
const SHUBHA_USER_ID = '07db7180-6fac-4055-86ee-8b3748590f56';
const PARENT_USER_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

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
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch { return null; }
}

function parseFollowups(fText) {
  if (!fText || typeof fText !== 'string') return [];
  const entries = [];
  
  // Split on all known action prefixes followed by ' · ' and a date
  const parts = fText.split(/(?=(?:Call|Call Not Picked|WhatsApp|Email|SMS|Visit|Revisit|Home Meeting|Closing Meeting|Meeting|Note)\s*·\s*\d)/i);
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    // Match: "[Action Name] · [Date Time]\n[Remark]"
    const match = trimmed.match(/^([^\n·]+)\s*·\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm))\s*\n?([\s\S]*)/i);
    if (match) {
      const [, act, dateStr, rem] = match;
      const actClean = act.trim();
      const isDnp = actClean.toLowerCase().includes('not picked') || actClean.toLowerCase().includes('dnp');
      const isVisit = actClean.toLowerCase().includes('visit');
      const isMeeting = actClean.toLowerCase().includes('meeting');
      
      const actionType = isDnp ? 'DNP' : isVisit ? 'SITE_VISIT' : isMeeting ? 'MEETING' : 'CALL_FEEDBACK';
      const desc = actClean + ' on ' + dateStr.trim() + (rem.trim() ? '  \n\n' + rem.trim() : '');
      const timestamp = parseDate(dateStr);
      
      entries.push({
        action_type: actionType,
        description: desc,
        created_at: timestamp
      });
    }
  }
  return entries;
}

async function run() {
  console.log('=== STARTING SHUBHA LEAD HISTORY FIX ===\n');

  // 1. Fetch all Shubha leads from DB
  console.log('Fetching Shubha leads from DB...');
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
  console.log(`Found ${allShubhaLeads.length} leads assigned to Shubha.`);

  const phoneToLead = new Map();
  const leadIds = [];
  allShubhaLeads.forEach(l => {
    leadIds.push(l.id);
    const d = (l.phone || '').replace(/\D/g, '').slice(-10);
    if (d.length >= 7) phoneToLead.set(d, l);
  });

  // 2. Fix custom_fields on all leads to remove history_visible_from
  console.log('\nUpdating custom_fields on all Shubha leads to allow full history visibility in History Modal...');
  let cfUpdated = 0;
  for (let i = 0; i < allShubhaLeads.length; i += BATCH_SIZE) {
    const batch = allShubhaLeads.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (l) => {
      let cf = l.custom_fields;
      if (typeof cf === 'string') {
        try { cf = JSON.parse(cf); } catch { cf = {}; }
      }
      if (cf && cf.history_visible_from) {
        delete cf.history_visible_from;
        await supabase
          .from('leads')
          .update({ custom_fields: JSON.stringify(cf) })
          .eq('id', l.id);
        cfUpdated++;
      }
    }));
  }
  console.log(`Updated custom_fields for ${cfUpdated} leads.`);

  // 3. Delete existing lead_history for all Shubha leads
  console.log('\nDeleting old history entries for Shubha leads...');
  let totalDeleted = 0;
  for (let i = 0; i < leadIds.length; i += 100) {
    const chunk = leadIds.slice(i, i + 100);
    const { error } = await supabase
      .from('lead_history')
      .delete()
      .in('lead_id', chunk);
    if (error) {
      console.error('Error deleting chunk:', error.message);
    } else {
      totalDeleted += chunk.length;
    }
  }
  console.log(`Cleared old history for ${totalDeleted} leads.`);

  // Also clean any leftover where user_id = Shubha
  await supabase.from('lead_history').delete().eq('user_id', SHUBHA_USER_ID);

  // 4. Parse history from combined CSV
  console.log('\nReading and parsing combined history CSV...');
  const wb = XLSX.readFile(HISTORY_CSV);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);
  const shubhaRows = rows.filter(r => r['Lead Owner'] && r['Lead Owner'].includes('Shubha'));
  console.log(`Total Shubha rows in CSV: ${shubhaRows.length}`);

  const historyInserts = [];
  const processedPhones = new Set();
  let matchedLeads = 0;

  for (const row of shubhaRows) {
    const d = String(row['Contacts'] || '').replace(/\D/g, '').slice(-10);
    if (!d || processedPhones.has(d)) continue;
    
    const lead = phoneToLead.get(d);
    if (!lead) continue;
    
    processedPhones.add(d);
    matchedLeads++;

    const followupsText = row['Followups'] || '';
    const entries = parseFollowups(followupsText);

    for (const entry of entries) {
      historyInserts.push({
        lead_id: lead.id,
        user_id: SHUBHA_USER_ID,
        action_type: entry.action_type,
        description: entry.description,
        created_at: entry.created_at || new Date().toISOString()
      });
    }
  }

  console.log(`Matched ${matchedLeads} leads. Total individual history entries prepared: ${historyInserts.length}`);

  // 5. Insert all history records in batches
  console.log('\nInserting history records into lead_history in batches...');
  let totalInserted = 0;
  let insertErrors = 0;
  for (let i = 0; i < historyInserts.length; i += BATCH_SIZE) {
    const batch = historyInserts.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('lead_history').insert(batch);
    if (error) {
      console.error(`Batch insert error at ${i}:`, error.message);
      insertErrors += batch.length;
    } else {
      totalInserted += batch.length;
      if (totalInserted % 1000 === 0 || i + BATCH_SIZE >= historyInserts.length) {
        console.log(`  Inserted ${totalInserted} / ${historyInserts.length} entries...`);
      }
    }
  }

  console.log(`\nInsertion complete! Total inserted: ${totalInserted}, Errors: ${insertErrors}`);

  // 6. Verification on sample lead (Sanjeev Kumar)
  console.log('\n=== VERIFICATION (Sanjeev Kumar: +91 9872074442) ===');
  const sanjeevLead = phoneToLead.get('9872074442');
  if (sanjeevLead) {
    const { data: sanjeevHist } = await supabase
      .from('lead_history')
      .select('*')
      .eq('lead_id', sanjeevLead.id)
      .order('created_at', { ascending: false });
    
    console.log(`Total history entries for Sanjeev Kumar: ${sanjeevHist?.length}`);
    console.log('\nEntries (ordered newest to oldest):');
    sanjeevHist?.forEach((h, idx) => {
      console.log(`\n[${idx + 1}] Type: ${h.action_type} | Created At: ${h.created_at}`);
      console.log(`Description:\n${h.description}`);
    });
  }

  console.log('\n=== ALL DONE SUCCESSFULLY ===');
}

run().catch(console.error);
