/**
 * Ingest image references into the bank.
 *
 * Point it at a business whose creatives you want the agent to learn from: it takes that
 * business's own images, has the vision model describe each one structurally, and banks the
 * description plus the image URL. The agent then picks one and rebuilds it for whichever
 * business it is working on — the description is what makes picking cheap.
 *
 *   npm run ingest:image-ref -- --tenant <uuid> --count 6 --industry "real estate"
 *
 * Descriptions are structural on purpose: layout, where the copy sits, framing, light, mood.
 * No brand names, no claims — a reference must never carry a third party's identity forward.
 */
import '../lib/env-local';
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { analyzeImageWithGemini } from '../utils/image-analysis';

const args = process.argv.slice(2);
const arg = (k: string, fallback = '') => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const TENANT = arg('tenant');
const COUNT = Number(arg('count', '6'));
const INDUSTRY = arg('industry', '');
if (!TENANT) {
  console.error('usage: --tenant <uuid> [--count 6] [--industry "real estate"]');
  process.exit(1);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const INDEX_PATH = path.join('references', 'index.json');
const index = existsSync(INDEX_PATH)
  ? JSON.parse(readFileSync(INDEX_PATH, 'utf8'))
  : { videos: [], images: [], pages: [] };
index.images = index.images || [];

const { data, error } = await sb
  .from('assets')
  .select('id, url, type, status, created_at')
  .eq('user_id', TENANT)
  .eq('type', 'image')
  .neq('status', 'Distributed')
  .order('created_at', { ascending: false })
  .limit(60);

if (error) {
  console.error(error.message);
  process.exit(1);
}

const prompt = [
  'Describe this creative as a layout recipe for a designer who must rebuild it for a different business.',
  'Cover, in under 120 words and as plain sentences: the aspect and crop, what the main subject is and where it sits,',
  'where the text sits and how it is weighted, the colour and lighting, and the overall mood.',
  'Do not name any brand, product, person, price, phone number or slogan you can read. Describe only structure.',
].join(' ');

let added = 0;
for (const row of data ?? []) {
  if (added >= COUNT) break;
  if (!row.url || !/^https:\/\//i.test(row.url)) continue;
  const id = `img-${String(row.id).slice(0, 8)}`;
  if (index.images.some((r: any) => r.id === id)) continue;

  try {
    const description = (await analyzeImageWithGemini(String(row.url), prompt)).trim();
    if (!description || /VISION UNAVAILABLE/i.test(description)) {
      console.log(`SKIP ${id} — no usable description`);
      continue;
    }
    index.images.push({
      id,
      kind: 'image',
      title: `Reference ${added + 1} (${INDUSTRY || 'unclassified'})`,
      industry: INDUSTRY,
      summary: description.replace(/\s+/g, ' ').slice(0, 600),
      assets: { url: String(row.url) },
      source: { tenantId: TENANT, assetId: row.id, ingestedAt: new Date().toISOString() },
    });
    added++;
    console.log(`ok ${id} — ${description.replace(/\s+/g, ' ').slice(0, 110)}...`);
  } catch (e: any) {
    console.log(`FAIL ${id} — ${e?.message}`);
  }
}

index.updatedAt = new Date().toISOString();
writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
console.log(`\nbanked ${added} image reference(s); bank now has ${index.images.length} image refs, ${index.videos.length} video refs`);
