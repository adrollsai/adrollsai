const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkGnrProperties() {
  const gnrUserId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
  console.log("=== CHECKING PROPERTIES FOR GNR HOMES (user_id:", gnrUserId, ") ===");

  const { data: props, error } = await supabase
    .from('properties')
    .select('id, title, price, user_id')
    .eq('user_id', gnrUserId);

  console.log("Properties error:", error);
  console.log("Properties count:", props ? props.length : 0);
  console.log("Properties:", props);

  // Check all properties across all users
  const { data: allProps } = await supabase
    .from('properties')
    .select('id, title, price, user_id')
    .limit(10);

  console.log("\nSample properties across system:", allProps);
}

checkGnrProperties().catch(console.error);
