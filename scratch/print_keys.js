const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function inspectTable(tableName) {
    const { data, error } = await supabaseAdmin
        .from(tableName)
        .select('*')
        .limit(1);
    
    if (error) {
        console.error(`Error fetching from ${tableName}:`, error.message);
        return;
    }

    if (data.length === 0) {
        console.log(`Table ${tableName}: EXISTS, but 0 records.`);
    } else {
        console.log(`Table ${tableName} columns:`, Object.keys(data[0]).join(', '));
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
