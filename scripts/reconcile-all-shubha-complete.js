const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';
const { categorizeLeadStage, DEFAULT_PIPELINE_STAGES } = require('../utils/pipeline-stages.ts');

function parseNextAction(text) {
  if (!text) return null;
  // Match 'Next Action: Call on 9/14/2026, 3:04:00 PM' or 'Next action scheduled for 2026-09-08T05:30:00.000Z'
  const match = text.match(/Next Action:\s*([A-Za-z]+)\s*on\s*([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4}),?\s*([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?\s*(am|pm)?/i);
  if (match) {
    const actionType = match[1];
    const month = parseInt(match[2], 10) - 1; // M/D/YYYY
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

async function reconcileAllShubha() {
  console.log('=== Step 1: Fetch ALL Shubha Leads ===');
  let allLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }
  console.log(`Total Shubha leads: ${allLeads.length}`);

  // Fetch ALL history for all leads in chunks of 50
  console.log('\n=== Step 2: Fetching All History per Lead ===');
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
    process.stdout.write(`Fetched history for ${Math.min(i + 50, allLeads.length)} / ${allLeads.length} leads...\r`);
  }
  console.log(`\nHistory mapped for ${historyByLeadId.size} leads.`);

  // Step 3: Compute exact true stage and next action for each lead
  console.log('\n=== Step 3: Computing Ground Truth Updates ===');
  const updates = [];
  const todayStr = '2026-08-31';

  allLeads.forEach(l => {
    const historyList = historyByLeadId.get(l.id) || [];
    const latestHist = historyList[0];
    const notes = l.notes || '';
    const currentStage = (l.pipeline_stage || l.status || '').trim();

    let properStage = currentStage;
    let nextAction = null;

    // Check history first (highest priority)
    if (latestHist) {
      const desc = (latestHist.description || '').toLowerCase();
      if (desc.includes('moved to visit done') || desc.includes('stage: visit done')) properStage = 'Visit Done';
      else if (desc.includes('moved to revisit done') || desc.includes('stage: revisit done')) properStage = 'Revisit Done';
      else if (desc.includes('moved to meeting done') || desc.includes('stage: meeting done')) properStage = 'Meeting Done';
      else if (desc.includes('moved to lost/ni') || desc.includes('stage: lost/ni') || desc.includes('no plans') || desc.includes('no requirement') || desc.includes('not looking for property') || desc.includes('incorrect number') || desc.includes('not intersted')) properStage = 'Lost/NI';
      else if (desc.includes('moved to plan postponed') || desc.includes('stage: plan postponed') || desc.includes('plan drop')) properStage = 'Plan Postponed';
      else if (desc.includes('moved to already purchased') || desc.includes('stage: already purchased') || desc.includes('bought property')) properStage = 'Already Purchased';
      else if (desc.includes('moved to requirement taken') || desc.includes('stage: requirement taken')) properStage = 'Requirement Taken';
      else if (desc.includes('moved to visit planned') || desc.includes('stage: visit planned')) properStage = 'Visit Planned';
      else if (desc.includes('moved to dealer') || desc.includes('stage: dealer')) properStage = 'Dealer';
      else if (properStage === 'New Lead' || properStage === 'New') {
        properStage = 'Contacted';
      }

      // Check for scheduled next action in history entries
      for (const h of historyList) {
        const parsed = parseNextAction(h.description);
        if (parsed) {
          nextAction = parsed;
          break;
        }
      }
    }

    // Also check notes for next actions or stage updates if not in history
    if (!nextAction && (notes.includes('Next action scheduled for') || notes.includes('Next Action:'))) {
      nextAction = parseNextAction(notes);
    }

    if (notes.includes('[📝 Followup') || notes.includes('[⚠️ Call Not Picked')) {
      const stageMatch = notes.match(/Stage:\s*([^.\n]+)/i);
      if (stageMatch && stageMatch[1]) {
        const raw = stageMatch[1].trim().toLowerCase();
        if (raw.includes('lost') || raw.includes('ni') || raw.includes('not interested')) properStage = 'Lost/NI';
        else if (raw.includes('postponed')) properStage = 'Plan Postponed';
        else if (raw.includes('purchased')) properStage = 'Already Purchased';
        else if (raw.includes('visit done')) properStage = 'Visit Done';
        else if (raw.includes('visit planned')) properStage = 'Visit Planned';
        else if (raw.includes('requirement taken')) properStage = 'Requirement Taken';
        else if (raw.includes('dealer')) properStage = 'Dealer';
      } else if (properStage === 'New Lead' || properStage === 'New') {
        properStage = 'Contacted';
      }
    }

    let cf = l.custom_fields || {};
    if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) { cf = {}; } }

    let nextFollowupVal = null;
    if (nextAction) {
      // Validate date is not past/overdue
      const d = new Date(nextAction.date);
      const istStr = new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      if (istStr >= todayStr) {
        nextFollowupVal = nextAction.date;
        cf.next_action_date = nextAction.date;
        cf.next_action_type = nextAction.type || 'Call';
      } else {
        delete cf.next_action_date;
        delete cf.next_action_type;
        delete cf.next_followup;
      }
    } else {
      delete cf.next_action_date;
      delete cf.next_action_type;
      delete cf.next_followup;
    }

    const needsStageUpdate = properStage !== currentStage;
    const needsNextActionUpdate = l.next_followup !== nextFollowupVal;

    if (needsStageUpdate || needsNextActionUpdate) {
      updates.push({
        id: l.id,
        name: l.name,
        stage: properStage,
        next_followup: nextFollowupVal,
        custom_fields: cf
      });
    }
  });

  console.log(`Total leads requiring ground-truth updates: ${updates.length}`);

  // Step 4: Fast parallel execution in chunks of 50
  console.log('\n=== Step 4: Executing Updates ===');
  for (let i = 0; i < updates.length; i += 50) {
    const chunk = updates.slice(i, i + 50);
    await Promise.all(chunk.map(u => 
      supabase.from('leads').update({
        pipeline_stage: u.stage,
        status: u.stage,
        next_followup: u.next_followup,
        custom_fields: u.custom_fields
      }).eq('id', u.id)
    ));
    process.stdout.write(`Updated ${Math.min(i + 50, updates.length)} / ${updates.length} leads...\r`);
  }
  console.log(`\n✅ Finished updating all ${updates.length} leads.`);

  // Final verification
  console.log('\n=== FINAL VERIFIED DASHBOARD COUNTS FOR SHUBHA ===');
  let fresh = 0, ongoing = 0, notInterested = 0;
  let pCount = 0, tCount = 0, sCount = 0;
  const stageBreakdown = {};

  page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach(l => {
      const st = l.pipeline_stage || l.status;
      stageBreakdown[st] = (stageBreakdown[st] || 0) + 1;
      const cat = categorizeLeadStage(l, DEFAULT_PIPELINE_STAGES);
      if (cat === 'fresh') fresh++;
      else if (cat === 'ongoing') ongoing++;
      else if (cat === 'not_interested') notInterested++;

      let cf = l.custom_fields;
      if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) {} }
      const nextDate = l.next_followup || cf?.next_action_date;
      if (nextDate) {
        const d = new Date(nextDate);
        const istStr = new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
        if (istStr < todayStr) pCount++;
        else if (istStr === todayStr) tCount++;
        else sCount++;
      }
    });
    page++;
    if (data.length < 1000) break;
  }

  console.log('Stage Breakdown:', stageBreakdown);
  console.log('\nCRM Categories:');
  console.log('Fresh (Untouched):', fresh);
  console.log('Ongoing (In-Progress / Followed Up):', ongoing);
  console.log('Not Interested (Lost / Postponed / Closed):', notInterested);
  console.log('\nAction Manager:');
  console.log('Pending (P):', pCount);
  console.log('Today (T):', tCount);
  console.log('Scheduled (S):', sCount);
}

reconcileAllShubha().catch(console.error);
