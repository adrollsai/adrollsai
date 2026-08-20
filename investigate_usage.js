const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function investigate() {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  console.log('=== INVESTIGATING APP USAGE SINCE 48 HOURS AGO ===');
  console.log('Timestamp cutoff:', since);

  // 1. Leads called
  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, phone, voice_call_status, voice_call_duration, last_called_at, created_at')
    .gte('last_called_at', since);

  console.log('\n[1] LEADS WITH VOICE CALLS IN LAST 48 HOURS: count =', leads ? leads.length : 0);
  if (leads && leads.length > 0) {
    let totalSec = 0;
    leads.forEach(l => {
      totalSec += (l.voice_call_duration || 0);
      console.log(`- Lead: ${l.name} (${l.phone}) | Status: ${l.voice_call_status} | Duration: ${l.voice_call_duration || 0}s | Called At: ${l.last_called_at}`);
    });
    console.log(`-> Total Voice Call Duration: ${totalSec}s (${(totalSec / 60).toFixed(1)} mins)`);
  }

  // 2. Lead history entries (transcripts, remarks, summaries)
  const { data: history } = await supabase
    .from('lead_history')
    .select('id, lead_id, action_type, description, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  console.log('\n[2] LEAD HISTORY ACTIONS IN LAST 48 HOURS: count =', history ? history.length : 0);
  if (history && history.length > 0) {
    history.slice(0, 15).forEach(h => {
      console.log(`- [${h.created_at}] Action: ${h.action_type} | ${h.description ? h.description.slice(0, 90) : ''}`);
    });
  }

  // 3. AI Generated Video/Ad jobs
  const { data: videos } = await supabase
    .from('video_renders')
    .select('id, status, created_at')
    .gte('created_at', since);

  console.log('\n[3] VIDEO GENERATIONS IN LAST 48 HOURS: count =', videos ? videos.length : 0);
}

investigate();
