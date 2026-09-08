const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDetails() {
  // Check 5 rows from call_logs where recording_url is not null
  const { data: recLogs, error: logErr } = await supabase
    .from('call_logs')
    .select('*')
    .not('recording_url', 'is', null)
    .limit(5);

  console.log('--- CALL LOGS WITH RECORDING ---');
  if (logErr) console.error(logErr);
  else console.log(JSON.stringify(recLogs, null, 2));

  // Check 5 rows from lead_history that have recording
  const { data: histLogs, error: histErr } = await supabase
    .from('lead_history')
    .select('*')
    .ilike('description', '%CALL_JSON%')
    .order('id', { ascending: false })
    .limit(5);

  console.log('--- LEAD HISTORY WITH CALL_JSON ---');
  if (histErr) console.error(histErr);
  else {
    console.log('Columns:', Object.keys(histLogs[0] || {}));
    histLogs.forEach(h => {
      console.log('History ID:', h.id, 'Lead ID:', h.lead_id);
      try {
        const parsed = JSON.parse(h.description.replace('🎙️ CALL_JSON:', '').trim());
        console.log('  parsed.recording_url:', parsed.recording_url);
        console.log('  parsed.duration:', parsed.duration);
      } catch (e) {
        console.log('  raw:', h.description.slice(0, 100));
      }
    });
  }

  // Check how recordings are displayed on the leads page
  // Where does the leads page get recordings from?
}

checkDetails();
