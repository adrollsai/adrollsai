import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testHttpsReset() {
    const email = 'rchopra489@gmail.com';
    const targetRedirect = 'https://local.nobogent.com/auth/callback?next=/auth/reset-password';
    console.log(`--- TESTING HTTPS RESET FOR ${email} ---`);
    console.log(`Target Redirect: ${targetRedirect}`);

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: {
            redirectTo: targetRedirect
        }
    });

    if (error) {
        console.error('Error generating link:', error);
    } else {
        console.log('Action Link:', data.properties?.action_link);
        console.log('Hashed Token:', data.properties?.hashed_token);
        console.log('Redirect To in properties:', data.properties?.redirect_to);

        // Verify OTP token_hash
        const supabaseAnon = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        const { data: verifyData, error: verifyErr } = await supabaseAnon.auth.verifyOtp({
            token_hash: data.properties?.hashed_token!,
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
}

testHttpsReset().catch(console.error);
