const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const MUNENDER_ID = '17cd53d4-fed6-4d71-87c3-ad69ab052553';

async function checkRows() {
  const { data } = await supabase.from('lead_history')
    .select('*')
    .eq('user_id', MUNENDER_ID)
    .gte('created_at', '2026-10-01T00:00:00Z');

  console.log(JSON.stringify(data, null, 2));
}

checkRows();
