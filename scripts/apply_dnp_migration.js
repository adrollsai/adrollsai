const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyMigration() {
  console.log("Checking leads table columns...");
  // Test if dnp_count exists by selecting it
  const { data, error } = await supabaseAdmin.from('leads').select('id, dnp_count, last_call_at, last_call_status').limit(1);

  if (error && error.code === 'PGRST204') {
    console.log("Columns missing in REST schema, attempting direct table update / migration call...");
  } else if (!error) {
    console.log("Columns dnp_count, last_call_at already exist in schema!", data);
    return;
  }
  
  // Execute alter table query via rpc or postgres if function exists, or update via dummy payload
  try {
    const { error: execErr } = await supabaseAdmin.rpc('exec_sql', {
      sql_query: `
        ALTER TABLE leads 
        ADD COLUMN IF NOT EXISTS dnp_count INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_call_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_call_status TEXT,
        ADD COLUMN IF NOT EXISTS last_called_by UUID REFERENCES profiles(id);
      `
    });
    if (execErr) {
      console.log("RPC exec_sql result:", execErr.message);
    } else {
      console.log("Migration executed via exec_sql RPC!");
    }
  } catch (e) {
    console.error("Migration error:", e);
  }
}

applyMigration();
