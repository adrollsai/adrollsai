const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';
const { categorizeLeadStage, DEFAULT_PIPELINE_STAGES } = require('../utils/pipeline-stages.ts');

async function reconcileAllRemarksToStages() {
  console.log('=== Step 1: Fetch All Leads Assigned to Shubha ===');
  let allLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }
  console.log(`Total Shubha leads fetched: ${allLeads.length}`);

  const updates = [];
  let trulyFreshCount = 0;
  let movedFromFreshCount = 0;

  allLeads.forEach(l => {
    let cf = l.custom_fields || {};
    if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch (e) { cf = {}; } }

    const rawRemark = (
      cf.last_followup_remark || 
      cf.last_remark || 
      l.last_followup_remark || 
      l.last_call_remark || 
      ''
    ).trim();

    const notes = (l.notes || '').trim();
    const currentStage = (l.pipeline_stage || l.status || '').trim();

    let combinedText = (rawRemark + ' ' + notes).toLowerCase();

    let targetStage = currentStage;

    // Check if there are any remarks/followups recorded
    const hasAnyRemark = rawRemark.length > 0 || notes.includes('[📝') || notes.includes('[⚠️') || notes.includes('Stage:');

    if (hasAnyRemark) {
      if (
        combinedText.includes('not required') || 
        combinedText.includes('no requirement') || 
        combinedText.includes('no plan') || 
        combinedText.includes('not looking') || 
        combinedText.includes('not interested') || 
        combinedText.includes('not intersted') || 
        combinedText.includes('incorrect number') || 
        combinedText.includes('wrong number') || 
        combinedText.includes('lost/ni') ||
        combinedText.includes('stage: lost/ni')
      ) {
        targetStage = 'Lost/NI';
      } else if (
        combinedText.includes('postpon') || 
        combinedText.includes('plan drop') ||
        combinedText.includes('stage: plan postponed')
      ) {
        targetStage = 'Plan Postponed';
      } else if (
        combinedText.includes('purchased') || 
        combinedText.includes('bought property') || 
        combinedText.includes('already invested') ||
        combinedText.includes('stage: already purchased')
      ) {
        targetStage = 'Already Purchased';
      } else if (
        combinedText.includes('visit done') || 
        combinedText.includes('stage: visit done')
      ) {
        targetStage = 'Visit Done';
      } else if (
        combinedText.includes('visit planned') || 
        combinedText.includes('stage: visit planned') ||
        combinedText.includes('will visit') ||
        combinedText.includes('schedule visit')
      ) {
        targetStage = 'Visit Planned';
      } else if (
        combinedText.includes('asking for') || 
        combinedText.includes('pitched') || 
        combinedText.includes('bhk') || 
        combinedText.includes('sq yd') || 
        combinedText.includes('budget') || 
        combinedText.includes('plot') || 
        combinedText.includes('villa') || 
        combinedText.includes('flat') || 
        combinedText.includes('stage: requirement taken') ||
        combinedText.includes('looking for')
      ) {
        targetStage = 'Requirement Taken';
      } else if (
        combinedText.includes('dealer') || 
        combinedText.includes('stage: dealer')
      ) {
        targetStage = 'Dealer';
      } else {
        targetStage = 'Contacted';
      }
    } else {
      // Truly uncontacted / untouched lead
      targetStage = 'New Lead';
    }

    if (currentStage === 'New Lead' || currentStage === 'New') {
      if (targetStage === 'New Lead') trulyFreshCount++;
      else movedFromFreshCount++;
    }

    if (targetStage !== currentStage) {
      updates.push({ id: l.id, name: l.name, oldStage: currentStage, newStage: targetStage });
    }
  });

  console.log(`\nClassification Summary:`);
  console.log(`- Truly untouched fresh leads (No remarks anywhere): ${trulyFreshCount}`);
  console.log(`- Leads in New Lead that had remarks and moved to proper stages: ${movedFromFreshCount}`);
  console.log(`- Total stage updates to execute: ${updates.length}`);

  // Step 2: Parallel Batch Update in chunks of 50
  for (let i = 0; i < updates.length; i += 50) {
    const chunk = updates.slice(i, i + 50);
    await Promise.all(chunk.map(u => 
      supabase.from('leads').update({
        pipeline_stage: u.newStage,
        status: u.newStage
      }).eq('id', u.id)
    ));
    process.stdout.write(`Updated ${Math.min(i + 50, updates.length)} / ${updates.length} leads...\r`);
  }

  console.log(`\n✅ Finished updating database.`);

  // Step 3: Verify Final Counts
  let finalFresh = 0, finalOngoing = 0, finalNotInterested = 0;
  const stageBreakdown = {};

  page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach(l => {
      const st = l.pipeline_stage || l.status;
      stageBreakdown[st] = (stageBreakdown[st] || 0) + 1;
      const cat = categorizeLeadStage(l, DEFAULT_PIPELINE_STAGES);
      if (cat === 'fresh') finalFresh++;
      else if (cat === 'ongoing') finalOngoing++;
      else if (cat === 'not_interested') finalNotInterested++;
    });
    page++;
    if (data.length < 1000) break;
  }

  console.log('\n=== FINAL RECONCILED STAGE BREAKDOWN FOR SHUBHA ===');
  console.log(stageBreakdown);
  console.log('\n=== CRM TAB COUNTS ===');
  console.log('Fresh Tab (Truly Untouched):', finalFresh);
  console.log('Ongoing Tab (Contacted / Requirements / Visits):', finalOngoing);
  console.log('Not Interested Tab (Lost / Postponed / Closed):', finalNotInterested);
}

reconcileAllRemarksToStages().catch(console.error);
