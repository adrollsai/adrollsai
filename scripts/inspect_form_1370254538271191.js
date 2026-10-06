const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectForm() {
  const bioqueId = '68b55a31-a16d-454d-a20f-11adabf590b0';
  const { data: profile } = await supabase
    .from('profiles')
    .select('selected_page_token, facebook_token')
    .eq('id', bioqueId)
    .single();

  const token = profile.selected_page_token || profile.facebook_token;
  const formId = '1370254538271191';

  const res = await fetch(`https://graph.facebook.com/v21.0/${formId}?fields=id,name,status,questions,context_card,question_page_custom_headline&access_token=${token}`);
  const data = await res.json();
  console.log('Form 1370254538271191:', JSON.stringify(data, null, 2));
}

inspectForm().catch(console.error);
