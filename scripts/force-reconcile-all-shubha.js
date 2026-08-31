const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';
const { categorizeLeadStage, DEFAULT_PIPELINE_STAGES } = require('../utils/pipeline-stages.ts');

async function forceReconcileAllShubha() {
  console.log('=== Step 1: Fetch All 1717 Shubha Leads ===');
  let allLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }
  console.log(`Fetched ${allLeads.length} leads.`);

  // Step 2: Compute target stage for EVERY lead
  const updates = [];
  let freshCount = 0;
  let nonFreshCount = 0;

  allLeads.forEach(l => {
    let cf = l.custom_fields || {};
    if (typeof cf === 'string') {
      try { cf = JSON.parse(cf); } catch (e) { cf = {}; }
    }

    const rawRemark = (
      cf?.last_followup_remark ||
      cf?.last_remark ||
      l.last_followup_remark ||
      l.last_call_remark ||
      ''
    ).trim();

    const notes = (l.notes || '').trim();
    const currentStage = (l.pipeline_stage || l.status || '').trim();

    // Check if there is any actual call/followup remark (ignoring pure opening questionnaire answers)
    let combinedText = (rawRemark + ' ' + notes).toLowerCase();

    // Filter out pure opening remarks
    const hasCallRemark = 
      rawRemark.length > 0 || 
      notes.includes('[📝 Followup') || 
      notes.includes('[⚠️ Call Not Picked') || 
      notes.includes('Stage:') ||
      notes.includes('Call on ') ||
      notes.includes('Call Not Picked on');

    let targetStage = currentStage;

    if (hasCallRemark) {
      if (
        combinedText.includes('not required') || 
        combinedText.includes('no requirement') || 
        combinedText.includes('no plan') || 
        combinedText.includes('said no plan') ||
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
      // Pure untouched new lead with NO call remarks
      targetStage = 'New Lead';
    }

    if (targetStage === 'New Lead') freshCount++;
    else nonFreshCount++;

    if (targetStage !== currentStage) {
      updates.push({ id: l.id, name: l.name, oldStage: currentStage, newStage: targetStage, remarkSnippet: rawRemark.slice(0, 50) });
    }
  });

  console.log(`\nAnalysis:`);
  console.log(`- Truly Fresh Leads (No call remarks): ${freshCount}`);
  console.log(`- Contacted / Stage Leads: ${nonFreshCount}`);
  console.log(`- Total DB stage updates to apply: ${updates.length}`);

  // Step 3: Execute updates in batches with error logging
  for (let i = 0; i < updates.length; i += 25) {
    const chunk = updates.slice(i, i + 25);
    await Promise.all(chunk.map(async u => {
      const { error } = await supabase.from('leads').update({
        pipeline_stage: u.newStage,
        status: u.newStage
      }).eq('id', u.id);
      if (error) console.error(`Failed to update ${u.id}:`, error);
    }));
    process.stdout.write(`Updated ${Math.min(i + 25, updates.length)} / ${updates.length} leads...\r`);
  }

  console.log('\n✅ Successfully updated database.');

  // Step 4: Verification of Fresh Queue
  page = 0;
  let recheckedFresh = [];
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach(l => {
      const cat = categorizeLeadStage(l, DEFAULT_PIPELINE_STAGES);
      if (cat === 'fresh') {
        let cf = l.custom_fields;
        if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch(e) {} }
        recheckedFresh.push({
          name: l.name,
          phone: l.phone,
          stage: l.pipeline_stage,
          remark: cf?.last_followup_remark || cf?.last_remark || l.notes
        });
      }
    });
    page++;
    if (data.length < 1000) break;
  }

  console.log(`\n=== FINAL VERIFIED FRESH LEADS FOR SHUBHA (${recheckedFresh.length} leads) ===`);
  recheckedFresh.forEach(f => {
    console.log(f.name.padEnd(25), '| Stage:', f.stage, '| Remark:', (f.remark || 'NONE').slice(0, 70).replace(/\n/g, ' '));
  });
}

forceReconcileAllShubha().catch(console.error);
