const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function diagnose() {
  const { data: p } = await s.from('profiles').select('id, email, selected_page_id, selected_page_token, facebook_token, linkedin_id, linkedin_token, linkedin_urn').eq('id', 'bc63c065-9bcc-4793-bedc-f0960406425b').single();
  
  console.log('User:', p.email, 'Page ID:', p.selected_page_id);
  const fbToken = p.selected_page_token || p.facebook_token;
  
  if (fbToken) {
    const fbRes = await fetch(`https://graph.facebook.com/v19.0/${p.selected_page_id}?fields=name,instagram_business_account&access_token=${fbToken}`);
    const fbData = await fbRes.json();
    console.log('FB Page & IG Response:', JSON.stringify(fbData, null, 2));
  } else {
    console.log('No FB token found');
  }

  if (p.linkedin_token) {
    const liRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${p.linkedin_token}` }
    });
    console.log('LinkedIn Status:', liRes.status);
    const liData = await liRes.json();
    console.log('LinkedIn Response:', JSON.stringify(liData, null, 2));
  } else {
    console.log('No LinkedIn token found');
  }
}

diagnose().catch(console.error);
