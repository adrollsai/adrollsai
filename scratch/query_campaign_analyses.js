const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function queryAnalyses() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log("Fetching all records from campaign_analyses...");
  const { data, error } = await supabase
    .from('campaign_analyses')
    .select('*');

  if (error) {
    console.error("Error fetching analyses:", error);
    return;
  }

  console.log(`Total campaign_analyses records: ${data.length}`);
  data.forEach((row, idx) => {
    console.log(`\nRecord #${idx + 1}:`);
    console.log(`  ID: ${row.id}`);
    console.log(`  Created At: ${row.created_at}`);
    console.log(`  Campaign ID: ${row.campaign_id}`);
    console.log(`  User ID: ${row.user_id}`);
    console.log(`  Analysis Snippet: ${row.analysis_text.substring(0, 100)}...`);
    console.log(`  Recommendations Count: ${row.recommendations?.length}`);
  });
}

queryAnalyses();
