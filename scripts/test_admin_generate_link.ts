import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testAdminLink() {
    const email = 'rchopra489@gmail.com';
    const localRedirect = 'http://local.nobogent.com/auth/callback?next=/auth/reset-password';
    console.log(`--- GENERATING ADMIN LINK WITH REDIRECT: ${localRedirect} ---`);

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: {
            redirectTo: localRedirect
        }
    });

    if (error) {
        console.error('Error generating link:', error);
    } else {
        console.log('Action Link:', data.properties?.action_link);
        console.log('Redirect To in properties:', data.properties?.redirect_to);
    }
}

testAdminLink().catch(console.error);
