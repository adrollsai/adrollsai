const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';
const { categorizeLeadStage, DEFAULT_PIPELINE_STAGES } = require('../utils/pipeline-stages.ts');

async function reconcileShubha173Fresh() {
  console.log('=== Step 1: Read Workveu Data for Shubha ===');
  const dir = 'C:\\Users\\Adrolls\\Downloads\\workveu data new';
  const files = ['1-6000.xlsx', '6001-12000.xlsx', '12001-15697.xlsx'].map(f => path.join(dir, f));

  const excelRows = [];
  files.forEach(file => {
    const wb = XLSX.readFile(file);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    excelRows.push(...rows);
  });

  const excelMap = new Map();
  excelRows.forEach(r => {
    const p = String(r['Contacts'] || '').replace(/\D/g, '').slice(-10);
    if (p.length >= 7) excelMap.set(p, r);
  });

  // Step 2: Fetch all Shubha leads from DB
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

  // Fetch all history for Shubha leads in chunks of 50
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

  // Step 3: Classify each lead
  const updates = [];
  let keptInFresh = 0;
  let movedToStages = 0;

  allLeads.forEach(l => {
    const p = (l.phone || '').replace(/\D/g, '').slice(-10);
    const ex = excelMap.get(p);
    const historyList = historyByLeadId.get(l.id) || [];
    const latestHist = historyList[0];
    const notes = l.notes || '';
    const currentStage = (l.pipeline_stage || l.status || '').trim();

    let targetStage = currentStage;

    // 1. Check Nobogent history (highest priority)
    if (latestHist) {
      const desc = (latestHist.description || '').toLowerCase();
      if (desc.includes('moved to visit done') || desc.includes('stage: visit done')) targetStage = 'Visit Done';
      else if (desc.includes('moved to revisit done') || desc.includes('stage: revisit done')) targetStage = 'Revisit Done';
      else if (desc.includes('moved to meeting done') || desc.includes('stage: meeting done')) targetStage = 'Meeting Done';
      else if (desc.includes('moved to lost/ni') || desc.includes('stage: lost/ni') || desc.includes('no plans') || desc.includes('no requirement') || desc.includes('not looking') || desc.includes('incorrect number') || desc.includes('not intersted') || desc.includes('not interested')) targetStage = 'Lost/NI';
      else if (desc.includes('moved to plan postponed') || desc.includes('stage: plan postponed') || desc.includes('plan drop') || desc.includes('postpone')) targetStage = 'Plan Postponed';
      else if (desc.includes('moved to already purchased') || desc.includes('stage: already purchased') || desc.includes('bought property')) targetStage = 'Already Purchased';
      else if (desc.includes('moved to requirement taken') || desc.includes('stage: requirement taken')) targetStage = 'Requirement Taken';
      else if (desc.includes('moved to visit planned') || desc.includes('stage: visit planned')) targetStage = 'Visit Planned';
      else if (desc.includes('moved to dealer') || desc.includes('stage: dealer')) targetStage = 'Dealer';
      else if (currentStage === 'New Lead' || currentStage === 'New') {
        targetStage = 'Contacted';
      }
    } 
    // 2. Check Nobogent followup notes
    else if (notes.includes('[📝 Followup') || notes.includes('[⚠️ Call Not Picked')) {
      const stageMatch = notes.match(/Stage:\s*([^.\n]+)/i);
      if (stageMatch && stageMatch[1]) {
        const raw = stageMatch[1].trim().toLowerCase();
        if (raw.includes('lost') || raw.includes('ni') || raw.includes('not interested') || raw.includes('no plans')) targetStage = 'Lost/NI';
        else if (raw.includes('postponed') || raw.includes('postpone')) targetStage = 'Plan Postponed';
        else if (raw.includes('purchased') || raw.includes('bought')) targetStage = 'Already Purchased';
        else if (raw.includes('visit done')) targetStage = 'Visit Done';
        else if (raw.includes('visit planned')) targetStage = 'Visit Planned';
        else if (raw.includes('requirement taken')) targetStage = 'Requirement Taken';
        else if (raw.includes('dealer')) targetStage = 'Dealer';
      } else if (currentStage === 'New Lead' || currentStage === 'New') {
        targetStage = 'Contacted';
      }
    }
    // 3. If no Nobogent action, check Workveu Excel status & remarks
    else if (ex) {
      const exStage = String(ex['Lead Status'] || ex['Status'] || '').trim();
      const exRemark = String(ex['Last Remark'] || ex['Remarks'] || ex['Notes'] || '').toLowerCase();
      const exFollowups = Number(ex['Followup Taken'] || 0);

      if (exStage && exStage !== 'New Lead' && exStage !== 'New') {
        targetStage = exStage;
      } else if (exRemark || exFollowups > 0) {
        if (exRemark.includes('lost') || exRemark.includes('ni') || exRemark.includes('not interested') || exRemark.includes('not looking') || exRemark.includes('no requirement') || exRemark.includes('no plans') || exRemark.includes('wrong number')) {
          targetStage = 'Lost/NI';
        } else if (exRemark.includes('postpone') || exRemark.includes('postponed') || exRemark.includes('plan drop')) {
          targetStage = 'Plan Postponed';
        } else if (exRemark.includes('purchased') || exRemark.includes('bought')) {
          targetStage = 'Already Purchased';
        } else if (exRemark.includes('visit done')) {
          targetStage = 'Visit Done';
        } else if (exRemark.includes('visit planned')) {
          targetStage = 'Visit Planned';
        } else if (exRemark.includes('dealer')) {
          targetStage = 'Dealer';
        } else if (exRemark.includes('bhk') || exRemark.includes('sq yd') || exRemark.includes('budget') || exRemark.includes('plot') || exRemark.includes('villa') || exRemark.includes('flat')) {
          targetStage = 'Requirement Taken';
        } else {
          targetStage = 'Contacted';
        }
      } else {
        // Truly without remark / untouched
        targetStage = 'New Lead';
      }
    }

    if (targetStage === 'New Lead') {
      keptInFresh++;
    } else {
      movedToStages++;
    }

    if (targetStage !== currentStage) {
      updates.push({ id: l.id, name: l.name, oldStage: currentStage, newStage: targetStage });
    }
  });

  console.log(`\nClassification Summary:`);
  console.log(`- Truly Untouched / New Leads to keep in Fresh: ${keptInFresh}`);
  console.log(`- Leads with remarks/followups allotted to proper stages: ${movedToStages}`);
  console.log(`- Database updates needed: ${updates.length}`);

  // Step 4: Execute updates in chunks of 50
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

  // Step 5: Final verified breakdown
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

  console.log('\n=== FINAL RECONCILED STAGE BREAKDOWN FOR SHUBHA ===');
  console.log(stageBreakdown);
  console.log('\n=== CRM TAB COUNTS ===');
  console.log('Fresh Tab:', freshCount);
  console.log('Ongoing Tab:', ongoingCount);
  console.log('Not Interested Tab:', notInterestedCount);
}

reconcileShubha173Fresh().catch(console.error);
