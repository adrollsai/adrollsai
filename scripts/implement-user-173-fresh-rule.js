const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';
const { categorizeLeadStage, DEFAULT_PIPELINE_STAGES } = require('../utils/pipeline-stages.ts');

function parseNextAction(text) {
  if (!text) return null;
  const match = text.match(/Next Action:\s*([A-Za-z]+)\s*on\s*([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4}),?\s*([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?\s*(am|pm)?/i);
  if (match) {
    const actionType = match[1];
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    let year = parseInt(match[4], 10);
    if (year < 100) year += 2000;
    let hour = parseInt(match[5], 10);
    const minute = parseInt(match[6], 10);
    const ampm = match[8]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    const d = new Date(year, month, day, hour, minute);
    if (!isNaN(d.getTime())) {
      return { date: d.toISOString(), type: actionType };
    }
  }
  const isoMatch = text.match(/Next action scheduled for\s*(\d{4}-\d{2}-\d{2}T[^\s\)]+)(?:\s*\(([^\)]+)\))?/i);
  if (isoMatch) {
    const d = new Date(isoMatch[1]);
    if (!isNaN(d.getTime())) {
      return { date: d.toISOString(), type: isoMatch[2] || 'Call' };
    }
  }
  return null;
}

async function implement173FreshRule() {
  console.log('=== Step 1: Read the 170+ Fresh Leads from Excel ===');
  const freshFiles = ['Leads fresh_2026.Aug.20.xlsx', 'Leads fresh_2026.Aug.21.xlsx'];
  const excelRows = [];
  freshFiles.forEach(f => {
    const p = path.join('C:\\Users\\Adrolls\\Downloads', f);
    if (fs.existsSync(p)) {
      const wb = XLSX.readFile(p);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      excelRows.push(...rows);
    }
  });

  const freshPhoneMap = new Map();
  excelRows.forEach(r => {
    const p = String(r['Contacts'] || r['Phone'] || r['phone'] || '').replace(/\D/g, '').slice(-10);
    if (p.length >= 7) {
      freshPhoneMap.set(p, r);
    }
  });

  console.log(`Found ${freshPhoneMap.size} unique phones in fresh Excel files.`);

  // Step 2: Fetch all leads for Shubha from DB
  let allLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }
  console.log(`Total Shubha DB leads: ${allLeads.length}`);

  // Find all DB leads that match the fresh Excel dataset
  const matchedFreshLeads = allLeads.filter(l => {
    const p = (l.phone || '').replace(/\D/g, '').slice(-10);
    return freshPhoneMap.has(p);
  });
  console.log(`Matched Fresh Leads in DB: ${matchedFreshLeads.length}`);

  // Fetch recent history (past 3 days: 2026-08-28 onwards) for these leads
  const matchedIds = matchedFreshLeads.map(l => l.id);
  const cutoffDate = '2026-08-28T00:00:00.000Z';

  const { data: recentHistory } = await supabase
    .from('lead_history')
    .select('*')
    .in('lead_id', matchedIds)
    .gte('created_at', cutoffDate)
    .order('created_at', { ascending: false });

  const recentHistoryByLeadId = new Map();
  recentHistory?.forEach(h => {
    if (!recentHistoryByLeadId.has(h.lead_id)) recentHistoryByLeadId.set(h.lead_id, h);
  });

  console.log(`Leads from fresh dataset updated by Shubha in past 2-3 days: ${recentHistoryByLeadId.size}`);

  const freshToKeepIds = [];
  const updatedStageMap = new Map(); // leadId -> { stage, nextAction }

  matchedFreshLeads.forEach(l => {
    const latestRecent = recentHistoryByLeadId.get(l.id);

    if (latestRecent) {
      // Shubha updated this lead in past 2-3 days -> assign to updated stage
      const desc = (latestRecent.description || '').toLowerCase();
      let targetStage = 'Contacted';

      if (desc.includes('moved to visit done') || desc.includes('stage: visit done')) targetStage = 'Visit Done';
      else if (desc.includes('moved to revisit done') || desc.includes('stage: revisit done')) targetStage = 'Revisit Done';
      else if (desc.includes('moved to meeting done') || desc.includes('stage: meeting done')) targetStage = 'Meeting Done';
      else if (desc.includes('moved to lost/ni') || desc.includes('stage: lost/ni') || desc.includes('no plans') || desc.includes('no requirement') || desc.includes('not looking') || desc.includes('incorrect number') || desc.includes('not intersted') || desc.includes('not interested')) targetStage = 'Lost/NI';
      else if (desc.includes('moved to plan postponed') || desc.includes('stage: plan postponed') || desc.includes('plan drop') || desc.includes('postpone')) targetStage = 'Plan Postponed';
      else if (desc.includes('moved to already purchased') || desc.includes('stage: already purchased') || desc.includes('bought property')) targetStage = 'Already Purchased';
      else if (desc.includes('moved to requirement taken') || desc.includes('stage: requirement taken')) targetStage = 'Requirement Taken';
      else if (desc.includes('moved to visit planned') || desc.includes('stage: visit planned')) targetStage = 'Visit Planned';
      else if (desc.includes('moved to dealer') || desc.includes('stage: dealer')) targetStage = 'Dealer';
      else targetStage = 'Contacted';

      const nextAction = parseNextAction(latestRecent.description);
      updatedStageMap.set(l.id, { stage: targetStage, nextAction });
    } else {
      // NOT updated in past 2-3 days -> KEEP IN FRESH (New Lead)
      freshToKeepIds.push(l.id);
    }
  });

  console.log(`\nExecution Plan:`);
  console.log(`- Keep in Fresh (New Lead): ${freshToKeepIds.length} leads`);
  console.log(`- Move to Updated Stages: ${updatedStageMap.size} leads`);

  // Execute Fresh updates in bulk
  for (let i = 0; i < freshToKeepIds.length; i += 100) {
    const chunk = freshToKeepIds.slice(i, i + 100);
    await supabase.from('leads').update({
      pipeline_stage: 'New Lead',
      status: 'New Lead'
    }).in('id', chunk);
  }
  console.log(`✅ Set ${freshToKeepIds.length} leads to 'New Lead' (Fresh).`);

  // Execute Recent stage updates
  for (const [leadId, info] of updatedStageMap.entries()) {
    const { data: lead } = await supabase.from('leads').select('custom_fields').eq('id', leadId).single();
    let cf = lead?.custom_fields || {};
    if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch(e) { cf = {}; } }

    let updatePayload = {
      pipeline_stage: info.stage,
      status: info.stage
    };

    if (info.nextAction) {
      cf.next_action_date = info.nextAction.date;
      cf.next_action_type = info.nextAction.type || 'Call';
      updatePayload.next_followup = info.nextAction.date;
      updatePayload.custom_fields = cf;
    }

    await supabase.from('leads').update(updatePayload).eq('id', leadId);
    console.log(`Updated recent lead ${leadId} to stage: ${info.stage}`);
  }

  // Final verification
  let freshCount = 0, ongoingCount = 0, notInterestedCount = 0;
  const stageBreakdown = {};
  page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach(l => {
      const st = l.pipeline_stage || l.status;
      stageBreakdown[st] = (stageBreakdown[st] || 0) + 1;
      const cat = categorizeLeadStage(l, DEFAULT_PIPELINE_STAGES);
      if (cat === 'fresh') freshCount++;
      else if (cat === 'ongoing') ongoingCount++;
      else if (cat === 'not_interested') notInterestedCount++;
    });
    page++;
    if (data.length < 1000) break;
  }

  console.log('\n=== FINAL VERIFIED BREAKDOWN FOR SHUBHA ===');
  console.log('Stage Breakdown:', stageBreakdown);
  console.log('\nCRM Categories:');
  console.log('Fresh Tab:', freshCount);
  console.log('Ongoing Tab:', ongoingCount);
  console.log('Not Interested Tab:', notInterestedCount);
}

implement173FreshRule().catch(console.error);
