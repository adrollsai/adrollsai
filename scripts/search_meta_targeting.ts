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

  async function searchTargeting(q: string, type: string = 'adinterest') {
    const res = await fetch(`https://graph.facebook.com/v21.0/search?type=${type}&q=${encodeURIComponent(q)}&access_token=${token}`);
    const json = await res.json();
    return json.data || [];
  }

  const queries = [
    'company formation',
    'business setup',
    'trade license',
    'free zone',
    'entrepreneurship',
    'small business',
    'startup',
    'investor',
    'venture capital',
    'angel investor',
    'commercial law'
  ];

  console.log('=== TARGETING INTEREST SEARCH ===');
  for (const q of queries) {
    const results = await searchTargeting(q, 'adinterest');
    console.log(`\nQuery: "${q}" -> ${results.length} found`);
    results.slice(0, 3).forEach((r: any) => console.log(`  - [${r.id}] ${r.name} (Audience: ${r.audience_size_lower_bound} - ${r.audience_size_upper_bound})`));
  }

  console.log('\n=== WORK POSITIONS SEARCH ===');
  const jobQueries = ['Founder', 'Managing Director', 'CEO', 'Director', 'Owner', 'Partner'];
  for (const j of jobQueries) {
    const results = await searchTargeting(j, 'adworkposition');
    console.log(`\nJob Query: "${j}" -> ${results.length} found`);
    results.slice(0, 3).forEach((r: any) => console.log(`  - [${r.id}] ${r.name}`));
  }
}

main().catch(console.error);
