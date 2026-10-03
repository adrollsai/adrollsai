const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PIPIXEL_AGENCY_ID = 'c7bede84-d7ea-4b02-bbbb-017d24a37914';
const TARGET_EMAIL = 'mfaizaldxb@gmail.com';
const TARGET_PASSWORD = 'Faizal@PiPixel2026!';
const BUSINESS_NAME = 'Faizal DXB';

async function setupSubaccount() {
  console.log('========================================================');
  console.log('🚀 CREATING SUBACCOUNT UNDER PIPIXEL FOR:', TARGET_EMAIL);
  console.log('========================================================');

  // 1. Create or resolve Auth User
  console.log('\n--- Step 1: Checking / Creating Auth User ---');
  let userId = null;
  const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) throw listErr;

  const existingUser = users.find(u => u.email?.toLowerCase() === TARGET_EMAIL.toLowerCase());

  if (existingUser) {
    console.log(`Found existing auth user: ${existingUser.id}`);
    userId = existingUser.id;
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: TARGET_PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'client', business_name: BUSINESS_NAME }
    });
    if (updateErr) throw updateErr;
    console.log('✓ Password and metadata updated for existing auth user.');
  } else {
    console.log(`Creating new auth user for ${TARGET_EMAIL}...`);
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: TARGET_EMAIL,
      password: TARGET_PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'client', business_name: BUSINESS_NAME }
    });
    if (createErr) throw createErr;
    userId = newUser.user.id;
    console.log(`✓ Created new auth user with ID: ${userId}`);
  }

  // 2. Upsert Profile under PiPixel
  console.log('\n--- Step 2: Configuring Profile under PiPixel Agency ---');
  const profilePayload = {
    id: userId,
    email: TARGET_EMAIL,
    business_name: BUSINESS_NAME,
    role: 'client',
    agency_id: PIPIXEL_AGENCY_ID,
    parent_id: PIPIXEL_AGENCY_ID,
    subscription_plan: 'enterprise',
    subscription_status: 'active',
    subscription_valid_until: '2099-12-31T23:59:59+00:00',
    credits: 1000,
    onboarding_completed: true,
    accepted_terms: true,
    currency: 'AED',
    timezone: 'Asia/Dubai',
    client_features: [
      'analytics',
      'inventory',
      'creation',
      'ads',
      'crm',
      'whatsapp',
      'voice_agent',
      'flows'
    ]
  };

  const { error: profileErr } = await supabaseAdmin.from('profiles').upsert(profilePayload);
  if (profileErr) throw profileErr;
  console.log('✓ Profile successfully upserted and linked to PiPixel agency!');

  // 3. Record in Credit Transactions Ledger
  console.log('\n--- Step 3: Recording Credit Ledger Entry ---');
  await supabaseAdmin.from('credit_transactions').delete().eq('user_id', userId);
  const { error: txErr } = await supabaseAdmin.from('credit_transactions').insert({
    user_id: userId,
    amount: 1000,
    category: 'topup',
    description: 'Initial account activation: 1,000 credits granted under PiPixel'
  });
  if (txErr) console.warn('Credit transaction note:', txErr.message);
  else console.log('✓ 1,000 credits ledger entry recorded successfully.');

  // 4. Verify Authentication
  console.log('\n--- Step 4: Verifying Sign-in with Credentials ---');
  const { data: authData, error: authErr } = await supabaseAdmin.auth.signInWithPassword({
    email: TARGET_EMAIL,
    password: TARGET_PASSWORD
  });

  if (authErr) {
    throw new Error(`Verification sign-in failed: ${authErr.message}`);
  }
  console.log('✓ Login verification SUCCESSFUL! Session established for:', authData.user.email);

  // 5. Verify Profile from DB
  const { data: verifiedProfile, error: vErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, business_name, role, agency_id, parent_id, credits, subscription_plan, subscription_status')
    .eq('id', userId)
    .single();

  if (vErr) throw vErr;

  console.log('\n========================================================');
  console.log('🎉 ACCOUNT CREATION & ACTIVATION COMPLETED SUCCESSFULLY!');
  console.log('========================================================');
  console.log('User ID:          ', verifiedProfile.id);
  console.log('Email:            ', verifiedProfile.email);
  console.log('Password:         ', TARGET_PASSWORD);
  console.log('Business Name:    ', verifiedProfile.business_name);
  console.log('Role:             ', verifiedProfile.role);
  console.log('Agency ID (PiPixel):', verifiedProfile.agency_id);
  console.log('Subscription:     ', verifiedProfile.subscription_plan, `(${verifiedProfile.subscription_status})`);
  console.log('Credits Balance:  ', verifiedProfile.credits);
  console.log('========================================================');
}

setupSubaccount().catch((err) => {
  console.error('❌ Error during setup:', err);
  process.exit(1);
});
