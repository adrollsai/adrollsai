const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAndRecover() {
  const userId = '68b55a31-a16d-454d-a20f-11adabf590b0';
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('facebook_token')
    .eq('id', userId)
    .single();

  const token = profile.facebook_token;

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, email, facebook_lead_id')
    .eq('user_id', userId)
    .or('phone.eq.true,phone.eq.false');

  console.log(`Found ${leads.length} leads with phone='true'/'false'. Recovering from Meta API...`);

  let recoveredCount = 0;

  for (const l of leads) {
    if (l.facebook_lead_id) {
      try {
        const res = await fetch(`https://graph.facebook.com/v20.0/${l.facebook_lead_id}?fields=field_data&access_token=${token}`);
        const data = await res.json();
        const phoneField = data.field_data?.find(f => 
          f.name === 'phone_number' || 
          f.name === 'phone' || 
          f.name === 'mobile_number' ||
          (f.name.includes('phone') && !f.name.includes('verified'))
        );
        const realPhone = phoneField?.values?.[0];
        if (realPhone) {
          console.log(`✅ Recovered ${l.name} (${l.email}): "${realPhone}"`);
          // Update in DB
          await supabaseAdmin.from('leads').update({ phone: realPhone }).eq('id', l.id);
          recoveredCount++;
        } else {
          console.log(`⚠️ No phone found in Meta data for ${l.name}:`, JSON.stringify(data.field_data));
        }
      } catch (err) {
        console.error(`❌ Error fetching Meta lead ${l.id}:`, err.message);
      }
    }
  }

  console.log(`\n🎉 Successfully recovered ${recoveredCount} / ${leads.length} real phone numbers!`);
}

checkAndRecover();
