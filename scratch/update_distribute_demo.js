const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const email = 'adrolls-realty-demo@adrolls.in';
    console.log(`=== Querying Profile for ${email} ===`);
    
    const { data: profile, error: fetchErr } = await supabaseAdmin
        .from('profiles')
        .select('id, email, enable_distribution, role')
        .eq('email', email)
        .single();

    if (fetchErr) {
        console.error("Fetch Error:", fetchErr.message);
        return;
    }

    console.log("Current Profile State:", profile);

    console.log(`=== Updating enable_distribution to false ===`);
    const { data: updated, error: updateErr } = await supabaseAdmin
        .from('profiles')
        .update({ enable_distribution: false })
        .eq('email', email)
        .select()
        .single();

    if (updateErr) {
        console.error("Update Error:", updateErr.message);
    } else {
        console.log("Successfully updated Profile:", {
            id: updated.id,
            email: updated.email,
            enable_distribution: updated.enable_distribution,
            role: updated.role
        });
    }
}

run().catch(console.error);
