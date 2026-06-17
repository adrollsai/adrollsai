const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("Checking landing_pages column 'pixel_id'...");
    try {
        const { data, error } = await supabaseAdmin
            .from('landing_pages')
            .select('id, pixel_id')
            .limit(1);
        if (error) {
            console.error("Error querying landing_pages:", error.message);
        } else {
            console.log("landing_pages query successful. pixel_id exists!");
        }
    } catch (e) {
        console.error("Crash checking landing_pages:", e.message);
    }

    console.log("Checking leads column 'pixel_id'...");
    try {
        const { data, error } = await supabaseAdmin
            .from('leads')
            .select('id, pixel_id')
            .limit(1);
        if (error) {
            console.error("Error querying leads:", error.message);
        } else {
            console.log("leads query successful. pixel_id exists!");
        }
    } catch (e) {
        console.error("Crash checking leads:", e.message);
    }
}

run().catch(console.error);
