const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
        
    if (error) {
        console.error(error);
        return;
    }
    
    console.log("=== ALL PROFILE FIELDS ===");
    for (const key of Object.keys(profile)) {
        const value = profile[key];
        if (value === null || value === undefined) {
            console.log(`${key}: ${value}`);
        } else if (typeof value === 'string' && value.length > 50) {
            console.log(`${key}: [String length ${value.length}] ${value.substring(0, 20)}...`);
        } else {
            console.log(`${key}:`, value);
        }
    }
}

run().catch(console.error);
