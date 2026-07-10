const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== CHECKING ALL HISTORIES FOR RAHUL ===");
    const { data: history, error } = await supabaseAdmin
        .from('lead_history')
        .select('*')
        .eq('lead_id', '5282f7a4-c3af-45bf-899f-0c55d2fc7120')
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        return;
    }

    console.log("Found history items:", history.length);
    history.forEach(h => {
        console.log(`- ID: ${h.id}, Type: ${h.action_type}, CreatedAt: ${h.created_at}`);
        console.log(`  Desc: ${h.description.substring(0, 150)}`);
    });
}

run().catch(console.error);
