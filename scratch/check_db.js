const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    console.log("=================== RUNNING STATUS DIAGNOSTICS ===================");

    // 1. Fetch properties
    const { data: properties, error: propErr } = await supabase
        .from('properties')
        .select('*')
        .order('created_at', { ascending: false });

    if (propErr) {
        console.error("Error fetching properties:", propErr);
    } else {
        console.log(`Found ${properties.length} properties:`);
        properties.forEach((p, i) => {
            console.log(`[Prop ${i+1}] Title: ${p.title} | Image URL: ${p.image_url} | Images: ${JSON.stringify(p.images)}`);
        });
    }
}

run();
