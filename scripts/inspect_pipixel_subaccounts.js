const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const PIPIXEL_AGENCY_ID = 'c7bede84-d7ea-4b02-bbbb-017d24a37914';
  
  // 1. Fetch PiPixel profile
  const { data: pipixel } = await supabaseAdmin
    .from('profiles')
    .select('id, email, business_name, role, agency_id, parent_id, credits, subscription_plan, subscription_status')
    .eq('id', PIPIXEL_AGENCY_ID)
    .single();
  console.log('PiPixel Agency Profile:', pipixel);

  // 2. Fetch existing subaccounts under PiPixel
  const { data: subaccounts, error: subErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, business_name, role, agency_id, parent_id, credits, subscription_plan, subscription_status, client_features')
    .or(`agency_id.eq.${PIPIXEL_AGENCY_ID},parent_id.eq.${PIPIXEL_AGENCY_ID}`);
  console.log('Existing Subaccounts under PiPixel:', subaccounts);

  // 3. Check if Mfaizaldxb@gmail.com exists
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
  const targetEmail = 'mfaizaldxb@gmail.com';
  const foundUser = users.find(u => u.email?.toLowerCase() === targetEmail);
  console.log('Target user in Auth:', foundUser ? { id: foundUser.id, email: foundUser.email } : 'Not found');

  const { data: targetProfile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .ilike('email', targetEmail);
  console.log('Target user in Profiles:', targetProfile);
}

main().catch(console.error);
