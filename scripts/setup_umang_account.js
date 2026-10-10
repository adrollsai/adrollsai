const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const NOBOGENT_AGENCY_ID = 'bc63c065-9bcc-4793-bedc-f0960406425b'; // Nobogent Super Admin
const TARGET_EMAIL = 'Umangassociates5@gmail.com';
const TARGET_PASSWORD = 'Umang@Nobogent2026!';
const BUSINESS_NAME = 'Umang Associates';
const AI_TASK_CREDITS = 1500;
const CALLING_CREDITS = 2500;
const TOTAL_CREDITS = AI_TASK_CREDITS + CALLING_CREDITS; // 4000

async function setupUmangAccount() {
  console.log('========================================================');
  console.log('🚀 CREATING NOBOGENT CLIENT ACCOUNT FOR:', TARGET_EMAIL);
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

  // 2. Upsert Profile under Nobogent
  console.log('\n--- Step 2: Configuring Profile under Nobogent ---');
  const profilePayload = {
    id: userId,
    email: TARGET_EMAIL,
    business_name: BUSINESS_NAME,
    full_name: BUSINESS_NAME,
    role: 'client',
    agency_id: NOBOGENT_AGENCY_ID,
    parent_id: NOBOGENT_AGENCY_ID,
    subscription_plan: 'enterprise',
    subscription_status: 'active',
    subscription_valid_until: '2030-12-31T23:59:59+00:00',
    credits: TOTAL_CREDITS,
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    onboarding_completed: true,
    accepted_terms: true,
    selected_text_llm: 'gemini',
    voice_provider: 'gemini',
    auto_call_new_leads: false,
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

  const { error: profileErr } = await supabaseAdmin
    .from('profiles')
    .upsert(profilePayload, { onConflict: 'id' });

  if (profileErr) throw profileErr;
  console.log('✓ Profile successfully upserted and linked to Nobogent!');

  // 3. Record in Credit Transactions Ledger
  console.log('\n--- Step 3: Recording Credit Ledger Entries ---');
  await supabaseAdmin.from('credit_transactions').delete().eq('user_id', userId);

  const { error: txErr1 } = await supabaseAdmin.from('credit_transactions').insert({
    user_id: userId,
    amount: AI_TASK_CREDITS,
    category: 'ai_generation',
    description: 'Initial account allocation: 1,500 Credits for all AI tasks'
  });
  if (txErr1) console.warn('Credit transaction 1 note:', txErr1.message);
  else console.log(`✓ ${AI_TASK_CREDITS} AI task credits ledger entry recorded.`);

  const { error: txErr2 } = await supabaseAdmin.from('credit_transactions').insert({
    user_id: userId,
    amount: CALLING_CREDITS,
    category: 'calling',
    description: 'Initial account allocation: 2,500 AI Voice Calling credits'
  });
  if (txErr2) console.warn('Credit transaction 2 note:', txErr2.message);
  else console.log(`✓ ${CALLING_CREDITS} calling credits ledger entry recorded.`);

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
    .select('id, email, business_name, role, agency_id, parent_id, credits, subscription_plan, subscription_status, client_features')
    .eq('id', userId)
    .single();

  if (vErr) throw vErr;

  console.log('\n========================================================');
  console.log('🎉 UMANG ASSOCIATES ACCOUNT CREATED SUCCESSFULLY!');
  console.log('========================================================');
  console.log({
    userId: verifiedProfile.id,
    email: verifiedProfile.email,
    business_name: verifiedProfile.business_name,
    role: verifiedProfile.role,
    password: TARGET_PASSWORD,
    totalCredits: verifiedProfile.credits,
    aiTaskCredits: AI_TASK_CREDITS,
    callingCredits: CALLING_CREDITS,
    subscriptionPlan: verifiedProfile.subscription_plan,
    subscriptionStatus: verifiedProfile.subscription_status,
    features: verifiedProfile.client_features
  });
}

setupUmangAccount().catch(err => {
  console.error('Fatal error setting up Umang Associates account:', err);
  process.exit(1);
});
