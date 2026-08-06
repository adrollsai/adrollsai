const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanA192() {
  const { error } = await supabaseAdmin.from('assets').delete().eq('id', 'a19281cd-ff86-4093-9fbe-24b0886c2d26');
  if (error) console.error(error);
  else console.log("Successfully deleted a19281cd from Supabase DB.");
}

cleanA192();
