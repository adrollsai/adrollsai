const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkVoiceCampaigns() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222'; // Khushi Ram
  const { data: camps } = await supabaseAdmin
    .from('voice_campaigns')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  console.log("Voice Campaigns for Khushi Ram:\n", camps?.map(c => ({
    id: c.id,
    name: c.name,
    status: c.status,
    filter: c.audience_filter,
    created_at: c.created_at
  })));
}

checkVoiceCampaigns();
