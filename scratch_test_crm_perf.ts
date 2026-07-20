import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
    'https://hpssqssdewmkmafxlfud.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwc3Nxc3NkZXdta21hZnhsZnVkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjgxMTkyMSwiZXhwIjoyMDk4Mzg3OTIxfQ.HgzsU10Lft2bpkOe5SMx-MyW_kmx0ld7txyqe8grlAA'
);

async function addIndex() {
    console.log("=== Creating Index on lead_history(lead_id) ===");
    // Test query execution time before & after index
    const start = Date.now();
    const { data, error } = await supabase.from('leads')
        .select('*, lead_history(action_type, description, created_at)')
        .limit(100);
    console.log(`Query took ${Date.now() - start}ms. Error:`, error);
}

addIndex().catch(console.error);
