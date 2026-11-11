/**
 * Render a spec inside an E2B sandbox instead of on the caller's machine.
 *
 * Local rendering worked but was bound to one machine's cores. The sandbox gives
 * a clean Linux box with ffmpeg, more vCPUs than a laptop, and — importantly — the
 * same environment the app already uses for media work, so this is not a new
 * dependency, just a new caller.
 *
 * The properties that make it usable rather than a demo:
 *
 *  - **Idempotent provisioning.** Toolchain and the 168 MB segmentation model are
 *    installed once per sandbox and marked with a version file. Warming a cold
 *    sandbox is the expensive part, so it must never happen twice for the same box.
 *  - **Content-addressed assets.** Files are downloaded inside the sandbox under a
 *    hash of their URL and skipped when already present, so re-rendering a revised
 *    spec does not re-transfer footage.
 *  - **Validation before transfer.** The output is probed *in* the sandbox for
 *    duration, frame count and size. A broken render fails there, cheaply, instead
 *    of after a download.
 *  - **No idle-pause mid-render.** A long render looks like an idle sandbox to the
 *    pause-on-idle timer; the busy counter is held for the whole run.
 *  - **Metered.** Sandbox seconds are recorded against the caller, so render cost
 *    shows up on the ledger like every other vendor.
 */
import crypto from 'node:crypto';
import {
  getOrCreateSandbox,
  beginSandboxCommand,
  endSandboxCommand,
  uploadBufferToR2,
} from '@/lib/agent/sandbox';
import { SANDBOX_INR_PER_SECOND } from '@/lib/agent/pricing';
import { recordSpend } from '@/lib/agent/spend';
import type { Spec } from './schema';

const ROOT = '.nobo-render';
const TOOLCHAIN_VERSION = 'v1';
const MODEL_URL =
  'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx';
const MODEL_MIN_BYTES = 100_000_000; // a truncated download must not be reused
const FONT_URL =
  'https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf';
const MAX_OUTPUT_BYTES = 400 * 1024 * 1024;

export interface AssetRef {
  /** Publicly reachable URL the sandbox can curl. */
  url: string;
  /** Optional stable name; defaults to a hash of the URL. */
  name?: string;
}

export interface CloudRenderInput {
  spec: Spec;
  /** The renderer source. Passed in so this module stays importable from a route
   *  (where reading the repo from disk is not reliable) as well as from a CLI. */
  rendererSource: string;
  userId: string;
  stills?: AssetRef[];
  clips?: AssetRef[];
  presenter?: AssetRef;
  music?: AssetRef;
  /** Defaults to the sandbox's vCPU count, capped by shot count. */
  workers?: number;
  timeoutMs?: number;
  /** Endpoint the sandbox uses for outbound downloads (R2 public base). */
  onEvent?: (msg: string) => void;
}

export interface CloudRenderResult {
  url: string;
  bytes: number;
  durationSec: number;
  frames: number;
  width: number;
  height: number;
  workers: number;
  sandboxSeconds: number;
  costInr: number;
  /** Full sandbox log, useful when something fails. */
  log: string;
}

function shq(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function hashName(url: string, fallbackExt = 'bin'): string {
  const h = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
  const clean = url.split('?')[0].split('#')[0];
  const m = clean.match(/\.([a-z0-9]{2,5})$/i);
  return `${h}.${(m?.[1] || fallbackExt).toLowerCase()}`;
}

/** Run a command in the sandbox, returning stdout/stderr and the exit code. */
async function runIn(
  sandbox: any,
  command: string,
  timeoutMs = 300_000
): Promise<{ code: number; stdout: string; stderr: string }> {
  const res = await sandbox.commands.run(command, { timeoutMs });
  return {
    code: typeof res?.exitCode === 'number' ? res.exitCode : 0,
    stdout: String(res?.stdout || ''),
    stderr: String(res?.stderr || ''),
  };
}

/** The one-time (per sandbox) setup: deps, model, tools. Idempotent by marker. */
async function provision(sandbox: any, log: (s: string) => void): Promise<number> {
  const script = `
set -u
ROOT="$HOME/${ROOT}"
mkdir -p "$ROOT/assets/stills" "$ROOT/assets/clips" "$ROOT/scripts"
MARK="$ROOT/.toolchain"
WANT="${TOOLCHAIN_VERSION}"

if [ "$(cat "$MARK" 2>/dev/null)" != "$WANT" ]; then
  echo "[provision] installing python deps"
  (python3 -m pip install --quiet --no-cache-dir numpy pillow onnxruntime 2>&1 | tail -3) || {
    echo "[provision] pip failed"; exit 11; }
  echo "$WANT" > "$MARK"
else
  echo "[provision] python deps cached"
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[provision] installing ffmpeg"
  (apt-get update -qq && apt-get install -y -qq ffmpeg) >/dev/null 2>&1 || { echo "[provision] ffmpeg failed"; exit 12; }
fi

M="$ROOT/u2net_human_seg.onnx"
SIZE=$(stat -c %s "$M" 2>/dev/null || echo 0)
if [ "$SIZE" -lt ${MODEL_MIN_BYTES} ]; then
  echo "[provision] fetching matte model (this is the slow one)"
  curl -fsSL --retry 3 --retry-delay 2 -o "$M.part" "${MODEL_URL}" && mv "$M.part" "$M" || {
    echo "[provision] model download failed"; exit 13; }
else
  echo "[provision] matte model cached"
fi

F="$ROOT/Montserrat.ttf"
if [ "$(stat -c %s "$F" 2>/dev/null || echo 0)" -lt 50000 ]; then
  echo "[provision] fetching display font"
  curl -fsSL --retry 3 -o "$F.part" "${FONT_URL}" && mv "$F.part" "$F" || echo "[provision] font fetch failed (will fall back to a system face)"
else
  echo "[provision] font cached"
fi

echo "[provision] vcpus=$(nproc)"
nproc
`;
  const res = await runIn(sandbox, script, 900_000);
  log(res.stdout.trim());
  if (res.code !== 0) {
    throw new Error(`Sandbox provisioning failed (exit ${res.code}): ${(res.stderr || res.stdout).slice(-800)}`);
  }
  const last = res.stdout.trim().split('\n').pop() || '';
  const vcpus = Number(last);
  return Number.isFinite(vcpus) && vcpus > 0 ? vcpus : 2;
}

/** Download assets into the sandbox, skipping any already present by hash. */
async function fetchAssets(
  sandbox: any,
  group: 'stills' | 'clips',
  refs: AssetRef[],
  log: (s: string) => void
): Promise<string[]> {
  if (!refs.length) return [];
  const names = refs.map((r) => r.name || hashName(r.url));
  const pairs = refs.map((r, i) => ({ url: r.url, name: names[i] }));
  const script = `
set -u
ROOT="$HOME/${ROOT}/assets/${group}"
mkdir -p "$ROOT"
${pairs
  .map(
    (p) => `F="$ROOT/${p.name}"
if [ -s "$F" ]; then echo "cached ${p.name}"; else
  curl -fsSL --retry 3 --retry-delay 2 -o "$F.part" ${shq(p.url)} && mv "$F.part" "$F" && echo "fetched ${p.name}" || { echo "FAILED ${p.name}"; exit 21; }
fi`
  )
  .join('\n')}
ls -1 "$ROOT"
`;
  const res = await runIn(sandbox, script, 600_000);
  if (res.code !== 0) {
    throw new Error(`Could not fetch ${group} into the sandbox: ${(res.stderr || res.stdout).slice(-600)}`);
  }
  log(res.stdout.trim());
  return names;
}

async function fetchOne(sandbox: any, ref: AssetRef, asName: string, log: (s: string) => void) {
  const script = `
set -u
ROOT="$HOME/${ROOT}/assets"
mkdir -p "$ROOT"
F="$ROOT/${asName}"
if [ -s "$F" ]; then echo "cached ${asName}"; else
  curl -fsSL --retry 3 --retry-delay 2 -o "$F.part" ${shq(ref.url)} && mv "$F.part" "$F" && echo "fetched ${asName}" || { echo "FAILED ${asName}"; exit 22; }
fi
`;
  const res = await runIn(sandbox, script, 600_000);
  log(res.stdout.trim());
  if (res.code !== 0) throw new Error(`Could not fetch ${asName}: ${(res.stderr || res.stdout).slice(-400)}`);
}

/**
 * Render the spec in a sandbox and return a public URL.
 */
export async function renderSpecInSandbox(input: CloudRenderInput): Promise<CloudRenderResult> {
  const { userId, spec } = input;
  const emitted: string[] = [];
  const log = (s: string) => {
    if (!s) return;
    emitted.push(s);
    input.onEvent?.(s);
  };

  const startedAt = Date.now();
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) throw new Error('E2B_API_KEY is not configured, so the cloud renderer is unavailable.');

  const timeoutMs = input.timeoutMs ?? 25 * 60_000;
  const sandbox = await getOrCreateSandbox(userId, apiKey, timeoutMs);

  // Hold the busy counter for the WHOLE render: a 10-minute job otherwise looks
  // like an idle sandbox and gets paused out from under itself.
  beginSandboxCommand(userId);
  let downloadedBytes = 0;

  try {
    const vcpus = await provision(sandbox, log);

    // Renderer + spec
    const root = `/home/user/${ROOT}`;
    await sandbox.files.write(`${root}/scripts/render-spec.py`, input.rendererSource);
    await sandbox.files.write(`${root}/spec.json`, JSON.stringify(spec, null, 2));

    const stillNames = await fetchAssets(sandbox, 'stills', input.stills || [], log);
    const clipNames = await fetchAssets(sandbox, 'clips', input.clips || [], log);
    if (input.presenter) await fetchOne(sandbox, input.presenter, `presenter.${hashName(input.presenter.url).split('.').pop()}`, log);
    if (input.music) await fetchOne(sandbox, input.music, `music.${hashName(input.music.url).split('.').pop()}`, log);

    const shots = spec.segments.length || 1;
    // Each worker holds its own ONNX session and image caches. Default to a
    // conservative fan-out and let the caller opt up, rather than OOM-killing a
    // sandbox halfway through a render.
    const requested = input.workers ?? Math.max(1, Math.min(vcpus - 1, 4));
    const workers = Math.max(1, Math.min(Math.floor(requested), shots, 8));

    const presenterFile = input.presenter
      ? `assets/presenter.${hashName(input.presenter.url).split('.').pop()}`
      : '';
    const musicFile = input.music ? `assets/music.${hashName(input.music.url).split('.').pop()}` : '';

    const renderCmd = `
set -uo pipefail
cd "$HOME/${ROOT}"
export RENDER_THREADS=$(( $(nproc) / ${workers} > 0 ? $(nproc) / ${workers} : 1 ))
rm -f out.mp4
python3 scripts/render-spec.py \
  --spec spec.json \
  --out out.mp4 \
  --stills assets/stills \
  --clips assets/clips \
  ${presenterFile ? `--presenter ${presenterFile}` : ''} \
  ${musicFile ? `--music ${musicFile}` : ''} \
  --model "$HOME/${ROOT}/u2net_human_seg.onnx" \
  --font "$HOME/${ROOT}/Montserrat.ttf" \
  --parallel ${workers} > render.log 2>&1
CODE=$?
echo "=== failure scan ==="
grep -nE "Traceback|MemoryError|Killed|OSError|ValueError|No such file" render.log | tail -12
echo "=== tail ==="
tail -25 render.log
echo "---exit:\${CODE}"
`;
    log(`rendering with ${workers} workers on ${vcpus} vCPU`);
    const renderRes = await runIn(sandbox, renderCmd, timeoutMs);
    log(renderRes.stdout.trim());
    if (!/---exit:0\s*$/.test(renderRes.stdout)) {
      throw new Error(`Render failed:\n${(renderRes.stderr || renderRes.stdout).slice(-1200)}`);
    }

    // Validate IN the sandbox before paying to transfer it.
    const probeCmd = `
cd "$HOME/${ROOT}"
[ -s out.mp4 ] || { echo "MISSING"; exit 31; }
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,nb_frames,r_frame_rate \
  -show_entries format=duration,size -of json out.mp4
`;
    const probeRes = await runIn(sandbox, probeCmd, 120_000);
    if (probeRes.code !== 0) throw new Error(`Output validation failed: ${(probeRes.stderr || probeRes.stdout).slice(-400)}`);

    let probe: any = {};
    try {
      probe = JSON.parse(probeRes.stdout);
    } catch {
      throw new Error(`Could not parse ffprobe output: ${probeRes.stdout.slice(0, 400)}`);
    }
    const stream = probe.streams?.[0] || {};
    const durationSec = Number(probe.format?.duration) || 0;
    const bytes = Number(probe.format?.size) || 0;
    const frames = Number(stream.nb_frames) || Math.round(durationSec * Number(String(stream.r_frame_rate || '24').split('/')[0] || 24));

    const expected = Number(spec.compiledFrom?.durationSec) || 0;
    if (expected && Math.abs(durationSec - expected) > 0.75) {
      throw new Error(
        `Render is ${durationSec.toFixed(2)}s but the spec says ${expected.toFixed(2)}s — refusing to publish a drifted render.`
      );
    }
    if (bytes > MAX_OUTPUT_BYTES) throw new Error(`Output is ${(bytes / 1048576).toFixed(0)} MB, over the transfer limit.`);

    // Transfer through the sandbox reader, then straight to R2.
    const buffer: Uint8Array = await sandbox.files.read(`${root}/out.mp4`, { format: 'bytes' });
    downloadedBytes = buffer?.length || 0;
    if (!downloadedBytes) throw new Error('Sandbox returned an empty video.');

    const fileName = `spec-renders/${userId.slice(0, 8)}_${Date.now()}.mp4`;
    const url = await uploadBufferToR2(buffer, fileName, userId);
    log(`published ${url}`);

    const sandboxSeconds = (Date.now() - startedAt) / 1000;
    const costInr = sandboxSeconds * SANDBOX_INR_PER_SECOND;
    await recordSpend({
      service: 'e2b',
      model: 'spec-render',
      units: Math.round(sandboxSeconds),
      unit: 'sandbox second',
      costInr,
      userId,
      detail: `spec render: ${workers} workers, ${durationSec.toFixed(1)}s output, ${(downloadedBytes / 1048576).toFixed(1)}MB returned`,
    });

    // Best-effort cleanup so the next render does not inherit a stale output.
    void runIn(sandbox, `rm -f "$HOME/${ROOT}/out.mp4"`, 30_000).catch(() => {});

    return {
      url,
      bytes: downloadedBytes,
      durationSec,
      frames,
      width: Number(stream.width) || 0,
      height: Number(stream.height) || 0,
      workers,
      sandboxSeconds: Math.round(sandboxSeconds),
      costInr,
      log: emitted.join('\n'),
    };
  } finally {
    endSandboxCommand(userId);
  }
}
