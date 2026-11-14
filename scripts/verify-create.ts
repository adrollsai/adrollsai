/**
 * The Create flow: intent → chat message → single pre-flight review → paid generation.
 *
 * Asserts the three things that make the promise true:
 *   1. a panel submission always produces an unambiguous brief that asks for one review
 *   2. the approval tool carries the resolved spec and the previews through to the card
 *   3. the system prompt actually tells the agent not to spend before that approval
 */
import { buildCreateIntent } from '../lib/agent/create-intent';
import { createHumanApprovalTool } from '../lib/agent/tools/human_approval';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

/** Minimal Supabase stub: the approval tool only inserts and reads back nothing. */
function stubSupabase(rows: any[]) {
  return {
    from(table: string) {
      const q: any = {
        insert: (row: any) => {
          rows.push({ table, row });
          return Promise.resolve({ error: null });
        },
        select: () => q,
        eq: () => q,
        maybeSingle: () => Promise.resolve({ data: null }),
      };
      return q;
    },
  } as any;
}

async function main() {
  // ---------------------------------------------------------------- 1. intent
  const img = buildCreateIntent({
    kind: 'image',
    ratio: '9:16',
    refMode: 'pick',
    reference: { id: 'pinterest_pin_12', name: 'Marina Skyline Gold', category: 'waterfront' },
    brief: 'Diwali offer, 3BHK Mohali, under 1.2 crore',
  });
  check('image intent names the dimensions', img.includes('Dimensions: 9:16'));
  check('image intent names the chosen reference', img.includes('Marina Skyline Gold') && img.includes('pinterest_pin_12'));
  check('image intent carries the brief', img.includes('Diwali offer'));
  check('image intent asks for exactly one review before spending', /stop exactly once/i.test(img) && /before the first paid generation/i.test(img));

  const vid = buildCreateIntent({
    kind: 'video',
    ratio: '9:16',
    resolution: '720p',
    seconds: 20,
    refMode: 'random',
  });
  check('video intent carries resolution and length', vid.includes('720p') && vid.includes('20s'));
  check('video intent lets the agent choose a reference', /pick one reference creative/i.test(vid));
  check('video intent falls back to the business profile for a brief', /use my business profile/i.test(vid));

  const vo = buildCreateIntent({ kind: 'voiceover', brief: 'hinglish read for a 20s reel' });
  check('voiceover intent has no reference line', !/Reference:/.test(vo));
  check('voiceover intent keeps the brief', vo.includes('hinglish read'));

  const none = buildCreateIntent({ kind: 'image', ratio: '1:1', refMode: 'none' });
  check('brand-only mode says so', /design it from the brand profile/i.test(none));

  // ---------------------------------------------------------------- 2. approval tool
  const rows: any[] = [];
  const tools = createHumanApprovalTool(stubSupabase(rows), 'user-1');
  const exec = (tools.request_human_approval as any).execute as (
    input: any,
    options: any
  ) => Promise<any>;
  const res: any = await exec(
    {
      actionType: 'create_asset',
      title: 'Approve the 15s Diwali reel',
      description: 'Generates a 15s 9:16 reel with the script below.',
      estimatedCost: '₹38',
      spec: [
        { label: 'Script', value: 'Wanna get in touch with us?' },
        { label: 'Voice', value: 'Aoede, american english' },
        { label: 'Dimensions', value: '9:16 · 720p · 15s' },
        { label: 'Reference', value: 'Marina Skyline Gold' },
      ],
      previews: [{ kind: 'audio', url: 'https://example.com/vo.mp3', caption: 'Voiceover preview' }],
      resumePrompt: 'Approved — generate the reel now with the staged plan.',
      actionPayload: { model: 'grok-imagine-video-1-5-preview' },
    },
    { toolCallId: 'test-call', messages: [] }
  );
  check('approval returns a card artifact', res.artifact?.type === 'action_confirmation');
  check('card carries the spec sheet', (res.artifact?.spec || []).length === 4);
  check('card carries the preview', res.artifact?.previews?.[0]?.kind === 'audio');
  check('card carries the resume prompt', /generate the reel now/i.test(res.artifact?.resumePrompt || ''));
  check('spec and previews are persisted with the event', rows.length === 1 && (rows[0].row.payload.spec || []).length === 4);
  check('create_asset is an allowed action type', rows[0].row.payload.actionType === 'create_asset');

  // ---------------------------------------------------------------- 3. prompt contract
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'stub-anon-key';
  const { createAgentContext } = await import('../lib/agent/orchestrator');
  const ctx = await createAgentContext(
    {
      from() {
        const q: any = {
          select: () => q,
          eq: () => q,
          ilike: () => q,
          limit: () => q,
          maybeSingle: () => Promise.resolve({ data: null }),
          single: () => Promise.resolve({ data: null }),
          then: (r: any) => Promise.resolve({ data: null }).then(r),
        };
        return q;
      },
    } as any,
    'user-1',
    { intentText: 'make me a video reel for diwali', forceGroups: ['media'] }
  );
  const prompt = String((ctx as any).system || (ctx as any).systemPrompt || '');
  check('prompt has a making-things contract', /MAKING THINGS/i.test(prompt));
  check('prompt forbids spending before the review', /before the first billable image\/video generation/i.test(prompt));
  check('prompt asks for spec + previews in the approval', /'spec'/.test(prompt) && /'previews'/.test(prompt));
  check('prompt says one gate, not five', /One gate, not five/i.test(prompt));
  check('prompt tells it to pick a reference when none is given', /pick ONE reference creative/i.test(prompt));
  check('prompt says a free mock is not the deliverable', /free substitute does not satisfy/i.test(prompt));
  check('approval tool is described as the creative gate too', /pre-flight review of any billable creative job/i.test(prompt));

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} checks passed`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error('verify-create crashed:', e);
  process.exit(1);
});
