/**
 * Give stored flows the trigger NODE they are missing.
 *
 * Six of the eight automations on the main account record `trigger.type` — so the scheduler knows
 * when to fire them — but carry no `triggerNode` in their node list. That is enough to run and not
 * enough to EDIT: `validateFlow` (the publish gate, and the Flow Studio's live validation) refuses a
 * graph with no trigger node, so opening one of these flows and saving it would fail on a problem the
 * owner never created and cannot see.
 *
 * The repair is a materialisation, not a guess: the trigger type is already on the row, so the node
 * is added with exactly that type. Nothing here decides WHEN a flow runs, and nothing here activates
 * anything — a paused flow stays paused.
 *
 *   npm run repair:flow-triggers            # report only
 *   npm run repair:flow-triggers -- --apply # write the missing nodes
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function envFromLocal(): Record<string, string> {
  const raw = fs.readFileSync(path.resolve('.env.local'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...envFromLocal(), ...process.env } as Record<string, string>;
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const APPLY = process.argv.includes('--apply');

/**
 * Which account to repair. Defaults to the owner account this work is verified against; pass
 * `--user=<uuid>` for another, or `--all-users` to sweep every tenant. Writing to another tenant's
 * rows is a data change somebody should ask for, so it is not the default.
 */
const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const userFlag = process.argv.find((arg) => arg.startsWith('--user='));
const ALL_USERS = process.argv.includes('--all-users');
const SCOPE = userFlag ? userFlag.split('=')[1] : ALL_USERS ? null : OWNER;

/** The events the system actually fires on. A recorded trigger outside this list is not a trigger. */
const KNOWN_TRIGGERS = new Set([
  'trigger_meta_ad',
  'trigger_whatsapp_ctwa',
  'trigger_whatsapp_inbound',
  'trigger_crm_lead',
  'trigger_ig_comment',
  'trigger_fb_comment',
  'trigger_ig_dm',
  'trigger_fb_messenger',
  'trigger_whatsapp_template_button',
]);

interface Verdict {
  id: string;
  title: string;
  active: boolean;
  action: 'add trigger node' | 'already has one' | 'no json (not a flow)' | 'no recorded trigger' | 'invalid trigger';
  detail?: string;
}

async function main() {
  let query = supabase
    .from('automations')
    .select('id, title, description, is_active, user_id')
    .order('created_at', { ascending: true })
    .limit(2000);
  if (SCOPE) query = query.eq('user_id', SCOPE);
  const { data, error } = await query;
  if (error) throw new Error(`could not read automations: ${error.message}`);

  const verdicts: Verdict[] = [];
  const repairs: { id: string; title: string; description: string }[] = [];

  for (const row of data ?? []) {
    const raw = String((row as any).description ?? '');
    const brace = raw.indexOf('{');
    const title = String((row as any).title ?? (row as any).id);

    if (brace < 0) {
      verdicts.push({ id: String((row as any).id), title, active: (row as any).is_active === true, action: 'no json (not a flow)' });
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw.slice(brace));
    } catch {
      verdicts.push({ id: String((row as any).id), title, active: (row as any).is_active === true, action: 'no json (not a flow)', detail: 'description is not readable JSON' });
      continue;
    }

    const nodes: any[] = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    if (nodes.some((n) => String(n?.type) === 'triggerNode')) {
      verdicts.push({ id: String((row as any).id), title, active: (row as any).is_active === true, action: 'already has one' });
      continue;
    }

    const triggerType = parsed?.trigger?.type ? String(parsed.trigger.type) : null;
    if (!triggerType) {
      // Deliberately NOT guessed: choosing an event for somebody's flow is a business decision,
      // and a wrong one messages the wrong person at the wrong time.
      verdicts.push({
        id: String((row as any).id),
        title,
        active: (row as any).is_active === true,
        action: 'no recorded trigger',
        detail: 'the owner has to say which event starts this flow (agent tool repair_flow_trigger)',
      });
      continue;
    }

    if (!KNOWN_TRIGGERS.has(triggerType)) {
      // Some flows recorded `trigger: { type: "triggerNode" }` — a canvas node name where an event
      // name belongs. Materialising that as a trigger node would turn a visible problem into an
      // invisible one, so it is reported as what it is: no usable trigger.
      verdicts.push({
        id: String((row as any).id),
        title,
        active: (row as any).is_active === true,
        action: 'invalid trigger',
        detail: `"${triggerType}" is not an event — the owner has to pick a real one (repair_flow_trigger)`,
      });
      continue;
    }

    parsed.nodes = [
      { id: 'trigger', type: 'triggerNode', data: { triggerType }, position: { x: 0, y: 0 } },
      ...nodes,
    ];
    verdicts.push({ id: String((row as any).id), title, active: (row as any).is_active === true, action: 'add trigger node', detail: triggerType });
    repairs.push({ id: String((row as any).id), title, description: JSON.stringify(parsed) });
  }

  for (const v of verdicts) {
    console.log(`${v.id.slice(0, 8)}  ${v.action.padEnd(20)} ${v.active ? 'ACTIVE ' : 'paused '} ${v.title}${v.detail ? `  [${v.detail}]` : ''}`);
  }

  const toFix = verdicts.filter((v) => v.action === 'add trigger node');
  console.log(`\n${verdicts.length} automation row(s); ${toFix.length} need a trigger node.`);

  // The publish gate is the thing the missing node actually broke, so report it directly: a flow
  // that validates can be opened, edited and saved; one that does not would fail on a problem its
  // owner never created.
  if (process.argv.includes('--validate')) {
    const { validateFlow } = await import('../lib/flows/schema');
    console.log('\nvalidateFlow (the publish gate):');
    for (const row of data ?? []) {
      const raw = String((row as any).description ?? '');
      const brace = raw.indexOf('{');
      if (brace < 0) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(raw.slice(brace));
      } catch {
        continue;
      }
      if (!Array.isArray(parsed?.nodes) || !parsed.nodes.length) continue;
      const verdict = validateFlow({ nodes: parsed.nodes, edges: [] });
      console.log(
        `  ${verdict.ok ? 'ok  ' : 'FAIL'} ${String((row as any).title).slice(0, 60)}` +
          (verdict.ok ? '' : ` — ${verdict.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ').slice(0, 160)}`)
      );
    }
  }

  if (!APPLY) {
    console.log('Report only. Re-run with --apply to write the missing trigger nodes.');
    return;
  }

  let written = 0;
  for (const repair of repairs) {
    const { error: writeError } = await supabase.from('automations').update({ description: repair.description }).eq('id', repair.id);
    if (writeError) {
      console.error(`  FAILED ${repair.title}: ${writeError.message}`);
      continue;
    }
    written++;
    console.log(`  wrote trigger node for ${repair.title}`);
  }
  console.log(`\n${written} flow(s) repaired.`);
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
