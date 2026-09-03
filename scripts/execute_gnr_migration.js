const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

const adrollsEnv = dotenv.parse(fs.readFileSync('../adrolls.env'));
const oldDb = createClient(adrollsEnv.NEXT_PUBLIC_SUPABASE_URL, adrollsEnv.SUPABASE_SERVICE_ROLE_KEY);

const nobogentEnv = dotenv.parse(fs.readFileSync('.env.local'));
const newDb = createClient(nobogentEnv.NEXT_PUBLIC_SUPABASE_URL, nobogentEnv.SUPABASE_SERVICE_ROLE_KEY);

const GNR_ID = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
const SHIVANI_ID = '84fbb50a-3018-4b95-835e-988aee0fb6fe';

async function executeMigration() {
  console.log('🚀 Starting GNR Homes data transfer to Nobogent...\n');

  // ==========================================
  // STEP 1: PROPERTIES
  // ==========================================
  console.log('--- Step 1: Migrating Missing Properties ---');
  const { data: oldProps, error: oldPropsErr } = await oldDb
    .from('properties')
    .select('*')
    .in('user_id', [GNR_ID, SHIVANI_ID]);

  if (oldPropsErr) throw new Error(`Failed to fetch old properties: ${oldPropsErr.message}`);

  const { data: newProps, error: newPropsErr } = await newDb
    .from('properties')
    .select('id')
    .in('user_id', [GNR_ID, SHIVANI_ID]);

  if (newPropsErr) throw new Error(`Failed to fetch new properties: ${newPropsErr.message}`);

  const newPropIds = new Set(newProps.map(p => p.id));
  const propsToInsert = oldProps.filter(p => !newPropIds.has(p.id));

  console.log(`Found ${propsToInsert.length} properties to insert.`);
  if (propsToInsert.length > 0) {
    for (const prop of propsToInsert) {
      const { error: insErr } = await newDb.from('properties').insert(prop);
      if (insErr) {
        console.error(`Error inserting property ${prop.id} (${prop.title}):`, insErr.message);
      } else {
        console.log(`  ✓ Inserted property: "${prop.title}" (${prop.id})`);
      }
    }
  }

  // ==========================================
  // STEP 2: ASSETS
  // ==========================================
  console.log('\n--- Step 2: Migrating Missing Assets ---');
  const { data: oldAssets, error: oldAssetsErr } = await oldDb
    .from('assets')
    .select('*')
    .in('user_id', [GNR_ID, SHIVANI_ID]);

  if (oldAssetsErr) throw new Error(`Failed to fetch old assets: ${oldAssetsErr.message}`);

  const { data: newAssets, error: newAssetsErr } = await newDb
    .from('assets')
    .select('id')
    .in('user_id', [GNR_ID, SHIVANI_ID]);

  if (newAssetsErr) throw new Error(`Failed to fetch new assets: ${newAssetsErr.message}`);

  const newAssetIds = new Set(newAssets.map(a => a.id));
  const assetsToInsert = oldAssets.filter(a => !newAssetIds.has(a.id));

  console.log(`Found ${assetsToInsert.length} assets to insert.`);
  if (assetsToInsert.length > 0) {
    // Insert in batches of 25
    for (let i = 0; i < assetsToInsert.length; i += 25) {
      const batch = assetsToInsert.slice(i, i + 25);
      const { error: insErr } = await newDb.from('assets').insert(batch);
      if (insErr) {
        console.error(`Error inserting assets batch ${i}:`, insErr.message);
        // Fallback row-by-row
        for (const a of batch) {
          const { error: singleErr } = await newDb.from('assets').insert(a);
          if (singleErr) console.error(`  Failed asset ${a.id}:`, singleErr.message);
        }
      } else {
        console.log(`  ✓ Inserted assets batch ${i + 1} - ${Math.min(i + 25, assetsToInsert.length)}`);
      }
    }
  }

  // ==========================================
  // STEP 3: FETCH LEADS & MAP
  // ==========================================
  console.log('\n--- Step 3: Mapping Leads ---');
  let oldLeads = [];
  let from = 0;
  while (true) {
    const { data, error } = await oldDb.from('leads').select('*').eq('user_id', GNR_ID).range(from, from + 999);
    if (error) throw error;
    oldLeads = oldLeads.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Fetched ${oldLeads.length} leads from Old DB.`);

  let newLeads = [];
  from = 0;
  while (true) {
    const { data, error } = await newDb.from('leads').select('*').eq('user_id', GNR_ID).range(from, from + 999);
    if (error) throw error;
    newLeads = newLeads.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`Fetched ${newLeads.length} leads from New DB.`);

  const newById = new Map(newLeads.map(l => [l.id, l]));
  const newByPhone = new Map(newLeads.map(l => [(l.phone || '').replace(/\D/g, '').slice(-10), l]).filter(([p]) => p));

  const oldToNewLeadIdMap = new Map();
  const leadsToInsert = [];
  const leadsToUpdate = [];

  for (const ol of oldLeads) {
    const cleanPhone = (ol.phone || '').replace(/\D/g, '').slice(-10);
    if (newById.has(ol.id)) {
      oldToNewLeadIdMap.set(ol.id, ol.id);
      leadsToUpdate.push({ oldLead: ol, newLead: newById.get(ol.id), targetId: ol.id });
    } else if (cleanPhone && newByPhone.has(cleanPhone)) {
      const nl = newByPhone.get(cleanPhone);
      oldToNewLeadIdMap.set(ol.id, nl.id);
      leadsToUpdate.push({ oldLead: ol, newLead: nl, targetId: nl.id });
    } else {
      oldToNewLeadIdMap.set(ol.id, ol.id);
      leadsToInsert.push(ol);
    }
  }

  console.log(`Mapping results:
  - Missing leads to insert: ${leadsToInsert.length}
  - Existing leads to reconcile/update: ${leadsToUpdate.length}`);

  // ==========================================
  // STEP 4: INSERT MISSING LEADS
  // ==========================================
  console.log('\n--- Step 4: Inserting Missing Leads ---');
  // Get new DB lead column names to only include valid columns
  const { data: leadSample } = await newDb.from('leads').select('*').limit(1);
  const validLeadCols = new Set(Object.keys(leadSample[0] || {}));

  let insertedLeadsCount = 0;
  for (let i = 0; i < leadsToInsert.length; i += 25) {
    const batch = leadsToInsert.slice(i, i + 25).map(ol => {
      const cleanRecord = {};
      for (const [key, val] of Object.entries(ol)) {
        if (validLeadCols.has(key)) {
          cleanRecord[key] = val;
        }
      }
      // Ensure user_id is GNR and assigned_to is Shivani
      cleanRecord.user_id = GNR_ID;
      cleanRecord.assigned_to = SHIVANI_ID;
      return cleanRecord;
    });

    const { error: insErr } = await newDb.from('leads').insert(batch);
    if (insErr) {
      console.error(`Batch insert error at ${i}:`, insErr.message);
      // Fallback row-by-row
      for (const r of batch) {
        const { error: sErr } = await newDb.from('leads').insert(r);
        if (sErr) console.error(`  Failed lead ${r.id} (${r.name}):`, sErr.message);
        else insertedLeadsCount++;
      }
    } else {
      insertedLeadsCount += batch.length;
      console.log(`  ✓ Inserted leads batch ${i + 1} - ${Math.min(i + 25, leadsToInsert.length)}`);
    }
  }
  console.log(`Successfully inserted ${insertedLeadsCount} missing leads.`);

  // ==========================================
  // STEP 5: UPDATE EXISTING LEADS
  // ==========================================
  console.log('\n--- Step 5: Updating & Enriching Existing Leads ---');
  let updatedStageCount = 0;
  let updatedNotesCount = 0;
  let reassignedCount = 0;

  for (const { oldLead, newLead, targetId } of leadsToUpdate) {
    const updates = {};

    // 1. Assign to Shivani
    if (newLead.assigned_to !== SHIVANI_ID) {
      updates.assigned_to = SHIVANI_ID;
      reassignedCount++;
    }

    // 2. Restore progressed stage if new lead is still "New" / "New Lead"
    const isNewStage = !newLead.pipeline_stage || newLead.pipeline_stage === 'New' || newLead.pipeline_stage === 'New Lead';
    const hadProgress = oldLead.pipeline_stage && oldLead.pipeline_stage !== 'New' && oldLead.pipeline_stage !== 'New Lead';
    if (isNewStage && hadProgress) {
      updates.pipeline_stage = oldLead.pipeline_stage;
      if (oldLead.status) updates.status = oldLead.status;
      updatedStageCount++;
    }

    // 3. Merge notes if old lead has notes and new lead does not
    if (oldLead.notes && (!newLead.notes || newLead.notes.trim() === '')) {
      updates.notes = oldLead.notes;
      updatedNotesCount++;
    }

    // 4. Merge custom fields if missing
    if (oldLead.custom_fields && Object.keys(oldLead.custom_fields).length > 0 && (!newLead.custom_fields || Object.keys(newLead.custom_fields).length === 0)) {
      updates.custom_fields = oldLead.custom_fields;
    }

    if (Object.keys(updates).length > 0) {
      const { error: uErr } = await newDb.from('leads').update(updates).eq('id', targetId);
      if (uErr) {
        console.error(`Error updating lead ${targetId}:`, uErr.message);
      }
    }
  }
  console.log(`Reconciliation updates:
  - Reassigned to Shivani: ${reassignedCount}
  - Progressed stages restored: ${updatedStageCount}
  - Notes merged: ${updatedNotesCount}`);

  // ==========================================
  // STEP 6: TRANSFER LEAD HISTORY & REMARKS
  // ==========================================
  console.log('\n--- Step 6: Migrating Lead History & Remarks ---');
  const oldLeadIds = oldLeads.map(l => l.id);
  let oldHistory = [];
  for (let i = 0; i < oldLeadIds.length; i += 200) {
    const chunk = oldLeadIds.slice(i, i + 200);
    const { data } = await oldDb.from('lead_history').select('*').in('lead_id', chunk);
    if (data) oldHistory = oldHistory.concat(data);
  }
  console.log(`Fetched ${oldHistory.length} lead_history rows from Old DB.`);

  // Fetch all existing lead_history in New DB for target leads
  const targetLeadIds = Array.from(oldToNewLeadIdMap.values());
  let existingNewHistory = [];
  for (let i = 0; i < targetLeadIds.length; i += 200) {
    const chunk = targetLeadIds.slice(i, i + 200);
    const { data } = await newDb.from('lead_history').select('*').in('lead_id', chunk);
    if (data) existingNewHistory = existingNewHistory.concat(data);
  }
  console.log(`Fetched ${existingNewHistory.length} existing history rows from New DB.`);

  const existingHistKeys = new Set(existingNewHistory.map(h => `${h.lead_id}|${(h.description || '').trim()}`));

  const historyToInsert = [];
  let duplicatesSkipped = 0;

  for (const oh of oldHistory) {
    const targetLeadId = oldToNewLeadIdMap.get(oh.lead_id);
    if (!targetLeadId) continue;

    const key = `${targetLeadId}|${(oh.description || '').trim()}`;
    if (existingHistKeys.has(key)) {
      duplicatesSkipped++;
    } else {
      existingHistKeys.add(key);
      historyToInsert.push({
        lead_id: targetLeadId,
        user_id: oh.user_id === GNR_ID ? GNR_ID : SHIVANI_ID,
        action_type: oh.action_type || 'REMARK',
        description: oh.description,
        created_at: oh.created_at
      });
    }
  }

  console.log(`History entries to insert: ${historyToInsert.length} (Skipped ${duplicatesSkipped} duplicates)`);

  let insertedHistoryCount = 0;
  for (let i = 0; i < historyToInsert.length; i += 50) {
    const batch = historyToInsert.slice(i, i + 50);
    const { error: insErr } = await newDb.from('lead_history').insert(batch);
    if (insErr) {
      console.error(`Error inserting history batch at ${i}:`, insErr.message);
      for (const h of batch) {
        const { error: sErr } = await newDb.from('lead_history').insert(h);
        if (sErr) console.error(`  Failed history row:`, sErr.message);
        else insertedHistoryCount++;
      }
    } else {
      insertedHistoryCount += batch.length;
      console.log(`  ✓ Inserted history batch ${i + 1} - ${Math.min(i + 50, historyToInsert.length)}`);
    }
  }
  console.log(`Successfully inserted ${insertedHistoryCount} history/remarks entries.`);

  // ==========================================
  // STEP 7: FINAL VERIFICATION
  // ==========================================
  console.log('\n==========================================');
  console.log('🎉 Migration Completed! Running Verification...');
  console.log('==========================================');

  const { count: finalLeadCount } = await newDb
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', GNR_ID);

  const { count: finalShivaniAssigned } = await newDb
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', GNR_ID)
    .eq('assigned_to', SHIVANI_ID);

  const { count: finalPropsCount } = await newDb
    .from('properties')
    .select('*', { count: 'exact', head: true })
    .in('user_id', [GNR_ID, SHIVANI_ID]);

  const { count: finalAssetsCount } = await newDb
    .from('assets')
    .select('*', { count: 'exact', head: true })
    .in('user_id', [GNR_ID, SHIVANI_ID]);

  let totalHistoryInNew = 0;
  for (let i = 0; i < targetLeadIds.length; i += 200) {
    const chunk = targetLeadIds.slice(i, i + 200);
    const { count } = await newDb.from('lead_history').select('*', { count: 'exact', head: true }).in('lead_id', chunk);
    totalHistoryInNew += (count || 0);
  }

  console.log(`\nFinal Stats for GNR Homes in New DB:
  - Total Leads: ${finalLeadCount} (previously 311, expected ~455)
  - Leads assigned to Shivani: ${finalShivaniAssigned}
  - Total Properties: ${finalPropsCount} (previously 18, expected 21+)
  - Total Assets: ${finalAssetsCount} (previously 195, expected 270+)
  - Total Lead History entries for GNR leads: ${totalHistoryInNew} (previously 366, expected ~800+)
  `);
}

executeMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
