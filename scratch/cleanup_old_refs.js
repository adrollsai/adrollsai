const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    console.log("Cleaning up old reference_creatives with broken URLs (missing adrolls-storage)...");
    
    const { data, error } = await supabase
        .from('reference_creatives')
        .select('id, url')
    
    if (error) { console.error("Fetch error:", error); return; }
    
    const brokenRows = data.filter(row => 
        row.url.includes('r2.dev/reference-creatives/') && 
        !row.url.includes('r2.dev/adrolls-storage/')
    );
    
    console.log(`Found ${brokenRows.length} records with broken URLs to delete.`);
    
    if (brokenRows.length === 0) {
        console.log("Nothing to clean up!");
        return;
    }
    
    const ids = brokenRows.map(r => r.id);
    const { error: delError } = await supabase
        .from('reference_creatives')
        .delete()
        .in('id', ids);
    
    if (delError) {
        console.error("Delete error:", delError);
    } else {
        console.log(`✅ Deleted ${brokenRows.length} broken records.`);
    }
    
    // Verify final count
    const { data: remaining } = await supabase.from('reference_creatives').select('category');
    const counts = {};
    remaining.forEach(r => { counts[r.category] = (counts[r.category] || 0) + 1; });
    console.log(`Final record count: ${remaining.length} total`, counts);
}

run().catch(console.error);
