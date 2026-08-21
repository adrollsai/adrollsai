const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const blueSquareId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

async function listProps() {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', blueSquareId)
    .single();

  console.log('=== BLUE SQUARE PROFILE ===');
  console.log('Business Name:', profile.business_name);
  console.log('Email:', profile.email);
  console.log('Contact Number:', profile.contact_number);
  console.log('Address:', profile.address);
  console.log('Logo URL:', profile.logo_url);
  console.log('Landing Enabled:', profile.business_landing_enabled);
  console.log('Business Info:', profile.business_info);

  const { data: properties } = await supabase
    .from('properties')
    .select('*')
    .eq('user_id', blueSquareId);

  console.log('\n=== PROPERTIES (' + properties.length + ') ===');
  properties.forEach((p, idx) => {
    console.log(`\n[${idx + 1}] ID: ${p.id}`);
    console.log(`Title: ${p.title}`);
    console.log(`Type: ${p.property_type}`);
    console.log(`Price: ${p.price}`);
    console.log(`Address: ${p.address}`);
    console.log(`Description: ${p.description ? p.description.slice(0, 100) + '...' : 'None'}`);
    console.log(`Image URL: ${p.image_url}`);
    console.log(`Images: ${p.images ? p.images.length : 0}`);
    console.log(`Configurations: ${JSON.stringify(p.configurations)}`);
  });
}

listProps().catch(console.error);
