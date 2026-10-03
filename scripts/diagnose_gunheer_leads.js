const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { categorizeLeadStage, extractStagesFromProfile } = require('../utils/pipeline-stages.ts');

async function run() {
  const gunheerId = 'ac1d3d22-1c96-462f-b2b5-9bc26ada4bab';
  const bluesquareId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

  // 1. Check parent badges & custom stages
  const { data: bsProfile } = await supabase
    .from('profiles')
    .select('id, business_name, email, badges, custom_pipeline_stages')
    .eq('id', bluesquareId)
    .single();

  console.log('=== BLUESQUARE PROFILE STAGES ===');
  console.log('Badges:', bsProfile?.badges);
  const stages = extractStagesFromProfile(bsProfile);
  console.log('Extracted stages:', stages.map(s => `${s.name} (${s.category})`));

  // 2. Fetch ALL leads assigned to Gunheer in batches of 1000
  let allLeads = [];
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, name, phone, pipeline_stage, status, created_at, next_followup, notes, custom_fields, assigned_to')
      .eq('assigned_to', gunheerId)
      .order('created_at', { ascending: false })
      .range(page * 1000, (page + 1) * 1000 - 1);

    if (error) {
      console.error('Fetch error:', error);
      break;
    }
    if (!data || data.length === 0) break;
    allLeads = allLeads.concat(data);
    if (data.length < 1000) break;
    page++;
  }

  console.log(`\n=== TOTAL LEADS ASSIGNED TO GUNHEER: ${allLeads.length} ===`);

  // Breakdown by categorizeLeadStage
  const bucketCounts = { fresh: 0, ongoing: 0, not_interested: 0, trash: 0 };
  const stageCounts = {};
  const freshLeadsList = [];

  for (const l of allLeads) {
    const bucket = categorizeLeadStage(l, stages);
    bucketCounts[bucket] = (bucketCounts[bucket] || 0) + 1;

    const rawStage = (l.pipeline_stage || l.status || '(blank)').trim();
    stageCounts[rawStage] = (stageCounts[rawStage] || 0) + 1;

    if (bucket === 'fresh') {
      freshLeadsList.push(l);
    }
  }

  console.log('\n=== BUCKET COUNTS WITH CURRENT categorizeLeadStage ===');
  console.log(bucketCounts);

  console.log('\n=== RAW STAGE COUNTS ===');
  console.log(stageCounts);

  console.log(`\n=== FRESH LEADS COUNT: ${freshLeadsList.length} ===`);
  console.log('Sample 5 fresh leads:');
  freshLeadsList.slice(0, 5).forEach(l => {
    console.log({
      id: l.id,
      name: l.name,
      stage: l.pipeline_stage,
      status: l.status,
      notes: l.notes ? l.notes.substring(0, 80) : '(none)'
    });
  });

  // Check lead_history on Gunheer's leads in the past 7 days to see if someone changed stages or reassigned
  console.log('\n=== RECENT STATUS CHANGES / REASSIGNMENTS ON GUNHEER LEADS (Last 3 days) ===');
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  
  const { data: recentHistory } = await supabase
    .from('lead_history')
    .select('id, lead_id, user_id, action_type, description, created_at')
    .gte('created_at', threeDaysAgo)
    .order('created_at', { ascending: false })
    .limit(40);

  console.log(`Found ${recentHistory?.length || 0} recent actions in lead_history across system:`);
  (recentHistory || []).slice(0, 20).forEach(h => {
    console.log(`[${h.created_at}] [${h.action_type}] User: ${h.user_id} - ${h.description}`);
  });

  // Check how many leads assigned to Gunheer have `created_at` in the last 7 days vs older
  const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const freshLast7Days = freshLeadsList.filter(l => new Date(l.created_at) >= sevenDaysAgo).length;
  console.log(`\nFresh leads created in last 7 days: ${freshLast7Days}`);
}

run().catch(console.error);
