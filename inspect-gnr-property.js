const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    console.log("=== CHECK PROPERTY 8050efba-27eb-45e2-8149-28e24de74b99 ===");
    const { data: prop } = await supabaseAdmin
        .from('properties')
        .select('*')
        .eq('id', '8050efba-27eb-45e2-8149-28e24de74b99');
    console.log(JSON.stringify(prop, null, 2));

    console.log("\n=== CHECK USER PROFILE 42d2e0c5-4fe6-4738-8a9f-63f09be01f12 ===");
    const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', '42d2e0c5-4fe6-4738-8a9f-63f09be01f12');
    console.log(JSON.stringify(prof, null, 2));
}

main().catch(console.error);
