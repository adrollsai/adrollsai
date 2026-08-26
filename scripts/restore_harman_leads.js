const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const HARMAN_ID = '7ce0408f-b03f-4af8-a32d-852b6c22da2a';
const BLUESQUARE_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

async function executeHarmanRestoration() {
  console.log('=== SAFE RESTORATION OF HARMAN BAJWA LEADS ===\n');

  // Step 1: Read Source Files
  const dataDir = 'C:\\Users\\Adrolls\\Downloads\\data';
  const sourceFiles = [
    path.join(dataDir, 'ALL Leads 1-6000.xlsx'),
    path.join(dataDir, 'ALL Leads 6001-12000.xlsx'),
    path.join(dataDir, 'ALL Leads 12001-15591.xlsx')
  ];

  const sourceHarmanMap = new Map();
  sourceFiles.forEach(file => {
    if (fs.existsSync(file)) {
      const wb = XLSX.readFile(file);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      rows.forEach(r => {
        const owner = String(r['Lead Owner'] || r['Owner'] || '').trim();
        if (owner.toLowerCase().includes('harman') || owner.toLowerCase().includes('bajwa')) {
          const rawPhone = String(r['Contacts'] || '').replace(/\D/g, '').slice(-10);
          if (rawPhone.length >= 7) {
            sourceHarmanMap.set(rawPhone, {
              name: r['Lead Name'],
              phone: rawPhone,
              status: r['Lead Status'] || r['Status'],
              owner: owner
            });
          }
        }
      });
    }
  });

  console.log(`Total Harman leads in source snapshot files: ${sourceHarmanMap.size}`);

  // Step 2: Fetch ALL DB leads for BlueSquare workspace
  let allDbLeads = [];
  let page = 0;
  while (true) {
    const { data: chunk, error } = await supabase
      .from('leads')
      .select('id, name, phone, assigned_to, user_id, status, pipeline_stage, next_followup, custom_fields, created_at')
      .eq('user_id', BLUESQUARE_ID)
      .range(page * 1000, (page + 1) * 1000 - 1);

    if (error || !chunk || chunk.length === 0) break;
    allDbLeads = allDbLeads.concat(chunk);
    if (chunk.length < 1000) break;
    page++;
  }

  console.log(`Total DB leads loaded: ${allDbLeads.length}`);

  // Step 3: Find all diverted leads that need restoration
  const dbPhoneMap = new Map();
  allDbLeads.forEach(l => {
    const cleanPhone = String(l.phone || '').replace(/\D/g, '').slice(-10);
    if (cleanPhone.length >= 7) {
      dbPhoneMap.set(cleanPhone, l);
    }
  });

  const leadsToRestore = [];
  sourceHarmanMap.forEach((srcLead, phone) => {
    const dbLead = dbPhoneMap.get(phone);
    if (dbLead && dbLead.assigned_to !== HARMAN_ID) {
      leadsToRestore.push({
        id: dbLead.id,
        name: dbLead.name,
        phone: dbLead.phone,
        previous_assigned_to: dbLead.assigned_to,
        previous_status: dbLead.status,
        previous_pipeline_stage: dbLead.pipeline_stage,
        target_assigned_to: HARMAN_ID,
        original_source_owner: srcLead.owner
      });
    }
  });

  console.log(`Found ${leadsToRestore.length} diverted leads to restore to Harman.`);

  // Step 4: Create Backup JSON for Full Reversibility
  const backupDir = path.join(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupFilePath = path.join(backupDir, 'harman_leads_backup_20260825.json');
  fs.writeFileSync(backupFilePath, JSON.stringify({
    timestamp: new Date().toISOString(),
    total_restored: leadsToRestore.length,
    leads: leadsToRestore
  }, null, 2));

  console.log(`Saved pre-restoration backup file to: ${backupFilePath}`);

  // Step 5: Execute Batch Updates to Reassign to Harman
  const leadIdsToUpdate = leadsToRestore.map(l => l.id);
  for (let i = 0; i < leadIdsToUpdate.length; i += 100) {
    const chunk = leadIdsToUpdate.slice(i, i + 100);
    const { error } = await supabase
      .from('leads')
      .update({ assigned_to: HARMAN_ID })
      .in('id', chunk);

    if (error) {
      console.error('Error updating chunk:', error);
    }
  }

  console.log(`Successfully restored ${leadsToRestore.length} leads back to Harman Bajwa!`);

  // Step 6: Verify New Count
  const { count: finalCount } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', BLUESQUARE_ID)
    .eq('assigned_to', HARMAN_ID);

  console.log(`\n--- RESTORATION COMPLETE ---`);
  console.log(`Harman's new total lead count in DB: ${finalCount}`);
}

executeHarmanRestoration();
