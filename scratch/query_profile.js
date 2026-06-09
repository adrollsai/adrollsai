const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const userId = 'fd337d26-5919-42c1-a805-577fda7b93bf';
    const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) {
        console.error("Error fetching profile:", error);
    } else {
        console.log("=== Profile Keys ===");
        console.log(JSON.stringify(profile, null, 2));
    }
}

run();
