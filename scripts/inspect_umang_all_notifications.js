const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectAllNotifs() {
  const userId = 'b685d287-7d54-4c9c-ae03-a46bb96ebdde';
  const { data: notifs } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  console.log('Total notifications for Umang Associates:', notifs ? notifs.length : 0);
  
  const byType = {};
  notifs?.forEach(n => {
    byType[n.type] = (byType[n.type] || 0) + 1;
  });
  console.log('Notifications by type:', JSON.stringify(byType, null, 2));

  const voiceOrInterestNotifs = notifs?.filter(n => 
    n.type === 'meeting_booked' || 
    n.type === 'lead_interested' || 
    n.type === 'connect_expert' ||
    (n.title && (n.title.includes('🎙️') || n.title.includes('🔥') || n.title.toLowerCase().includes('visit') || n.title.toLowerCase().includes('interest')))
  );

  console.log('\nVoice / Booking / High-Interest Notifications count:', voiceOrInterestNotifs ? voiceOrInterestNotifs.length : 0);
  voiceOrInterestNotifs?.forEach((n, idx) => {
    console.log(`\n[${idx+1}] [${n.created_at}] Type: ${n.type} | Title: ${n.title}`);
    console.log(`     Link: ${n.action_link}`);
    console.log(`     Message Preview: ${n.message.replace(/\n/g, ' -- ').slice(0, 150)}...`);
  });
}
inspectAllNotifs().catch(console.error);
