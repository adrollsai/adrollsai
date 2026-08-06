const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixMediaType() {
  const imageUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785906182341-offer.jpg";

  const { data, error } = await supabaseAdmin
    .from('whatsapp_messages')
    .update({ media_type: 'image' })
    .eq('media_url', imageUrl);

  if (error) {
    console.error("Error updating media_type:", error);
  } else {
    console.log(`✅ Updated media_type to 'image' for broadcast messages in DB!`);
  }
}

fixMediaType();
