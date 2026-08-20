/**
 * Import Shubha's leads from Excel into Supabase CRM
 * 
 * Phase 1: Import 1,665 leads from shubha_leads.xlsx
 * Phase 2: Import lead history from 7 history Excel files
 * Phase 3: Verify and report
 * 
 * Usage: node scripts/import_shubha_leads.js
 */

const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

// --- CONFIG ---
const SUPABASE_URL = 'https://hpssqssdewmkmafxlfud.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwc3Nxc3NkZXdta21hZnhsZnVkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjgxMTkyMSwiZXhwIjoyMDk4Mzg3OTIxfQ.HgzsU10Lft2bpkOe5SMx-MyW_kmx0ld7txyqe8grlAA';
const SHUBHA_USER_ID = '07db7180-6fac-4055-86ee-8b3748590f56';

const LEADS_FILE = 'C:\\Users\\Adrolls\\Downloads\\shubha_leads.xlsx';
const HISTORY_DIR = 'C:\\Users\\Adrolls\\Downloads\\leads history workvew';
const HISTORY_FILES = [
  'Lead Ageing and Followups Report_2026.Aug.18.xlsx',
  'Lead Ageing and Followups Report_2026.Aug.18 (1).xlsx',
  'Lead Ageing and Followups Report_2026.Aug.18 (2).xlsx',
  'Lead Ageing and Followups Report_2026.Aug.18 (3).xlsx',
  'Lead Ageing and Followups Report_2026.Aug.18 (4).xlsx',
  'Lead Ageing and Followups Report_2026.Aug.18 (5).xlsx',
  'Lead Ageing and Followups Report_2026.Aug.18 (6).xlsx',
];

const BATCH_SIZE = 100;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// --- PIPELINE STAGE MAPPING ---
const STAGE_MAP = {
  'new lead': 'New Lead',
  'requirement taken': 'Requirement Taken',
  'visit planned': 'Visit Planned',
  'visit done': 'Visit Done',
  'revisit done': 'Revisit Done',
  'meeting planned': 'Meeting Planned',
  'meeting done': 'Meeting Done',
  'never picked': 'Never Picked',
  'negotiation': 'Negotiation',
  'deal/token': 'Deal/Token',
  'dealer': 'Dealer',
  'plan postponed': 'Plan Postponed',
  'already purchased': 'Already Purchased',
  'lost/ni': 'Lost/NI',
};

const NOT_INTERESTED_STAGES = new Set([
  'lost/ni', 'dealer', 'plan postponed', 'already purchased'
]);

const ONGOING_STAGES = new Set([
  'requirement taken', 'visit planned', 'visit done', 'revisit done',
  'meeting planned', 'meeting done', 'never picked', 'negotiation', 'deal/token'
]);

// --- HELPERS ---

function cleanPhone(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  const digits = str.replace(/\D/g, '');
  if (digits.length < 7) return null;
  const last10 = digits.slice(-10);
  if (last10.length === 10) return '+91 ' + last10;
  return '+' + digits;
}

function phoneKey(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : null;
}

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
  const isoStr = year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0') + 'T' + String(hour).padStart(2, '0') + ':' + minute + ':00+05:30';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch { return null; }
}

function stripHtml(text) {
  if (!text) return '';
  return String(text).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

function countDnp(text) {
  if (!text) return 0;
  const matches = text.toLowerCase().match(/\bdnp\b|call not picked|not picked/gi);
  return matches ? matches.length : 0;
}

function determinePipelineStage(row) {
  const rawStatus = (row['Lead Status'] || '').trim();
  const statusLower = rawStatus.toLowerCase();
  const lastRemarks = (row['Last Remarks'] || '').trim();
  const nextFollowup = (row['Next Followup'] || '').trim();
  const followupCount = parseInt(row['Followup Taken']) || 0;
  const hasDnp = nextFollowup.toLowerCase().includes('dnp') || lastRemarks.toLowerCase().includes('dnp');
  const hasRemarks = lastRemarks.length > 0;
  const hasActivity = hasDnp || hasRemarks || followupCount > 0;
  const mappedStage = STAGE_MAP[statusLower] || rawStatus || 'New Lead';
  
  let section;
  if (NOT_INTERESTED_STAGES.has(statusLower)) {
    section = 'not_interested';
  } else if (ONGOING_STAGES.has(statusLower)) {
    section = 'ongoing';
  } else if (statusLower === 'new lead' || statusLower === '') {
    section = hasActivity ? 'ongoing' : 'fresh';
  } else {
    section = 'ongoing';
  }
  return { mappedStage, section, hasDnp, hasRemarks, hasActivity };
}

function parseFollowups(followupsText) {
  if (!followupsText || typeof followupsText !== 'string') return [];
  const entries = [];
  const parts = followupsText.split(/(?=(?:Call|WhatsApp|Email|SMS|Visit|Meeting|Note)\s*\u00b7\s*\d)/i);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(Call|WhatsApp|Email|SMS|Visit|Meeting|Note)\s*\u00b7\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm))\s*\n?([\s\S]*)/i);
    if (match) {
      const [, actionType, dateStr, remarkText] = match;
      const timestamp = parseDate(dateStr);
      const remark = remarkText ? remarkText.trim() : '';
      const description = 'Call on ' + dateStr + '  \n\n' + remark;
      entries.push({
        action_type: 'CALL_FEEDBACK',
        description: description,
        created_at: timestamp,
      });
    }
  }
  return entries;
}

// ============================================================
// PHASE 1: Import leads
// ============================================================
async function phase1_importLeads() {
  console.log('\n========================================');
  console.log('PHASE 1: Importing leads from shubha_leads.xlsx');
  console.log('========================================\n');
  
  const wb = XLSX.readFile(LEADS_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);
  console.log('Total rows in Excel: ' + rows.length);
  
  const seenPhones = new Map();
  const leadsToInsert = [];
  let skippedDuplicates = 0;
  let skippedNoPhone = 0;
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const phone = cleanPhone(row['Contacts']);
    if (!phone) { skippedNoPhone++; continue; }
    const pk = phoneKey(row['Contacts']);
    if (seenPhones.has(pk)) { skippedDuplicates++; continue; }
    seenPhones.set(pk, i);
    
    const { mappedStage, section, hasDnp, hasRemarks, hasActivity } = determinePipelineStage(row);
    const lastRemarks = (row['Last Remarks'] || '').trim();
    const nextFollowupDate = parseDate(row['Next Followup Date']);
    const meetingDate = (row['Meeting Date'] || '').trim();
    const meetingDateParsed = parseDate(meetingDate);
    const createdDate = parseDate(row['Created Date']);
    const openingRemarks = stripHtml(row['Openning Remarks'] || '');
    const followupCount = parseInt(row['Followup Taken']) || 0;
    const nextFollowupRaw = (row['Next Followup'] || '').trim();
    const dnpCount = countDnp(nextFollowupRaw) + countDnp(lastRemarks);
    
    const customFields = {
      opening_comments: openingRemarks || null,
      last_followup_remark: lastRemarks || null,
      meeting_date: meetingDate || null,
      budget: (row['Budget'] || '').trim() || null,
      lead_source_details: (row['Source Details'] || '').trim() || null,
      client_status: (row['Client Status'] || '').trim() || null,
      property_type: (row['Property Type'] || '').trim() || null,
      followup_count: followupCount,
      csv_audience: 'shubha_leads.xlsx Import 2026-08-20',
      visited: (row['Visited'] || '').trim() || null,
      next_action_date: nextFollowupDate || null,
      next_action_type: nextFollowupDate ? 'Call' : null,
      last_call_dnp: hasDnp,
      dnp_count: dnpCount,
      last_followup_at: meetingDateParsed || null,
      last_followup_type: followupCount > 0 ? 'Call' : null,
      history_visible_from: new Date().toISOString(),
      shared_with: (row['Shared With'] || '').trim() || null,
      shared_from: (row['Shared From'] || '').trim() || null,
      reports_to: (row['Reports To'] || '').trim() || null,
    };
    
    let notes = '';
    if (hasDnp) {
      notes = '[\\u26a0\\ufe0f Imported - Last remark had DNP]: ' + lastRemarks;
    } else if (hasRemarks) {
      notes = '[\\ud83d\\udcdd Imported - Last Remark]: ' + lastRemarks;
    }
    
    leadsToInsert.push({
      user_id: SHUBHA_USER_ID,
      name: (row['Lead Name'] || '').trim() || 'Unknown',
      phone: phone,
      email: (row['Email'] || '').trim() || null,
      source: (row['Lead Source'] || '').trim() || null,
      pipeline_stage: mappedStage,
      status: mappedStage,
      next_followup: nextFollowupDate || null,
      notes: notes || null,
      custom_fields: JSON.stringify(customFields),
      created_at: createdDate || new Date().toISOString(),
      budget: (row['Budget'] || '').trim() || null,
      ad_name: (row['Source Details'] || '').trim() || null,
    });
  }
  
  console.log('Leads to insert: ' + leadsToInsert.length);
  console.log('Skipped (no phone): ' + skippedNoPhone);
  console.log('Skipped (duplicate phone): ' + skippedDuplicates);
  
  let totalInserted = 0;
  let totalErrors = 0;
  const insertedLeadIds = new Map();
  
  for (let i = 0; i < leadsToInsert.length; i += BATCH_SIZE) {
    const batch = leadsToInsert.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(leadsToInsert.length / BATCH_SIZE);
    
    const { data, error } = await supabase.from('leads').insert(batch).select('id, phone');
    
    if (error) {
      console.error('Batch ' + batchNum + '/' + totalBatches + ' ERROR:', error.message);
      // Try one by one
      for (const lead of batch) {
        const { data: sd, error: se } = await supabase.from('leads').insert(lead).select('id, phone');
        if (se) {
          console.error('  Failed: ' + lead.name + ' (' + lead.phone + '): ' + se.message);
          totalErrors++;
        } else if (sd && sd[0]) {
          totalInserted++;
          const pk = phoneKey(sd[0].phone);
          if (pk) insertedLeadIds.set(pk, sd[0].id);
        }
      }
    } else if (data) {
      totalInserted += data.length;
      data.forEach(d => {
        const pk = phoneKey(d.phone);
        if (pk) insertedLeadIds.set(pk, d.id);
      });
      if (batchNum % 5 === 0 || batchNum === totalBatches) {
        console.log('  Batch ' + batchNum + '/' + totalBatches + ': ' + totalInserted + ' leads inserted so far');
      }
    }
  }
  
  console.log('\nPhase 1 Complete:');
  console.log('  Total inserted: ' + totalInserted);
  console.log('  Total errors: ' + totalErrors);
  console.log('  Lead IDs mapped: ' + insertedLeadIds.size);
  return insertedLeadIds;
}

// ============================================================
// PHASE 2: Import lead history
// ============================================================
async function phase2_importHistory(insertedLeadIds) {
  console.log('\n========================================');
  console.log('PHASE 2: Importing lead history from 7 files');
  console.log('========================================\n');
  
  if (!insertedLeadIds || insertedLeadIds.size === 0) {
    console.log('Fetching lead IDs from database...');
    insertedLeadIds = new Map();
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.from('leads').select('id, phone').eq('user_id', SHUBHA_USER_ID).range(offset, offset + 999);
      if (error || !data || data.length === 0) break;
      data.forEach(d => { const pk = phoneKey(d.phone); if (pk) insertedLeadIds.set(pk, d.id); });
      if (data.length < 1000) break;
      offset += 1000;
    }
    console.log('Fetched ' + insertedLeadIds.size + ' lead IDs from database');
  }
  
  let totalHistoryEntries = 0;
  let totalMatched = 0;
  let totalUnmatched = 0;
  let totalInserted = 0;
  let totalErrors = 0;
  const allHistoryInserts = [];
  const processedLeadPhones = new Set();
  
  for (const fileName of HISTORY_FILES) {
    const filePath = HISTORY_DIR + '\\' + fileName;
    console.log('\nProcessing: ' + fileName);
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    const shubhaRows = rows.filter(r => r['Lead Owner'] && r['Lead Owner'].includes('Shubha'));
    console.log('  Total rows: ' + rows.length + ', Shubha rows: ' + shubhaRows.length);
    
    let fileMatched = 0, fileUnmatched = 0;
    for (const row of shubhaRows) {
      const pk = phoneKey(row['Contacts']);
      if (!pk) continue;
      if (processedLeadPhones.has(pk)) continue;
      const leadId = insertedLeadIds.get(pk);
      if (!leadId) { fileUnmatched++; continue; }
      processedLeadPhones.add(pk);
      fileMatched++;
      
      const followupsText = row['Followups'] || '';
      const entries = parseFollowups(followupsText);
      totalHistoryEntries += entries.length;
      
      for (const entry of entries) {
        allHistoryInserts.push({
          lead_id: leadId,
          user_id: SHUBHA_USER_ID,
          action_type: entry.action_type,
          description: entry.description,
          created_at: entry.created_at || new Date().toISOString(),
        });
      }
    }
    totalMatched += fileMatched;
    totalUnmatched += fileUnmatched;
    console.log('  Matched: ' + fileMatched + ', Unmatched: ' + fileUnmatched);
  }
  
  console.log('\nTotal history entries to insert: ' + allHistoryInserts.length);
  console.log('Leads matched: ' + totalMatched + ', Unmatched: ' + totalUnmatched);
  
  for (let i = 0; i < allHistoryInserts.length; i += BATCH_SIZE) {
    const batch = allHistoryInserts.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(allHistoryInserts.length / BATCH_SIZE);
    const { error } = await supabase.from('lead_history').insert(batch);
    if (error) {
      console.error('  History batch ' + batchNum + '/' + totalBatches + ' ERROR:', error.message);
      totalErrors += batch.length;
    } else {
      totalInserted += batch.length;
      if (batchNum % 10 === 0 || batchNum === totalBatches) {
        console.log('  History batch ' + batchNum + '/' + totalBatches + ': ' + totalInserted + ' entries inserted');
      }
    }
  }
  
  console.log('\nPhase 2 Complete:');
  console.log('  Total history entries inserted: ' + totalInserted);
  console.log('  Total errors: ' + totalErrors);
  console.log('  Unique leads with history: ' + processedLeadPhones.size);
  return { totalInserted, totalErrors };
}

// ============================================================
// PHASE 3: Verification
// ============================================================
async function phase3_verify() {
  console.log('\n========================================');
  console.log('PHASE 3: Verification');
  console.log('========================================\n');
  
  const { count: totalLeads } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', SHUBHA_USER_ID);
  console.log('Total leads in DB for Shubha: ' + totalLeads);
  
  // Fetch all leads for stats
  const allLeads = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('pipeline_stage, custom_fields').eq('user_id', SHUBHA_USER_ID).range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allLeads.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  
  const stageCounts = {};
  let freshCount = 0, ongoingCount = 0, notInterestedCount = 0;
  
  for (const lead of allLeads) {
    const stage = lead.pipeline_stage || 'Unknown';
    stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    const stageLower = stage.toLowerCase();
    
    if (NOT_INTERESTED_STAGES.has(stageLower)) {
      notInterestedCount++;
    } else if (ONGOING_STAGES.has(stageLower)) {
      ongoingCount++;
    } else if (stageLower === 'new lead') {
      let cf = lead.custom_fields;
      if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch { cf = {}; } }
      const hasActivity = cf && (cf.last_followup_remark || cf.last_call_dnp || cf.dnp_count > 0 || cf.followup_count > 0);
      if (hasActivity) ongoingCount++;
      else freshCount++;
    } else {
      ongoingCount++;
    }
  }
  
  console.log('\nPipeline Stage Distribution:');
  Object.entries(stageCounts).sort((a, b) => b[1] - a[1]).forEach(([s, c]) => console.log('  ' + s + ': ' + c));
  console.log('\nSection Distribution:');
  console.log('  Fresh: ' + freshCount);
  console.log('  Ongoing: ' + ongoingCount);
  console.log('  Not Interested: ' + notInterestedCount);
  console.log('  Total: ' + (freshCount + ongoingCount + notInterestedCount));
  
  const { count: totalHistory } = await supabase.from('lead_history').select('id', { count: 'exact', head: true }).eq('user_id', SHUBHA_USER_ID);
  console.log('\nTotal lead history entries for Shubha: ' + totalHistory);
  
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  
  const { count: todayFollowups } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', SHUBHA_USER_ID).not('next_followup', 'is', null).gte('next_followup', todayStart).lt('next_followup', todayEnd);
  const { count: pendingFollowups } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', SHUBHA_USER_ID).not('next_followup', 'is', null).lt('next_followup', todayStart);
  const { count: scheduledFollowups } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', SHUBHA_USER_ID).not('next_followup', 'is', null).gte('next_followup', todayEnd);
  
  console.log('\nNext Action Distribution:');
  console.log('  Today: ' + todayFollowups);
  console.log('  Pending (overdue): ' + pendingFollowups);
  console.log('  Scheduled (future): ' + scheduledFollowups);
  console.log('  No followup set: ' + ((totalLeads || 0) - (todayFollowups || 0) - (pendingFollowups || 0) - (scheduledFollowups || 0)));
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('===========================================');
  console.log('SHUBHA LEADS IMPORT SCRIPT');
  console.log('Started at: ' + new Date().toLocaleString());
  console.log('===========================================');
  
  try {
    const insertedLeadIds = await phase1_importLeads();
    await phase2_importHistory(insertedLeadIds);
    await phase3_verify();
    console.log('\n===========================================');
    console.log('IMPORT COMPLETE!');
    console.log('Finished at: ' + new Date().toLocaleString());
    console.log('===========================================');
  } catch (err) {
    console.error('FATAL ERROR:', err);
    process.exit(1);
  }
}

main();
