const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function inspectTable(tableName) {
    console.log(`\n=== Inspecting table: ${tableName} ===`);
    const { data, error } = await supabaseAdmin
        .from(tableName)
        .select('*')
        .limit(1);
    
    if (error) {
        console.error(`Error fetching from ${tableName}:`, error);
        return;
    }

    if (data.length === 0) {
        console.log(`No records found in ${tableName}.`);
    } else {
        console.log(`Record columns/keys:`, Object.keys(data[0]));
        console.log(`Sample record:`, JSON.stringify(data[0], null, 2));
    }
}

async function run() {
    await inspectTable('profiles');
    await inspectTable('properties');
    await inspectTable('assets');
    await inspectTable('leads');
    await inspectTable('campaigns');
    await inspectTable('landing_pages');
}

run().catch(console.error);
