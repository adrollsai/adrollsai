import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const token = (await supabase.from('profiles').select('facebook_token').eq('id', '426490e7-c7ec-43b7-979f-a891f947ab3c').single()).data?.facebook_token;
  const res = await fetch(`https://graph.facebook.com/v21.0/act_2355441981399964?fields=name,currency,timezone_name,balance,amount_spent,spend_cap&access_token=${token}`);
  console.log('Ad Account Details:', await res.json());

  const campRes = await fetch(`https://graph.facebook.com/v21.0/120252584916540286?fields=name,daily_budget,budget_remaining,status&access_token=${token}`);
  console.log('Campaign Details:', await campRes.json());

  const uaeAdset = await fetch(`https://graph.facebook.com/v21.0/120252584927560286?fields=name,daily_budget,status&access_token=${token}`);
  console.log('UAE Adset Details:', await uaeAdset.json());
}

main().catch(console.error);
