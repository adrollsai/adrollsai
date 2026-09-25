const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectPermissions() {
  const bioqueId = '68b55a31-a16d-454d-a20f-11adabf590b0';
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', bioqueId)
    .single();

  const token = profile.facebook_token;
  const pageId = profile.selected_page_id || '1272183225974349';

  console.log('Bioque Profile Selected Page ID:', profile.selected_page_id);
  console.log('Bioque Profile Selected Page Token:', profile.selected_page_token ? 'Present' : 'Null');

  // 1. Debug Token Permissions
  console.log('\n--- 1. TOKEN PERMISSIONS (/me/permissions) ---');
  const permRes = await fetch(`https://graph.facebook.com/v20.0/me/permissions?access_token=${token}`);
  const permData = await permRes.json();
  console.log('Permissions:', JSON.stringify(permData, null, 2));

  // 2. Token Details (/debug_token)
  console.log('\n--- 2. TOKEN DEBUG INFO (/debug_token) ---');
  const debugRes = await fetch(`https://graph.facebook.com/v20.0/debug_token?input_token=${token}&access_token=${token}`);
  console.log('Debug token:', JSON.stringify(await debugRes.json(), null, 2));

  // 3. User Pages Accounts (/me/accounts)
  console.log('\n--- 3. USER PAGES (/me/accounts) ---');
  const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,tasks,access_token&access_token=${token}`);
  const accData = await accRes.json();
  console.log('User Accounts (Pages):', JSON.stringify(accData, null, 2));

  // 4. Test Page Token directly for pageId
  console.log(`\n--- 4. PAGE TOKEN & TASKS FOR PAGE ${pageId} ---`);
  const pageRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}?fields=id,name,tasks,access_token&access_token=${token}`);
  const pageData = await pageRes.json();
  console.log('Page info from user token:', JSON.stringify(pageData, null, 2));

  const pageToken = pageData.access_token || profile.selected_page_token;
  if (pageToken) {
    console.log('\n--- 5. TESTING LEADGEN_FORMS WITH PAGE TOKEN ---');
    const formRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/leadgen_forms?access_token=${pageToken}`);
    console.log('leadgen_forms response with page token:', JSON.stringify(await formRes.json(), null, 2));
  } else {
    console.log('\n--- 5. NO PAGE TOKEN FOUND! TESTING WITH USER TOKEN ---');
    const formRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/leadgen_forms?access_token=${token}`);
    console.log('leadgen_forms response with user token:', JSON.stringify(await formRes.json(), null, 2));
  }
}

inspectPermissions();
