const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectBioqueLeadsOnly() {
  const bioqueId = '68b55a31-a16d-454d-a20f-11adabf590b0';

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('user_id', bioqueId)
    .order('created_at', { ascending: false })
    .limit(3);

  console.log(`\nTotal Leads for Bioque: ${leads?.length || 0}`);
  leads?.forEach((l, i) => {
    console.log(`\n--- Lead ${i + 1} ---`);
    console.log(`Name: ${l.name}`);
    console.log(`Phone: ${l.phone}`);
    console.log(`Email: ${l.email}`);
    console.log(`Ad Name: ${l.ad_name}`);
    console.log(`Created At: ${l.created_at}`);
    console.log(`Status: ${l.status}`);
    console.log(`Notes: ${l.notes}`);
    console.log(`Custom Fields:`, JSON.stringify(l.custom_fields, null, 2));
  });

  // Done
}

inspectBioqueLeadsOnly().catch(console.error);
