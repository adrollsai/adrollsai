const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .limit(10);

  if (error) {
    console.error('Error fetching automations:', error);
  } else {
    console.log('Automations data:');
    console.log(JSON.stringify(data, null, 2));
  }
}

check();
