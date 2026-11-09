// Reset the stuck run so the worker retries it from scratch with the fix.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

(async () => {
  const { data: runs } = await admin
    .from('harness_runs')
    .select('id, status, attempts, session_id')
    .in('status', ['queued', 'running', 'dead', 'failed'])
    .order('created_at', { ascending: true })
    .limit(3);

  for (const r of runs || []) {
    // Clear the checkpoint on purpose: it was built by the old display-oriented
    // path, so it has no reasoning and no tool calls. Without clearing it the
    // resume would keep using the broken history and never exercise the fix.
    const { error } = await admin
      .from('harness_runs')
      .update({ status: 'queued', attempts: 0, next_attempt_at: null, error: null, checkpoint: null })
      .eq('id', r.id);
    console.log(`reset run ${r.id.slice(0, 8)} (was ${r.status}, attempts=${r.attempts}) + cleared checkpoint → ${error ? 'ERROR ' + error.message : 'queued'}`);
  }
  if (!runs?.length) console.log('no runs to reset');
})();
