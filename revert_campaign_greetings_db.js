const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function revertGreetings() {
  const { data: campaigns } = await supabaseAdmin.from('voice_campaigns').select('*');

  console.log(`Reverting greetings for ${campaigns.length} campaigns...`);

  for (const camp of campaigns) {
    const filter = camp.audience_filter || {};
    filter.greeting = 'Hi {name} ji, kaise ho aap?';
    
    // Also revert greeting step in custom_prompt if present
    let prompt = camp.custom_prompt || '';
    if (prompt.includes('Namaste')) {
      prompt = prompt.replace(/Namaste \{name\} ji!/g, 'Hi {name} ji, kaise ho aap?');
    }

    await supabaseAdmin
      .from('voice_campaigns')
      .update({
        audience_filter: filter,
        custom_prompt: prompt
      })
      .eq('id', camp.id);

    console.log(`Reverted campaign "${camp.name}" (${camp.id}) greeting to: Hi {name} ji, kaise ho aap?`);
  }
}

revertGreetings();
