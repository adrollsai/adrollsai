import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: events, error } = await sb
  .from('harness_events')
  .select('session_id, seq, type, data, created_at')
  .in('type', ['tool.result'])
  .order('created_at', { ascending: false })
  .limit(400);

if (error) {
  console.error('query failed:', error.message);
  process.exit(1);
}

const failed = (events || []).filter((e) => e?.data?.isError === true || e?.data?.output?.success === false);
console.log(`scanned ${events?.length || 0} tool results, ${failed.length} indicated failure\n`);

for (const e of failed.slice(0, 6)) {
  const out = e.data?.output || {};
  console.log('─'.repeat(70));
  console.log(`session ${String(e.session_id).slice(0, 8)}  seq ${e.seq}  ${e.created_at}`);
  console.log(`tool: ${e.data?.name}`);
  const input = JSON.stringify(e.data?.input || {}).slice(0, 300);
  console.log(`input: ${input}`);
  console.log('output:');
  console.log(JSON.stringify(out, null, 1).slice(0, 1800));
}
