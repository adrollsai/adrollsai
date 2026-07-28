import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testGenerateLink() {
    const email = 'rchopra489@gmail.com';
    console.log(`--- GENERATING RECOVERY LINK FOR ${email} ---`);

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: {
            redirectTo: 'http://local.nobogent.com:3000/auth/callback?next=/auth/reset-password'
        }
    });

    if (error) {
        console.error('Generate link error:', error);
    } else {
        console.log('Generated Link Properties:');
        console.log('Action Link:', data.properties?.action_link);
        console.log('Email OTP:', data.properties?.email_otp);
        console.log('Hashed Token:', data.properties?.hashed_token);
        console.log('Redirect To:', data.properties?.redirect_to);
    }
}

testGenerateLink().catch(console.error);
