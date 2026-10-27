import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: p } = await supabase.from('profiles').select('facebook_token').eq('id', '426490e7-c7ec-43b7-979f-a891f947ab3c').single();
  const token = p.facebook_token;

  const ads = ['120252584939940286', '120252584941120286', '120252584942450286'];
  for (const adId of ads) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${adId}?fields=id,name,creative{id,name,object_story_spec,asset_feed_spec}&access_token=${token}`);
    const data = await res.json();
    console.log(`Ad ${adId}:`);
    console.log(JSON.stringify(data.creative?.object_story_spec, null, 2));
  }
}

main().catch(console.error);
