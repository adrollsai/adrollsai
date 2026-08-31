const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';
const { categorizeLeadStage, DEFAULT_PIPELINE_STAGES } = require('../utils/pipeline-stages.ts');

async function reconcileShubhaStages() {
  console.log('=== Step 1: Fetch all Shubha Leads & History ===');
  let allLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }

  // Fetch all history for Shubha leads
  const { data: allHistory } = await supabase
    .from('lead_history')
    .select('*')
    .eq('user_id', SHUBHA_ID)
    .order('created_at', { ascending: false });

  console.log(`Fetched ${allLeads.length} leads and ${allHistory?.length} history entries for Shubha.`);

  const leadLatestHist = new Map();
  allHistory.forEach(h => {
    if (!h.lead_id || leadLatestHist.has(h.lead_id)) return;
    leadLatestHist.set(h.lead_id, h);
  });

  const updates = [];

  allLeads.forEach(l => {
    const latestHist = leadLatestHist.get(l.id);
    const notes = l.notes || '';
    const currentStage = (l.pipeline_stage || l.status || '').trim();

    let targetStage = currentStage;

    // Check latest history entry from Nobogent
    if (latestHist) {
      const desc = (latestHist.description || '').toLowerCase();
      if (desc.includes('moved to visit done') || desc.includes('stage: visit done')) targetStage = 'Visit Done';
      else if (desc.includes('moved to revisit done') || desc.includes('stage: revisit done')) targetStage = 'Revisit Done';
      else if (desc.includes('moved to meeting done') || desc.includes('stage: meeting done')) targetStage = 'Meeting Done';
      else if (desc.includes('moved to lost/ni') || desc.includes('stage: lost/ni') || desc.includes('no plans') || desc.includes('no requirement')) targetStage = 'Lost/NI';
      else if (desc.includes('moved to plan postponed') || desc.includes('stage: plan postponed')) targetStage = 'Plan Postponed';
      else if (desc.includes('moved to already purchased') || desc.includes('stage: already purchased')) targetStage = 'Already Purchased';
      else if (desc.includes('moved to requirement taken') || desc.includes('stage: requirement taken')) targetStage = 'Requirement Taken';
      else if (desc.includes('moved to visit planned') || desc.includes('stage: visit planned')) targetStage = 'Visit Planned';
      else if (desc.includes('moved to dealer') || desc.includes('stage: dealer')) targetStage = 'Dealer';
      else if (currentStage === 'New Lead' || currentStage === 'New') {
        if (desc.includes('call') || desc.includes('dnp') || desc.includes('followup')) {
          targetStage = 'Contacted';
        }
      }
    } else if (notes.includes('[📝 Followup') || notes.includes('[⚠️ Call Not Picked')) {
      const stageMatch = notes.match(/Stage:\s*([^.\n]+)/i);
      if (stageMatch && stageMatch[1]) {
        const raw = stageMatch[1].trim();
        if (raw.toLowerCase().includes('lost') || raw.toLowerCase().includes('ni')) targetStage = 'Lost/NI';
        else if (raw.toLowerCase().includes('postponed')) targetStage = 'Plan Postponed';
        else if (raw.toLowerCase().includes('purchased')) targetStage = 'Already Purchased';
        else if (raw.toLowerCase().includes('visit done')) targetStage = 'Visit Done';
        else if (raw.toLowerCase().includes('visit planned')) targetStage = 'Visit Planned';
        else if (raw.toLowerCase().includes('requirement taken')) targetStage = 'Requirement Taken';
        else if (raw.toLowerCase().includes('dealer')) targetStage = 'Dealer';
      } else if (currentStage === 'New Lead' || currentStage === 'New') {
        targetStage = 'Contacted';
      }
    }

    if (targetStage && targetStage !== currentStage) {
      updates.push({ id: l.id, name: l.name, oldStage: currentStage, newStage: targetStage });
    }
  });

  console.log(`\nFound ${updates.length} leads requiring stage correction back to Nobogent truth.`);

  // Fast parallel update
  for (let i = 0; i < updates.length; i += 50) {
    const chunk = updates.slice(i, i + 50);
    await Promise.all(chunk.map(u => 
      supabase.from('leads').update({
        pipeline_stage: u.newStage,
        status: u.newStage
      }).eq('id', u.id)
    ));
    process.stdout.write(`Reconciled ${Math.min(i + 50, updates.length)} / ${updates.length} leads...\r`);
  }

  console.log(`\n✅ Successfully reconciled all ${updates.length} leads to their true Nobogent stages.`);

  // Final verification
  let fresh = 0, ongoing = 0, notInterested = 0;
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
    });
    page++;
    if (data.length < 1000) break;
  }

  console.log('\n=== RECONCILED STAGE BREAKDOWN FOR SHUBHA ===');
  console.log(stageBreakdown);
  console.log('\n=== CRM TAB COUNTS ===');
  console.log('Fresh (Truly Untouched / New):', fresh);
  console.log('Ongoing (In Progress / Contacted):', ongoing);
  console.log('Not Interested (Lost / Postponed / Closed):', notInterested);
}

reconcileShubhaStages().catch(console.error);
