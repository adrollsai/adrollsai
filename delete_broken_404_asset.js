const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function deleteBroken() {
  const brokenIds = [
    '0eaac805-47e2-41c6-a341-cf63ba2740eb',
    '884bd839-900a-4556-b7dc-6222cd6a8e75'
  ];

  for (const id of brokenIds) {
    const { error } = await supabaseAdmin.from('assets').delete().eq('id', id);
    if (error) {
      console.error(`Error deleting ${id}:`, error);
    } else {
      console.log(`[Clean DB] Successfully deleted broken/stale asset ${id}`);
    }
  }
}

deleteBroken();
