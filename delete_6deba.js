const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function clean6deba() {
  const { error } = await supabaseAdmin.from('assets').delete().eq('id', '6deba2cb-2f3f-4b5d-a3c2-24d34ae03bb7');
  if (error) console.error(error);
  else console.log("Successfully deleted 6deba2cb from Supabase DB.");
}

clean6deba();
