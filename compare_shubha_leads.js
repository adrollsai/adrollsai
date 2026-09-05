const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const xlsx = require('xlsx');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const shubhaId = '07db7180-6fac-4055-86ee-8b3748590f56';
const adminId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

function normalizePhone(p) {
  if (!p) return '';
  let s = String(p).replace(/\D/g, '');
  if (s.length >= 10) return s.slice(-10);
  return s;
}

function extractStagesFromProfile(profile) {
  if (!profile || !profile.badges) return [];
  const stageBadge = profile.badges.find(b => typeof b === 'string' && b.startsWith('__PIPELINE_STAGES__:'));
  if (!stageBadge) return [];
  try {
    return JSON.parse(stageBadge.replace('__PIPELINE_STAGES__:', ''));
  } catch (e) {
    return [];
  }
}

function categorizeLeadStage(rawStageOrLead, customStages) {
  if (!rawStageOrLead) return 'fresh';

  let stageStr = '';
  let cf = null;
  let hasDnpOrActiveFollowup = false;

  if (typeof rawStageOrLead === 'object' && rawStageOrLead !== null) {
    stageStr = (rawStageOrLead.pipeline_stage || rawStageOrLead.status || '').trim();
    cf = rawStageOrLead.custom_fields;
    if (typeof cf === 'string') {
      try { while (typeof cf === 'string') cf = JSON.parse(cf); } catch (e) { cf = null; }
    }
    if (!stageStr && cf) {
      stageStr = (cf.pipeline_stage || cf.status || cf.lead_status || cf.client_status || '').trim();
    }

    const dnpCount = rawStageOrLead.dnp_count || cf?.dnp_count || 0;
    const isDnp = rawStageOrLead.last_call_dnp === true || cf?.last_call_dnp === true;
    const hasNextFollowup = !!rawStageOrLead.next_followup || !!cf?.next_action_date;

    if (dnpCount > 0 || isDnp || hasNextFollowup) {
      hasDnpOrActiveFollowup = true;
    }
  } else if (typeof rawStageOrLead === 'string') {
    stageStr = rawStageOrLead.trim();
  }

  if (!stageStr) return 'fresh';
  const normalized = stageStr.toLowerCase();

  if (normalized === 'trash' || normalized === 'deleted' || normalized === 'archived') {
    return 'trash';
  }

  if (Array.isArray(customStages) && customStages.length > 0) {
    const matched = customStages.find(s => s.name.trim().toLowerCase() === normalized || s.id.toLowerCase() === normalized);
    if (matched) {
      if (matched.category === 'fresh') {
        return hasDnpOrActiveFollowup ? 'ongoing' : 'fresh';
      }
      return matched.category;
    }
  }

  if (
    normalized.includes('lost') ||
    normalized.includes('ni') ||
    normalized.includes('not interested') ||
    normalized.includes('not_interested') ||
    normalized.includes('junk') ||
    normalized.includes('unqualified') ||
    normalized.includes('dealer') ||
    normalized.includes('postponed') ||
    normalized.includes('already purchased') ||
    normalized.includes('different requirement') ||
    normalized.includes('wrong number') ||
    normalized.includes('fake')
  ) {
    return 'not_interested';
  }

  if (
    normalized === 'new' ||
    normalized === 'new lead' ||
    normalized === 'unprocessed' ||
    normalized === 'fresh' ||
    normalized === 'fresh lead' ||
    normalized === 'uncontacted'
  ) {
    return hasDnpOrActiveFollowup ? 'ongoing' : 'fresh';
  }

  return 'ongoing';
}

async function main() {
  const { data: adminProfile } = await supabase.from('profiles').select('*').eq('id', adminId).single();
  const stages = extractStagesFromProfile(adminProfile);

  // Read Excel
  const wb = xlsx.readFile('C:/Users/Adrolls/Downloads/shubha ongoing.xlsx');
  const excelRows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  console.log('Total rows in Excel:', excelRows.length);

  // Map excel leads by phone
  const excelByPhone = new Map();
  excelRows.forEach(row => {
    const phone = normalizePhone(row['Contacts']);
    if (phone) {
      excelByPhone.set(phone, row);
    }
  });
  console.log('Unique phone numbers in Excel:', excelByPhone.size);

  // Fetch all leads for Shubha in DB
  let allShubhaLeads = [];
  let from = 0;
  while (true) {
    const { data } = await supabase.from('leads')
      .select('id, name, phone, email, status, pipeline_stage, assigned_to, user_id, custom_fields, next_followup, created_at')
      .or('assigned_to.eq.' + shubhaId + ',user_id.eq.' + shubhaId)
      .order('id')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    allShubhaLeads = allShubhaLeads.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log('Total DB leads for Shubha:', allShubhaLeads.length);

  // Categorize Shubha leads in DB
  const dbCatCounts = { fresh: 0, ongoing: 0, not_interested: 0, trash: 0 };
  const dbStageCounts = {};
  const dbLeadsByPhone = new Map();

  allShubhaLeads.forEach(l => {
    const cat = categorizeLeadStage(l, stages);
    dbCatCounts[cat] = (dbCatCounts[cat] || 0) + 1;
    const st = (l.pipeline_stage || l.status || '(none)').trim();
    dbStageCounts[st] = (dbStageCounts[st] || 0) + 1;

    const phone = normalizePhone(l.phone);
    if (phone) {
      if (!dbLeadsByPhone.has(phone)) {
        dbLeadsByPhone.set(phone, []);
      }
      dbLeadsByPhone.get(phone).push(l);
    }
  });

  console.log('\n--- Shubha CRM Status in DB ---');
  console.log('Category breakdown in DB:', dbCatCounts);
  console.log('Stage breakdown in DB:', dbStageCounts);

  // Now compare the 555 Excel leads against DB!
  console.log('\n--- Comparing 555 Excel leads against DB ---');
  let foundInShubhaDB = 0;
  let foundInShubhaDBOngoing = 0;
  let foundInShubhaDBFresh = 0;
  let foundInShubhaDBNotInterested = 0;
  let notFoundInShubhaDB = [];

  const stageDiscrepancies = [];

  excelRows.forEach(row => {
    const phone = normalizePhone(row['Contacts']);
    const excelStage = (row['Lead Status'] || '').trim();
    const excelName = row['Lead Name'];

    const dbMatches = dbLeadsByPhone.get(phone);
    if (dbMatches && dbMatches.length > 0) {
      foundInShubhaDB++;
      const dbLead = dbMatches[0]; // primary
      const cat = categorizeLeadStage(dbLead, stages);
      if (cat === 'ongoing') foundInShubhaDBOngoing++;
      else if (cat === 'fresh') foundInShubhaDBFresh++;
      else if (cat === 'not_interested') foundInShubhaDBNotInterested++;

      const dbStage = (dbLead.pipeline_stage || dbLead.status || '').trim();
      if (cat !== 'ongoing' || dbStage.toLowerCase() !== excelStage.toLowerCase()) {
        stageDiscrepancies.push({
          name: excelName,
          phone,
          excelStage,
          dbStage,
          dbCategory: cat,
          dbLeadId: dbLead.id
        });
      }
    } else {
      notFoundInShubhaDB.push({
        name: excelName,
        phone,
        rawContact: row['Contacts'],
        excelStage,
        excelRow: row
      });
    }
  });

  console.log(`Excel total leads: ${excelRows.length}`);
  console.log(`Found in Shubha DB leads: ${foundInShubhaDB}`);
  console.log(`  - Categorized as Ongoing in DB: ${foundInShubhaDBOngoing}`);
  console.log(`  - Categorized as Fresh in DB: ${foundInShubhaDBFresh}`);
  console.log(`  - Categorized as Not Interested in DB: ${foundInShubhaDBNotInterested}`);
  console.log(`NOT found in Shubha DB leads: ${notFoundInShubhaDB.length}`);

  // Check if those NOT in Shubha DB are in the database under someone else (e.g. Bluesquare admin, other agents, or unassigned)
  if (notFoundInShubhaDB.length > 0) {
    console.log('\nChecking if missing leads exist elsewhere in the DB...');
    const missingPhones = notFoundInShubhaDB.map(m => m.phone).filter(Boolean);
    
    // Check in batches
    let foundElsewhere = [];
    for (let i = 0; i < missingPhones.length; i += 50) {
      const batch = missingPhones.slice(i, i + 50);
      // Construct an ILIKE or in query
      const { data } = await supabase.from('leads')
        .select('id, name, phone, assigned_to, user_id, pipeline_stage, status')
        .in('phone', batch);
      if (data && data.length > 0) {
        foundElsewhere = foundElsewhere.concat(data);
      }
    }
    console.log(`Of the ${notFoundInShubhaDB.length} missing from Shubha, found ${foundElsewhere.length} under other users/formats in DB.`);
    if (foundElsewhere.length > 0) {
      console.log('Sample found elsewhere:', foundElsewhere.slice(0, 5));
    }
  }

  console.log('\n--- Breakdown of Stage Discrepancies among matched leads ---');
  console.log(`Total discrepancies (either category != ongoing or stage != excelStage): ${stageDiscrepancies.length}`);
  
  // Group discrepancies by dbCategory and dbStage
  const discrepancyGroups = {};
  stageDiscrepancies.forEach(d => {
    const key = `Excel: [${d.excelStage}] -> DB Category: [${d.dbCategory}] (DB Stage: [${d.dbStage}])`;
    discrepancyGroups[key] = (discrepancyGroups[key] || 0) + 1;
  });
  console.log('Discrepancy groups:', discrepancyGroups);
}

main();
