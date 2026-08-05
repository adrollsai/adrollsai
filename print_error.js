const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function printErr() {
  const { data: asset } = await supabaseAdmin
    .from('assets')
    .select('metadata')
    .eq('user_id', '42d2e0c5-4fe6-4738-8a9f-63f09be01f12')
    .eq('status', 'Failed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  console.log("EXACT ERROR:", asset.metadata?.error);
}

printErr();
