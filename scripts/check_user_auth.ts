import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkUser() {
    const email = 'rchopra489@gmail.com';
    console.log(`--- CHECKING USER ${email} ---`);

    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) return console.error('Error listing users:', error);

    const user = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (!user) {
        console.log(`User ${email} NOT found in Supabase Auth.`);
        console.log('Existing users count:', data.users.length);
        console.log('Sample user emails:', data.users.map(u => u.email).slice(0, 5));
    } else {
        console.log('Found User Record:');
        console.log('ID:', user.id);
        console.log('Email:', user.email);
        console.log('Email Confirmed At:', user.email_confirmed_at);
        console.log('Last Sign In:', user.last_sign_in_at);
        console.log('App Metadata:', user.app_metadata);
        console.log('User Metadata:', user.user_metadata);
    }
}

checkUser().catch(console.error);
