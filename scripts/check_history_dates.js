const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const HARMAN_ID = '7ce0408f-b03f-4af8-a32d-852b6c22da2a';
const MUNENDER_ID = '17cd53d4-fed6-4d71-87c3-ad69ab052553';

async function check() {
  const { data: hMunender } = await supabase.from('lead_history')
    .select('id, created_at, description, action_type')
    .eq('user_id', MUNENDER_ID);
  
  console.log('Total history rows for Munender:', hMunender?.length);
  
  const { data: hHarman } = await supabase.from('lead_history')
    .select('id, created_at, description, action_type')
    .eq('user_id', HARMAN_ID);
  
  console.log('Total history rows for Harman:', hHarman?.length);

  // Group by created_at date (YYYY-MM-DD)
  const munenderDates = {};
  hMunender?.forEach(h => {
    const d = h.created_at.slice(0, 10);
    munenderDates[d] = (munenderDates[d] || 0) + 1;
  });
  console.log('Munender history created_at dates:', munenderDates);

  const harmanDates = {};
  hHarman?.forEach(h => {
    const d = h.created_at.slice(0, 10);
    harmanDates[d] = (harmanDates[d] || 0) + 1;
  });
  console.log('Harman history created_at dates:', harmanDates);
}

check();
