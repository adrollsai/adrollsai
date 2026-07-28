import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testOtpFlow() {
    const email = 'rchopra489@gmail.com';
    console.log(`--- TESTING OTP RECOVERY FLOW FOR ${email} ---`);

    // 1. Generate recovery link
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: {
            redirectTo: 'http://local.nobogent.com/auth/callback?next=/auth/reset-password'
        }
    });

    if (linkErr) return console.error('Error generating link:', linkErr);

    const tokenHash = linkData.properties?.hashed_token;
    console.log('Action link generated:', linkData.properties?.action_link);
    console.log('Token Hash:', tokenHash);

    // 2. Simulate server route calling verifyOtp (no cookies, no code verifier!)
    const supabaseServer = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: verifyData, error: verifyErr } = await supabaseServer.auth.verifyOtp({
        token_hash: tokenHash!,
        type: 'recovery'
    });

    if (verifyErr) {
        console.error('VERIFY OTP FAILED:', verifyErr.message);
    } else {
        console.log('VERIFY OTP SUCCESS!');
        console.log('User Email:', verifyData.user?.email);
        console.log('Session Access Token Exists:', !!verifyData.session?.access_token);
    }
}

testOtpFlow().catch(console.error);
