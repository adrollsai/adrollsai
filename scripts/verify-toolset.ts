/**
 * Measures the tool catalogue the model actually receives, per kind of request.
 *
 * The agent used to carry all 65 tools on every step (~3.3k prompt tokens plus
 * ~11.8k of schema). Groups now follow the conversation, so this script proves
 * two things: the saving is real, and every ordinary request still gets the
 * tools it needs.
 *
 *   npm run verify:toolset
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { ALL_GROUPS } from '../lib/agent/tool-groups';

const tok = (s: string) => Math.round(s.length / 4);

function costOf(tools: Record<string, any>, systemPrompt: string) {
  const names = Object.keys(tools);
  const schemaChars = names.reduce(
    (sum, n) => sum + JSON.stringify((tools as any)[n]?.inputSchema ?? (tools as any)[n]?.parameters ?? '').length,
    0
  );
  return {
    names,
    tools: names.length,
    promptTokens: tok(systemPrompt),
    schemaTokens: Math.round(schemaChars / 4),
  };
}

/** Each case: what the user typed, and the tools that MUST survive selection. */
const CASES: { name: string; text: string; needs: string[] }[] = [
  {
    name: 'reporting lookup',
    text: 'How many calls did we make today and how many positive leads?',
    needs: ['org_call_report', 'org_lead_report'],
  },
  {
    name: 'call summaries',
    text: 'What did the leads actually say on the calls this week?',
    needs: ['lead_conversations'],
  },
  {
    name: 'image creative',
    text: 'Make a Bhai Dooj greeting image for the brand',
    needs: ['generate_ai_image', 'nobogent_brand_get_profile', 'request_human_approval'],
  },
  {
    name: 'video creative',
    text: 'Generate a 15 second reel with a voiceover',
    needs: ['generate_grok_video', 'generate_voiceover', 'sandbox_render_hyperframes'],
  },
  {
    name: 'composite edit',
    text: 'Put text behind the person head in this video',
    needs: ['get_recipe', 'sandbox_bash_run', 'analyze_video_with_gemini'],
  },
  {
    name: 'meta ads',
    text: 'Pause my Facebook ads campaign and show the spend breakdown',
    needs: ['meta_graph_set_status', 'meta_graph_insights', 'meta_graph_account'],
  },
  {
    name: 'landing page',
    text: 'Publish a landing page for the new Diwali offer',
    needs: ['site_publish_landing_page', 'site_domain_status'],
  },
  {
    name: 'social post',
    text: 'Post this image to our Instagram',
    needs: ['publish_social_post', 'social_connected_accounts'],
  },
  {
    name: 'automation',
    text: 'Set up a follow up automation when a lead comes in',
    needs: ['list_automation_flows', 'check_flow_conflicts', 'request_human_approval'],
  },
  {
    name: 'research',
    text: 'Search the web for the latest WhatsApp pricing',
    needs: ['deepseek_web_search'],
  },
  {
    name: 'notification',
    text: 'Email me when the render finishes',
    needs: ['notify_user'],
  },
  {
    name: 'vague follow-up',
    // The route passes the last few user turns, so "do it" still resolves to
    // the reporting suite the conversation was actually about.
    text: 'How many calls did we make today?\nok do it',
    needs: ['org_call_report', 'request_human_approval'],
  },
  {
    name: 'bare greeting',
    text: 'hello',
    needs: ['sandbox_bash_run', 'generate_ai_image', 'deepseek_web_search', 'request_human_approval'],
  },
];

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: profile } = await sb.from('profiles').select('id, business_name').limit(1).maybeSingle();
  if (!profile?.id) {
    console.error('no profile to test against');
    process.exit(1);
  }

  // Baseline: everything, which is what every step used to pay for.
  const full = await createAgentContext(sb, profile.id, { forceGroups: ALL_GROUPS });
  const baseline = costOf(full.tools as Record<string, any>, full.systemPrompt);
  const baselineTotal = baseline.promptTokens + baseline.schemaTokens;
  console.log(`BASELINE (all groups): ${baseline.tools} tools, ` +
    `prompt ~${baseline.promptTokens} + schemas ~${baseline.schemaTokens} = ~${baselineTotal} tokens/step\n`);

  let failures = 0;
  let sumTotal = 0;
  for (const c of CASES) {
    const ctx = await createAgentContext(sb, profile.id, { intentText: c.text });
    const cost = costOf(ctx.tools as Record<string, any>, ctx.systemPrompt);
    const total = cost.promptTokens + cost.schemaTokens;
    sumTotal += total;

    const missing = c.needs.filter((n) => !cost.names.includes(n));
    // A described tool must be a registered tool: the prompt may never mention
    // something the agent cannot call.
    const described = (ctx.systemPrompt.match(/'([a-z0-9_]{4,})'/g) || [])
      .map((s) => s.replace(/'/g, ''))
      .filter((n) => n.includes('_') && !n.startsWith('sandbox_publish') );
    const ghosts = [...new Set(described)].filter(
      (n) => !cost.names.includes(n) && !['ads_mcp_management', 'image_to_video'].includes(n)
    );

    const ok = missing.length === 0 && ghosts.length === 0;
    if (!ok) failures++;
    const saved = Math.round((1 - total / baselineTotal) * 100);
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(18)} groups=[${ctx.toolGroups.join(',')}] ` +
        `${cost.tools} tools, ~${total} tokens (${saved}% smaller)`
    );
    if (missing.length) console.log(`      missing: ${missing.join(', ')}`);
    if (ghosts.length) console.log(`      prompt mentions unregistered tools: ${ghosts.join(', ')}`);
  }

  const avg = Math.round(sumTotal / CASES.length);
  console.log(
    `\nAverage per turn: ~${avg} tokens vs ~${baselineTotal} baseline ` +
      `(${Math.round((1 - avg / baselineTotal) * 100)}% smaller, ~${Math.round((baselineTotal - avg) / 4)} chars less every step)`
  );

  if (failures) {
    console.error(`\n${failures} case(s) failed.`);
    process.exit(1);
  }
  console.log('All cases pass — every request keeps the tools it needs.');
})().catch((err) => {
  console.error('failed:', err?.message || err);
  process.exit(1);
});
