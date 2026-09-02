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
    if (!isNaN(d.getTime())) return { date: d.toISOString(), type: actionType, source: 'Next Action regex' };
  }
  const isoMatch = text.match(/Next action scheduled for\s*(\d{4}-\d{2}-\d{2}T[^\s\)]+)(?:\s*\(([^\)]+)\))?/i);
  if (isoMatch) {
    const d = new Date(isoMatch[1]);
    if (!isNaN(d.getTime())) return { date: d.toISOString(), type: isoMatch[2] || 'Call', source: 'ISO regex' };
  }
  return null;
}

async function auditScheduledActions() {
  console.log('=== Step 1: Fetch all Shubha leads from DB ===');
  let allLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }
  console.log(`Total Shubha leads in DB: ${allLeads.length}`);

  // Fetch all history entries logged by Shubha in chunks of 50 leads
  console.log('=== Step 2: Fetch history for all Shubha leads ===');
  const historyByLeadId = new Map();
  for (let i = 0; i < allLeads.length; i += 50) {
    const chunkIds = allLeads.slice(i, i + 50).map(l => l.id);
    const { data: hist } = await supabase
      .from('lead_history')
      .select('*')
      .in('lead_id', chunkIds)
      .order('created_at', { ascending: false });
    if (hist) {
      hist.forEach(h => {
        if (!historyByLeadId.has(h.lead_id)) historyByLeadId.set(h.lead_id, []);
        historyByLeadId.get(h.lead_id).push(h);
      });
    }
  }
  console.log(`History mapped for ${historyByLeadId.size} leads.`);

  // Find all scheduled actions in History
  const historyScheduledMap = new Map();
  for (const [leadId, histList] of historyByLeadId.entries()) {
    for (const h of histList) {
      const parsed = parseNextAction(h.description);
      if (parsed) {
        historyScheduledMap.set(leadId, {
          date: parsed.date,
          type: parsed.type,
          created_at: h.created_at,
          desc: h.description
        });
        break;
      }
    }
  }
  console.log(`Total leads with scheduled action in History: ${historyScheduledMap.size}`);

  // Also check notes for scheduled actions
  const notesScheduledMap = new Map();
  allLeads.forEach(l => {
    const n = l.notes || '';
    if (n.includes('Next action scheduled for') || n.includes('Next Action:')) {
      const parsed = parseNextAction(n);
      if (parsed) {
        notesScheduledMap.set(l.id, {
          date: parsed.date,
          type: parsed.type,
          desc: 'From notes'
        });
      }
    }
  });
  console.log(`Total leads with scheduled action in Notes: ${notesScheduledMap.size}`);

  // Combined total unique scheduled actions created by Shubha
  const totalCombinedScheduledMap = new Map([...historyScheduledMap, ...notesScheduledMap]);
  console.log(`Total combined unique leads with scheduled action in History/Notes: ${totalCombinedScheduledMap.size}`);

  // Check how many of these are future (> 2026-08-31)
  const todayStr = '2026-08-31';
  let totalFutureScheduled = 0;
  let totalTodayScheduled = 0;
  let totalPastScheduled = 0;

  for (const [leadId, sched] of totalCombinedScheduledMap.entries()) {
    const d = new Date(sched.date);
    const istStr = new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    if (istStr > todayStr) totalFutureScheduled++;
    else if (istStr === todayStr) totalTodayScheduled++;
    else totalPastScheduled++;
  }

  console.log(`\n--- Ground Truth Scheduled Actions Created by Shubha ---`);
  console.log(`Future Scheduled (> 2026-08-31): ${totalFutureScheduled}`);
  console.log(`Today Scheduled (== 2026-08-31): ${totalTodayScheduled}`);
  console.log(`Past/Overdue Scheduled (< 2026-08-31): ${totalPastScheduled}`);

  // Check current DB status on leads table
  let dbFutureScheduled = 0;
  let dbToday = 0;
  let dbPast = 0;
  const dbFutureByStage = {};
  const dbFutureByCategory = { fresh: 0, ongoing: 0, not_interested: 0, trash: 0 };

  allLeads.forEach(l => {
    let cf = l.custom_fields;
    if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch(e) {} }
    const nextDate = l.next_followup || cf?.next_action_date;

    if (nextDate) {
      const d = new Date(nextDate);
      const istStr = new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      const st = l.pipeline_stage || l.status;
      const cat = categorizeLeadStage(l, DEFAULT_PIPELINE_STAGES);

      if (istStr > todayStr) {
        dbFutureScheduled++;
        dbFutureByStage[st] = (dbFutureByStage[st] || 0) + 1;
        dbFutureByCategory[cat] = (dbFutureByCategory[cat] || 0) + 1;
      } else if (istStr === todayStr) {
        dbToday++;
      } else {
        dbPast++;
      }
    }
  });

  console.log(`\n--- Current Active next_followup in Leads Table ---`);
  console.log(`Future Scheduled (> 2026-08-31) in DB: ${dbFutureScheduled}`);
  console.log(`Today (== 2026-08-31) in DB: ${dbToday}`);
  console.log(`Past (< 2026-08-31) in DB: ${dbPast}`);

  console.log('\n--- Active Future Scheduled Breakdown by Stage ---');
  console.log(dbFutureByStage);

  console.log('\n--- Active Future Scheduled Breakdown by Category ---');
  console.log(dbFutureByCategory);

  console.log(`\nAction Manager UI "S" Value (Only Fresh + Ongoing): ${dbFutureByCategory.fresh + dbFutureByCategory.ongoing}`);
  console.log(`Future Scheduled Actions currently suppressed because lead is in "Not Interested": ${dbFutureByCategory.not_interested}`);
}

auditScheduledActions().catch(console.error);
