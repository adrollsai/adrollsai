const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    console.log("=== SEARCHING PROFILES FOR 'gnr' ===");
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email, credits')
        .or('full_name.ilike.%gnr%,email.ilike.%gnr%');

    if (error) {
        console.error("Search error:", error);
        return;
    }

    console.log("Found profiles:", JSON.stringify(profiles, null, 2));

    if (!profiles || profiles.length === 0) {
        console.log("No profiles matched 'gnr'. Let me list recent active profiles:");
        const { data: recent } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, email, credits')
            .order('id', { ascending: false })
            .limit(10);
        console.log(JSON.stringify(recent, null, 2));
        return;
    }

    for (const p of profiles) {
        const currentCredits = p.credits || 0;
        const newCredits = currentCredits + 2000;
        console.log(`Adding 2000 credits to user ${p.full_name} (${p.id}). Current: ${currentCredits} -> New: ${newCredits}`);

        const { data: updated, error: updateErr } = await supabaseAdmin
            .from('profiles')
            .update({ credits: newCredits })
            .eq('id', p.id)
            .select()
            .single();

        if (updateErr) {
            console.error(`Error updating profile ${p.id}:`, updateErr);
        } else {
            console.log(`SUCCESS! Updated profile ${updated.full_name} (${updated.id}) credits: ${updated.credits}`);
        }
    }
}

main().catch(console.error);
