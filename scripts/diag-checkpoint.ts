// Inspect the stored checkpoint: does the replayed conversation carry the
// assistant `reasoning` parts that DeepSeek's thinking mode requires?
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

(async () => {
  const runId = process.env.RUN_ID;
  const { data: runs } = await admin
    .from('harness_runs')
    .select('id, status, attempts, checkpoint')
    .order('created_at', { ascending: false })
    .limit(3);

  for (const r of runs || []) {
    if (runId && r.id !== runId) continue;
    console.log(`\n=== run ${r.id.slice(0, 8)} status=${r.status} attempts=${r.attempts}`);
    const msgs = r.checkpoint?.messages || [];
    console.log(`checkpoint messages: ${msgs.length}`);
    msgs.forEach((m: any, i: number) => {
      const parts = Array.isArray(m.content)
        ? m.content.map((c: any) => c.type).join(',')
        : typeof m.content === 'string'
        ? 'string'
        : '?';
      const toolNames = Array.isArray(m.content)
        ? m.content.filter((c: any) => c.type === 'tool-call').map((c: any) => c.toolName).join('|')
        : '';
      console.log(`  [${i}] role=${m.role} parts=${parts}${toolNames ? ' tools=' + toolNames : ''}`);
    });

    const hasReasoning = msgs.some(
      (m: any) => Array.isArray(m.content) && m.content.some((c: any) => c.type === 'reasoning')
    );
    console.log(`  contains reasoning parts: ${hasReasoning}`);
  }
})();
