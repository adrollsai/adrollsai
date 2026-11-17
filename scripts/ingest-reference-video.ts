/**
 * Ingest one video into the reference bank.
 *
 * Measures the file (probe + cut detection + loudness), builds a small proxy and a contact
 * sheet, uploads both to R2 so the agent can actually look at them, and writes a bank entry
 * with the measurements attached. One command per reference:
 *
 *   npx esbuild scripts/ingest-reference-video.ts --bundle --platform=node \
 *     --format=esm --packages=external --outfile=.tmp-ingest.mjs
 *
 *   node .tmp-ingest.mjs --file "<path>" --slug homcom-mohali --industry "real estate" \
 *     --summary "16 bold text beats over stills, dissolves, end card with phone"
 */
import '../lib/env-local';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'fs';
import path from 'path';
import os from 'os';
import { uploadBufferToR2 } from '../lib/agent/sandbox';

const run = promisify(exec);
const args = process.argv.slice(2);
const arg = (k: string, fallback = '') => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const FILE = arg('file');
const SLUG = arg('slug');
if (!FILE || !SLUG) {
  console.error('usage: --file "<video>" --slug <slug> [--industry X] [--summary "..."] [--goal Y] [--title "..."]');
  process.exit(1);
}
if (!existsSync(FILE)) {
  console.error(`missing file: ${FILE}`);
  process.exit(1);
}

const OUT = path.join('references', 'videos');
mkdirSync(OUT, { recursive: true });

const tmpProxy = path.join(os.tmpdir(), `refproxy_${Date.now()}.mp4`);
const tmpSheet = path.join(os.tmpdir(), `refsheet_${Date.now()}.png`);

console.log(`probing ${path.basename(FILE)} (${(statSync(FILE).size / 1048576).toFixed(1)} MB)`);

// --- probe ---
const { stdout: probeOut } = await run(`ffprobe -v error -print_format json -show_format -show_streams "${FILE}"`, { maxBuffer: 8 << 20 });
const probe = JSON.parse(probeOut);
const v = (probe.streams || []).find((s: any) => s.codec_type === 'video') || {};
const a = (probe.streams || []).find((s: any) => s.codec_type === 'audio') || {};
const duration = Number(probe.format?.duration || v.duration || 0);
const fps = (() => {
  const r = String(v.r_frame_rate || '30/1').split('/');
  return Number(r[1]) ? Number(r[0]) / Number(r[1]) : Number(r[0]) || 30;
})();

// --- loudness (best effort) ---
let loudness: { meanDb: number | null; maxDb: number | null } = { meanDb: null, maxDb: null };
try {
  const { stderr } = await run(`ffmpeg -hide_banner -nostats -i "${FILE}" -af volumedetect -f null ${os.platform() === 'win32' ? 'NUL' : '/dev/null'}`, { maxBuffer: 8 << 20 }).catch((e: any) => e);
  const text = String(stderr || '');
  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(text);
  const max = /max_volume:\s*(-?[\d.]+) dB/.exec(text);
  loudness = { meanDb: mean ? Number(mean[1]) : null, maxDb: max ? Number(max[1]) : null };
} catch {}

// --- cuts (free, no account needed) ---
let shots: { start: number; end: number; seconds: number }[] = [{ start: 0, end: duration, seconds: duration }];
let cutCount = 0;
try {
  const { stdout: cutsOut } = await run(`npx --yes hyperframes measure cuts "${FILE}"`, { timeout: 600000, maxBuffer: 16 << 20 });
  const parsed = JSON.parse(cutsOut.slice(cutsOut.indexOf('{')));
  if (parsed.ok) {
    shots = parsed.shots || shots;
    cutCount = (parsed.cuts || []).length;
  }
} catch (e: any) {
  console.warn(`cut detection failed, falling back to a single shot: ${e?.message}`);
}

const shotSeconds = shots.map((s) => Number(s.seconds.toFixed(2)));

// --- proxy (the bank never needs the 177MB original) ---
console.log('building 720p proxy...');
await run(`ffmpeg -y -loglevel error -i "${FILE}" -vf "scale=720:-2" -c:v libx264 -crf 26 -preset veryfast -movflags +faststart -c:a aac -b:a 96k "${tmpProxy}"`, { maxBuffer: 8 << 20 });

// --- contact sheet: 16 frames across the whole film ---
console.log('building contact sheet...');
const everySec = Math.max(1, duration / 16);
await run(`ffmpeg -y -loglevel error -i "${FILE}" -vf "fps=1/${everySec.toFixed(3)},scale=270:-2,tile=4x4" -frames:v 1 "${tmpSheet}"`, { maxBuffer: 8 << 20 });

console.log('uploading to the CDN...');
const proxyUrl = await uploadBufferToR2(readFileSync(tmpProxy), `ref-${SLUG}.mp4`, 'references');
const sheetUrl = await uploadBufferToR2(readFileSync(tmpSheet), `ref-${SLUG}-sheet.png`, 'references');

const entry = {
  id: SLUG,
  kind: 'video' as const,
  title: arg('title', path.basename(FILE)),
  industry: arg('industry', ''),
  goal: arg('goal', ''),
  summary: arg('summary', ''),
  measured: {
    durationSec: Number(duration.toFixed(3)),
    width: Number(v.width || 0),
    height: Number(v.height || 0),
    aspect: v.width && v.height ? `${v.width}x${v.height}` : '',
    orientation: v.width && v.height ? (v.height > v.width ? 'vertical' : v.width > v.height ? 'horizontal' : 'square') : '',
    fps: Number(fps.toFixed(3)),
    bitrateMbps: probe.format?.bit_rate ? Number((Number(probe.format.bit_rate) / 1e6).toFixed(2)) : null,
    originalBytes: statSync(FILE).size,
    videoCodec: v.codec_name || '',
    audioCodec: a.codec_name || '',
    audioChannels: a.channels ?? null,
    audioSampleRate: a.sample_rate ? Number(a.sample_rate) : null,
    loudness,
    cutCount,
    shots: shotSeconds,
    avgShotSec: shotSeconds.length ? Number((shotSeconds.reduce((s, x) => s + x, 0) / shotSeconds.length).toFixed(2)) : null,
  },
  assets: { proxyUrl, sheetUrl },
  source: { localPath: FILE, ingestedAt: new Date().toISOString() },
};

// Single source of truth: references/index.json, statically imported by the loader so it is
// always bundled into the deployment. Re-ingesting the same slug replaces that entry.
const INDEX_PATH = path.join('references', 'index.json');
const index = existsSync(INDEX_PATH)
  ? JSON.parse(readFileSync(INDEX_PATH, 'utf8'))
  : { videos: [], images: [], pages: [] };
index.videos = [...(index.videos || []).filter((r: any) => r.id !== SLUG), entry];
index.updatedAt = new Date().toISOString();
writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);

for (const f of [tmpProxy, tmpSheet]) {
  try { if (existsSync(f)) unlinkSync(f); } catch {}
}

console.log(`\nwrote ${INDEX_PATH} (${index.videos.length} video refs)`);
console.log(`  ${entry.measured.aspect} ${entry.measured.orientation}, ${entry.measured.durationSec}s, ${entry.measured.fps}fps, ${entry.measured.bitrateMbps} Mbps`);
console.log(`  ${cutCount} hard cuts -> ${shotSeconds.length} shot(s): ${shotSeconds.join(', ')}`);
console.log(`  proxy  ${proxyUrl}`);
console.log(`  sheet  ${sheetUrl}`);
