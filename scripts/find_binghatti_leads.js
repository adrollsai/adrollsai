const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function findBinghattiLeads() {
  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .ilike('ad_name', '%Binghatti%');

    console.log('Error:', error);
    console.log('Binghatti leads by ad_name count:', leads?.length);
    leads?.forEach((l, i) => {
      console.log(`\n--- Binghatti Lead ${i + 1} ---`);
      console.log('User ID:', l.user_id);
      console.log('Name:', l.name);
      console.log('Phone:', l.phone);
      console.log('Email:', l.email);
      console.log('Created At:', l.created_at);
      console.log('Ad Name:', l.ad_name);
      console.log('Custom Fields:', JSON.stringify(l.custom_fields, null, 2));
    });

    const { data: leads2, error: err2 } = await supabase
      .from('leads')
      .select('*')
      .ilike('notes', '%Binghatti%');
    console.log('Binghatti in notes count:', leads2?.length);
    leads2?.forEach((l, i) => {
      console.log(`\n--- Binghatti Note Lead ${i + 1} ---`);
      console.log('Name:', l.name, 'Phone:', l.phone, 'Notes:', l.notes);
    });
  } catch (err) {
    console.error('Catch error:', err);
  }
}

findBinghattiLeads().catch(console.error);
