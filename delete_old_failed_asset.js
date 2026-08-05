const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function removeFailed() {
  const failedId = '994d8cb8-a89e-4e78-beee-0a672900c4ec';

  const { error } = await supabaseAdmin
    .from('assets')
    .delete()
    .eq('id', failedId);

  if (error) {
    console.error("Delete error:", error);
  } else {
    console.log(`Successfully deleted old failed asset record ${failedId} from Supabase DB.`);
  }
}

removeFailed();
