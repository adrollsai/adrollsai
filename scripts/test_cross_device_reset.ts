import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testCrossDevice() {
    const email = 'rchopra489@gmail.com';
    console.log(`--- TESTING CROSS-DEVICE RECOVERY LINK FOR ${email} ---`);

    // Generate recovery link using admin client
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: {
            redirectTo: 'http://local.nobogent.com:3000/auth/callback?next=/auth/reset-password'
        }
    });

    if (linkErr) {
        return console.error('Error generating link:', linkErr);
    }

    const actionLink = linkData.properties?.action_link;
    const tokenHash = linkData.properties?.hashed_token;

    console.log('Action Link:', actionLink);
    console.log('Token Hash:', tokenHash);

    // Verify token_hash with anon client WITHOUT any PKCE verifier cookie
    const supabaseAnon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { flowType: 'implicit' } }
    );

    const { data: verifyData, error: verifyErr } = await supabaseAnon.auth.verifyOtp({
        token_hash: tokenHash!,
        type: 'recovery'
    });

    if (verifyErr) {
        console.error('Cross-device verification failed:', verifyErr.message);
    } else {
        console.log('SUCCESS! Cross-device verification succeeded without PKCE code verifier!');
        console.log('Verified User Email:', verifyData.user?.email);
        console.log('Session Access Token Exists:', !!verifyData.session?.access_token);
    }
}

testCrossDevice().catch(console.error);
