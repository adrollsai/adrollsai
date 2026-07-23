const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("Searching for Randeep Singh Mann...");
    const { data: leads, error: leadsErr } = await supabaseAdmin
        .from('leads')
        .select('*')
        .ilike('name', '%Randeep%');

    if (leadsErr) {
        console.error("Error fetching leads:", leadsErr);
        return;
    }

    console.log(`Matched ${leads.length} leads:`);
    console.log(JSON.stringify(leads, null, 2));

    for (const lead of leads) {
        console.log(`\n--- History for Lead: ${lead.name} (${lead.id}) ---`);
        const { data: history, error: histErr } = await supabaseAdmin
            .from('lead_history')
            .select('*')
            .eq('lead_id', lead.id)
            .order('created_at', { ascending: false });
        
        if (histErr) {
            console.error("Error fetching history:", histErr);
        } else {
            console.log(history);
        }

        // Search whatsapp chats by phone or matching lead_id
        console.log(`\n--- WhatsApp Chats matching lead_id or phone (${lead.phone}) ---`);
        const { data: chats, error: chatsErr } = await supabaseAdmin
            .from('whatsapp_chats')
            .select('*')
            .or(`lead_id.eq.${lead.id},recipient_phone.ilike.%${lead.phone.replace(/\D/g, '')}%`);
            
        if (chatsErr) {
            console.error("Error fetching chats:", chatsErr);
        } else {
            console.log(chats);
            for (const chat of chats) {
                console.log(`\n--- Messages for Chat ID: ${chat.id} ---`);
                const { data: messages, error: msgsErr } = await supabaseAdmin
                    .from('whatsapp_messages')
                    .select('*')
                    .eq('chat_id', chat.id)
                    .order('created_at', { ascending: false });
                if (msgsErr) {
                    console.error("Error fetching messages:", msgsErr);
                } else {
                    console.log(`Found ${messages.length} messages.`);
                    console.log(messages.map(m => ({ id: m.id, role: m.role, text: m.message_text, created_at: m.created_at })));
                }
            }
        }
    }
}

run().catch(console.error);
