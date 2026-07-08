const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== CHECKING RECENT WHATSAPP BROADCASTS ===");
    const { data: broadcasts, error: bErr } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    if (bErr) {
        console.error("Failed to fetch broadcasts:", bErr);
    } else {
        console.log(JSON.stringify(broadcasts, null, 2));
    }

    console.log("\n=== CHECKING RECENT RECIPIENT ERRORS ===");
    const { data: recipients, error: rErr } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(10);

    if (rErr) {
        console.error("Failed to fetch recipients:", rErr);
    } else {
        recipients.forEach(r => {
            console.log(`\nRecipient: ${r.phone_number}`);
            console.log(`  Status: ${r.status}`);
            console.log(`  Error: ${r.error_message}`);
            console.log(`  Sent At: ${r.sent_at}`);
        });
    }
}

run().catch(console.error);
