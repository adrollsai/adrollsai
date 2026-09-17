import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, facebook_token, selected_page_token, selected_page_id, selected_page_name')
    .eq('id', '93c65dee-87a5-48e3-a2d2-406182a33b37')
    .single();

  if (error) {
    console.error('Error fetching profile:', error);
    return;
  }

  console.log('Page ID:', data.selected_page_id, 'Page Name:', data.selected_page_name);
  console.log('Has fb_token:', !!data.facebook_token, 'Has page_token:', !!data.selected_page_token);

  if (data.facebook_token) {
    const res = await fetch(`https://graph.facebook.com/v20.0/me/permissions?access_token=${data.facebook_token}`);
    const permData = await res.json();
    console.log('User Permissions:', JSON.stringify(permData, null, 2));

    const debugRes = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${data.facebook_token}&access_token=${process.env.NEXT_PUBLIC_FACEBOOK_APP_ID}|${process.env.FACEBOOK_CLIENT_SECRET}`
    );
    const debugData = await debugRes.json();
    console.log('Debug Token Full Response:', JSON.stringify(debugData, null, 2));
  }

  if (data.selected_page_token) {
    const pageRes = await fetch(
      `https://graph.facebook.com/v20.0/1233494216519110?fields=id,name,tasks&access_token=${data.selected_page_token}`
    );
    const pageJson = await pageRes.json();
    console.log('Page Token Check:', pageJson);
    
    // Also test leadgen_forms GET
    const formsRes = await fetch(
      `https://graph.facebook.com/v20.0/1233494216519110/leadgen_forms?access_token=${data.selected_page_token}`
    );
    const formsJson = await formsRes.json();
    console.log('leadgen_forms GET test:', formsJson);
  }

  const appToken = `${process.env.NEXT_PUBLIC_FACEBOOK_APP_ID}|${process.env.FACEBOOK_CLIENT_SECRET}`;
  const pRes = await fetch(`https://graph.facebook.com/v20.0/${process.env.NEXT_PUBLIC_FACEBOOK_APP_ID}/permissions?access_token=${appToken}`);
  const pJson = await pRes.json();
  console.log('App Approved Live Permissions:', pJson.data?.map((p: any) => `${p.permission}: ${p.status}`));

  const rRes = await fetch(`https://graph.facebook.com/v20.0/${process.env.NEXT_PUBLIC_FACEBOOK_APP_ID}/roles?access_token=${appToken}`);
  const rJson = await rRes.json();
  console.log('App Roles (Admins/Developers/Testers):', rJson);
}

check();
