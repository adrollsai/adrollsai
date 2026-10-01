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
const SUBACCOUNT_EMAIL = 'hyder@citizenshipbay.com';
const SUBACCOUNT_PASSWORD = 'CitizenshipBay2026!';
const BUSINESS_NAME = 'Citizenship Bay';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), headers: res.headers, statusCode: res.statusCode }));
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
  console.log('=== Step 0: Clean up mistaken PassPro test account if needed ===');
  const { data: { users: allUsers } } = await supabaseAdmin.auth.admin.listUsers();
  const passproUser = allUsers.find(u => u.email?.toLowerCase() === 'media@passpro.co');
  if (passproUser) {
    console.log(`Removing mistaken PassPro account ${passproUser.id}...`);
    await supabaseAdmin.from('credit_transactions').delete().eq('user_id', passproUser.id);
    await supabaseAdmin.from('profiles').delete().eq('id', passproUser.id);
    await supabaseAdmin.auth.admin.deleteUser(passproUser.id);
    console.log('Passpro account cleaned up.');
  }

  console.log('=== Step 1: Create or Resolve Auth User for Citizenship Bay ===');
  let userId = null;

  const existingCB = allUsers.find(u => u.email?.toLowerCase() === SUBACCOUNT_EMAIL.toLowerCase());

  if (existingCB) {
    console.log(`Found existing auth user: ${existingCB.id}`);
    userId = existingCB.id;
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
    // Try to find favicon or logo from citizenshipbay.com
    const homeRes = await fetchUrl('https://www.citizenshipbay.com/');
    const html = homeRes.buffer.toString('utf-8');
    const iconMatch = html.match(/href=[\"']([^\"']*(?:favicon|logo)[^\"']*\.(?:png|jpg|webp|ico))[\"']/i);
    let logoCandidate = iconMatch ? iconMatch[1] : null;
    if (logoCandidate && !logoCandidate.startsWith('http')) {
      logoCandidate = 'https://www.citizenshipbay.com' + (logoCandidate.startsWith('/') ? '' : '/') + logoCandidate;
    }
    console.log('Found logo/favicon URL candidate:', logoCandidate);
    if (logoCandidate) {
      const imgRes = await fetchUrl(logoCandidate);
      if (imgRes.statusCode === 200 && imgRes.buffer.length > 0) {
        const ct = imgRes.headers['content-type'] || 'image/png';
        const r2Key = `logos/${userId}/citizenshipbay-logo.png`;
        logoUrl = await uploadBufferToR2(imgRes.buffer, r2Key, ct);
        console.log('Uploaded Citizenship Bay logo to R2:', logoUrl);
      }
    }
  } catch (err) {
    console.warn('Could not auto-fetch logo:', err.message);
  }

  console.log('=== Step 3: Upsert Citizenship Bay Profile Under Pipixel Agency ===');
  const profilePayload = {
    id: userId,
    email: SUBACCOUNT_EMAIL,
    business_name: BUSINESS_NAME,
    role: 'client',
    agency_id: PIPIXEL_AGENCY_ID,
    parent_id: PIPIXEL_AGENCY_ID,
    contact_number: '+971 4 430 8028',
    address: 'Emaar Business Park, Building 4, Office 404, Sheikh Zayed Road, Dubai, UAE',
    logo_url: logoUrl,
    brand_color: '#0A2540',
    mission_statement: 'Citizenship Bay is a premier Dubai-based Citizenship and Residency by Investment advisory firm. We guide high-net-worth individuals and families through globally approved legal investment migration programs across the Caribbean, Europe, and the Pacific with absolute integrity and transparency.',
    business_info: JSON.stringify({
      bio: 'Citizenship Bay is a leading Dubai-based consultancy specializing in legal citizenship and residency by investment programs worldwide. We assist clients in securing second citizenship and passports across Antigua & Barbuda, Dominica, Grenada, St Kitts & Nevis, Saint Lucia, Vanuatu, and European Golden Visa pathways.',
      notification_email: SUBACCOUNT_EMAIL,
      timezone: 'Asia/Dubai',
      industry: 'Citizenship & Residency by Investment',
      website: 'https://www.citizenshipbay.com',
      offices: {
        dubai: 'Emaar Business Park, Building 4, Office 404, Sheikh Zayed Road, Dubai, UAE'
      },
      phone_numbers: ['+971 4 430 8028', '+971 58 178 8208']
    }),
    credits: 1000,
    subscription_plan: 'enterprise',
    subscription_status: 'active',
    subscription_valid_until: '2099-12-31T23:59:59+00:00',
    onboarding_completed: true,
    accepted_terms: true,
    currency: 'USD',
    client_features: ['analytics', 'inventory', 'creation', 'ads', 'crm', 'whatsapp', 'voice_agent', 'flows'],
    character_description: 'A distinguished, authoritative citizenship by investment legal advisor and global mobility consultant.',
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
  // Clear any existing initial grant if rerun
  await supabaseAdmin.from('credit_transactions').delete().eq('user_id', userId);
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
