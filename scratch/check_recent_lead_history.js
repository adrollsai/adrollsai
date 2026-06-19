const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== ALL LEAD HISTORY EVENTS (SINCE June 17, 2026) ===");
    
    const { data: history, error } = await supabaseAdmin
        .from('lead_history')
        .select('*')
        .gte('created_at', '2026-06-17T00:00:00.000Z')
        .order('created_at', { ascending: false });
        
    if (error) {
        console.error(error);
        return;
    }
    
    console.log(`Found ${history.length} history records:`);
    for (const h of history) {
        // Fetch lead name if it still exists
        const { data: lead } = await supabaseAdmin
            .from('leads')
            .select('name, source')
            .eq('id', h.lead_id)
            .maybeSingle();
            
        console.log(`- [${h.created_at}] Lead ID: ${h.lead_id} | Name in DB: "${lead ? lead.name : 'DELETED'}" | Source: "${lead ? lead.source : 'N/A'}" | Action: ${h.action_type} | Desc: ${h.description}`);
    }
}

run().catch(console.error);
