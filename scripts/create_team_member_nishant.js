const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceRole) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole);
const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

const NOBOGENT_PARENT_ID = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const MEMBER_EMAIL = 'nishantyadav2710@gmail.com';
const MEMBER_NAME = 'Nishant Yadav';
const MEMBER_PASSWORD = 'Nishant@Nobogent2026!';
const MEMBER_ROLE = 'agent';

async function createTeamMember() {
    console.log(`Starting account creation for: ${MEMBER_EMAIL} under Nobogent (${NOBOGENT_PARENT_ID})...`);

    // Verify parent profile
    const { data: parentProfile, error: parentErr } = await supabaseAdmin
        .from('profiles')
        .select('id, email, business_name, role')
        .eq('id', NOBOGENT_PARENT_ID)
        .single();

    if (parentErr || !parentProfile) {
        throw new Error(`Parent profile not found: ${parentErr?.message}`);
    }
    console.log(`Found Parent Profile: ${parentProfile.business_name} (${parentProfile.email}) [Role: ${parentProfile.role}]`);

    // Check if user already exists in auth
    const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr) throw listErr;

    const existingAuthUser = users.find(u => u.email?.toLowerCase().trim() === MEMBER_EMAIL.toLowerCase().trim());
    let userId = null;

    if (existingAuthUser) {
        console.log(`User already exists in Supabase Auth with ID: ${existingAuthUser.id}. Updating password...`);
        userId = existingAuthUser.id;
        const { error: updateAuthErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            password: MEMBER_PASSWORD,
            email_confirm: true,
            user_metadata: {
                role: MEMBER_ROLE,
                full_name: MEMBER_NAME
            }
        });
        if (updateAuthErr) throw updateAuthErr;
        console.log('Successfully updated existing auth user password and metadata.');
    } else {
        console.log('Creating new auth user in Supabase Auth...');
        const { data: createData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email: MEMBER_EMAIL,
            password: MEMBER_PASSWORD,
            email_confirm: true,
            user_metadata: {
                role: MEMBER_ROLE,
                full_name: MEMBER_NAME
            }
        });
        if (createErr) throw createErr;
        userId = createData.user.id;
        console.log(`Auth user created successfully with ID: ${userId}`);
    }

    // Upsert Profile
    console.log(`Upserting profile for user ${userId}...`);
    const profilePayload = {
        id: userId,
        email: MEMBER_EMAIL,
        full_name: MEMBER_NAME,
        business_name: MEMBER_NAME,
        role: MEMBER_ROLE,
        parent_id: NOBOGENT_PARENT_ID,
        agency_id: null,
        timezone: 'Asia/Kolkata',
        created_at: new Date().toISOString()
    };

    const { data: profileData, error: profileErr } = await supabaseAdmin
        .from('profiles')
        .upsert(profilePayload)
        .select()
        .single();

    if (profileErr) {
        throw new Error(`Failed to upsert profile: ${profileErr.message}`);
    }

    console.log('Profile successfully configured:', profileData);

    // Verify authentication test
    console.log('Testing sign-in with the configured credentials...');
    const { data: signInData, error: signInErr } = await supabaseClient.auth.signInWithPassword({
        email: MEMBER_EMAIL,
        password: MEMBER_PASSWORD
    });

    if (signInErr) {
        console.error('Sign-in test failed:', signInErr);
    } else {
        console.log('Sign-in test SUCCESSFUL! User session established for:', signInData.user.email);
    }

    console.log('\n=============================================');
    console.log('TEAM MEMBER ACCOUNT CREATED SUCCESSFULLY');
    console.log(`Email:    ${MEMBER_EMAIL}`);
    console.log(`Password: ${MEMBER_PASSWORD}`);
    console.log(`Role:     ${MEMBER_ROLE}`);
    console.log(`Parent:   Nobogent (${parentProfile.email})`);
    console.log('=============================================\n');
}

createTeamMember().catch((err) => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
