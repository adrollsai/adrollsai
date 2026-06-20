const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const userId = "c890a11f-84ce-4592-ab8f-8682927b1a9d"; // Realty Nation

async function run() {
    console.log("=== Querying creative_prompts ===");
    const { data, error } = await supabaseAdmin
        .from('creative_prompts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${data.length} creative prompts:`);
    data.forEach((p, idx) => {
        console.log(`[${idx}] ID: ${p.id} | Product Name: ${p.product_name} | Concept: ${p.concept_name || p.concept} | Created: ${p.created_at}`);
        console.log(`  Details:`, JSON.stringify(p, null, 2));
        console.log("------------------------");
    });
}

run().catch(console.error);
