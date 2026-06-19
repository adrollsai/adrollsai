const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== INSPECTING 'rahul' LEAD ===");
    
    // Find the lead named rahul or with email rchopra489@gmail.com
    const { data: leads, error } = await supabaseAdmin
        .from('leads')
        .select('*')
        .eq('email', 'rchopra489@gmail.com')
        .order('created_at', { ascending: false });
        
    if (error) {
        console.error(error);
        return;
    }
    
    console.log(`Found ${leads.length} leads with email rchopra489@gmail.com:`);
    for (const l of leads) {
        console.log("\nLead details:", {
            id: l.id,
            name: l.name,
            email: l.email,
            phone: l.phone,
            source: l.source,
            created_at: l.created_at,
            pixel_id: l.pixel_id
        });
        
        // Fetch history
        const { data: history } = await supabaseAdmin
            .from('lead_history')
            .select('*')
            .eq('lead_id', l.id)
            .order('created_at', { ascending: true });
            
        console.log(`History events for this lead (${history?.length || 0}):`);
        history?.forEach(h => {
            console.log(`- [${h.created_at}] Action: ${h.action_type} | Desc: ${h.description}`);
        });
    }
}

run().catch(console.error);
