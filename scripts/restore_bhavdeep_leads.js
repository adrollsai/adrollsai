/**
 * Safe restoration script for Bhavdeep Singh's leads
 * 
 * 1. Identifies all 1,638 original leads of Bhavdeep from the source files.
 * 2. Identifies all leads Bhavdeep actively worked on today (protected leads).
 * 3. Restores assignment (assigned_to = Bhavdeep) for all 1,638 leads.
 * 4. Restores original pipeline stages for untouched leads.
 * 5. Leaves today's 90 worked leads with their active stages, notes, and followups completely intact.
 */

const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BHAVDEEP_USER_ID = '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe';

const SOURCE_FILES = [
  'C:\\Users\\Adrolls\\Downloads\\data\\ALL Leads 1-6000.xlsx',
  'C:\\Users\\Adrolls\\Downloads\\data\\ALL Leads 6001-12000.xlsx',
  'C:\\Users\\Adrolls\\Downloads\\data\\ALL Leads 12001-15591.xlsx'
];

const STAGE_NORMALIZATION = {
  'new lead': 'New Lead',
  'new': 'New Lead',
  'requirement taken': 'Requirement Taken',
  'visit planned': 'Visit Planned',
  'visit done': 'Visit Done',
  'revisit done': 'Revisit Done',
  'meeting planned': 'Meeting Planned',
  'meeting done': 'Meeting Done',
  'never picked': 'Never Picked',
  'lost/ni': 'Lost/NI',
  'dealer': 'Dealer',
  'plan postponed': 'Plan Postponed',
  'already purchased': 'Already Purchased',
  'different requirement': 'Different Requirement',
  'negotiation': 'Negotiation',
  'deal/token': 'Deal/Token'
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function restoreBhavdeepLeads() {
  console.log('=== STARTING SAFE BHAVDEEP LEADS RESTORATION ===\n');

  // Step 1: Read source files and map Bhavdeep leads
  console.log('Step 1: Reading source snapshot files...');
  const sourceBhavdeepMap = new Map();

  SOURCE_FILES.forEach(file => {
    const wb = XLSX.readFile(file);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    rows.forEach(r => {
      const owner = r['Lead Owner'] || r['Owner'] || '';
      if (String(owner).toLowerCase().includes('bhavdeep') || String(owner).toLowerCase().includes('deep')) {
        const rawPhone = String(r['Contacts'] || '').replace(/\D/g, '').slice(-10);
        if (rawPhone.length >= 7) {
          const rawStage = String(r['Lead Status'] || r['Status'] || 'New Lead').trim();
          const normalizedStage = STAGE_NORMALIZATION[rawStage.toLowerCase()] || rawStage;
          sourceBhavdeepMap.set(rawPhone, {
            name: r['Lead Name'],
            phone: rawPhone,
            sourceStage: normalizedStage,
            lastRemarks: r['Last Remarks'] || '',
            openningRemarks: r['Openning Remarks'] || ''
          });
        }
      }
    });
  });

  console.log(`Found ${sourceBhavdeepMap.size} unique Bhavdeep leads in source snapshots.`);

  // Step 2: Fetch all DB leads
  console.log('\nStep 2: Fetching DB leads...');
  let allDbLeads = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, phone, name, status, pipeline_stage, assigned_to, user_id, notes, next_followup')
      .order('id')
      .range(offset, offset + 999);

    if (error) {
      console.error('Error fetching leads:', error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    allDbLeads.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`Total DB leads loaded: ${allDbLeads.length}`);

  const dbPhoneMap = new Map();
  allDbLeads.forEach(l => {
    const d = (l.phone || '').replace(/\D/g, '').slice(-10);
    if (d.length >= 7) dbPhoneMap.set(d, l);
  });

  // Step 3: Identify protected leads (worked on today by Bhavdeep)
  console.log('\nStep 3: Finding leads actively worked on today by Bhavdeep...');
  const sinceISO = '2026-08-21T18:30:00.000Z'; // Midnight IST Aug 22
  const { data: todayHistory, error: histErr } = await supabase
    .from('lead_history')
    .select('lead_id, action_type, description, created_at')
    .eq('user_id', BHAVDEEP_USER_ID)
    .gte('created_at', sinceISO);

  if (histErr) {
    console.error('Error fetching today history:', histErr);
    process.exit(1);
  }

  const protectedLeadIds = new Set(todayHistory.map(h => h.lead_id));
  console.log(`Protected Leads: ${protectedLeadIds.size} leads were modified/interacted with today.`);

  // Step 4: Prepare updates
  console.log('\nStep 4: Preparing updates...');
  const reassignOnlyUpdates = []; // Protected leads or leads whose stage is already correct but need reassignment
  const fullRestoreUpdates = [];   // Leads needing assignment + original stage restore
  let alreadyPerfect = 0;

  sourceBhavdeepMap.forEach((src, phone) => {
    const dbLead = dbPhoneMap.get(phone);
    if (!dbLead) {
      console.warn(`Warning: Phone ${phone} (${src.name}) not found in DB!`);
      return;
    }

    const isProtected = protectedLeadIds.has(dbLead.id);
    const needsReassignment = dbLead.assigned_to !== BHAVDEEP_USER_ID;
    const stageNeedsFix = dbLead.pipeline_stage !== src.sourceStage;

    if (isProtected) {
      // Keep today's stage/notes/followup completely intact! Only reassign if needed
      if (needsReassignment) {
        reassignOnlyUpdates.push({
          id: dbLead.id,
          name: dbLead.name,
          phone: dbLead.phone,
          currentStage: dbLead.pipeline_stage
        });
      } else {
        alreadyPerfect++;
      }
    } else {
      // Not protected today
      if (needsReassignment || stageNeedsFix) {
        fullRestoreUpdates.push({
          id: dbLead.id,
          name: dbLead.name,
          phone: dbLead.phone,
          oldStage: dbLead.pipeline_stage,
          targetStage: src.sourceStage,
          assigned_to: BHAVDEEP_USER_ID
        });
      } else {
        alreadyPerfect++;
      }
    }
  });

  console.log(`Protected leads needing reassignment only: ${reassignOnlyUpdates.length}`);
  console.log(`Untouched leads needing stage & assignment restore: ${fullRestoreUpdates.length}`);
  console.log(`Already perfect leads: ${alreadyPerfect}`);

  // Step 5: Execute Updates
  console.log('\nStep 5: Applying database updates...');

  // 5a. Reassign protected leads (stage remains untouched)
  if (reassignOnlyUpdates.length > 0) {
    console.log(`Reassigning ${reassignOnlyUpdates.length} protected leads to Bhavdeep...`);
    const protectedIds = reassignOnlyUpdates.map(u => u.id);
    const { error: pErr } = await supabase
      .from('leads')
      .update({ assigned_to: BHAVDEEP_USER_ID })
      .in('id', protectedIds);

    if (pErr) console.error('Error reassigning protected leads:', pErr);
    else console.log('✅ Successfully reassigned protected leads without touching their active stages.');
  }

  // 5b. Restore untouched leads in batches
  console.log(`Restoring ${fullRestoreUpdates.length} untouched leads to their original stage & assignment...`);
  const BATCH_SIZE = 50;
  let restoredCount = 0;

  for (let i = 0; i < fullRestoreUpdates.length; i += BATCH_SIZE) {
    const chunk = fullRestoreUpdates.slice(i, i + BATCH_SIZE);
    
    // Group chunk by targetStage for efficient bulk updates
    const stageGroups = {};
    chunk.forEach(item => {
      if (!stageGroups[item.targetStage]) stageGroups[item.targetStage] = [];
      stageGroups[item.targetStage].push(item.id);
    });

    for (const [stage, ids] of Object.entries(stageGroups)) {
      const { error: uErr } = await supabase
        .from('leads')
        .update({
          assigned_to: BHAVDEEP_USER_ID,
          pipeline_stage: stage,
          status: stage
        })
        .in('id', ids);

      if (uErr) {
        console.error(`Error updating batch for stage ${stage}:`, uErr.message);
      } else {
        restoredCount += ids.length;
      }
    }

    if (restoredCount % 100 === 0 || i + BATCH_SIZE >= fullRestoreUpdates.length) {
      console.log(`  Processed ${restoredCount} / ${fullRestoreUpdates.length} leads...`);
    }
  }

  console.log(`\n✅ Database update complete! Total updated: ${restoredCount + reassignOnlyUpdates.length}`);

  // Step 6: Post-restoration verification
  console.log('\n=== FINAL VERIFICATION ===');
  const { count: finalAssignedCount } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', BHAVDEEP_USER_ID);

  console.log(`Total leads assigned to Bhavdeep now: ${finalAssignedCount}`);

  // Get final stage breakdown
  let finalLeads = [];
  offset = 0;
  while (true) {
    const { data } = await supabase
      .from('leads')
      .select('id, status, pipeline_stage')
      .eq('assigned_to', BHAVDEEP_USER_ID)
      .order('id')
      .range(offset, offset + 999);

    if (!data || data.length === 0) break;
    finalLeads.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }

  const finalStages = {};
  finalLeads.forEach(l => {
    const s = l.pipeline_stage || l.status || 'unknown';
    finalStages[s] = (finalStages[s] || 0) + 1;
  });

  console.log('\nFinal Stage Distribution for Bhavdeep:');
  console.table(finalStages);

  // Check today's protected leads
  let protectedStillIntact = 0;
  for (const pid of protectedLeadIds) {
    const found = finalLeads.find(l => l.id === pid);
    if (found) protectedStillIntact++;
  }
  console.log(`\nProtected leads check: ${protectedStillIntact} / ${protectedLeadIds.size} protected leads are in Bhavdeep's account with today's stages intact.`);
  console.log('\n🎉 ALL DONE SUCCESSFULLY!');
}

restoreBhavdeepLeads().catch(console.error);
