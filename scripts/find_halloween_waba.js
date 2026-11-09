const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectAllWabas() {
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', 'bc63c065-9bcc-4793-bedc-f0960406425b').single();
  const token = profile.whatsapp_access_token || profile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;

  const wabaIds = [
    '1432599971552983',
    '959012113488417',
    '2980053509017170',
    '1661232922326686',
    '1015373167918902',
    '1550427980118583',
    '27044929898478696',
    '1777393797025557',
    '1729377688197938'
  ];

  for (const waba of wabaIds) {
    console.log(`\n=================== WABA: ${waba} ===================`);
    // Get phone numbers
    try {
      const pRes = await fetch(`https://graph.facebook.com/v21.0/${waba}/phone_numbers`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const pData = await pRes.json();
      console.log('Phone numbers:', pData.data?.map(p => ({ id: p.id, display: p.display_phone_number, name: p.verified_name })));
    } catch(e) { console.error('Phones err:', e.message); }

    // Get templates
    try {
      const tRes = await fetch(`https://graph.facebook.com/v21.0/${waba}/message_templates?limit=100`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const tData = await tRes.json();
      const halloween = tData.data?.filter(t => t.name.toLowerCase().includes('halloween'));
      if (halloween && halloween.length > 0) {
        console.log(`🎯 FOUND HALLOWEEN TEMPLATE IN WABA ${waba}!`, JSON.stringify(halloween, null, 2));
      } else {
        console.log(`No halloween template. (Found ${tData.data?.length || 0} templates: ${tData.data?.map(t => t.name).join(', ')})`);
      }
    } catch(e) { console.error('Templates err:', e.message); }
  }
}

inspectAllWabas().catch(console.error);

