import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    const { data: p } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', '29937131-1975-4c5f-9b78-e5b28f918d32')
        .single();

    console.log('Pro Estate profile in Supabase:', p);
}

main().catch(console.error);
