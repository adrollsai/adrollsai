/**
 * LIVE ACCEPTANCE for the `image` skill — the only place in this package that
 * spends credits.
 *
 *   npm run proof:image-skill
 *
 * It calls the skill exactly as the app does (`createImage`), with nothing
 * faked except the two things that would touch a customer:
 *
 *   - `publish` writes the bytes to D:\nobo-images AND puts them on R2 under the
 *     skill's own key, so the key/URL path is exercised for real;
 *   - `record` reports `recorded: false` instead of UPDATE-ing `agent_runs` for a
 *     run row that does not exist.
 *
 * Everything else is the production path: `createKieImageTask` (kie.ai, real
 * credits), `queryKieTask`, the real download, and the prompt built by
 * `lib/agent/tools/skills/image/prompt.ts`.
 *
 * Ten images, four aspect ratios, four of them editing a supplied reference —
 * exactly the acceptance the package asks for. C: has ~2.5 GB free on this
 * machine, so the output lands on D:.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config(); // fall back to .env if .env.local is absent

const ROOT = process.env.NOBO_IMAGE_ROOT || 'D:\\nobo-images';

interface Job {
  id: string;
  label: string;
  aspectRatio: '3:4' | '1:1' | '9:16' | '16:9';
  brief: string;
  facts?: Record<string, unknown>;
  referenceUrls?: string[];
}

/** Public stock references (Unsplash) — no customer asset is used in this proof. */
const REF_VILLA = 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80';
const REF_INTERIOR = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80';
const REF_HOUSE = 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=80';

const JOBS: readonly Job[] = [
  {
    id: 'p1',
    label: '3:4 poster, no reference',
    aspectRatio: '3:4',
    brief:
      'Diwali launch poster for Green Meadows, a 3BHK apartment project: a warmly lit modern living room at dusk with diyas on the balcony ledge',
    facts: {
      project: 'Green Meadows',
      price: 'Starting ₹1.45 Cr',
      location: 'Sector 82, Mohali',
      offer: 'Diwali booking open',
    },
  },
  {
    id: 'p2',
    label: '3:4 poster, villa reference (edit)',
    aspectRatio: '3:4',
    brief:
      'Launch poster for this villa: keep the same white contemporary house with its lit pool at dusk, and set the launch headline in luxury serif type',
    facts: { project: 'The White House Villa', price: 'Starting ₹2.1 Cr', location: 'New Chandigarh' },
    referenceUrls: [REF_VILLA],
  },
  {
    id: 'p3',
    label: '3:4 typographic, no reference',
    aspectRatio: '3:4',
    brief:
      'A quiet, expensive typographic poster for an interior design studio called Atelier Nine, no photography, editorial type on deep green',
    facts: { studio: 'Atelier Nine', offer: 'Consultations open for December' },
  },
  {
    id: 'sq1',
    label: '1:1 square, no reference',
    aspectRatio: '1:1',
    brief:
      'Square social tile announcing weekend portrait sessions at a photography studio, warm editorial photograph of a studio corner with a softbox',
    facts: { studio: 'Studio Meraki', offer: 'Weekend portrait sessions', price: 'From ₹4,500' },
  },
  {
    id: 'sq2',
    label: '1:1 square, interior reference (edit)',
    aspectRatio: '1:1',
    brief:
      'Square tile for this living room: keep this exact room and furniture, add a headline about a monsoon offer on home interiors',
    facts: { brand: 'Casa Lumen', offer: 'Monsoon interiors offer', price: 'Up to 20% off' },
    referenceUrls: [REF_INTERIOR],
  },
  {
    id: 'v1',
    label: '9:16 story, no reference',
    aspectRatio: '9:16',
    brief:
      'Vertical story graphic for a gym called Iron Yard: a real training floor at dawn, headline about a 6-week strength programme',
    facts: { gym: 'Iron Yard', programme: '6-week strength programme', price: '₹6,999' },
  },
  {
    id: 'v2',
    label: '9:16 story, house reference (edit)',
    aspectRatio: '9:16',
    brief:
      'Vertical story for this house: keep this exact building and its landscaping, add a site-visit headline and the price',
    facts: { project: 'Regalia Estate', price: 'Starting ₹3.4 Cr', location: 'Aerocity, Mohali' },
    referenceUrls: [REF_HOUSE],
  },
  {
    id: 'v3',
    label: '9:16 story, villa reference (edit)',
    aspectRatio: '9:16',
    brief:
      'Vertical story for this villa: same house, same pool, evening light, with a short headline about an open house this Sunday',
    facts: { project: 'The White House Villa', event: 'Open house, Sunday 11am' },
    referenceUrls: [REF_VILLA],
  },
  {
    id: 'l1',
    label: '16:9 banner, no reference',
    aspectRatio: '16:9',
    brief:
      'Landscape link-ad banner for a coffee roastery called Ember Roast: a real espresso pour in a warm cafe, headline about a subscription',
    facts: { brand: 'Ember Roast', offer: 'Monthly coffee subscription', price: 'From ₹899/month' },
  },
  {
    id: 'l2',
    label: '16:9 banner, house reference (edit)',
    aspectRatio: '16:9',
    brief:
      'Landscape banner for this property: the same house and driveway, wide framing, with a headline about possession-ready homes',
    facts: { project: 'Regalia Estate', status: 'Possession ready', location: 'Aerocity, Mohali' },
    referenceUrls: [REF_HOUSE],
  },
];

/** Width/height straight from the file header — no image library involved. */
function dimensionsOf(bytes: Uint8Array): { width: number; height: number; format: string } {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20), format: 'png' };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        return { width, height, format: 'jpg' };
      }
      offset += 2 + length;
    }
  }
  return { width: 0, height: 0, format: 'unknown' };
}

interface Row {
  id: string;
  label: string;
  requested: string;
  providerRatio: string;
  model: string;
  route: string;
  width: number;
  height: number;
  bytes: number;
  file: string;
  r2Url: string | null;
  credits: number;
  seconds: number;
  taskId: string;
  /** The reference files this job edited, copied next to the output to compare. */
  referenceFiles: string[];
}

async function main() {
  const { createImage } = await import('../lib/agent/tools/skills/image/index');

  fs.mkdirSync(ROOT, { recursive: true });

  // `NOBO_IMAGE_JOBS=p1,v2` runs a subset — used for a one-image smoke test before
  // spending the full ten.
  const only = String(process.env.NOBO_IMAGE_JOBS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const JOBS_SELECTED = only.length > 0 ? JOBS.filter((job) => only.includes(job.id)) : JOBS;
  if (only.length > 0) console.log(`[proof] subset: ${JOBS_SELECTED.map((j) => j.id).join(', ')}`);

  const key = process.env.KIE_API_KEY;
  if (!key) throw new Error('KIE_API_KEY is not set — cannot run the live acceptance');
  if (!process.env.R2_ACCESS_KEY_ID) console.warn('[proof] R2 credentials missing: files will be saved to disk only');

  console.log(`[proof] ${JOBS_SELECTED.length} jobs, output -> ${ROOT}`);

  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { r2, R2_BUCKET, R2_PUBLIC_URL } = await import('@/utils/r2');

  const rows: Row[] = [];
  const failures: { id: string; reason: string }[] = [];

  /** Save a supplied reference next to the outputs so the two can be compared. */
  const saveReference = async (url: string, id: string): Promise<string> => {
    const file = path.join(ROOT, `ref-${id}.jpg`);
    if (fs.existsSync(file)) return file;
    const response = await fetch(url);
    if (!response.ok) return '';
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    return file;
  };

  let sequence = 0;
  const worker = async () => {
    for (;;) {
      const index = sequence++;
      if (index >= JOBS_SELECTED.length) return;
      const job = JOBS_SELECTED[index];
      const started = Date.now();

      const referenceFiles: string[] = [];
      for (const [i, url] of (job.referenceUrls ?? []).entries()) {
        const saved = await saveReference(url, `${job.id}-${i + 1}`);
        if (saved) referenceFiles.push(path.relative(ROOT, saved));
      }

      let savedExt = 'png';
      const deps = {
        affordable: async () => ({ ok: true }),
        pollTries: 48,
        pollMs: 5_000,
        publish: async (args: { key: string; bytes: Uint8Array; contentType: string }) => {
          savedExt = args.key.split('.').pop() || 'png';
          const file = path.join(ROOT, path.basename(args.key));
          fs.writeFileSync(file, Buffer.from(args.bytes));
          let url: string | null = null;
          try {
            await r2.send(
              new PutObjectCommand({
                Bucket: R2_BUCKET,
                Key: args.key,
                Body: Buffer.from(args.bytes),
                ContentType: args.contentType,
              }),
            );
            url = `${String(R2_PUBLIC_URL).replace(/\/+$/, '')}/${args.key}`;
          } catch (error: any) {
            console.warn(`[proof] ${job.id}: R2 put failed (${error?.message ?? error}) — file kept on disk`);
          }
          return { url: url ?? file, bytes: args.bytes.length };
        },
        record: async () => ({ recorded: false, reason: 'live proof does not write agent_runs' }),
      };

      try {
        const result = await createImage({
          runId: `image-proof-${job.id}`,
          userId: 'image-skill-proof',
          input: {
            brief: job.brief,
            facts: job.facts,
            referenceUrls: job.referenceUrls,
            aspectRatio: job.aspectRatio,
          },
          deps: deps as never,
          log: () => {},
        });

        const file = path.join(ROOT, path.basename(result.artefact.key));
        const bytes = fs.readFileSync(file);
        const size = dimensionsOf(new Uint8Array(bytes));

        rows.push({
          id: job.id,
          label: job.label,
          requested: job.aspectRatio,
          providerRatio: job.aspectRatio,
          model: result.plan.model,
          route: result.plan.route,
          width: size.width,
          height: size.height,
          bytes: bytes.length,
          file: path.relative(ROOT, file),
          r2Url: /^https?:/.test(result.artefact.url) ? result.artefact.url : null,
          credits: result.plan.credits,
          seconds: Math.round((Date.now() - started) / 100) / 10,
          taskId: result.taskId,
          referenceFiles,
        });
        console.log(
          `[proof] ${job.id} ok  ${size.width}x${size.height} ${(bytes.length / 1024).toFixed(0)}KB  ` +
            `${result.plan.route}  ${Math.round((Date.now() - started) / 100) / 10}s  -> ${path.basename(file)} (${savedExt})`,
        );
      } catch (error: any) {
        const reason = String(error?.message ?? error);
        failures.push({ id: job.id, reason });
        console.error(`[proof] ${job.id} FAILED: ${reason.slice(0, 200)}`);
      }
    }
  };

  // Three at a time: enough to finish in a few minutes, gentle on the provider.
  await Promise.all([worker(), worker(), worker()]);

  const report = {
    ranAt: new Date().toISOString(),
    outputRoot: ROOT,
    asked: JOBS_SELECTED.length,
    produced: rows.length,
    failed: failures,
    rows,
  };
  fs.writeFileSync(path.join(ROOT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== live acceptance ===');
  for (const row of rows) {
    console.log(
      `${row.id.padEnd(4)} ${row.requested.padEnd(5)} -> ${String(row.width).padStart(4)}x${String(row.height).padEnd(4)} ` +
        `${row.route.padEnd(9)} refs=${row.referenceFiles.length} ${row.seconds}s  ${row.file}`,
    );
  }
  const ratios = new Set(rows.map((r) => r.requested));
  const withRefs = rows.filter((r) => r.referenceFiles.length > 0);
  console.log(
    `\n${rows.length}/${JOBS_SELECTED.length} images produced across ${ratios.size} aspect ratio(s); ` +
      `${withRefs.length} with a reference image; ${failures.length} failure(s)`,
  );
  if (failures.length) console.log('failures:', JSON.stringify(failures, null, 2));
  if (rows.length !== JOBS_SELECTED.length || (only.length === 0 && ratios.size < 4) || (only.length === 0 && withRefs.length < 3)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[proof] fatal:', error?.message ?? error);
  process.exit(1);
});
