const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Supabase configuration missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const { data: profiles, error } = await supabase.from('profiles').select('id, business_name');
  if (error) {
    console.error('Error fetching profiles:', error);
    process.exit(1);
  }

  if (!profiles || profiles.length === 0) {
    console.log('No profiles found in the database');
    return;
  }

  console.log(`Found ${profiles.length} profiles:`);
  for (const p of profiles) {
    console.log(`- ${p.business_name || 'Unnamed'} (ID: ${p.id})`);
  }

  const phoneId = "1140952692437292";
  const wabaId = "1777393797025557";
  const token = process.env.DEV_WHATSAPP_ACCESS_TOKEN;
  const phoneNumber = "+1 555 663 3659";

  for (const p of profiles) {
    console.log(`Updating profile ${p.id}...`);
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        whatsapp_access_token: token,
        whatsapp_phone_number_id: phoneId,
        whatsapp_waba_id: wabaId,
        whatsapp_phone_number: phoneNumber,
        whatsapp_connected_at: new Date().toISOString()
      })
      .eq('id', p.id);

    if (updateErr) {
      console.error(`Error updating profile ${p.id}:`, updateErr);
      continue;
    }

    console.log(`Seeding flows for profile ${p.id}...`);
    const defaultFlows = [
      {
        user_id: p.id,
        title: 'Instant Lead Welcome',
        description: 'Send a welcome template 2 mins after lead capture from ads/pages.',
        icon_name: 'MessageCircle',
        is_active: false,
        template_name: 'real_estate_welcome_1',
        template_body: 'Hi {{1}}, thanks for showing interest in {{2}}! I am Harman from {{3}}. Would you like to receive the digital brochure or schedule a quick site visit?',
        delay_minutes: 2
      },
      {
        user_id: p.id,
        title: 'Site Visit Coordinator',
        description: 'Reminds leads 24 hours before a scheduled site visit appointment.',
        icon_name: 'CalendarClock',
        is_active: false,
        template_name: 'real_estate_reminder_1',
        template_body: 'Hello {{1}}, this is a quick reminder for our scheduled site visit to {{2}} tomorrow at {{3}}. Let me know if you need location details!',
        delay_minutes: 1440
      },
      {
        user_id: p.id,
        title: 'New Launch Alert',
        description: 'Alert leads immediately about new project phases or pricing updates.',
        icon_name: 'BellRing',
        is_active: false,
        template_name: 'real_estate_alert_1',
        template_body: 'Hi {{1}}, we just launched a new inventory phase at {{2}} with starting prices at {{3}}. Would you like to get the floor plans?',
        delay_minutes: 0
      }
    ];

    const { count } = await supabase
      .from('whatsapp_flows')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', p.id);

    if (count === 0 || count === null) {
      const { error: seedErr } = await supabase.from('whatsapp_flows').insert(defaultFlows);
      if (seedErr) {
        console.error(`Error seeding flows for profile ${p.id}:`, seedErr);
      } else {
        console.log(`Seeded default flows successfully for profile ${p.id}.`);
      }
    } else {
      console.log(`Profile ${p.id} already has seeded flows.`);
    }
  }

  console.log('Update complete.');
}

run();
