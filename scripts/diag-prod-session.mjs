import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

for (const t of ['harness_events', 'harness_tool_calls', 'harness_runs', 'harness_sessions']) {
  const { data, error } = await sb.from(t).select('*').limit(1);
  console.log(`${t}: ${error ? 'ERR ' + error.message : Object.keys(data?.[0] || {}).join(', ') || '(empty)'}`);
}

const SID = '13fe9b85-7a37-4c61-aeec-14c8392256a1';
const ev = await sb.from('harness_events').select('*').eq('session_id', SID).order('seq', { ascending: true });
if (ev.error) {
  console.log('\nevents error:', ev.error.message);
} else {
  console.log(`\n===== events for ${SID}: ${ev.data.length}`);
  for (const e of ev.data) {
    const rest = { ...e };
    delete rest.id;
    delete rest.session_id;
    delete rest.seq;
    delete rest.type;
    console.log(`#${e.seq} ${e.type}  ${JSON.stringify(rest).slice(0, 260)}`);
  }
}
