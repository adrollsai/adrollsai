const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function updateDeccanWhatsApp() {
  const deccanId = '93c65dee-87a5-48e3-a2d2-406182a33b37';
  
  // 1. Fetch the landing page
  const { data: lp, error: fetchErr } = await supabaseAdmin
    .from('landing_pages')
    .select('*')
    .eq('user_id', deccanId)
    .single();

  if (fetchErr || !lp) {
    console.error('Error fetching landing page:', fetchErr);
    return;
  }

  console.log('Original landing page ID:', lp.id);
  console.log('Original contains 9876543210:', lp.html_content.includes('9876543210'));

  // Replace 919876543210 / 9876543210 in WhatsApp link and placeholder
  let updatedHtml = lp.html_content;
  
  // Specifically update wa.me/919876543210 or wa.me/9876543210
  updatedHtml = updatedHtml.replaceAll('wa.me/919876543210', 'wa.me/918600080096');
  updatedHtml = updatedHtml.replaceAll('wa.me/9876543210', 'wa.me/918600080096');
  
  // Also check if phone placeholder is updated or kept as example
  // placeholder="+91 98765 43210" is standard form placeholder, but let's check

  console.log('Updated contains wa.me/918600080096:', updatedHtml.includes('wa.me/918600080096'));
  console.log('Remaining 9876543210 in updatedHtml:');
  updatedHtml.split('\n').forEach((line, idx) => {
    if (line.includes('9876543210') || line.includes('8600080096')) {
      console.log(`[Line ${idx + 1}]: ${line.trim()}`);
    }
  });

  // 2. Update the landing page in database
  const { data: updateRes, error: updateErr } = await supabaseAdmin
    .from('landing_pages')
    .update({
      html_content: updatedHtml,
      updated_at: new Date().toISOString()
    })
    .eq('id', lp.id)
    .select();

  if (updateErr) {
    console.error('Update error:', updateErr);
    return;
  }
  console.log('Successfully updated landing page row in database!');

  // 3. Check profile and ensure contact_number / whatsapp fields are consistent
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, business_name, contact_number, whatsapp_phone_number, custom_domain')
    .eq('id', deccanId)
    .single();

  console.log('Current Deccan Profile:', profile);

  if (!profile.contact_number) {
    const { error: profErr } = await supabaseAdmin
      .from('profiles')
      .update({
        contact_number: '+91 86000 80096'
      })
      .eq('id', deccanId);
    if (profErr) {
      console.error('Profile update error:', profErr);
    } else {
      console.log('Updated profile contact_number to +91 86000 80096');
    }
  }
}

updateDeccanWhatsApp().catch(console.error);
