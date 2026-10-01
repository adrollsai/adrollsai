const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/adrolls-storage\/?$/, '');
const r2 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const PIPIXEL_AGENCY_ID = 'c7bede84-d7ea-4b02-bbbb-017d24a37914';
const SUBACCOUNT_EMAIL = 'media@passpro.co';
const SUBACCOUNT_PASSWORD = 'PassPro2026!';
const BUSINESS_NAME = 'PassPro Citizenship by Investment';

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function uploadBufferToR2(buffer, r2Key, contentType = 'image/png') {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return `${R2_PUBLIC_URL}/${r2Key}`;
}

async function run() {
  console.log('=== Step 1: Create or Resolve Auth User for PassPro ===');
  let userId = null;

  // Search existing auth users
  const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  const existingUser = (users || []).find(u => u.email?.toLowerCase() === SUBACCOUNT_EMAIL.toLowerCase());

  if (existingUser) {
    console.log(`Found existing auth user: ${existingUser.id}`);
    userId = existingUser.id;
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: SUBACCOUNT_PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'client', business_name: BUSINESS_NAME }
    });
    if (updateErr) console.error('Error updating existing user:', updateErr);
    else console.log('Password synchronized.');
  } else {
    console.log(`Creating new user for ${SUBACCOUNT_EMAIL}...`);
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: SUBACCOUNT_EMAIL,
      password: SUBACCOUNT_PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'client', business_name: BUSINESS_NAME }
    });

    if (createErr) {
      console.error('Error creating user:', createErr);
      process.exit(1);
    }
    userId = newUser.user.id;
    console.log(`Successfully created auth user with ID: ${userId}`);
  }

  console.log('=== Step 2: Fetch and Upload Brand Assets ===');
  let logoUrl = null;
  try {
    const iconBuf = await fetchBuffer('https://passpro.co/apple-touch-icon.png');
    const r2Key = `logos/${userId}/passpro-logo.png`;
    logoUrl = await uploadBufferToR2(iconBuf, r2Key, 'image/png');
    console.log('Uploaded PassPro logo to R2:', logoUrl);
  } catch (err) {
    console.warn('Could not upload logo from external URL, proceeding without logo:', err.message);
  }

  console.log('=== Step 3: Upsert PassPro Profile Under Pipixel Agency ===');
  const profilePayload = {
    id: userId,
    email: SUBACCOUNT_EMAIL,
    business_name: BUSINESS_NAME,
    role: 'client',
    agency_id: PIPIXEL_AGENCY_ID,
    parent_id: PIPIXEL_AGENCY_ID,
    contact_number: '+971 4 554 1449',
    address: 'Office 501, Al Habtoor Business Tower, Dubai Marina, Dubai, UAE',
    logo_url: logoUrl,
    brand_color: '#B8860B',
    mission_statement: 'PassPro is a premier Dubai-based Government Authorised Agent advising on every approved investment route across Caribbean Citizenship-by-Investment programmes (Antigua & Barbuda, Dominica, Grenada, St Kitts & Nevis, Saint Lucia) and Vanuatu. Committed to absolute integrity, speed, and discretion, we deliver second citizenship and global wealth mobility to high-net-worth families.',
    business_info: JSON.stringify({
      bio: 'PassPro is a premier Dubai-based Government Authorised Agent advising on every approved investment route across Caribbean Citizenship-by-Investment programmes (Antigua & Barbuda, Dominica, Grenada, St Kitts & Nevis, Saint Lucia) and Vanuatu. Founded in 2016 and led by Giselle Bru, PassPro has advised 4,000+ families across 50+ nationalities seeking second citizenship, second passports, and global mobility.',
      notification_email: SUBACCOUNT_EMAIL,
      timezone: 'Asia/Dubai',
      industry: 'Citizenship by Investment & Second Passport Advisory',
      website: 'https://passpro.co',
      offices: {
        dubai: 'Office 501, Al Habtoor Business Tower, Dubai Marina, Dubai, UAE'
      },
      phone_numbers: ['+971 4 554 1449']
    }),
    credits: 1000,
    subscription_plan: 'enterprise',
    subscription_status: 'active',
    subscription_valid_until: '2099-12-31T23:59:59+00:00',
    onboarding_completed: true,
    accepted_terms: true,
    currency: 'USD',
    client_features: ['analytics', 'inventory', 'creation', 'ads', 'crm', 'whatsapp', 'voice_agent', 'flows'],
    character_description: 'An authoritative, discreet citizenship by investment legal advisor and global wealth mobility expert.',
    character_url: logoUrl,
    timezone: 'Asia/Dubai'
  };

  const { error: profileErr } = await supabaseAdmin.from('profiles').upsert(profilePayload);
  if (profileErr) {
    console.error('Profile Upsert Error:', profileErr);
    process.exit(1);
  }
  console.log('Profile successfully upserted!');

  console.log('=== Step 4: Record Initial Credit Transaction in Ledger ===');
  const { error: txErr } = await supabaseAdmin.from('credit_transactions').insert({
    user_id: userId,
    amount: 1000,
    category: 'topup',
    description: 'Initial package activation credit grant: 1000 credits'
  });

  if (txErr) {
    console.warn('Warning: Could not insert credit transaction:', txErr.message);
  } else {
    console.log('Credit transaction successfully recorded in ledger.');
  }

  console.log('=== Step 5: Verification ===');
  const { data: verifyProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, email, business_name, role, agency_id, parent_id, subscription_plan, subscription_status, credits, client_features, subscription_valid_until')
    .eq('id', userId)
    .single();

  console.log('Verified Profile:', verifyProfile);

  // Test sign in with password to confirm credentials work
  const { data: authData, error: authErr } = await supabaseAdmin.auth.signInWithPassword({
    email: SUBACCOUNT_EMAIL,
    password: SUBACCOUNT_PASSWORD
  });

  if (authErr) {
    console.error('Verification sign-in failed:', authErr.message);
  } else {
    console.log('Verification sign-in SUCCESSFUL! User session established for:', authData.user.email);
  }

  console.log('\n--- SETUP COMPLETED SUCCESSFULLY ---');
  console.log('Email:', SUBACCOUNT_EMAIL);
  console.log('Password:', SUBACCOUNT_PASSWORD);
  console.log('Agency ID (Pipixel):', PIPIXEL_AGENCY_ID);
  console.log('Package:', verifyProfile.subscription_plan, `(Status: ${verifyProfile.subscription_status})`);
  console.log('Credits:', verifyProfile.credits);
}

run().catch(console.error);
