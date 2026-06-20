const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const propertyId = "66dcd35c-a3f6-41dc-9908-662fa37b98f0"; // Highland Mayfield

async function run() {
    console.log("=== Querying Highland Mayfield Property Details ===");
    const { data: prop, error } = await supabaseAdmin
        .from('properties')
        .select('*')
        .eq('id', propertyId)
        .single();

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log("Property Details:");
    console.log(`Title: ${prop.title}`);
    console.log(`Images:`, JSON.stringify(prop.images, null, 2));
    console.log(`Image URL: ${prop.image_url}`);
    console.log(`Description: ${prop.description}`);
}

run().catch(console.error);
