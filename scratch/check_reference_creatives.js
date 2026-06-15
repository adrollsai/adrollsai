const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    console.log("Checking reference_creatives table...");
    const { data, error } = await supabase
        .from('reference_creatives')
        .select('*');

    if (error) {
        console.error("❌ Error query reference_creatives:", error);
    } else {
        console.log(`✅ Table exists! Found ${data.length} records in reference_creatives.`);
        if (data.length > 0) {
            const categories = {};
            data.forEach(row => {
                categories[row.category] = (categories[row.category] || 0) + 1;
            });
            console.log("Record count by category:", categories);
        }
    }
}

run();
