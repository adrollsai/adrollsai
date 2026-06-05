require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const userId = "9bbf6e51-283e-48d1-bbb4-8dc546cc74b2";

async function run() {
    try {
        console.log("=== Listing files in 'logos' bucket for user:", userId);
        const { data, error } = await supabase
            .storage
            .from('logos')
            .list('', {
                limit: 100,
                sortBy: { column: 'name', order: 'desc' }
            });

        if (error) {
            console.error("Error listing files:", error);
            return;
        }

        const userFiles = data.filter(file => file.name.includes(userId));
        console.log(`Found ${userFiles.length} files matching userId:`);
        userFiles.forEach(file => {
            console.log(`- ${file.name} (Size: ${file.metadata?.size || 'unknown'}, Created: ${file.created_at})`);
        });
    } catch (e) {
        console.error(e);
    }
}

run();
