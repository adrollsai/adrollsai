import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, email, business_name, role, team_owner_id')
    .or('email.ilike.%homcom%,id.eq.9bbf6e51-283e-48d1-bbb4-8dc546cc74b2');
  console.log('Matching profiles:', profs);

  const { data: allIntegrations } = await supabase
    .from('whatsapp_integrations')
    .select('*');
  console.log('All whatsapp integrations count:', allIntegrations?.length);
  for (const item of (allIntegrations || [])) {
    console.log(`Integration user_id: ${item.user_id}, phone_number_id: ${item.phone_number_id}, waba_id: ${item.waba_id}`);
  }

  const { data: automations } = await supabase
    .from('automations')
    .select('id, title, user_id, is_active')
    .or('user_id.eq.9bbf6e51-283e-48d1-bbb4-8dc546cc74b2');
  console.log('Automations for HOMCOM:', automations);
}
check();
