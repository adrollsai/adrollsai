const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const GNR_USER_ID = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';

async function checkStatus() {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, name, phone, voice_call_status, voice_call_summary, booked_time, pipeline_stage, notes')
    .eq('user_id', GNR_USER_ID)
    .ilike('source', '%housing%');

  if (error) {
    console.error(error);
    return;
  }

  console.log('Total Housing leads:', leads.length);
  const completed = leads.filter(l => l.voice_call_status === 'completed');
  const calling = leads.filter(l => l.voice_call_status === 'calling');
  const noAnswer = leads.filter(l => ['no_answer', 'busy', 'failed'].includes(l.voice_call_status));
  const uncalled = leads.filter(l => ['not_called', null, 'queued'].includes(l.voice_call_status));

  console.log('Connected calls:', completed.length);
  console.log('Calling right now:', calling.length);
  console.log('No answer / Busy:', noAnswer.length);
  console.log('Uncalled / Fresh:', uncalled.length);

  const callbacks = leads.filter(l => {
    const s = (l.voice_call_summary || '').toLowerCase();
    return s.includes('callback') || s.includes('call back') || s.includes('scheduled') || s.includes('tomorrow') || s.includes('follow-up') || s.includes('parso');
  });

  console.log('\nLeads with agreed callbacks / consultation timings (' + callbacks.length + '):');
  callbacks.forEach(c => {
    console.log('\n• Name:', c.name, '(' + c.phone + ')');
    console.log('  Summary:', c.voice_call_summary);
    console.log('  Stage:', c.pipeline_stage);
  });
}

checkStatus();
