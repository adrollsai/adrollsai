import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PROESTATE_USER_ID = '29937131-1975-4c5f-9b78-e5b28f918d32';

async function main() {
    console.log('🔍 Comprehensive audit of all records for Pro Estate...');

    // 1. lead_history
    const { data: hist, count: histCount } = await supabase
        .from('lead_history')
        .select('*', { count: 'exact' })
        .eq('user_id', PROESTATE_USER_ID);

    console.log(`lead_history entries with user_id: ${histCount}`);
    hist?.forEach(h => {
        console.log(`  - [${h.created_at}] ${h.action_type}: ${h.description?.slice(0, 80)}`);
    });

    // 2. whatsapp_chats
    const { data: chats, count: chatCount } = await supabase
        .from('whatsapp_chats')
        .select('*', { count: 'exact' })
        .eq('user_id', PROESTATE_USER_ID);

    console.log(`whatsapp_chats with user_id: ${chatCount}`);
    chats?.forEach(c => {
        console.log(`  - Chat: ${c.contact_name} (${c.contact_phone}) | Lead ID: ${c.lead_id}`);
    });

    // 3. whatsapp_messages
    const { data: msgs, count: msgCount } = await supabase
        .from('whatsapp_messages')
        .select('*', { count: 'exact' })
        .eq('user_id', PROESTATE_USER_ID);

    console.log(`whatsapp_messages with user_id: ${msgCount}`);

    // 4. voice_calls / call_logs
    try {
        const { data: calls, count: callCount } = await supabase
            .from('call_logs')
            .select('*', { count: 'exact' })
            .eq('user_id', PROESTATE_USER_ID);
        console.log(`call_logs with user_id: ${callCount}`);
    } catch(e) {}

    // 5. Check all leads in DB that have ever been assigned or linked to Pro Estate
    const { data: allLeads, count: allLeadsCount } = await supabase
        .from('leads')
        .select('*', { count: 'exact' })
        .or(`user_id.eq.${PROESTATE_USER_ID},assigned_to.eq.${PROESTATE_USER_ID}`);

    console.log(`Total leads matching Pro Estate user_id/assigned_to: ${allLeadsCount}`);
    allLeads?.forEach(l => {
        console.log(`  - ${l.name} | ${l.phone} | Source: ${l.source} | Stage: ${l.pipeline_stage} | Created: ${l.created_at}`);
    });
}

main().catch(console.error);
