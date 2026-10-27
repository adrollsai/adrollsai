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
    .select('facebook_token')
    .eq('id', '426490e7-c7ec-43b7-979f-a891f947ab3c')
    .single();

  const token = profile.facebook_token;

  async function searchTargeting(q: string, type: string) {
    const res = await fetch(`https://graph.facebook.com/v21.0/search?type=${type}&q=${encodeURIComponent(q)}&access_token=${token}`);
    const json = await res.json();
    return json.data || [];
  }

  const queries = ['business owner', 'general manager', 'partner', 'co-founder', 'executive director', 'sole proprietorship'];
  for (const q of queries) {
    const results = await searchTargeting(q, 'adworkposition');
    console.log(`\nWork Position: "${q}" -> ${results.length} found`);
    results.slice(0, 3).forEach((r: any) => console.log(`  - [${r.id}] ${r.name}`));
  }

  // Also check behaviors
  const bQueries = ['business', 'owner', 'travel'];
  for (const q of bQueries) {
    const results = await searchTargeting(q, 'adTargetingCategory&class=behaviors');
    console.log(`\nBehavior: "${q}" -> ${results.length} found`);
    results.slice(0, 5).forEach((r: any) => console.log(`  - [${r.id}] ${r.name}`));
  }
}

main().catch(console.error);
