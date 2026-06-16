const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
    console.log("=== Debugging Meta Token Permissions ===");
    const adAccountId = "act_431233473660683";

    // Find the target profile
    const { data: subAccount, error: err1 } = await supabase
        .from('profiles')
        .select('id, business_name, role, facebook_token, agency_id, parent_id')
        .eq('ad_account_id', adAccountId)
        .single();

    if (err1) {
        console.error("Error fetching sub-account:", err1);
        return;
    }

    if (subAccount.facebook_token) {
        console.log(`\n--- Sub-account (${subAccount.business_name}) Token Permissions ---`);
        try {
            const res = await fetch(`https://graph.facebook.com/v19.0/me/permissions?access_token=${subAccount.facebook_token}`);
            const data = await res.json();
            console.log("Permissions:", JSON.stringify(data, null, 2));
        } catch (e) {
            console.error("Fetch failed:", e);
        }
    }
}

main().catch(console.error);
