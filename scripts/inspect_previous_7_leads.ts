import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: p } = await supabase.from('profiles').select('selected_page_id').eq('id', '426490e7-c7ec-43b7-979f-a891f947ab3c').single();
  const token = (await supabase.from('profiles').select('facebook_token').eq('id', '426490e7-c7ec-43b7-979f-a891f947ab3c').single()).data?.facebook_token;

  // Fetch page token
  const accRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`);
  const accJson = await accRes.json();
  const pageToken = accJson.data?.find((x: any) => x.id === p?.selected_page_id)?.access_token;

  const formId = '1144943251801844';
  const leadsRes = await fetch(`https://graph.facebook.com/v21.0/${formId}/leads?fields=id,created_time,field_data,ad_name,ad_id&access_token=${pageToken}`);
  const leadsData = await leadsRes.json();
  console.log('The 7 Previous Leads:');
  for (const l of leadsData.data || []) {
    console.log(`\nLead ID ${l.id} (${l.created_time}) - Ad: ${l.ad_name}`);
    for (const f of l.field_data) {
      console.log(`  ${f.name}: ${f.values?.join(', ')}`);
    }
  }
}

main().catch(console.error);
