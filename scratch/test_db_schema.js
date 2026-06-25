const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function checkSchema() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing environment variables!");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log("Checking campaign_analyses table...");
  const { data: analysisData, error: analysisError } = await supabase
    .from('campaign_analyses')
    .select('*')
    .limit(1);

  if (analysisError) {
    console.error("campaign_analyses table check failed:", analysisError.message);
  } else {
    console.log("campaign_analyses table exists! Sample data:", analysisData);
  }

  console.log("\nChecking leads table columns...");
  const { data: leadsData, error: leadsError } = await supabase
    .from('leads')
    .select('*')
    .limit(1);

  if (leadsError) {
    console.error("leads table check failed:", leadsError.message);
  } else {
    console.log("leads table exists! Columns in first row:", Object.keys(leadsData[0] || {}));
  }
}

checkSchema();
