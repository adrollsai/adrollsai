const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Querying lead stages ===");
    const { data: leads, error } = await supabaseAdmin
        .from('leads')
        .select('pipeline_stage, status')
        .limit(100);
    
    if (error) {
        console.error("Error:", error);
        return;
    }

    const stages = new Set();
    leads.forEach(l => {
        stages.add(l.pipeline_stage);
    });

    console.log("Pipeline stages found in DB:", Array.from(stages));
}

run().catch(console.error);
