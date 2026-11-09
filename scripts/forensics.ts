// Forensics: why did the agent stop? Reads the durable log, not the dev server.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const truncate = (v: unknown, n = 160) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + '…' : s;
};

(async () => {
  const { data: sessions } = await admin
    .from('harness_sessions')
    .select('id, title, status, workspace_id, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(5);

  console.log('=== 5 most recent sessions ===');
  for (const s of sessions || []) {
    console.log(`${s.id}  status=${s.status}  updated=${s.updated_at}`);
    console.log(`   title: ${truncate(s.title, 90)}`);
  }
  if (!sessions?.length) return;

  const target = sessions[0];
  console.log(`\n=== runs for ${target.id} ===`);
  const { data: runs } = await admin
    .from('harness_runs')
    .select('id, status, attempts, max_attempts, continuations, error, created_at, started_at, finished_at, deadline_at, next_attempt_at')
    .eq('session_id', target.id)
    .order('created_at', { ascending: false });
  if (!runs?.length) console.log('   (no durable runs — this was an interactive turn)');
  for (const r of runs || []) {
    console.log(`   ${r.id.slice(0, 8)} status=${r.status} attempts=${r.attempts}/${r.max_attempts} slices=${r.continuations}`);
    if (r.error) console.log(`      error: ${truncate(r.error, 300)}`);
    console.log(`      created=${r.created_at} started=${r.started_at} finished=${r.finished_at}`);
  }

  console.log(`\n=== events for ${target.id} ===`);
  const { data: events } = await admin
    .from('harness_events')
    .select('seq, type, data, created_at')
    .eq('session_id', target.id)
    .order('seq', { ascending: true });

  console.log(`   total events: ${(events || []).length}`);
  for (const e of events || []) {
    const d = e.data || {};
    let detail = '';
    if (e.type === 'user.message') detail = truncate(d.text, 100);
    else if (e.type === 'assistant.text') detail = truncate(d.text, 100);
    else if (e.type === 'assistant.reasoning') detail = `[reasoning] ${truncate(d.text, 80)}`;
    else if (e.type === 'tool.call') detail = `${d.name} ${truncate(d.input, 90)}`;
    else if (e.type === 'tool.result') detail = `→ ${truncate(d.output, 110)}`;
    else if (e.type === 'turn.error') detail = `ERROR: ${truncate(d.message, 300)}`;
    else if (e.type === 'run.status') detail = `${d.status}${d.detail ? ' — ' + truncate(d.detail, 200) : ''}`;
    else detail = truncate(d, 100);
    console.log(`   #${String(e.seq).padStart(3)} ${e.type.padEnd(22)} ${detail}`);
  }
})();
