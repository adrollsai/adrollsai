const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('=== INSPECTING CALL_LOGS ===');

  // Fetch most recent call_logs
  const { data: logs, error } = await supabase
    .from('call_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error fetching call_logs:', error);
    return;
  }

  console.log(`Fetched ${logs?.length} recent call_logs.`);
  if (logs && logs.length > 0) {
    console.log('Sample record keys:', Object.keys(logs[0]));
    console.log('\n--- 10 Most Recent Call Logs ---');
    logs.slice(0, 10).forEach(l => {
      console.log(`[${l.created_at}] User: ${l.user_id} | Lead: ${l.lead_id} | Status: ${l.status || l.call_status} | Duration: ${l.duration} | To: ${l.to_number || l.phone} | From: ${l.from_number}`);
    });

    // Check calls created on 2026-10-24
    const oct24 = logs.filter(l => l.created_at && l.created_at.startsWith('2026-10-24'));
    console.log(`\nCall logs on 2026-10-24 in top 50: ${oct24.length}`);
  }

  // Count call_logs grouped by user_id
  const { data: allLogs } = await supabase
    .from('call_logs')
    .select('user_id, created_at, status, duration')
    .order('created_at', { ascending: false });

  console.log(`Total call_logs in entire table: ${allLogs?.length}`);
  const userCounts = {};
  const dateCounts = {};
  allLogs?.forEach(l => {
    userCounts[l.user_id] = (userCounts[l.user_id] || 0) + 1;
    const day = l.created_at ? l.created_at.slice(0, 10) : 'unknown';
    dateCounts[day] = (dateCounts[day] || 0) + 1;
  });

  console.log('\nCall logs by User ID:', userCounts);
  console.log('\nCall logs by Date:', dateCounts);

  // Check user details for the top user IDs
  const userIds = Object.keys(userCounts);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, business_name, role')
    .in('id', userIds);

  console.log('\nProfiles for call_log users:');
  profiles?.forEach(p => {
    console.log(`ID: ${p.id} | Email: ${p.email} | Name: ${p.business_name} | Role: ${p.role} | Calls: ${userCounts[p.id]}`);
  });
}

main().catch(console.error);
