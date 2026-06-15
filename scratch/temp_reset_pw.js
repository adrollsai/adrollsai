const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    console.log(`Attempting to set password for User ID: ${userId} to "Adrolls12345!"`);
    
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: 'Adrolls12345!'
    });
    
    if (error) {
        console.error("Failed to update password:", error);
    } else {
        console.log("Password updated successfully!", data.user.email);
    }
}

run();
