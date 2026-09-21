import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
    const { data: h1 } = await supabase
        .from('lead_history')
        .select('*')
        .eq('lead_id', 'd27ba1ff-fd12-4f8b-9af4-b64e6f2362af')
        .order('created_at', { ascending: true });
    console.log('HISTORY FOR RAVI:', JSON.stringify(h1, null, 2));

    const { data: h2 } = await supabase
        .from('lead_history')
        .select('*')
        .eq('lead_id', '3d1d670e-ef7d-4e93-b26c-0ce6de379e35')
        .order('created_at', { ascending: true });
    console.log('\nHISTORY FOR VINITA:', JSON.stringify(h2, null, 2));
}

run().catch(console.error);
