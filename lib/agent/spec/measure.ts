/**
 * Measure a reference instead of trusting a model's description of it.
 *
 * Borrowed discipline from the HyperFrames `reverse-any-video` skill, which gets
 * two things right that our compile did not:
 *
 *  1. Cuts are MEASURED, not inferred. Asking a video model for a beat map gives
 *     plausible timings; measuring gives real ones. That matters because a spec's
 *     whole value is its timing, and the skill notes ffmpeg's plain scene score
 *     misses jump cuts and punch-ins inside a single take.
 *  2. Verification is NUMERIC. Our only feedback was a Gemini A/B, which scored
 *     the last build 5.3/10 and got the central occlusion claim flatly wrong.
 *     A diff that names missing cuts, extra cuts and sound offset cannot be wrong
 *     in that way.
 *
 * Both are implemented here against ffmpeg so they run anywhere we already run.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const MAX_BYTES = 400 * 1024 * 1024;

export interface CutPoint {
  /** Frame index at the source rate. */
  frame: number;
  /** Seconds, floored to the frame like the skill insists (2.767 lands a frame late). */
  time: number;
  score: number;
}

export interface Measurement {
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  frameCount: number;
  cuts: CutPoint[];
  /** Shot boundaries including the implicit start at 0. */
  shots: { start: number; end: number; frames: number }[];
  source: string;
}

function parseRate(r: string): number {
  if (!r) return 24;
  const [a, b] = r.split('/').map(Number);
  if (b) return a / b;
  return Number(r) || 24;
}

/** Download a URL to a temp file; local paths pass through untouched. */
async function materialise(source: string): Promise<{ file: string; cleanup: () => Promise<void> }> {
  if (!/^https?:\/\//i.test(source)) {
    return { file: source, cleanup: async () => {} };
  }
  const res = await fetch(source, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NobogentHarness/1.0)', Accept: 'video/*,*/*' },
  });
  if (!res.ok) throw new Error(`Could not download reference (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('Downloaded reference is empty');
  if (buf.length > MAX_BYTES) throw new Error(`Reference is ${(buf.length / 1024 / 1024).toFixed(0)} MB, too large to measure`);
  const file = path.join(os.tmpdir(), `nobo_measure_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`);
  await fs.writeFile(file, buf);
  return { file, cleanup: async () => { try { await fs.unlink(file); } catch {} } };
}

async function probe(file: string) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_frames,duration',
    '-show_entries', 'format=duration',
    '-of', 'json',
    file,
  ]);
  const j = JSON.parse(stdout || '{}');
  const st = j.streams?.[0] || {};
  const fps = parseRate(String(st.r_frame_rate || '24'));
  const durationSec = Number(st.duration) || Number(j.format?.duration) || 0;
  return {
    fps,
    width: Number(st.width) || 0,
    height: Number(st.height) || 0,
    durationSec,
    frameCount: Number(st.nb_frames) || Math.round(durationSec * fps),
  };
}

/**
 * Detect cuts with scdet, which reports a score per candidate change rather than a
 * binary scene flag, so we can keep near-cuts (a punch-in is a small score, a hard
 * cut a large one) and let the caller decide.
 */
async function detectCuts(file: string, threshold: number, fps: number): Promise<CutPoint[]> {
  let stderr = '';
  try {
    // scdet writes its findings to stderr as lavfi.scd.* key/values.
    const out = await run('ffmpeg', [
      '-v', 'info',
      '-i', file,
      '-vf', `scdet=threshold=${threshold}`,
      '-an',
      '-f', 'null', '-',
    ], { maxBuffer: 32 * 1024 * 1024 });
    stderr = String(out.stderr || '');
  } catch (err: any) {
    stderr = String(err?.stderr || '');
    if (!stderr.includes('lavfi.scd')) throw new Error(`cut detection failed: ${err?.message || err}`);
  }

  const cuts: CutPoint[] = [];
  // scdet prints "lavfi.scd.score: 12.752, lavfi.scd.time: 2.602603" (colons and a
  // comma); other ffmpeg builds use "=". Accept both so this is not brittle.
  const lineRe = /lavfi\.scd\.score[:=]\s*([0-9.]+)[,;\s]+lavfi\.scd\.time[:=]\s*([0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(stderr))) {
    const score = Number(m[1]);
    const time = Number(m[2]);
    if (!Number.isFinite(time) || time <= 0.05) continue; // ignore the file's own start
    cuts.push({ frame: Math.floor(time * fps), time: Math.floor(time * fps) / fps, score });
  }

  // Collapse cuts that belong to one transition. A hard flash or a dissolve fires
  // scdet two or three frames running, which would otherwise produce 3-frame
  // shots that no editor would call a shot.
  const merged: CutPoint[] = [];
  for (const c of cuts.sort((a, b) => a.time - b.time)) {
    const last = merged[merged.length - 1];
    if (last && c.time - last.time < 0.15) {
      if (c.score > last.score) merged[merged.length - 1] = c;
      continue;
    }
    merged.push(c);
  }
  return merged;
}

/** Full measurement of a reference: geometry, rate, cuts and the resulting shots. */
export async function measureReference(source: string, opts: { threshold?: number } = {}): Promise<Measurement> {
  const { file, cleanup } = await materialise(source);
  try {
    const meta = await probe(file);
    const cuts = await detectCuts(file, opts.threshold ?? 10, meta.fps);
    const bounds = [0, ...cuts.map((c) => c.time), meta.durationSec];
    const shots: Measurement['shots'] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const start = bounds[i];
      const end = bounds[i + 1];
      const frames = Math.max(0, Math.round((end - start) * meta.fps));
      if (end - start < 0.08) continue; // sub-2-frame flicker is not a shot
      shots.push({ start: Number(start.toFixed(3)), end: Number(end.toFixed(3)), frames });
    }
    return { ...meta, cuts, shots, source };
  } finally {
    await cleanup();
  }
}

export interface SpecDiff {
  durationDelta: number;
  missingCuts: number;
  extraCuts: number;
  missing: { at: number; reason: string }[];
  extra: { at: number; reason: string }[];
  matchedCuts: number;
  verdict: 'match' | 'close' | 'off';
  summary: string;
}

/**
 * Numeric diff between a compiled spec and the measured reference.
 *
 * This is the check that would have caught the earlier failures objectively: a
 * cut we invented, a shot we skipped, or a timeline that drifted.
 */
export function diffSpec(
  segments: { start: number; end: number }[],
  measured: Measurement,
  toleranceSec = 0.10
): SpecDiff {
  const specCuts = segments.slice(1).map((s) => s.start).sort((a, b) => a - b);
  const refCuts = measured.shots.slice(1).map((s) => s.start).sort((a, b) => a - b);

  const missing: SpecDiff['missing'] = [];
  const extra: SpecDiff['extra'] = [];
  const usedSpec = new Set<number>();

  for (const r of refCuts) {
    let best = -1;
    let bestD = Infinity;
    specCuts.forEach((s, i) => {
      if (usedSpec.has(i)) return;
      const d = Math.abs(s - r);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0 && bestD <= toleranceSec) {
      usedSpec.add(best);
    } else {
      missing.push({ at: r, reason: `reference cuts at ${r.toFixed(2)}s but the spec has no cut within ${toleranceSec}s` });
    }
  }
  specCuts.forEach((s, i) => {
    if (!usedSpec.has(i)) {
      extra.push({ at: s, reason: `spec cuts at ${s.toFixed(2)}s where the reference does not` });
    }
  });

  const specEnd = segments.length ? segments[segments.length - 1].end : 0;
  const durationDelta = Number((specEnd - measured.durationSec).toFixed(3));
  const matchedCuts = refCuts.length - missing.length;

  const ratio = refCuts.length ? matchedCuts / refCuts.length : 1;
  const verdict: SpecDiff['verdict'] =
    missing.length === 0 && extra.length === 0 && Math.abs(durationDelta) < 0.15
      ? 'match'
      : ratio >= 0.7 && Math.abs(durationDelta) < 0.6
        ? 'close'
        : 'off';

  return {
    durationDelta,
    missingCuts: missing.length,
    extraCuts: extra.length,
    missing,
    extra,
    matchedCuts,
    verdict,
    summary:
      `${matchedCuts}/${refCuts.length} reference cuts matched, ${extra.length} invented, ` +
      `duration ${durationDelta >= 0 ? '+' : ''}${durationDelta}s -> ${verdict}`,
  };
}
