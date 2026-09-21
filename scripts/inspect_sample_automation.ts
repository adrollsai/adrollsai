import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const { data: prof, error: pErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2')
    .single();
  console.log('Profile:', prof ? { id: prof.id, email: prof.email, business_name: prof.business_name, business_info: prof.business_info } : pErr);

  const { data: auto } = await supabase
    .from('automations')
    .select('*')
    .eq('id', 'f98a2152-15d5-460a-8c48-838f4aa4014c')
    .single();
  console.log('Sample automation:', {
    title: auto?.title,
    user_id: auto?.user_id,
    icon_name: auto?.icon_name,
    is_active: auto?.is_active,
    description_sample: auto?.description?.substring(0, 300)
  });

  // Let's also check bioque automation to see the exact structure we built
  const { data: bioqueAuto } = await supabase
    .from('automations')
    .select('*')
    .ilike('title', '%Bioque%')
    .limit(1);
  console.log('Bioque automation structure:', bioqueAuto);
}
check();
