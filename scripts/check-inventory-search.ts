/**
 * Does `nobogent_inventory_search` actually find the catalogue?
 *
 * The agent told two separate live runs "the catalogue has no course records (0 listings)" while a
 * real product row existed. This asks the same query the tool asks, and the same query with only
 * columns that exist, so the difference is visible instead of inferred.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';

console.log('=== what the TOOL asks for (nobogent_inventory_search)');
const asTool = await sb
  .from('properties')
  .select('id, title, description, price, location, images, created_at, category')
  .eq('user_id', ORG)
  .limit(20);
console.log('error :', asTool.error?.message ?? 'none');
console.log('count :', asTool.data?.length ?? 0);

console.log('\n=== what the tool FALLS BACK to (same columns, no query)');
const asFallback = await sb
  .from('properties')
  .select('id, title, description, price, location, images, created_at, category')
  .eq('user_id', ORG)
  .limit(20);
console.log('error :', asFallback.error?.message ?? 'none');
console.log('count :', asFallback.data?.length ?? 0);

console.log('\n=== the same rows with columns that exist');
const real = await sb
  .from('properties')
  .select('id, title, description, property_type, status, image_url, images, user_id')
  .eq('user_id', ORG)
  .limit(20);
console.log('error :', real.error?.message ?? 'none');
console.log('count :', real.data?.length ?? 0);
for (const row of real.data ?? []) {
  console.log(`  ${(row as any).id}  ${(row as any).title}  [${(row as any).status}]`);
}

console.log('\n=== columns actually on the table');
const one = await sb.from('properties').select('*').eq('user_id', ORG).limit(1);
if (one.data?.[0]) console.log(Object.keys(one.data[0]).join(', '));
