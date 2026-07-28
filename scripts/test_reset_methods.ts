import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testMethods() {
    console.log('--- TESTING RESET METHODS ---');

    // Method 1: Client with flowType: 'implicit'
    const clientImplicit = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { flowType: 'implicit' } }
    );

    const { error: err1 } = await clientImplicit.auth.resetPasswordForEmail('rchopra489@gmail.com', {
        redirectTo: 'http://local.nobogent.com:3000/auth/callback?next=/auth/reset-password'
    });

    console.log('Implicit resetPasswordForEmail result error:', err1?.message || 'NO ERROR (SUCCESS)');
}

testMethods().catch(console.error);
