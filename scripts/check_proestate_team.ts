import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    const ownerId = '29937131-1975-4c5f-9b78-e5b28f918d32';
    const { data: team } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, team_owner_id')
        .or(`id.eq.${ownerId},team_owner_id.eq.${ownerId}`);

    console.log('👥 Team Members under The ProEstate:', team);
}

main().catch(console.error);
