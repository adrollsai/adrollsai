const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SHUBHA_ID = '07db7180-6fac-4055-86ee-8b3748590f56';
const { categorizeLeadStage, DEFAULT_PIPELINE_STAGES } = require('../utils/pipeline-stages.ts');

async function restoreFreshNow() {
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

  let allLeads = [];
  let page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    page++;
    if (data.length < 1000) break;
  }

  const toRestoreIds = [];
  allLeads.forEach(l => {
    const p = (l.phone || '').replace(/\D/g, '').slice(-10);
    const ex = excelMap.get(p);
    if (ex) {
      const rawStage = String(ex['Lead Status'] || ex['Status'] || '').trim().toLowerCase();
      if (rawStage === 'new lead' || rawStage === 'new') {
        toRestoreIds.push(l.id);
      }
    }
  });

  console.log(`Restoring ${toRestoreIds.length} leads to 'New Lead' stage (Fresh tab)...`);

  for (let i = 0; i < toRestoreIds.length; i += 50) {
    const chunk = toRestoreIds.slice(i, i + 50);
    await supabase.from('leads').update({
      pipeline_stage: 'New Lead',
      status: 'New Lead'
    }).in('id', chunk);
  }

  console.log('Successfully restored leads to New Lead (Fresh).');

  // Verify CRM category counts
  let fresh = 0, ongoing = 0, notInterested = 0;
  page = 0;
  while (true) {
    const { data } = await supabase.from('leads').select('*').eq('assigned_to', SHUBHA_ID).range(page * 1000, (page + 1) * 1000 - 1);
    if (!data || data.length === 0) break;
    data.forEach(l => {
      const cat = categorizeLeadStage(l, DEFAULT_PIPELINE_STAGES);
      if (cat === 'fresh') fresh++;
      else if (cat === 'ongoing') ongoing++;
      else if (cat === 'not_interested') notInterested++;
    });
    page++;
    if (data.length < 1000) break;
  }

  console.log('\n=== VERIFIED CRM COUNTS FOR SHUBHA ===');
  console.log('Fresh Tab:', fresh);
  console.log('Ongoing Tab:', ongoing);
  console.log('Not Interested Tab:', notInterested);
}

restoreFreshNow().catch(console.error);
