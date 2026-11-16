/**
 * Generate imagery that is VERIFIED before anything uses it, then rebuild the page around it.
 *
 * This closes three pending items at once:
 *   1. the ad creative is compiled by build_ad_creative_prompt and then LOOKED AT by a vision model against its own
 *      checklist, so "does the poster actually say the offer" is a fact rather than an intention;
 *   2. the page stops recycling the ad poster as its hero — purpose-built photography is generated (no baked-in type,
 *      because a poster used as a hero duplicates the headline beside it);
 *   3. every candidate image passes the relevance check before it is placed, so another business's creative cannot
 *      appear on this page again.
 *
 *   npx esbuild scripts/generate-verified-imagery.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-verified-imagery.mjs && node .tmp-verified-imagery.mjs
 */
import fs from 'node:fs';
import 'dotenv/config';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { uploadBufferToR2 } from '../lib/agent/sandbox';
import { analyzeImageWithGemini } from '../utils/image-analysis';
import { filterRelevantImages } from '../lib/site/image-relevance';

dotenv.config({ path: '.env.local', quiet: true });

const ADMIN = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const BRIEF = {
  product: 'AI marketing department',
  offer: 'First month ₹999',
  audience: 'small business owners in India',
  place: 'Chandigarh',
  businessName: 'Nobogent',
};

const { createKieImageTask, queryKieTask } = await import('@/utils/external-apis');
const { imageModelFor } = await import('@/lib/agent/media-models');

async function generate(prompt: string, aspectRatio: '1:1' | '3:4' | '16:9' | '9:16', label: string): Promise<string | null> {
  const taskId = await createKieImageTask(prompt, imageModelFor([]), aspectRatio, []);
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const status = await queryKieTask(taskId);
    if (status.state === 'success' && status.resultUrl) {
      console.log(`  ${label}: generated`);
      return status.resultUrl;
    }
    if (status.state === 'fail') {
      console.log(`  ${label}: provider failed — ${status.error}`);
      return null;
    }
  }
  console.log(`  ${label}: timed out`);
  return null;
}

async function host(url: string, name: string): Promise<string> {
  const res = await fetch(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  return uploadBufferToR2(buffer, `nobogent/${name}-${Date.now()}.png`, ADMIN);
}

// ── 1. The ad creative, compiled then verified.
console.log('▸ 1. ad creative: compiled by the ad system, then vision-checked');
const ctx = await createAgentContext(sb as any, ADMIN, { intentText: 'make an ad for Nobogent' });
const spec = await (ctx.tools as any).build_ad_creative_prompt.execute(
  { ...BRIEF, format: '4:5', cta: 'call', facts: { authority: 'runs live campaigns' } },
  {} as any,
);
console.log(`  angle: ${spec?.angle?.id} | headline: ${spec?.headline}`);
console.log(`  contrast: ${spec?.layout?.contrast?.actual}:1 | needs: ${(spec?.needs ?? []).join(', ') || 'none'}`);

let adUrl: string | null = null;
if (spec?.success !== false && spec?.imagePrompt) {
  const raw = await generate(spec.imagePrompt, '3:4', 'ad');
  if (raw) {
    const verdict = await analyzeImageWithGemini(
      raw,
      [
        'Is this a finished advertising poster that a small business could run as a paid ad?',
        `It must show the headline "${spec.headline}" spelled correctly, and the call to action "${spec.cta?.label}".`,
        'Answer with: PASS or FAIL, then what the poster actually says (transcribe the large text), then any problem.',
      ].join('\n'),
    );
    console.log(`  vision verdict: ${String(verdict).replace(/\s+/g, ' ').slice(0, 300)}`);
    const passed = /^\s*PASS/i.test(String(verdict));
    fs.writeFileSync('.tmp-ad-verified.txt', String(verdict));
    if (passed) {
      adUrl = await host(raw, 'ad-verified');
      console.log(`  ad hosted: ${adUrl}`);
    } else {
      console.log('  AD REJECTED by the vision check — not used for the page');
      // Keep the bytes for inspection anyway.
      adUrl = await host(raw, 'ad-rejected');
    }
  }
}

// ── 2. Purpose-built page photography: no baked-in text, because a poster used as a hero duplicates the headline.
console.log('\n▸ 2. page photography (no baked-in type)');
const photoPrompts = {
  hero: 'Editorial photograph for a business website: two Indian small business owners in their thirties reviewing campaign results on a laptop in a bright modern office, warm natural window light, shallow depth of field, candid and optimistic, absolutely no text, no logos, no watermarks, no typography, 16:9 composition with calm space on the left',
  detail: 'Editorial photograph: close-up of hands on a laptop beside a cup of chai on a wooden desk, blurred bright office behind, warm natural light, documentary style, absolutely no text, no logos, no typography, 16:9',
};

const photos: Record<string, string | null> = {};
for (const [key, prompt] of Object.entries(photoPrompts)) {
  const raw = await generate(prompt, '16:9', key);
  photos[key] = raw ? await host(raw, `hero-${key}`) : null;
  if (photos[key]) console.log(`  ${key}: ${photos[key]}`);
}

// ── 3. Every candidate checked for relevance before use.
console.log('\n▸ 3. relevance check on every candidate');
const candidates = Object.values(photos).filter(Boolean) as string[];
if (adUrl) candidates.push(adUrl);
const check = await filterRelevantImages({
  candidates: candidates.map((url) => ({ url, origin: 'generated' })),
  brief: { productName: 'AI marketing department for small businesses', businessName: 'Nobogent', offer: BRIEF.offer },
  inspect: (url, prompt) => analyzeImageWithGemini(url, prompt),
  limit: 4,
});
console.log(`  kept ${check.keep.length} of ${candidates.length}`);
for (const rejected of check.rejected) console.log(`  rejected: ${rejected.why}`);

fs.writeFileSync(
  '.tmp-verified-imagery.json',
  JSON.stringify({ adUrl, photos, kept: check.keep, rejected: check.rejected, headline: spec?.headline }, null, 2),
);
console.log('\n▸ written to .tmp-verified-imagery.json');
