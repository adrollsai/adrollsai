const xlsx = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function normalizePhone(p) {
  if (!p) return '';
  let s = String(p).replace(/\D/g, '');
  if (s.length >= 10) return s.slice(-10);
  return s;
}

function parseDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const str = dateStr.trim();
  if (!str) return null;
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!match) return null;
  const [, day, month, year, hourRaw, minute, ampm] = match;
  let hour = parseInt(hourRaw, 10);
  if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
  const isoStr = year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0') + 'T' + String(hour).padStart(2, '0') + ':' + minute + ':00+05:30';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch { return null; }
}

function parseActionDetails(nextFollowupStr) {
  if (!nextFollowupStr || typeof nextFollowupStr !== 'string') {
    return { type: 'Call', remark: '' };
  }
  const lines = nextFollowupStr.split('\n').map(l => l.trim()).filter(Boolean);
  const firstLine = lines[0] || '';
  let type = 'Call';
  if (firstLine.toLowerCase().includes('visit')) type = 'Site Visit';
  else if (firstLine.toLowerCase().includes('revisit')) type = 'Revisit';
  else if (firstLine.toLowerCase().includes('meeting')) type = 'Meeting';

  const remark = lines.slice(1).join(' ').trim();
  return { type, remark };
}

function extractStagesFromProfile(profile) {
  if (!profile || !profile.badges) return [];
  const stageBadge = profile.badges.find(b => typeof b === 'string' && b.startsWith('__PIPELINE_STAGES__:'));
  if (!stageBadge) return [];
  try { return JSON.parse(stageBadge.replace('__PIPELINE_STAGES__:', '')); } catch (e) { return []; }
}

function categorizeLeadStage(rawStageOrLead, customStages) {
  if (!rawStageOrLead) return 'fresh';
  let stageStr = '';
  let cf = null;
  let hasDnpOrActiveFollowup = false;

  if (typeof rawStageOrLead === 'object' && rawStageOrLead !== null) {
    stageStr = (rawStageOrLead.pipeline_stage || rawStageOrLead.status || '').trim();
    cf = rawStageOrLead.custom_fields;
    if (typeof cf === 'string') { try { while (typeof cf === 'string') cf = JSON.parse(cf); } catch (e) { cf = null; } }
    if (!stageStr && cf) stageStr = (cf.pipeline_stage || cf.status || cf.lead_status || cf.client_status || '').trim();

    const dnpCount = rawStageOrLead.dnp_count || cf?.dnp_count || 0;
    const isDnp = rawStageOrLead.last_call_dnp === true || cf?.last_call_dnp === true;
    const hasNextFollowup = !!rawStageOrLead.next_followup || !!cf?.next_action_date;
    if (dnpCount > 0 || isDnp || hasNextFollowup) hasDnpOrActiveFollowup = true;
  } else if (typeof rawStageOrLead === 'string') {
    stageStr = rawStageOrLead.trim();
  }

  if (!stageStr) return 'fresh';
  const normalized = stageStr.toLowerCase();
  if (normalized === 'trash' || normalized === 'deleted' || normalized === 'archived') return 'trash';

  if (Array.isArray(customStages) && customStages.length > 0) {
    const matched = customStages.find(s => s.name.trim().toLowerCase() === normalized || s.id.toLowerCase() === normalized);
    if (matched) {
      if (matched.category === 'fresh') return hasDnpOrActiveFollowup ? 'ongoing' : 'fresh';
      return matched.category;
    }
  }

  if (
    normalized.includes('lost') || normalized.includes('ni') || normalized.includes('not interested') ||
    normalized.includes('not_interested') || normalized.includes('junk') || normalized.includes('unqualified') ||
    normalized.includes('dealer') || normalized.includes('postponed') || normalized.includes('already purchased') ||
    normalized.includes('different requirement') || normalized.includes('wrong number') || normalized.includes('fake')
  ) return 'not_interested';

  if (['new', 'new lead', 'unprocessed', 'fresh', 'fresh lead', 'uncontacted'].includes(normalized)) {
    return hasDnpOrActiveFollowup ? 'ongoing' : 'fresh';
  }
  return 'ongoing';
}

async function executeTransfer() {
  console.log('=== Step 1: Loading Profiles, Pipeline Stages & Excel Data ===');
  const shubhaId = '07db7180-6fac-4055-86ee-8b3748590f56';
  const adminId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

  const { data: adminProfile } = await supabase.from('profiles').select('*').eq('id', adminId).single();
  const stages = extractStagesFromProfile(adminProfile);

  const wb = xlsx.readFile('C:/Users/Adrolls/Downloads/shubha ongoing.xlsx');
  const excelRows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  console.log(`Excel file contains ${excelRows.length} leads.`);

  console.log('\n=== Step 2: Fetching Current Shubha Leads from DB ===');
  let allShubhaLeads = [];
  let from = 0;
  while (true) {
    const { data } = await supabase.from('leads')
      .select('id, name, phone, email, status, pipeline_stage, assigned_to, user_id, custom_fields, next_followup, notes, created_at')
      .eq('assigned_to', shubhaId)
      .order('id')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    allShubhaLeads = allShubhaLeads.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Fetched ${allShubhaLeads.length} leads currently assigned to Shubha in DB.`);

  const dbMap = new Map();
  allShubhaLeads.forEach(l => {
    const norm = normalizePhone(l.phone);
    if (norm) dbMap.set(norm, l);
  });

  // Check 1 missing lead: Sumit munjal
  const { data: sumitLeads } = await supabase.from('leads').select('*').ilike('phone', '%8559011375%');
  const sumitLead = sumitLeads && sumitLeads.length > 0 ? sumitLeads[0] : null;

  const untouchedOngoing = [];
  const leadsToUpdate = [];

  excelRows.forEach(r => {
    const norm = normalizePhone(r['Contacts']);
    let dbLead = dbMap.get(norm);
    let isSumit = false;
    if (!dbLead && norm === '8559011375' && sumitLead) {
      dbLead = sumitLead;
      isSumit = true;
    }

    if (!dbLead) {
      console.warn('Could not find lead in DB:', r['Lead Name'], r['Contacts']);
      return;
    }

    const currentCat = isSumit ? 'fresh' : categorizeLeadStage(dbLead, stages);
    if (currentCat === 'ongoing' && !isSumit) {
      untouchedOngoing.push(dbLead.id);
      return;
    }

    // Determine target stage
    const excelStage = (r['Lead Status'] || '').trim();
    let targetStage = excelStage;
    let isSpecial30 = false;
    if (excelStage === 'Plan Postponed' || excelStage === 'Already Purchased') {
      targetStage = 'Requirement Taken';
      isSpecial30 = true;
    }

    const nextFollowupIso = parseDate(r['Next Followup Date']);
    const { type: nextActionType, remark: nextActionRemark } = parseActionDetails(r['Next Followup']);
    const lastRemark = (r['Last Remarks'] || '').trim();

    // Prepare updated custom_fields
    let cf = dbLead.custom_fields || {};
    if (typeof cf === 'string') {
      try { cf = JSON.parse(cf); } catch (e) { cf = {}; }
    }
    const updatedCf = {
      ...cf,
      next_action_date: nextFollowupIso,
      next_action_type: nextActionType,
      next_action_remark: nextActionRemark,
      last_followup_remark: lastRemark,
      pipeline_stage: targetStage,
      status: targetStage
    };
    if (isSpecial30) {
      updatedCf.original_excel_status = excelStage;
    }

    // Prepare clean note entry
    const timestampStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const followupInfo = nextFollowupIso ? ` [Scheduled Next Action: ${nextActionType} on ${r['Next Followup Date']}]` : '';
    const noteEntry = `[🔄 Reconciled to Ongoing (${targetStage}) - ${timestampStr}]: Restored to ${targetStage} from downloaded ongoing records.${followupInfo}${nextActionRemark ? ' Remarks: ' + nextActionRemark : ''}`;
    const existingNotes = (dbLead.notes || '').trim();
    const updatedNotes = existingNotes ? `${noteEntry}\n\n${existingNotes}` : noteEntry;

    leadsToUpdate.push({
      leadId: dbLead.id,
      name: r['Lead Name'],
      phone: r['Contacts'],
      targetStage,
      excelStage,
      nextFollowupIso,
      nextActionType,
      nextActionRemark,
      updatedNotes,
      updatedCf,
      isSumit
    });
  });

  console.log(`\n=== Verification Before Execution ===`);
  console.log(`Untouched ongoing leads: ${untouchedOngoing.length} (ZERO CHANGES)`);
  console.log(`Total leads to update: ${leadsToUpdate.length}`);

  if (leadsToUpdate.length === 0) {
    console.log('No leads to update.');
    return;
  }

  console.log('\n=== Step 3: Executing Database Updates in Batches ===');
  let successCount = 0;
  let failCount = 0;
  const historyEntries = [];

  for (let i = 0; i < leadsToUpdate.length; i++) {
    const item = leadsToUpdate[i];

    const updatePayload = {
      pipeline_stage: item.targetStage,
      status: item.targetStage,
      next_followup: item.nextFollowupIso,
      assigned_to: shubhaId,
      notes: item.updatedNotes,
      custom_fields: item.updatedCf
    };

    const { error: updErr } = await supabase
      .from('leads')
      .update(updatePayload)
      .eq('id', item.leadId);

    if (updErr) {
      console.error(`Error updating lead ${item.leadId} (${item.name}):`, updErr.message);
      failCount++;
    } else {
      successCount++;
      historyEntries.push({
        lead_id: item.leadId,
        user_id: shubhaId,
        action_type: 'STAGE_CHANGE',
        description: `Stage updated to ${item.targetStage} (Reconciled from previous ongoing data: original status was ${item.excelStage}). Next Action: ${item.nextActionType} scheduled.`,
        created_at: new Date().toISOString()
      });
    }

    if ((i + 1) % 50 === 0 || i === leadsToUpdate.length - 1) {
      console.log(`Progress: ${i + 1} / ${leadsToUpdate.length} leads processed (${successCount} succeeded, ${failCount} failed)...`);
    }
  }

  console.log(`\n=== Step 4: Inserting Lead History Records ===`);
  // Insert in batches of 50
  for (let i = 0; i < historyEntries.length; i += 50) {
    const batch = historyEntries.slice(i, i + 50);
    const { error: histErr } = await supabase.from('lead_history').insert(batch);
    if (histErr) {
      console.error('Error inserting history batch:', histErr.message);
    }
  }
  console.log(`Inserted ${historyEntries.length} lead_history records.`);

  console.log('\n=== Step 5: Post-Update Verification ===');
  // Re-fetch Shubha leads to verify exact numbers
  let verifiedLeads = [];
  from = 0;
  while (true) {
    const { data } = await supabase.from('leads')
      .select('id, name, phone, email, status, pipeline_stage, assigned_to, custom_fields, next_followup')
      .eq('assigned_to', shubhaId)
      .order('id')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    verifiedLeads = verifiedLeads.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const verifiedCatCounts = { fresh: 0, ongoing: 0, not_interested: 0, trash: 0 };
  const verifiedStageCounts = {};

  verifiedLeads.forEach(l => {
    const cat = categorizeLeadStage(l, stages);
    verifiedCatCounts[cat] = (verifiedCatCounts[cat] || 0) + 1;
    const st = (l.pipeline_stage || l.status || '(none)').trim();
    if (cat === 'ongoing') {
      verifiedStageCounts[st] = (verifiedStageCounts[st] || 0) + 1;
    }
  });

  console.log('Total Shubha leads in DB now:', verifiedLeads.length);
  console.log('Category breakdown now:', verifiedCatCounts);
  console.log('Ongoing stages breakdown now:', verifiedStageCounts);

  // Check how many of the 555 Excel leads are in Ongoing now
  const verifiedPhoneMap = new Map();
  verifiedLeads.forEach(l => {
    const norm = normalizePhone(l.phone);
    if (norm) verifiedPhoneMap.set(norm, l);
  });

  let excelInOngoingNow = 0;
  let excelNotInOngoingNow = 0;
  excelRows.forEach(r => {
    const norm = normalizePhone(r['Contacts']);
    const l = verifiedPhoneMap.get(norm);
    if (l && categorizeLeadStage(l, stages) === 'ongoing') {
      excelInOngoingNow++;
    } else {
      excelNotInOngoingNow++;
    }
  });

  console.log(`\n=== 555 EXCEL LEADS RECONCILIATION RESULT ===`);
  console.log(`Excel leads now in Ongoing: ${excelInOngoingNow} / 555`);
  console.log(`Excel leads NOT in Ongoing: ${excelNotInOngoingNow} / 555`);
}

executeTransfer();
