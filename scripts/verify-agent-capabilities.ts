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

  // ── House skills: the platform's own rules must be loadable by every tenant.
  head('6. The platform rules are loadable, for every tenant');
  {
    const { HOUSE_SKILLS, houseSkill, houseSkillCatalogue } = await import('../lib/agent/house-skills');
    const { formatSkillCatalogue } = await import('../lib/agent/tools/skills');

    check(
      'the platform ships house skills, each with a name, a one-liner and a body',
      HOUSE_SKILLS.length >= 5 &&
        HOUSE_SKILLS.every(
          (skill) => skill.name.startsWith('nobogent-') && skill.description.length > 30 && skill.content.length > 200,
        ),
      HOUSE_SKILLS.map((skill) => skill.name).join(', '),
    );
    check(
      'the rules that cost real renders are all written down',
      (() => {
        const all = HOUSE_SKILLS.map((skill) => skill.content).join('\n');
        return (
          /0\.5 s \+ 0\.3 s per word/i.test(all) && // readability
          /lead-in/i.test(all) && // the t=0 trap
          /reuse one video file|separate copies/i.test(all) && // the shared-mp4 trap
          /-16 LUFS|loudness/i.test(all) && // mastering
          /never write a price|Never invent/i.test(all) // the factual guard
        );
      })(),
      'readability, lead-in, shared plates, loudness, factual guard',
    );
    check(
      'a house skill is readable by exact name, case-insensitively',
      houseSkill('nobogent-video-brief') !== null &&
        houseSkill('NOBOGENT-VIDEO-BRIEF') !== null &&
        houseSkill('nobogent-nonsense') === null,
      'name lookup',
    );
    check(
      'the prompt catalogue shows the platform rules even when the tenant has uploaded none',
      (() => {
        const catalogue = formatSkillCatalogue([]);
        return (
          /nobogent-video-brief/.test(catalogue) &&
          /PLATFORM RULES/.test(catalogue) &&
          houseSkillCatalogue().every((skill) => catalogue.includes(skill.name))
        );
      })(),
      `${houseSkillCatalogue().length} platform skill(s) in the catalogue`,
    );

    // The rules must be reachable THROUGH the agent's own tools, not only from code.
    const fromRegistry = await import('../lib/agent/tools/skills');
    const tools = fromRegistry.createSkillTools(admin as any, tenant.id);
    const listed = await (tools.list_skills as any).execute({}, {} as any);
    check(
      'the agent\'s own list_skills returns the platform rules',
      listed?.success === true &&
        (listed.skills ?? []).some((skill: any) => String(skill.name).startsWith('nobogent-')),
      `${(listed?.skills ?? []).length} skill(s) listed`,
    );
    const read = await (tools.get_skill as any).execute({ name: 'nobogent-never-invent' }, {} as any);
    check(
      'get_skill reads a platform rule, and says it is not advisory',
      read?.success === true && read.source === 'platform' && /Never invent/i.test(String(read.content)),
      read?.source ?? 'not read',
    );
  }

  // ── The video planner: the contract the agent must pass before promising a film.
  head('7. The video planner validates a brief before anything is spent');
  {
    const { planVideo } = await import('../lib/agent/tools/video-skill');
    const goodBeats = {
      version: 1,
      jobId: 'capability-check',
      aspect: '9:16',
      fps: 30,
      targetSeconds: 32,
      onScreenLanguage: 'en',
      logoOnScreen: false,
      voice: { language: 'hinglish', scene: 'warm, confident, unhurried — a teacher, not a salesman' },
      plates: [
        { id: 'a', source: 'generate', prompt: 'one slow push in', seconds: 6 },
        { id: 'b', source: 'generate', prompt: 'one slow pull back', seconds: 6 },
      ],
      beats: [
        { id: 'p01', vo: 'Batch 12 shuru ho raha hai', lines: ['BATCH 12 STARTS SOON'], plate: 'a' },
        { id: 'p02', vo: 'Aaj hi seat book karo', lines: ['BOOK YOUR SEAT'], plate: 'b' },
      ],
      scenes: [
        { id: 's1', kind: 'hook', beats: ['p01'], plate: 'a' },
        { id: 's2', kind: 'endcard', beats: ['p02'], plate: 'b' },
      ],
      endCard: {
        name: 'Sharma Academy',
        tagline: 'Edit like a pro',
        numbers: ['9820012345', '9820012346'],
        address: ['Pune'],
      },
    };
    const planned = planVideo({ beats: goodBeats });
    check(
      'a valid brief is planned and quoted',
      planned.success === true && (planned.credits?.total ?? 0) > 0,
      planned.success ? `${planned.credits?.total} credits, ${planned.beats} beats` : planned.error,
    );
    check(
      'the plan names the credits per step, so the owner can be asked first',
      (planned.steps ?? []).length > 0 && (planned.steps ?? []).every((step) => step.credits >= 0),
      (planned.steps ?? []).map((step) => `${step.name}:${step.credits}`).join(' '),
    );

    const tooLong = planVideo({
      beats: {
        ...goodBeats,
        beats: [{ id: 'p01', vo: 'x', lines: ['THIS LINE IS FAR TOO LONG FOR A VERTICAL FRAME'], plate: 'a' }],
      },
    });
    check(
      'a line too long for the frame is reported, not planned',
      tooLong.success === false || (tooLong.problems ?? []).length > 0,
      tooLong.problems?.[0]?.slice(0, 90) ?? tooLong.error ?? 'NOT CAUGHT',
    );

    const broken = planVideo({ beats: { nothing: true } });
    check(
      'a brief that is not a beats file is refused with the path that is wrong',
      broken.success === false && /beats/i.test(String(broken.error)),
      broken.error?.slice(0, 90) ?? 'no error',
    );
    check(
      'plan_video is registered with the agent',
      registryNames.includes('plan_video'),
      registryNames.includes('plan_video') ? 'present in the registry' : 'NOT registered',
    );

    // The image half, same discipline: the P5 rules reachable, without a second
    // spending path.
    const { planImage } = await import('../lib/agent/tools/video-skill');
    const image = planImage({
      brief: 'a Diwali offer card for a film editing course',
      facts: { price: 'Rs 24,000', phone: '+91 98200 12345' },
      aspectRatio: '1:1',
    });
    check(
      'an image brief is planned with the exact prompt and a price',
      image.success === true && Boolean(image.prompt) && (image.credits ?? 0) > 0,
      image.success ? `${image.credits} credits, ${image.aspectRatio}, route ${image.route}` : image.error,
    );
    check(
      'the supplied facts appear in the prompt, verbatim',
      image.success === true && image.prompt!.includes('Rs 24,000') && image.prompt!.includes('+91 98200 12345'),
      'facts carried into the prompt',
    );
    check(
      'a reference image switches the route to the edit model',
      (() => {
        const withRef = planImage({
          brief: 'the same card, but with our own building in the background',
          referenceUrls: ['https://example.com/building.jpg'],
        });
        return withRef.success === true && withRef.route !== image.route && (withRef.references ?? 0) === 1;
      })(),
      'reference routes to the edit model',
    );
    check(
      'plan_image is registered with the agent',
      registryNames.includes('plan_image'),
      registryNames.includes('plan_image') ? 'present in the registry' : 'NOT registered',
    );

    // ── the reverse: the planning half is a tool, the measuring half is a sandbox adapter
    const { planReverse, sandboxAnalysisTools, measureReference } = await import('../lib/agent/tools/reverse-skill');

    // A fake runner that records the command it was given and answers like a sandbox.
    const commands: string[] = [];
    const fakeRunner = {
      async run(command: string) {
        commands.push(command);
        if (command.startsWith('ffprobe')) {
          return {
            stdout: JSON.stringify({
              streams: [
                { codec_type: 'video', codec_name: 'h264', width: 720, height: 720, r_frame_rate: '25/1' },
                { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
              ],
              format: { duration: '10', size: '1000' },
            }),
          };
        }
        if (command.includes('silencedetect')) return { stdout: '', stderr: '[silencedetect] silence_start: 1\n[silencedetect] silence_end: 2 | silence_duration: 1' };
        if (command.includes('base64')) {
          // Answer with EXACTLY the bytes the analyser asked for: it rejects a short
          // frame, and a fake that returns a fixed size would fail for the wrong reason.
          const size = /scale=(\d+):(\d+)/.exec(command);
          const width = size ? Number(size[1]) : 48;
          const height = size ? Number(size[2]) : 64;
          return { stdout: Buffer.alloc(width * height * 3, 40).toString('base64') };
        }
        return { stdout: '', stderr: 'pts_time:5\nlavfi.scene_score=0.5' };
      },
    };

    const tools = sandboxAnalysisTools(fakeRunner);
    const probed = await tools.probeJson('/work/ref.mp4');
    check(
      'the sandbox adapter runs ffprobe and hands back the JSON',
      /"codec_type"/.test(probed),
      JSON.parse(probed).streams.length + ' stream(s)',
    );
    check(
      'the ffprobe command names the file and asks for the entries the parser reads',
      commands.some((command) => command.startsWith('ffprobe') && command.includes('/work/ref.mp4') && command.includes('format=duration,size')),
      commands[0]?.slice(0, 100),
    );

    await tools.log('/work/ref.mp4', 'silencedetect=noise=-35dB:d=0.10', 'audio');
    await tools.log('/work/ref.mp4', 'select=gt(scene,0.2)', 'video');
    check(
      'the audio seam uses -af and the video seam uses -vf, and both merge stderr',
      commands.some((command) => command.includes('-af') && command.includes('2>&1')) &&
        commands.some((command) => command.includes('-vf') && command.includes('2>&1')),
      `${commands.length} command(s) recorded`,
    );

    const frame = await tools.frameRgb('/work/ref.mp4', 1.5, 48, 64);
    check(
      'a frame comes back as raw rgb24 bytes, decoded from base64',
      frame instanceof Uint8Array && frame.length === 48 * 64 * 3 && frame[0] === 40,
      `${frame.length} bytes = 48x64x3`,
    );
    check(
      'the frame command pipes rawvideo rgb24 through base64, so no binary file API is needed',
      commands.some(
        (command) => command.includes('-f rawvideo') && command.includes('-pix_fmt rgb24') && command.includes('base64'),
      ),
      'rawvideo | base64',
    );

    let measured: any = null;
    try {
      measured = await measureReference('/work/ref.mp4', fakeRunner);
    } catch (error: any) {
      measured = { error: String(error?.message ?? error) };
    }
    check(
      'a full measurement runs end to end through the adapter',
      Boolean(measured?.facts) && measured.facts.durationSeconds === 10,
      measured?.error ?? `${measured?.facts?.durationSeconds}s, ${measured?.film?.shotCount} shot(s)`,
    );

    const reversePlanned = planReverse(measured);
    check(
      'a measurement becomes a rebuild plan with beats, credits and questions',
      reversePlanned.success === true && (reversePlanned.questions ?? []).length > 0,
      reversePlanned.success
        ? `${reversePlanned.scenes} scene(s), ${reversePlanned.credits?.total} credits, ${reversePlanned.questions?.length} question(s)`
        : reversePlanned.error,
    );
    check(
      'the SPEC it produces states no figure the measurement cannot account for',
      reversePlanned.success === true && reversePlanned.specAudit?.ok === true,
      `${reversePlanned.specAudit?.figures} figure(s), ${reversePlanned.specAudit?.invented.length} invented`,
    );
    check(
      'the copy comes back as WORD blanks, never as invented words',
      reversePlanned.success === true && /"lines":\s*\[\s*"WORD/.test(String(reversePlanned.beatsJson)),
      'marked blanks',
    );
    check(
      'something that is not a measurement is refused with what to pass instead',
      (() => {
        const bad = planReverse({ nothing: true } as any);
        return bad.success === false && /not a measurement/i.test(String(bad.error));
      })(),
      'refused',
    );
    check(
      'reverse_plan is registered with the agent',
      registryNames.includes('reverse_plan'),
      registryNames.includes('reverse_plan') ? 'present in the registry' : 'NOT registered',
    );
  }

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
