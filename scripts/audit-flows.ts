/**
 * Audits the REAL stored flows against the engine, using lib/flows/schema.
 *
 * This is the evidence for "the flow maker is not robust": it lists exactly
 * which saved, published flows contain steps that never execute.
 *
 *   npm run audit:flows
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { validateFlow, specFor } from '../lib/flows/schema';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

(async () => {
  const { data, error } = await sb
    .from('automations')
    .select('id, user_id, title, is_active, description')
    .like('title', 'Flow:%');
  if (error) { console.error('query failed:', error.message); process.exit(1); }

  const flows = data || [];
  console.log(`stored WhatsApp flows: ${flows.length}\n`);

  let brokenActive = 0;
  let brokenTotal = 0;
  const deadTypes: Record<string, number> = {};

  for (const f of flows) {
    let graph: any = {};
    try { graph = JSON.parse(f.description || '{}'); } catch { /* ignore */ }
    const v = validateFlow(graph);
    const errors = v.issues.filter((i) => i.severity === 'error');

    for (const t of v.unexecutable) deadTypes[t] = (deadTypes[t] || 0) + 1;

    if (!v.ok) {
      brokenTotal++;
      if (f.is_active) brokenActive++;
      const name = String(f.title).replace(/^Flow:\s*/, '').slice(0, 40);
      const flag = f.is_active ? 'ACTIVE  ' : 'disabled';
      console.log(`${flag} "${name}"  — ${errors.length} error(s)`);
      for (const e of errors.slice(0, 4)) console.log(`     • ${e.message.slice(0, 150)}`);
    }
  }

  console.log(`\n=== SUMMARY`);
  console.log(`flows with blocking errors : ${brokenTotal}/${flows.length}`);
  console.log(`   of which are LIVE        : ${brokenActive}`);
  console.log(`\nnode types that never execute, by usage:`);
  for (const [t, n] of Object.entries(deadTypes).sort((a, b) => b[1] - a[1])) {
    const spec = specFor(t);
    console.log(`   ${String(n).padStart(2)} x ${t.padEnd(28)} ${spec?.label || '(unknown type)'}`);
  }

  // The catalogue the UI offers vs what the engine runs, for the record.
  const executed = new Set<string>();
  const unsupported = new Set<string>();
  for (const type of Object.keys(deadTypes)) {
    const s = specFor(type);
    if (!s || s.support === 'unsupported') unsupported.add(type);
  }
  console.log(`\nengine supports: ${[...executed].length || 'see lib/flows/schema.ts'}`);
  console.log(`dead types in real flows: ${unsupported.size}`);
})();
