import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', '426490e7-c7ec-43b7-979f-a891f947ab3c')
    .single();

  const token = profile.facebook_token;
  const pageToken = profile.selected_page_token || token;
  const pageId = profile.selected_page_id;

  console.log('Page ID:', pageId);

  // Inspect the Lead Gen Form: 1144943251801844
  const formRes = await fetch(`https://graph.facebook.com/v21.0/1144943251801844?fields=id,name,status,questions,context_card,thank_you_page,follow_up_action_url&access_token=${token}`);
  const formData = await formRes.json();
  console.log('Current Form:', JSON.stringify(formData, null, 2));

  // Inspect UAE Adset: 120252584927560286
  const adsetRes = await fetch(`https://graph.facebook.com/v21.0/120252584927560286?fields=id,name,status,campaign_id,targeting,optimization_goal,promoted_object,daily_budget&access_token=${token}`);
  const adsetData = await adsetRes.json();
  console.log('UAE Adset:', JSON.stringify(adsetData, null, 2));

  // Inspect India Adset: 120252584938330286
  const inAdsetRes = await fetch(`https://graph.facebook.com/v21.0/120252584938330286?fields=id,name,status&access_token=${token}`);
  console.log('India Adset:', await inAdsetRes.json());

  // Also check the campaign status
  const campRes = await fetch(`https://graph.facebook.com/v21.0/120252584916540286?fields=id,name,status,effective_status,daily_budget&access_token=${token}`);
  console.log('Campaign:', await campRes.json());
}

main().catch(console.error);
