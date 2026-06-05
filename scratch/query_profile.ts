import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const targetUserId = "bc63c065-9bcc-4793-bedc-f0960406425b";
    console.log(`Fetching profile for user ${targetUserId}...`);
    
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', targetUserId)
        .maybeSingle();

    if (error) {
        console.error("Error fetching profile:", error);
        return;
    }

    if (!profile) {
        console.log("No profile found.");
        return;
    }

    console.log("=== Profile Record ===");
    console.log("ID:", profile.id);
    console.log("Business Name:", profile.business_name);
    console.log("Role:", profile.role);
    console.log("Parent ID:", profile.parent_id);
    console.log("Agency ID:", profile.agency_id);
    console.log("Enable Distribution:", profile.enable_distribution);
}

run().catch(console.error);
