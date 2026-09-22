const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function searchAll() {
  const bioqueId = '68b55a31-a16d-454d-a20f-11adabf590b0';

  // Check profiles.qualifying_questions
  const { data: p } = await supabaseAdmin.from('profiles').select('*').eq('id', bioqueId).single();
  console.log('Profile qualifying_questions:', p.qualifying_questions);
  console.log('Profile qualifying_enabled:', p.qualifying_enabled);

  // Check whatsapp_question_flows for all users
  const { data: qf } = await supabaseAdmin.from('whatsapp_question_flows').select('*');
  console.log('All whatsapp_question_flows:\n', JSON.stringify(qf, null, 2));

  // Check automations for Bioque
  const { data: auto } = await supabaseAdmin.from('automations').select('*').eq('user_id', bioqueId);
  console.log('Bioque automations:', auto.map(a => ({ id: a.id, title: a.title, is_active: a.is_active, desc: a.description?.substring(0, 100) })));

  // Check all automations that might mention dubai or question
  const { data: allAuto } = await supabaseAdmin.from('automations').select('id, user_id, title, is_active').ilike('title', '%dubai%');
  console.log('All dubai automations:', allAuto);

  // Check campaigns table
  const { data: camps } = await supabaseAdmin.from('campaigns').select('*');
  console.log('All campaigns table rows:', camps);
}
searchAll();
