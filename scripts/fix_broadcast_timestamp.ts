import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixBroadcastTimestamp() {
    const broadcastId = 'ecd17a20-5f12-4a2d-902b-542492e1e9b0';
    await supabaseAdmin
        .from('whatsapp_broadcasts')
        .update({ created_at: new Date().toISOString() })
        .eq('id', broadcastId);
    console.log(`Updated created_at for broadcast ${broadcastId}`);
}

fixBroadcastTimestamp().catch(console.error);
