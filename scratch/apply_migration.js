const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Supabase configuration missing in .env.local');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const sqlPath = path.join(__dirname, '..', 'sql', 'migrations', '08_whatsapp_advanced.sql');
  console.log(`Reading SQL migration from: ${sqlPath}`);
  const sqlQuery = fs.readFileSync(sqlPath, 'utf8');

  console.log('Executing migration query via exec_sql RPC...');
  const { data, error } = await supabaseAdmin.rpc('exec_sql', {
    query: sqlQuery
  });

  if (error) {
    console.error('Migration execution failed:');
    console.error(error);
    console.log('\n--- MANUAL MIGRATION INSTRUCTIONS ---');
    console.log('If the run_sql RPC is not enabled, please run the following SQL commands in your Supabase SQL Editor:');
    console.log('\n' + sqlQuery);
    process.exit(1);
  }

  console.log('Migration applied successfully!', data);
}

run().catch(console.error);
