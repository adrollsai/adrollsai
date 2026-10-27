import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: p } = await supabase.from('profiles').select('facebook_token').eq('id', '426490e7-c7ec-43b7-979f-a891f947ab3c').single();
  const token = p.facebook_token;
  const campaignId = '120252584916540286';
  const uaeAdsetId = '120252584927560286';

  // Fetch detailed metrics for yesterday and today
  const res = await fetch(`https://graph.facebook.com/v21.0/${uaeAdsetId}/insights?time_range={"since":"2026-10-21","until":"2026-10-22"}&fields=impressions,clicks,cpc,cpm,ctr,spend,actions,action_values,cost_per_action_type&access_token=${token}`);
  const data = await res.json();
  console.log('Insights for UAE Adset (Oct 21-22):', JSON.stringify(data, null, 2));

  // Also fetch for each ad
  const adsRes = await fetch(`https://graph.facebook.com/v21.0/${uaeAdsetId}/ads?fields=id,name,status,insights.time_range({"since":"2026-10-21","until":"2026-10-22"}){impressions,clicks,cpc,ctr,spend,actions}&access_token=${token}`);
  const adsData = await adsRes.json();
  console.log('Ads breakdown:', JSON.stringify(adsData, null, 2));

  // Compare with the previous period (when 7 leads came in)
  const prevRes = await fetch(`https://graph.facebook.com/v21.0/${campaignId}/insights?time_range={"since":"2026-10-19","until":"2026-10-20"}&fields=impressions,clicks,cpc,cpm,ctr,spend,actions&access_token=${token}`);
  console.log('Previous Period Insights (Oct 19-20):', JSON.stringify(await prevRes.json(), null, 2));
}

main().catch(console.error);
