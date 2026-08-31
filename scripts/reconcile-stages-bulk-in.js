const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';
const { categorizeLeadStage, DEFAULT_PIPELINE_STAGES } = require('../utils/pipeline-stages.ts');

async function bulkReconcile() {
  console.log('=== Step 1: Fetch All Shubha Leads ===');
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

  // Group lead IDs by their target stage
  const stageToIds = {
    'Lost/NI': [],
    'Plan Postponed': [],
    'Already Purchased': [],
    'Visit Done': [],
    'Visit Planned': [],
    'Requirement Taken': [],
    'Dealer': [],
    'Contacted': [],
    'New Lead': []
  };

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
    let combinedText = (rawRemark + ' ' + notes).toLowerCase();

    const hasCallRemark = 
      rawRemark.length > 0 || 
      notes.includes('[📝 Followup') || 
      notes.includes('[⚠️ Call Not Picked') || 
      notes.includes('Stage:') ||
      notes.includes('Call on ') ||
      notes.includes('Call Not Picked on') ||
      notes.includes('DNP');

    let targetStage = 'New Lead';

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
        combinedText.includes('stage: lost/ni') ||
        combinedText.includes('lost') ||
        combinedText.includes('ni')
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
      targetStage = 'New Lead';
    }

    stageToIds[targetStage].push(l.id);
  });

  console.log('\n=== Computed Target Stage Distribution ===');
  for (const [st, ids] of Object.entries(stageToIds)) {
    console.log(`${st.padEnd(20)}: ${ids.length} leads`);
  }

  // Step 2: Perform Bulk .in('id', chunk) updates atomically
  console.log('\n=== Executing Bulk Updates ===');
  for (const [st, ids] of Object.entries(stageToIds)) {
    if (ids.length === 0) continue;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await supabase.from('leads').update({
        pipeline_stage: st,
        status: st
      }).in('id', chunk);
      if (error) {
        console.error(`Error updating chunk for stage ${st}:`, error);
      }
    }
    console.log(`✅ Updated ${ids.length} leads to stage: ${st}`);
  }

  // Step 3: Final Verification
  let freshLeads = [];
  page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach(l => {
      const cat = categorizeLeadStage(l, DEFAULT_PIPELINE_STAGES);
      if (cat === 'fresh') {
        let cf = l.custom_fields;
        if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch(e) {} }
        freshLeads.push({
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

  console.log(`\n=== FINAL VERIFIED FRESH LEADS FOR SHUBHA (${freshLeads.length} leads) ===`);
  freshLeads.forEach(f => {
    console.log(f.name.padEnd(25), '| Stage:', f.stage, '| Remark:', (f.remark || 'NONE').slice(0, 60).replace(/\n/g, ' '));
  });
}

bulkReconcile().catch(console.error);
