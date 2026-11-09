// Remove data created by the verification suites (workspaces starting with
// "__verify" or the worker smoke marker). Safe to run any time.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const get = (n) => {
  const m = env.match(new RegExp('^' + n + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};

const admin = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

const { data: sessions } = await admin
  .from('harness_sessions')
  .select('id, workspace_id')
  .or('workspace_id.like.__verify%,workspace_id.eq.__worker_smoke__');

let removed = 0;
for (const s of sessions || []) {
  await admin.from('harness_tool_calls').delete().eq('session_id', s.id);
  await admin.from('harness_runs').delete().eq('session_id', s.id);
  await admin.from('harness_events').delete().eq('session_id', s.id);
  await admin.from('harness_sessions').delete().eq('id', s.id);
  removed++;
}

const runs = await admin.from('harness_runs').select('id', { count: 'exact', head: true });
console.log(`removed ${removed} test session(s); harness_runs remaining: ${runs.count ?? 0}`);
