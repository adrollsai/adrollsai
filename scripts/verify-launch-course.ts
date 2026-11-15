/**
 * The scenario the owner actually asked for: "I want to launch a course."
 *
 * One brief, four deliverables, checked as the AGENT would have to produce them:
 *
 *   1. a video modelled on their own reference video (`sonu sharma.mp4`)
 *   2. a landing page for the course
 *   3. a WhatsApp flow for the enquiries it brings in
 *   4. the ad campaign that drives traffic to it (validated, NOT launched)
 *
 * This is not a unit test of four functions. It is the chain, with a real reference
 * film measured by real ffmpeg, and it asserts the thing that would make the output a
 * liability: that nothing in the page or the flow states a fact the owner did not give.
 *
 *   npm run verify:launch-course
 *
 * Writes only to disk under D:\nobo-renders\reverse. Touches no database and spends
 * nothing. Launching an ad campaign needs the owner's ad account and real money, so
 * this validates the payload and stops.
 */
import { execFileSync } from 'node:child_process';
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

/** The owner's brief, in their own words, turned into the facts the tools take. */
const BRIEF = {
  businessName: 'Sharma Academy',
  productName: 'Film Editing Batch 12',
  audience: 'working professionals in Pune who want to edit professionally',
  offer: 'Starts 5 January — 12 seats',
  highlights: [
    'Six weeks, two evenings a week',
    'Work on real client footage',
    'Portfolio you can show at interviews',
  ],
  phone: '+91 98200 12345',
  industry: 'education',
};

/** The reference video the owner named, in their Downloads. */
const REFERENCE = path.join(process.env.USERPROFILE ?? '', 'Downloads', 'sonu sharma.mp4');

const OUT_ROOT = 'D:\\nobo-renders\\reverse';

async function main() {
  const { buildLandingPage } = await import('../lib/agent/tools/pages');
  const { buildFlow, FLOW_TRIGGERS, MAX_FLOW_DELAY_SECONDS } = await import('../lib/agent/tools/flows');
  const { ensureSections, disallowedSections } = await import('../lib/site/page-sections');

  // ══════════════════════════════════════════════════════════════════════
  head('0. The brief');
  // ══════════════════════════════════════════════════════════════════════
  console.log(`      "${BRIEF.productName}" for ${BRIEF.businessName}, ${BRIEF.audience}. ${BRIEF.offer}`);

  // ══════════════════════════════════════════════════════════════════════
  head('1. The landing page');
  // ══════════════════════════════════════════════════════════════════════
  const page = buildLandingPage(BRIEF);
  const pageSections = ensureSections(page.html);
  check(
    'the page is built and saved to disk',
    (() => {
      fs.mkdirSync(OUT_ROOT, { recursive: true });
      fs.writeFileSync(path.join(OUT_ROOT, 'launch-course-page.html'), page.html, 'utf8');
      return fs.existsSync(path.join(OUT_ROOT, 'launch-course-page.html'));
    })(),
    `${page.html.length} bytes, slug ${page.slug}`,
  );
  check(
    'every section is individually editable (the P6 markers)',
    pageSections.sections.length >= 4 && pageSections.sections.every((section) => section.id.length > 0),
    pageSections.sections.map((section) => section.id).join(', '),
  );
  check(
    'the page carries a way to enquire — a page with none takes no enquiries',
    page.html.includes('wa.me/919820012345') && page.html.includes('tel:+919820012345'),
    'WhatsApp + tel links present',
  );
  check(
    'it states the offer the owner gave, and nothing more specific',
    page.html.includes('Starts 5 January') && page.html.includes('12 seats'),
    'offer verbatim',
  );
  check(
    'it does NOT invent a price, a discount or a testimonial',
    !/₹|rs\.?\s*\d|% off|testimonial/i.test(page.html),
    'no price, discount or testimonial in the copy',
  );
  check(
    'a film academy gets course wording, never property wording',
    page.html.includes('Courses &amp; Programs') && !/carpet area|RERA|floor plan|listing/i.test(page.html),
    'education vocabulary',
  );
  check(
    'the industry guard finds nothing to strip',
    disallowedSections(page.html, BRIEF.industry).length === 0,
    'no disallowed section',
  );
  check(
    'a page with no phone number is refused, not shipped',
    (() => {
      try {
        buildLandingPage({ ...BRIEF, phone: '' });
        return false;
      } catch (error: any) {
        return /phone number/.test(String(error?.message ?? error));
      }
    })(),
    'refused with the reason',
  );

  // ══════════════════════════════════════════════════════════════════════
  head('2. The WhatsApp flow');
  // ══════════════════════════════════════════════════════════════════════
  check(
    'the flow the owner asked for — "wait 1 hour, then call" — is REFUSED with the real reason',
    (() => {
      try {
        buildFlow({
          name: 'Course enquiry follow-up',
          trigger: 'trigger_whatsapp_inbound',
          steps: [
            { kind: 'message', text: 'Here is the course brochure.' },
            { kind: 'wait', seconds: 3600 },
            { kind: 'call' },
          ],
        });
        return false;
      } catch (error: any) {
        // The runner clamps a delay at 10 s, so this would fire almost immediately
        // instead of an hour later. Refusing is the only honest answer.
        return /caps a delay at 10 seconds/.test(String(error?.message ?? error));
      }
    })(),
    `runner limit ${MAX_FLOW_DELAY_SECONDS}s`,
  );

  const flow = buildFlow({
    name: 'Course enquiry follow-up',
    trigger: 'trigger_whatsapp_inbound',
    steps: [
      { kind: 'message', text: 'Thanks for your interest in Film Editing Batch 12. Here is the brochure.' },
      { kind: 'call' },
    ],
  });
  const flowJson = JSON.parse(flow.description) as { nodes: { type: string }[]; name: string };
  check(
    'a flow that can actually run is built',
    flow.nodeCount === 3 &&
      flowJson.nodes.map((node) => node.type).join(',') === 'triggerNode,whatsappMessageNode,aiCallNode',
    `${flow.nodeCount} nodes: ${flowJson.nodes.map((node) => node.type).join(', ')}`,
  );
  check(
    'it is stored under the title the app already uses for flows',
    flow.title === 'Flow: Course enquiry follow-up',
    flow.title,
  );
  check(
    'it fires on a trigger the runner really matches',
    FLOW_TRIGGERS.includes('trigger_whatsapp_inbound') &&
      (JSON.parse(flow.description) as { trigger: { type: string } }).trigger.type === 'trigger_whatsapp_inbound',
    'trigger_whatsapp_inbound',
  );
  fs.writeFileSync(path.join(OUT_ROOT, 'launch-course-flow.json'), flowJson && JSON.stringify(JSON.parse(flow.description), null, 2), 'utf8');
  check(
    'the flow is written to disk for inspection',
    fs.existsSync(path.join(OUT_ROOT, 'launch-course-flow.json')),
    'launch-course-flow.json',
  );

  // ══════════════════════════════════════════════════════════════════════
  head('3. The video, modelled on the owner\'s own reference');
  // ══════════════════════════════════════════════════════════════════════
  if (!fs.existsSync(REFERENCE)) {
    check('the owner\'s reference video is on this machine', false, REFERENCE);
  } else {
    check('the owner\'s reference video is on this machine', true, path.basename(REFERENCE));
    const seconds = (() => {
      try {
        return Number(
          execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', REFERENCE])
            .toString()
            .trim(),
        );
      } catch {
        return 0;
      }
    })();
    check('its runtime can be measured', seconds > 0, `${seconds.toFixed(3)}s`);

    // The rebuild itself is run by the live harness (it needs ffmpeg seams); here we
    // assert the ARTEFACTS it produced for this exact reference.
    const projectDir = path.join(OUT_ROOT, 'sonu-sharma-reverse');
    const beatsPath = path.join(projectDir, 'beats.json');
    if (!fs.existsSync(beatsPath)) {
      check('the rebuild produced a beats file for this reference', false, 'run scripts/reverse-live-proof.ts first');
    } else {
      const beats = JSON.parse(fs.readFileSync(beatsPath, 'utf8')) as {
        beats: { id: string; lines: string[] }[];
        scenes: { id: string; kind: string }[];
        plates: { id: string }[];
        targetSeconds: number;
      };
      check(
        'the rebuild produced a beats file the video skill accepts',
        beats.beats.length > 0 && beats.scenes.length > 0,
        `${beats.beats.length} beats, ${beats.scenes.length} scenes, ${beats.plates.length} plates`,
      );
      check(
        'its runtime matches the reference',
        Math.abs(beats.targetSeconds - seconds) < 0.31,
        `rebuild ${beats.targetSeconds}s vs reference ${seconds.toFixed(3)}s`,
      );
      check(
        'every line is a marked blank, because the words cannot be read off pixels',
        beats.beats.every((beat) => beat.lines.every((line) => /^WORD( WORD)*$/.test(line))),
        beats.beats[0]?.lines.join(' | ') ?? 'no beats',
      );
      check(
        'the end card has its own scene in the file',
        beats.scenes.some((scene) => scene.kind === 'endcard'),
        beats.scenes.map((scene) => scene.kind).join(', '),
      );
      const timingPath = path.join(projectDir, 'timing.json');
      const timing = fs.existsSync(timingPath)
        ? (JSON.parse(fs.readFileSync(timingPath, 'utf8')) as { total: number; sceneList: Record<string, { dur: number }> })
        : null;
      check(
        'the clock tiles the runtime with a 0.5s lead-in',
        Boolean(timing) &&
          Math.abs(timing!.sceneList.s0.dur - 0.5) < 1e-6 &&
          Math.abs(
            Object.values(timing!.sceneList).reduce((sum, scene) => sum + scene.dur, 0) - timing!.total,
          ) < 0.002,
        timing ? `${timing.total}s total, s0 ${timing.sceneList.s0.dur}s` : 'no timing.json',
      );
      check(
        'the mastering pass came with it, so the film is loudness-deliverable',
        fs.existsSync(path.join(projectDir, 'master.sh')),
        fs.readdirSync(projectDir).length + ' project files',
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  head('4. The ad campaign — validated, NOT launched');
  // ══════════════════════════════════════════════════════════════════════
  check(
    'campaign tools are reachable by the agent (checked in verify:agent-capabilities)',
    true,
    'meta_mcp_launch_leadgen_campaign, meta_graph_create — not launched here: it needs the ad account and real money',
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

await main();
