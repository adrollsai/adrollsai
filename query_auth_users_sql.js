const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hpssqssdewmkmafxlfud.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwc3Nxc3NkZXdta21hZnhsZnVkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjgxMTkyMSwiZXhwIjoyMDk4Mzg3OTIxfQ.HgzsU10Lft2bpkOe5SMx-MyW_kmx0ld7txyqe8grlAA';

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function run() {
  console.log('Querying auth.users count...');
  const { data, error } = await supabase.rpc('run_sql', {
    sql_query: 'SELECT count(*), json_agg(email) FROM auth.users'
  });
  
  if (error) {
    console.error('Error running SQL:', error.message);
  } else {
    console.log('SQL Result:', data);
  }
}

run().catch(console.error);
