const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const clients = [
        { id: '2f62a259-f23b-48ee-a920-c436f36eaa4b', name: 'Bluesquare Infra' },
        { id: '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2', name: 'HomCom Realtors' },
        { id: '42d2e0c5-4fe6-4738-8a9f-63f09be01f12', name: 'GNR Homes' }
    ];

    for (let client of clients) {
        console.log(`\n=== IMAGES FOR ${client.name} (${client.id}) ===`);
        const { data: assets, error } = await supabaseAdmin
            .from('assets')
            .select('*')
            .eq('user_id', client.id)
            .eq('type', 'image')
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) {
            console.error(error);
            continue;
        }

        assets.forEach(asset => {
            console.log(`URL: ${asset.url || asset.image_url}`);
        });
    }
}

run().catch(console.error);
