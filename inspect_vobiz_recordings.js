const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectVobizRecordings() {
  const authId = 'MA_HOSGFZ86';
  const authToken = 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';

  // Test 1: Query by call_uuid
  console.log('--- Test filter by call_uuid=ad22ea81-175d-44ec-b3db-bfed4f253d3a ---');
  const resUuid = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Recording/?call_uuid=ad22ea81-175d-44ec-b3db-bfed4f253d3a`, {
    headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
  });
  console.log('Status:', resUuid.status);
  const dataUuid = await resUuid.json();
  console.log('Results with call_uuid filter:', dataUuid.objects?.length);

  // Test 2: Fetch all recordings from Vobiz (paging through them)
  console.log('\n--- Fetching ALL recordings from Vobiz ---');
  let allRecordings = [];
  let offset = 0;
  let limit = 100;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Recording/?limit=${limit}&offset=${offset}`, {
      headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
    });
    if (!res.ok) break;
    const data = await res.json();
    const objs = data.objects || [];
    allRecordings.push(...objs);
    console.log(`Fetched offset ${offset}: ${objs.length} recordings (Total so far: ${allRecordings.length})`);
    if (objs.length < limit || !data.meta?.next) {
      hasMore = false;
    } else {
      offset += limit;
    }
  }

  console.log(`\nTOTAL VOBIZ RECORDINGS FOUND: ${allRecordings.length}`);

  // Also check lead_history table in Supabase
  const { count: histCount } = await supabase
    .from('lead_history')
    .select('*', { count: 'exact', head: true })
    .ilike('description', '%recording_url%');
  console.log(`lead_history entries with recording_url: ${histCount}`);

  // Also check call_logs table in Supabase
  const { count: callLogsCount } = await supabase
    .from('call_logs')
    .select('*', { count: 'exact', head: true });
  console.log(`call_logs total entries: ${callLogsCount}`);

  // Let's see recording durations
  const meaningfulRecs = allRecordings.filter(r => parseFloat(r.recording_duration_ms || 0) > 4000);
  console.log(`Recordings with duration > 4 seconds: ${meaningfulRecs.length}`);
  console.log(`Recordings with duration <= 4 seconds: ${allRecordings.length - meaningfulRecs.length}`);

  if (meaningfulRecs.length > 0) {
    console.log('\nSample meaningful recordings:');
    meaningfulRecs.slice(0, 5).forEach(r => {
      console.log(`  To: ${r.to_number} | Duration: ${(parseFloat(r.recording_duration_ms)/1000).toFixed(1)}s | Date: ${r.add_time} | URL: ${r.recording_url}`);
    });
  }
}

inspectVobizRecordings();
