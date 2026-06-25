const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function inspectTable(tableName) {
    console.log(`\n=== Columns for ${tableName} ===`);
    const { data, error } = await supabaseAdmin
        .from(tableName)
        .select('*')
        .limit(1);
    if (error) {
        console.error(`Error querying ${tableName}:`, error.message);
    } else if (data && data.length > 0) {
        console.log(Object.keys(data[0]).join(', '));
    } else {
        console.log("No rows found. Attempting empty select schema retrieval...");
        const { data: emptyData, error: err } = await supabaseAdmin.from(tableName).select().limit(0);
        if (err) console.error("Error:", err.message);
        else console.log("Empty data keys:", emptyData ? Object.keys(emptyData) : "null");
    }
}

async function run() {
    await inspectTable('automations');
    await inspectTable('creative_prompts');
    await inspectTable('notifications');
    await inspectTable('lead_history');
    await inspectTable('ads');
}

run().catch(console.error);
