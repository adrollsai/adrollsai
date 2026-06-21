const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = '2b0312dc-c1fc-4798-ab1c-339939271229'; // Adrolls Realty profile
    
    console.log("=== Querying Custom Audiences in Meta Ad Account ===");
    const { data: prof, error: pErr } = await supabase
        .from('profiles')
        .select('facebook_token, ad_account_id')
        .eq('id', userId)
        .single();

    if (pErr || !prof) {
        console.error("Profile query error:", pErr);
        return;
    }

    const token = prof.facebook_token;
    const adAccountId = prof.ad_account_id;
    
    // Fetch all custom audiences in the account
    const fbUrl = `https://graph.facebook.com/v19.0/${adAccountId}/customaudiences?fields=id,name,subtype,description,time_created&limit=100&access_token=${token}`;
    try {
        const res = await fetch(fbUrl);
        const data = await res.json();
        
        if (data.error) {
            console.error("Meta API Error:", data.error);
            return;
        }

        const audiences = data.data || [];
        console.log(`Found ${audiences.length} custom audiences:`);
        
        // Sort by time_created descending
        audiences.sort((a, b) => b.time_created - a.time_created);
        
        audiences.slice(0, 10).forEach(aud => {
            console.log(`- Audience: "${aud.name}" (ID: ${aud.id})`);
            console.log(`  Subtype: ${aud.subtype}`);
            console.log(`  Created: ${new Date(aud.time_created * 1000).toISOString()}`);
            console.log(`  Description: ${aud.description || 'N/A'}`);
        });
    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

run().catch(console.error);
