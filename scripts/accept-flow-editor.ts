/**
 * End-to-end: build a flow the way the EDITOR does, save it, fire the trigger, and check the scheduler
 * queued real steps.
 *
 * This is the claim being tested: "any automation can be made from the editor". The flow below uses
 * canvas vocabulary only (`meta_ad`, `action_whatsapp_msg`, `action_delay` days, `action_whatsapp_questions`).
 * Everything it creates is deleted at the end.
 *
 *   npx tsx scripts/accept-flow-editor.ts
 */
import { createClient } from '@supabase/supabase-js';
import { translateCanvasFlow } from '../lib/flows/canvas-translation';
import { fireFlowTrigger } from '../lib/flows/ingress';
import { SCHEDULES, RUNS } from '../lib/flows/store';

const TEST_USER = 'b63bd63a-e7cc-440c-8d91-1b435f6edf21'; // "Nobogent Test"

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

(async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // Exactly what the canvas holds, in the canvas's own vocabulary.
  const canvasFlow = {
    name: 'Editor acceptance (delete me)',
    isActive: true,
    trigger: { type: 'meta_ad', label: 'Meta lead form' },
    nodes: [
      { id: 'n1', type: 'action_whatsapp_msg', config: { message: 'Thanks {{lead.name}}, here is the catalogue.' } },
      { id: 'n2', type: 'action_delay', config: { days: 2 } },
      { id: 'n3', type: 'action_whatsapp_questions', config: { questions: ['Still looking?'], quickReplies: ['Yes', 'No'] } },
      { id: 'n4', type: 'action_crm_stage', config: { value: 'Follow up' } },
    ],
  };

  const translated = translateCanvasFlow({ trigger: canvasFlow.trigger, nodes: canvasFlow.nodes });
  check('the editor flow translates cleanly', translated.problems.length === 0, translated.problems.map((p) => p.message).join('; ') || 'clean');

  // ── a lead to attach the run to
  const { data: lead, error: leadErr } = await db
    .from('leads')
    .insert({ user_id: TEST_USER, name: 'Editor acceptance lead', phone: '919999000009', status: 'new' })
    .select('id')
    .single();
  if (leadErr) throw new Error(`lead: ${leadErr.message}`);

  // ── save it the way /api/flows does: title "Flow: <name>", description JSON of the TRANSLATED flow
  const { data: automation, error: flowErr } = await db
    .from('automations')
    .insert({
      user_id: TEST_USER,
      title: `Flow: ${canvasFlow.name}`,
      description: JSON.stringify({ name: canvasFlow.name, isActive: true, trigger: translated.trigger, nodes: translated.nodes }),
      icon_name: 'Workflow',
      is_active: true,
      stats: JSON.stringify({ runs: 0, completed: 0, lastTriggeredAt: null }),
    })
    .select('id')
    .single();
  if (flowErr) throw new Error(`automation: ${flowErr.message}`);
  check('saved and active', Boolean(automation?.id));

  const clean = async () => {
    await db.from(SCHEDULES).delete().eq('flow_id', automation.id);
    await db.from(RUNS).delete().eq('flow_id', automation.id);
    await db.from('agent_pending_deliveries').delete().eq('flow_id', automation.id);
    await db.from('automations').delete().eq('id', automation.id);
    await db.from('leads').delete().eq('id', lead.id);
  };

  try {
    // ── fire the trigger the canvas chose
    const firedAt = new Date();
    const fired = await fireFlowTrigger(db, {
      userId: TEST_USER,
      trigger: 'trigger_meta_ad',
      leadId: lead.id,
      campaignId: null,
      now: firedAt,
    });

    check(
      'the runner accepted the flow and started it',
      fired.started.some((entry) => entry.title.includes('Editor acceptance')),
      fired.started.map((entry) => entry.title).join(', ') || fired.skipped.map((entry) => entry.why).join(' | ')
    );

    const { data: rows } = await db
      .from(SCHEDULES)
      .select('step_index, kind, run_at, status, payload')
      .eq('flow_id', automation.id)
      .order('run_at');

    const steps = rows ?? [];
    check('steps were queued on the ledger', steps.length === 3, `${steps.length} steps`);
    const first = steps[0];
    const third = steps[2];
    /**
     * Quiet hours are 21:00–09:00 by default, and the scheduler correctly refuses to send inside them:
     * a message due at 09:00 local is moved to the next allowed hour. So the assertion is not "exactly
     * now" — it is "queued for the next moment a customer may be messaged", and the second send is at
     * least two days out rather than exactly 2,880 minutes.
     */
    const firstDelayMin = first ? Math.round((new Date(first.run_at).getTime() - firedAt.getTime()) / 60000) : -1;
    check(
      'the first message is queued for the next sendable moment',
      firstDelayMin >= 0 && firstDelayMin <= 24 * 60,
      `${firstDelayMin} min (quiet hours may shift it)`
    );
    const thirdDelayMin = third ? Math.round((new Date(third.run_at).getTime() - firedAt.getTime()) / 60000) : -1;
    check(
      'the question bot is queued at least two days out',
      thirdDelayMin >= 2880 && thirdDelayMin <= 2880 + 24 * 60,
      `${thirdDelayMin} min (2 days = 2880)`
    );
    check('it carries the message text', String(first?.payload?.text ?? '').includes('catalogue'), String(first?.payload?.text ?? '').slice(0, 40));
    check('the stage change is an internal step, not a message', steps.some((step) => step.kind === 'handoff'), steps.map((step) => step.kind).join(','));
  } finally {
    await clean();
    const leftover = await db.from(SCHEDULES).select('id').eq('flow_id', automation.id);
    console.log(`\ncleaned up: ${(leftover.data ?? []).length === 0 ? 'yes' : 'NO — rows remain'}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
})();
