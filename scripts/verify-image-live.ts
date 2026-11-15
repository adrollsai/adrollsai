/**
 * Does image generation produce CORRECT output — right words, right brand, relevant?
 *
 * The classic failure of image models is text: "GRAND OPENING" comes back as "GRAND OPNING".
 * That is fatal for a marketing product and cannot be checked by looking at a status code, so this
 * generates one real image with mandated copy (brand name, headline, real phone number) through
 * the review gate and then inspects the pixels.
 *
 * Costs a few credits — deliberately, because this is the only way to know.
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
const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';

const ctx = await createAgentContext(admin, OWNER, { intentText: 'make a Diwali offer image' });
const tools = ctx.tools as any;

const IMAGE = {
  prompt:
    'A clean, premium 1:1 square social media offer card, 1080x1080. Deep navy background with a ' +
    'subtle gold radial glow. Large crisp white headline reading exactly "GRAND OPENING". Below it, ' +
    'a smaller gold line reading exactly "50% OFF THIS WEEK". At the bottom, small white text reading ' +
    'exactly "Call 98726 69935". Typography only, no photography, no people, generous margins, ' +
    'all words spelled correctly and perfectly legible.',
  aspectRatio: '1:1' as const,
};

console.log('▸ asking for the image (gated tool, so it will refuse first)…');
const blocked = await tools.generate_ai_image.execute(IMAGE);
console.log('   blocked:', blocked?.needs_review === true, '| actionId:', blocked?.actionId ?? '(none)');

const actionId = blocked?.actionId as string | undefined;
if (!actionId) {
  console.error('no approval card was recorded — cannot continue');
  process.exit(1);
}

// Approve exactly as the UI does.
const { error: approveError } = await admin
  .from('agent_events')
  .update({ status: 'approved', updated_at: new Date().toISOString() })
  .eq('user_id', OWNER)
  .eq('event_type', 'PENDING_ACTION_APPROVAL')
  .eq('payload->>actionId', actionId);
console.log('   approved:', !approveError, approveError?.message ?? '');

console.log('▸ generating…');
const started = Date.now();
const result = await tools.generate_ai_image.execute({ approvalId: actionId });
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const out = result ?? {};
console.log(`\nfinished in ${elapsed}s`);
console.log(JSON.stringify(out, null, 2).slice(0, 900));

const url =
  out.imageUrl || out.url || out.assetUrl || out?.result?.imageUrl || out?.result?.url || out?.artifact?.imageUrl || '';
if (!url) {
  console.log('\nNO IMAGE returned');
  process.exitCode = 1;
} else {
  console.log(`\nimage url: ${url}`);
  fs.writeFileSync('.tmp-image-url.txt', url);
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync('C:\\Users\\Adrolls\\Desktop\\nobo-e2e\\gen-image.png', buf);
  console.log(`downloaded ${(buf.length / 1024).toFixed(0)}KB — inspect nobo-e2e/gen-image.png`);
}
