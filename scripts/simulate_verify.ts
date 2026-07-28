import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function simulateVerify() {
    const email = 'rchopra489@gmail.com';
    console.log(`--- SIMULATING RECOVERY LINK FOR ${email} ---`);

    // 1. Generate link
    const { data: genData, error: genErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email
    });

    if (genErr) return console.error('Error generating link:', genErr);

    const tokenHash = genData.properties?.hashed_token;
    console.log('Generated token_hash:', tokenHash);

    // 2. Test verifying with supabase client verifyOtp
    const supabaseAnon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: verifyData, error: verifyErr } = await supabaseAnon.auth.verifyOtp({
        token_hash: tokenHash!,
        type: 'recovery'
    });

    if (verifyErr) {
        console.error('verifyOtp error:', verifyErr);
    } else {
        console.log('verifyOtp success!');
        console.log('User:', verifyData.user?.email);
        console.log('Session access token present:', !!verifyData.session?.access_token);
    }
}

simulateVerify().catch(console.error);
