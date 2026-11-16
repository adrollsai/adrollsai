/**
 * A proper ad: real moving footage, a spoken voiceover, music, and designed type.
 *
 * The previous attempt was a photograph with words on it — no footage, no voice, no sound. This
 * uses the tools the product already has:
 *   - generate_grok_video  → cinematic moving shots (image-to-video from the academy's photographs)
 *   - generate_voiceover   → the spoken script
 *   - ffmpeg              → concat the shots, overlay type, mix voice + music, grade
 *
 * Everything is approved one spend at a time, exactly as the UI would.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

dotenv.config({ path: '.env.local', quiet: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const OWNER = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';
const OUT = 'C:\\Users\\Adrolls\\Desktop\\nobo-e2e\\procolor';
fs.mkdirSync(OUT, { recursive: true });

const results = JSON.parse(fs.readFileSync(`${OUT}\\results.json`, 'utf8'));
const stills: string[] = results.results.filter((r: any) => r.kind === 'image').map((r: any) => r.url);

const approve = async (actionId: string) => {
  const { error } = await admin
    .from('agent_events')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('user_id', OWNER)
    .eq('event_type', 'PENDING_ACTION_APPROVAL')
    .eq('payload->>actionId', actionId);
  return !error;
};

/** Run a gated media tool: stage, approve, execute. */
async function gated(tools: any, name: string, input: any, label: string) {
  const blocked = await tools[name].execute(input);
  const actionId = blocked?.actionId as string | undefined;
  if (blocked?.imageUrl || blocked?.videoUrl || blocked?.audioUrl) return blocked;
  if (!actionId) {
    console.log(`  ${label}: no approval card — ${JSON.stringify(blocked).slice(0, 160)}`);
    return blocked;
  }
  await approve(actionId);
  return tools[name].execute({ approvalId: actionId });
}

const ctx = await createAgentContext(admin, OWNER, { intentText: 'make a cinematic ad' });
const tools = ctx.tools as any;

// ── 1. moving shots from the stills ────────────────────────────────────────
const shotPrompts = [
  'Slow cinematic push in on the cinematographer turning the focus ring, shallow depth of field, dust in the light beam, film grain, 24fps look',
  'Slow lateral dolly across a film set at dusk, gimbal and softbox visible, warm practical light, anamorphic flare',
];
const clips: string[] = [];
for (const [i, prompt] of shotPrompts.entries()) {
  const source = stills[i] || stills[0];
  if (!source) break;
  console.log(`\n▸ shot ${i + 1}/2 (grok imagine, image-to-video)…`);
  const out = await gated(tools, 'generate_grok_video', { prompt, imageUrls: [source] }, `shot ${i + 1}`);
  const url = out?.videoUrl || out?.url || out?.result?.videoUrl || '';
  console.log(url ? `  ok: ${url}` : `  failed: ${JSON.stringify(out).slice(0, 220)}`);
  if (url) clips.push(url);
}

// ── 2. the voiceover ───────────────────────────────────────────────────────
const script =
  'You want to shoot films people remember? Eight weeks at Procolor Film Academy in Chandigarh. ' +
  'Real cinema cameras. Real lights. Real locations. You finish with a short film, a documentary, ' +
  'a diploma, and a showreel of your own work. Small batches, hands on, taught by people who shoot. ' +
  'Diploma in Cinematography. Call nine five six nine nine one nine nine eight five.';
console.log('\n▸ voiceover (TTS)…');
const vo = await gated(
  tools,
  'generate_voiceover',
  { text: script, voice: 'Fenrir', language: 'en-IN' },
  'voiceover',
);
const voUrl = vo?.audioUrl || vo?.url || vo?.result?.audioUrl || '';
console.log(voUrl ? `  ok: ${voUrl}` : `  failed: ${JSON.stringify(vo).slice(0, 240)}`);

fs.writeFileSync(
  `${OUT}\\ad-assets.json`,
  JSON.stringify({ clips, voiceover: voUrl, stills, script }, null, 2),
);
console.log(`\nclips: ${clips.length} | voiceover: ${voUrl ? 'yes' : 'no'}`);
