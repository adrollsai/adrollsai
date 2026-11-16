/**
 * Does the compiled prompt actually make a good ad?
 *
 * The gate proves the compiler's output is internally correct. That is not the same as the picture being any
 * good, so this takes one real brief through the real tool and generates the real image, then saves it locally
 * so it can be LOOKED AT. A prompt that reads well and renders rubbish is the exact failure mode this is for.
 *
 *   npx esbuild scripts/proof-ad-default.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-proof-ad.mjs && node .tmp-proof-ad.mjs
 *
 * Costs one image generation.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

dotenv.config({ path: '.env.local', quiet: true });

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c'; // Procolor Film Academy

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const ctx = await createAgentContext(sb as any, ORG, {
  intentText: 'make an ad for the cinematography diploma, no reference supplied',
});
const tools = ctx.tools as any;

const spec = await tools.build_ad_creative_prompt.execute(
  {
    product: 'Diploma in Cinematography',
    offer: '₹15,000 off the November batch',
    audience: 'school leavers who want to work on film sets',
    place: 'Chandigarh',
    format: '4:5',
    cta: 'call',
    facts: { authority: 'faculty who shoot commercials' },
  },
  {} as any,
);

console.log('angle      :', spec?.angle?.id, '—', spec?.angle?.whyChosen);
console.log('headline   :', spec?.headline);
console.log('subhead    :', spec?.subhead);
console.log('cta        :', spec?.cta?.label);
console.log('needs      :', (spec?.needs || []).join(', ') || 'none');
console.log('\n--- the compiled prompt ---\n' + spec?.imagePrompt + '\n');

if (!spec?.success) {
  console.log('FAILED to compile:', spec?.error);
  process.exit(1);
}

// 4:5 is the feed unit, and the image model's nearest supported ratio is 3:4.
//
// This calls the image provider directly rather than through `generate_ai_image`, because that tool sits behind
// the review gate on purpose (an image costs credits and the owner approves it). A proof script is the owner
// spending their own credits deliberately, so it does not need the gate — the agent still does.
const { createKieImageTask, queryKieTask } = await import('@/utils/external-apis');
const { imageModelFor } = await import('@/lib/agent/media-models');

const taskId = await createKieImageTask(spec.imagePrompt, imageModelFor([]), '3:4', []);
console.log('\ngenerate -> task', taskId);

let url: string | null = null;
for (let i = 0; i < 40 && !url; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const status = await queryKieTask(taskId);
  if (status.state === 'success' && status.resultUrl) url = status.resultUrl;
  else if (status.state === 'fail') {
    console.log('provider failed:', status.error);
    break;
  }
  console.log(`  poll ${i + 1}: ${status.state}`);
}

if (!url) {
  console.log('No image URL came back for task', taskId);
  process.exit(1);
}

const res = await fetch(url);
const buffer = Buffer.from(await res.arrayBuffer());
const out = '.tmp-ad-proof.jpg';
fs.writeFileSync(out, buffer);
console.log(`\nsaved ${out} (${(buffer.length / 1024).toFixed(0)} KB) from ${url}`);
console.log(`checklist:\n - ${(spec.checklist || []).join('\n - ')}`);
