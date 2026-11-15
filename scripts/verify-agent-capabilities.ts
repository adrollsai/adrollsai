/**
 * Does the AGENT actually have the capability, for a real tenant?
 *
 * Every earlier gate proved a *library*. This one builds the REAL agent context —
 * `createAgentContext()`, the same function a live turn calls — for a real tenant in
 * the real database, and asks, for each thing a customer asks Nobogent to do:
 *
 *   1. does the conversation select the tool GROUP that capability lives in?
 *   2. is the specific tool PRESENT in the registry the model would be given?
 *   3. does that tool's input SCHEMA accept a realistic payload, and refuse a bad one?
 *
 * It calls no model and spends nothing. A missing tool is reported as a finding with
 * the group that should have carried it, because "the customer asked for an ad
 * campaign and the agent had no campaign tool" is the failure that matters, and no
 * unit test can see it.
 *
 *   npm run verify:agent-capabilities
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);

function readEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const file of ['.env.local']) {
    const full = path.resolve(file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
      if (/^\s*#/.test(line) || !line.includes('=')) continue;
      const at = line.indexOf('=');
      const key = line.slice(0, at).trim();
      if (key && !env[key]) env[key] = line.slice(at + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = readEnv();
const envReady = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

/** One thing a customer asks for, and what must be reachable to do it. */
interface Scenario {
  /** How the owner actually phrases it. */
  ask: string;
  /** Tool groups that must be selected for this turn. */
  groups: string[];
  /** At least one of these tool names must be in the registry. */
  tools: string[];
  /** A payload the chosen tool's schema should accept. */
  valid?: { tool: string; input: Record<string, unknown> };
  /** A payload it should refuse. */
  invalid?: { tool: string; input: Record<string, unknown> };
}
const SCENARIOS: Record<string, Scenario> = {
  adCampaign: {
    ask: 'Launch a Meta ad campaign for our new film editing course, ₹500 a day, targeting Pune',
    groups: ['meta'],
    tools: ['meta_mcp_launch_leadgen_campaign', 'meta_mcp_create_campaign', 'meta_graph_create'],
  },
  adCampaignPause: {
    ask: 'pause the campaign that is spending too much',
    groups: ['meta'],
    tools: ['meta_graph_set_status', 'meta_mcp_list_campaigns', 'meta_graph_list'],
  },
  videoNoReference: {
    ask: 'make a 30 second vertical video about our new batch starting Monday',
    groups: ['media'],
    tools: ['composeVideo', 'video_plan', 'generate_grok_video'],
  },
  videoFromReference: {
    ask: 'make me a video like the reference video I uploaded, same style',
    groups: ['media'],
    tools: ['reverse_measure', 'reverse_plan', 'list_reference_creatives', 'composeVideo'],
  },
  creativeNoReference: {
    ask: 'create an Instagram creative for the Diwali offer',
    groups: ['media'],
    tools: ['generate_ai_image', 'image_create'],
  },
  creativeFromReference: {
    ask: 'make a creative in the same style as this reference creative',
    groups: ['media'],
    tools: ['list_reference_creatives', 'image_create', 'generate_ai_image'],
  },
  whatsappFlow: {
    ask:
      'create a WhatsApp flow: when a new lead comes in, send the course brochure, wait 1 hour, ' +
      'then call them, and if they do not answer send a follow up the next day',
    groups: ['automation'],
    // ONLY a creating tool counts here. `list_automation_flows` alone means the agent
    // can describe flows it cannot build, which reads like a capability and is not one.
    tools: ['create_flow', 'flow_create', 'save_automation_flow', 'create_automation_flow'],
    valid: {
      tool: 'create_flow',
      input: {
        name: 'Course enquiry follow-up',
        trigger: 'trigger_whatsapp_inbound',
        steps: [
          { kind: 'message', text: 'Thanks for your interest — here is the brochure.' },
          { kind: 'call' },
        ],
      },
    },
    invalid: { tool: 'create_flow', input: { name: '', trigger: 'nonsense', steps: [] } },
  },
  callingFlow: {
    ask: 'set up an AI calling flow that calls every new lead within 5 minutes',
    groups: ['automation'],
    // Dispatching one call is not authoring a flow: require the create path.
    tools: ['create_flow', 'flow_create', 'save_automation_flow', 'create_automation_flow'],
  },
  scraping: {
    ask: 'scrape the pricing page of our competitor every morning and store it',
    groups: ['research'],
    tools: ['scrape_definitions', 'scrape_run', 'scrape_save_definition'],
  },
  landingPage: {
    ask: 'make a landing page for the new course, like the one we used for the last webinar',
    groups: ['sites'],
    // Publishing a page that already exists is not making one.
    tools: ['generate_landing_page', 'landing_page_generate', 'create_landing_page'],
    valid: {
      tool: 'create_landing_page',
      input: {
        businessName: 'Sharma Academy',
        productName: 'Film Editing Batch 12',
        audience: 'working professionals in Pune',
        phone: '+91 98200 12345',
      },
    },
    invalid: { tool: 'create_landing_page', input: { businessName: '', productName: '', phone: '1' } },
  },
  publishPost: {
    ask: 'post the new creative to Instagram and LinkedIn',
    groups: ['publishing'],
    tools: ['publish_social_post'],
  },
  reporting: {
    ask: 'how many leads came in today and how many calls did we make?',
    groups: ['reporting'],
    tools: ['nobogent_crm_query_leads'],
  },
};

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const { selectToolGroups } = await import('../lib/agent/tool-groups');
  const { createAgentContext } = await import('../lib/agent/orchestrator');

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // A real tenant with a business profile: the context needs one to build.
  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, business_name, industry, role')
    .not('business_name', 'is', null)
    .limit(5);

  if (error || !profiles?.length) {
    check('a real tenant could be read to build the agent context', false, error?.message ?? 'no profiles');
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exitCode = 1;
    return;
  }

  const tenant = profiles[0];
  console.log(`tenant: a real business profile (id withheld), industry=${tenant.industry ?? '(none)'}`);

  // ── Group selection: pure, so every scenario is cheap to check.
  head('1. Does the conversation select the right tool group?');
  const selections: Record<string, string[]> = {};
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const selection = selectToolGroups(scenario.ask);
    selections[name] = selection.groups;
    const missing = scenario.groups.filter((group) => !selection.groups.includes(group as any));
    check(
      `${name}: the wording selects ${scenario.groups.join(' + ')}`,
      missing.length === 0,
      missing.length
        ? `MISSING ${missing.join(', ')} — got: ${selection.groups.join(', ')}`
        : `got: ${selection.groups.join(', ')}`,
    );
  }

  // ── The registry itself, built exactly as a live turn builds it.
  head('2. Is the tool actually in the registry the model is given?');
  let registry: Record<string, any> = {};
  try {
    const context = await createAgentContext(admin as any, tenant.id, {
      // Intent text drives the group selection, same as a real turn.
      intentText: Object.values(SCENARIOS).map((scenario) => scenario.ask).join(' \n '),
    } as any);
    registry = (context as any).tools ?? {};
    check(
      'the real agent context built and produced a tool registry',
      Object.keys(registry).length > 0,
      `${Object.keys(registry).length} tools registered`,
    );
    console.log(`      groups active: ${((context as any).toolGroups ?? []).join(', ')}`);
  } catch (error: any) {
    check('the real agent context built', false, String(error?.message ?? error));
  }

  const registryNames = Object.keys(registry).sort();
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const present = scenario.tools.filter((tool) => registryNames.includes(tool));
    check(
      `${name}: at least one capable tool is registered`,
      present.length > 0,
      present.length ? `has ${present.join(', ')}` : `NONE of ${scenario.tools.join(', ')}`,
    );
  }

  // ── Schema behaviour: a tool that accepts anything is not a tool.
  head('3. Do the schemas accept a realistic payload and refuse a bad one?');
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    if (!scenario.valid) continue;
    const schema = registry[scenario.valid.tool]?.inputSchema;
    if (!schema?.safeParse) {
      check(`${name}: ${scenario.valid.tool} has a readable schema`, false, 'no inputSchema');
      continue;
    }
    const ok = schema.safeParse(scenario.valid.input);
    check(
      `${name}: ${scenario.valid.tool} accepts a realistic payload`,
      ok.success === true,
      ok.success ? '' : JSON.stringify(ok.error?.issues?.slice(0, 2)),
    );
    if (scenario.invalid) {
      const bad = schema.safeParse(scenario.invalid.input);
      check(
        `${name}: ${scenario.valid.tool} refuses an empty/garbage payload`,
        bad.success === false,
        bad.success ? 'ACCEPTED a payload it should have refused' : '',
      );
    }
  }

  // ── The catalogue, so the report says what the agent HAS, not just what it lacks.
  head('4. The capability catalogue that IS wired');
  const groups = new Map<string, string[]>();
  for (const [toolName, definition] of Object.entries(registry)) {
    const group = String((definition as any)?.metadata?.group ?? 'core');
    const list = groups.get(group) ?? [];
    list.push(toolName);
    groups.set(group, list);
  }
  for (const [group, tools] of [...groups.entries()].sort()) {
    console.log(`      ${group}: ${tools.length}`);
  }
  console.log(`      total: ${registryNames.length} tools`);

  // ── Documentation coverage: every wired tool should say when NOT to use it.
  head('5. Are the tools describable enough for a model to choose correctly?');
  const undescribed = registryNames.filter((toolName) => {
    const description = String((registry[toolName] as any)?.description ?? '');
    return description.trim().length < 40;
  });
  check(
    'every registered tool carries a real description',
    undescribed.length === 0,
    undescribed.length ? `${undescribed.length} thin: ${undescribed.slice(0, 6).join(', ')}` : 'all described',
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

// Invoked at the BOTTOM: `await` at the top of the file would run before the
// scenario fixtures below it are initialised, which is a temporal dead zone rather
// than a bug in the fixtures.
if (!envReady) {
  console.error('needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exitCode = 1;
} else {
  await main();
}
