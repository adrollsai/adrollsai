const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';
const { categorizeLeadStage, DEFAULT_PIPELINE_STAGES } = require('../utils/pipeline-stages.ts');

async function fixRemainingFresh() {
  console.log('=== Step 1: Fetch all leads for Shubha ===');
  let allLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }

  const stageGroups = {
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

    const cfRemark = (cf?.last_followup_remark || cf?.last_remark || '').trim();
    const leadRemark = (l.last_followup_remark || l.last_call_remark || '').trim();
    const notes = (l.notes || '').trim();

    const fullText = (cfRemark + ' ' + leadRemark + ' ' + notes).toLowerCase();

    // Check if there is any call/followup remark (exclude pure questionnaire/ad questions)
    const hasRemark = 
      cfRemark.length > 0 || 
      leadRemark.length > 0 ||
      notes.includes('[Last Remarks]') ||
      notes.includes('[📝') ||
      notes.includes('[⚠️') ||
      notes.includes('Call on ') ||
      notes.includes('Call Not Picked on') ||
      notes.includes('DNP') ||
      notes.includes('Stage:');

    let st = 'New Lead';

    if (hasRemark) {
      if (
        fullText.includes('no plan') ||
        fullText.includes('said no plan') ||
        fullText.includes('not required') ||
        fullText.includes('no requirement') ||
        fullText.includes('not looking') ||
        fullText.includes('not interested') ||
        fullText.includes('not intersted') ||
        fullText.includes('incorrect number') ||
        fullText.includes('wrong number') ||
        fullText.includes('lost/ni') ||
        fullText.includes('stage: lost/ni') ||
        fullText.includes('lost') ||
        fullText.includes('ni')
      ) {
        st = 'Lost/NI';
      } else if (
        fullText.includes('postpon') ||
        fullText.includes('plan drop') ||
        fullText.includes('stage: plan postponed')
      ) {
        st = 'Plan Postponed';
      } else if (
        fullText.includes('purchased') ||
        fullText.includes('bought') ||
        fullText.includes('already invested') ||
        fullText.includes('stage: already purchased')
      ) {
        st = 'Already Purchased';
      } else if (
        fullText.includes('visit done') ||
        fullText.includes('stage: visit done')
      ) {
        st = 'Visit Done';
      } else if (
        fullText.includes('visit planned') ||
        fullText.includes('planned meeting') ||
        fullText.includes('schedule visit') ||
        fullText.includes('will visit') ||
        fullText.includes('stage: visit planned')
      ) {
        st = 'Visit Planned';
      } else if (
        fullText.includes('asking for') ||
        fullText.includes('pitched') ||
        fullText.includes('plot') ||
        fullText.includes('bhk') ||
        fullText.includes('sq yd') ||
        fullText.includes('budget') ||
        fullText.includes('villa') ||
        fullText.includes('flat') ||
        fullText.includes('looking for') ||
        fullText.includes('stage: requirement taken')
      ) {
        st = 'Requirement Taken';
      } else if (
        fullText.includes('dealer') ||
        fullText.includes('stage: dealer')
      ) {
        st = 'Dealer';
      } else {
        st = 'Contacted';
      }
    } else {
      st = 'New Lead';
    }

    stageGroups[st].push(l.id);
  });

  console.log('=== Target Stage Distribution ===');
  for (const [st, ids] of Object.entries(stageGroups)) {
    console.log(`${st.padEnd(20)}: ${ids.length}`);
  }

  // Update in DB with bulk .in('id', chunk)
  for (const [st, ids] of Object.entries(stageGroups)) {
    if (ids.length === 0) continue;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      await supabase.from('leads').update({
        pipeline_stage: st,
        status: st
      }).in('id', chunk);
    }
  }
  console.log('✅ DB update completed.');

  // Final verification
  let freshList = [];
  page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach(l => {
      const cat = categorizeLeadStage(l, DEFAULT_PIPELINE_STAGES);
      if (cat === 'fresh') {
        let cf = l.custom_fields;
        if (typeof cf === 'string') { try { cf = JSON.parse(cf); } catch(e) {} }
        freshList.push({
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

  console.log(`\n=== VERIFIED TRULY FRESH LEADS (${freshList.length} leads) ===`);
  freshList.forEach(f => {
    console.log(f.name.padEnd(25), '| Phone:', f.phone, '| Stage:', f.stage, '| Remark:', (f.remark || 'NONE').slice(0, 60).replace(/\n/g, ' '));
  });
}

fixRemainingFresh().catch(console.error);
