import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkWebhooks() {
    const { data: logs } = await supabaseAdmin
        .from('lead_history')
        .select('*')
        .ilike('description', '%131042%')
        .order('created_at', { ascending: false })
        .limit(10);

    console.log('Webhook Failure Logs in lead_history:', logs);
}

checkWebhooks().catch(console.error);
