import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: p } = await supabase.from('profiles').select('facebook_token, selected_page_id').eq('id', '426490e7-c7ec-43b7-979f-a891f947ab3c').single();
  const token = p.facebook_token;
  const campaignId = '120252584916540286';

  // Fetch all ads in this campaign
  const adsRes = await fetch(`https://graph.facebook.com/v21.0/${campaignId}/ads?fields=id,name,status,adset_id,creative{id,name}&access_token=${token}`);
  const adsData = await adsRes.json();
  console.log('Ads in Campaign:');
  for (const ad of adsData.data || []) {
    console.log(`- Ad [${ad.id}] "${ad.name}" Status: ${ad.status}, AdSet: ${ad.adset_id}, Creative: ${ad.creative?.id}`);
    if (ad.creative?.id) {
      const cRes = await fetch(`https://graph.facebook.com/v21.0/${ad.creative.id}?fields=id,name,object_story_spec,asset_feed_spec&access_token=${token}`);
      const cData = await cRes.json();
      const formId = cData.object_story_spec?.link_data?.call_to_action?.value?.lead_gen_form_id;
      console.log(`  -> Creative Form ID: ${formId}`);
    }
  }
}

main().catch(console.error);
