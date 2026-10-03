const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: lead } = await supabase
    .from('leads')
    .select('id, name, status, pipeline_stage, custom_fields')
    .eq('id', '051aa826-3f11-4bdf-9e54-a0224b074ef9')
    .single();

  console.log('Lead record:');
  console.log('pipeline_stage column:', lead.pipeline_stage);
  console.log('status column:', lead.status);
  console.log('custom_fields:', lead.custom_fields);
}

run().catch(console.error);
