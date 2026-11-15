/**
 * Builds the shell script that renders a HyperFrames composition inside E2B.
 *
 * This lives in its own module because render wall clock is billed directly:
 * E2B charges per second of sandbox time, so every flag below is a cost lever,
 * and the tuning has to stay identical between the production tool and the
 * measurement harness (`scripts/measure-render-cost.ts`). Duplicating it made
 * the measurement lie about what production actually runs.
 */

export interface RenderSpan {
  index: number;
  start: number;
  end: number;
}

/**
 * Split a film into renderable spans.
 *
 * A span is the unit that one `hyperframes render` process produces, and it is also the unit
 * that survives across agent turns: finished spans stay on the sandbox disk, so a long film is
 * rendered a slice at a time and stitched once, instead of being one command that must finish
 * inside a single request.
 */
export function planRenderSpans(options: {
  durationSeconds: number;
  chunkSeconds?: number;
  startSeconds?: number;
  endSeconds?: number;
}): RenderSpan[] {
  const total = Math.max(1, Math.round(Number(options.durationSeconds) || 15));

  // An explicit span request stays a single span: the caller asked for exactly that range.
  if (typeof options.startSeconds === 'number') {
    const start = Math.max(0, Math.round(options.startSeconds));
    const end = typeof options.endSeconds === 'number' ? Math.round(options.endSeconds) : total;
    return [{ index: 0, start, end: Math.max(start + 1, Math.min(end, total)) }];
  }

  const requested = Math.round(Number(options.chunkSeconds) || 20);
  const chunk = Math.max(2, Math.min(requested, 120));
  const spans: RenderSpan[] = [];
  for (let start = 0, index = 0; start < total; start += chunk, index++) {
    spans.push({ index, start, end: Math.min(start + chunk, total) });
  }
  return spans;
}

/**
 * How long a slice should spend rendering before it stops and lets the next call continue.
 *
 * There is no fixed ceiling on the film; the only real limit is the request the work runs
 * inside. So the slice asks the turn how much time is left and leaves headroom to record the
 * result and stop cleanly.
 */
export function renderSliceBudgetSeconds(remainingMs: number): number {
  const headroomMs = 25_000; // capture the log, upload parts, return a result
  if (!Number.isFinite(remainingMs)) return 600;
  const usable = Math.max(0, remainingMs - headroomMs);
  return Math.max(0, Math.floor(usable / 1000));
}

export type RenderQuality = 'draft' | 'looks' | 'delivery';

/**
 * Make a hand-written composition renderable.
 *
 * HyperFrames identifies a composition by `data-composition-id` on the root element and learns
 * its length from `data-duration`. Miss either and the render dies after 14 seconds with:
 *
 *   [FrameCapture] Composition has zero duration.
 *   → Fix: add data-duration="<seconds>" to your root <div data-composition-id="..."> element.
 *
 * An agent writing HTML from scratch does not know that contract, so it produced compositions
 * that could never render — which is the deeper reason designed video "did not work": the model
 * fell back to ffmpeg because the HyperFrames path kept failing on its own markup.
 *
 * This repairs the two attributes when they are missing and otherwise leaves the markup alone,
 * so what the model authored is what renders.
 */
export function normaliseCompositionHtml(
  html: string,
  options: { durationSeconds: number; compositionId?: string },
): string {
  let out = String(html ?? '');
  if (!out.trim()) return out;

  const numeric = Number(options.durationSeconds);
  const seconds = Number.isFinite(numeric) && numeric > 0 ? Math.max(1, Math.round(numeric)) : 15;
  const id = (options.compositionId || 'composition').replace(/[^a-zA-Z0-9_-]/g, '_');
  const hasCompositionId = /data-composition-id\s*=/.test(out);
  const hasDuration = /data-duration\s*=/.test(out);

  if (hasCompositionId && hasDuration) return out;

  // The root is the first <div> that carries an id, else the first <div>, else <body>.
  const rootPatterns = [/<div\b[^>]*\bid\s*=\s*["'][^"']+["'][^>]*>/i, /<div\b[^>]*>/i, /<body\b[^>]*>/i];
  for (const pattern of rootPatterns) {
    const match = pattern.exec(out);
    if (!match) continue;
    const tag = match[0];
    const additions: string[] = [];
    if (!hasCompositionId) additions.push(`data-composition-id="${id}"`);
    if (!hasDuration) additions.push(`data-duration="${seconds}"`);
    if (!additions.length) return out;
    const patchedTag = tag.replace(/>$/, ` ${additions.join(' ')}>`);
    out = out.slice(0, match.index) + patchedTag + out.slice(match.index + tag.length);
    return out;
  }

  // No div and no body: wrap whatever there is so the renderer has somewhere to look.
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><div data-composition-id="${id}" data-duration="${seconds}">${out}</div></body></html>`;
}

/** The last few meaningful lines of a render log, for an error a human or model can act on. */
export function renderLogTail(stdout: string | undefined, stderr: string | undefined): string {
  const text = `${stdout || ''}\n${stderr || ''}`;
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, '').trim())
    // Strip the progress bar and its percentage but KEEP whatever follows: the failure line
    // arrives as "█░░░ 5% Failed: [FrameCapture] Composition has zero duration", and dropping
    // the whole line because it looked like a progress bar threw away the only useful sentence.
    .map((line) => line.replace(/^[█▉▊▋▌▍▎▏░\s]+\d+%\s*/, '').trim())
    .filter((line) => line && !/^@hf-/.test(line));

  // The reason is rarely the last line printed — a stitch failure is followed by ffmpeg's muxer
  // chatter, and routine telemetry ("Browser capability probe...") buries it. Error-shaped lines
  // are promoted to the front so the model reads the cause, not the noise.
  const isError = (line: string) => /error|failed|impossible|cannot|could not|no such file|✗|denied|missing/i.test(line);
  const isNoise = (line: string) => /capability probe|Render:trace|chunkIndex/i.test(line);
  const signal = lines.filter((line) => isError(line) && !isNoise(line)).slice(-8);
  const rest = lines.filter((line) => !signal.includes(line) && !isNoise(line)).slice(-6);
  return [...signal, ...rest].join(' | ').slice(0, 1200);
}

export interface HyperFramesRenderScriptOptions {
  /** Project directory under /home/user that holds index.html. */
  projectDir: string;
  /** Composition length in seconds — used only to report the frame count. */
  durationSeconds: number;
  fps?: number;
  quality?: RenderQuality;
  startSeconds?: number;
  endSeconds?: number;
  audioUrl?: string;
  /** Seconds per render span. Smaller spans resume more finely; larger spans start fewer browsers. */
  chunkSeconds?: number;
  /** Seconds this slice may spend rendering before it stops and lets the next call continue. */
  budgetSeconds?: number;
}

export function buildHyperFramesRenderScript(o: HyperFramesRenderScriptOptions): string {
  const hasSpan = typeof o.startSeconds === 'number';
  const explicit = typeof o.fps === 'number' ? Math.min(Math.max(Math.round(o.fps), 1), 60) : undefined;
  // `--start/--end` only renders MP4 at 24, 25, 30 or 60 fps, so a span render
  // snaps to the nearest supported rate instead of failing after the sandbox
  // has already been paid for. Without a span we pass `--fps` only when asked,
  // so a composition's own data-fps stays the author's decision.
  const fps = hasSpan
    ? [24, 25, 30, 60].reduce((best, v) => (Math.abs(v - (explicit ?? 30)) < Math.abs(best - (explicit ?? 30)) ? v : best), 30)
    : explicit;
  const fpsFlag = fps ? ` --fps ${fps}` : '';
  const quality: RenderQuality = o.quality ?? 'looks';
  const span =
    typeof o.startSeconds === 'number'
      ? ` --start ${Math.max(o.startSeconds, 0)}` +
        (typeof o.endSeconds === 'number' ? ` --end ${Math.max(o.endSeconds, 0)}` : '')
      : '';
  const chunks = planRenderSpans({
    durationSeconds: o.durationSeconds,
    chunkSeconds: o.chunkSeconds,
    startSeconds: o.startSeconds,
    endSeconds: o.endSeconds,
  });
  const sliceBudget = Math.max(0, Math.round(Number(o.budgetSeconds) || 0));
  void fpsFlag;
  void span;

  const script = `
export PATH=/usr/local/bin:$PATH
mkdir -p /home/user/tmp /home/user/.nobohf
export TMPDIR=/home/user/tmp
LOOP_START=$(date +%s)

# ── make room for the render ────────────────────────────────────────────────
# HyperFrames refuses to render when the filesystem it writes temp files to has less than a
# couple of gigabytes free, and the stock sandbox mounts /tmp as a 992 MB tmpfs on top of a
# 25 GB disk. So EVERY render died with:
#
#   ✗  Low disk space — 1.0 GB free at /tmp
#
# which is why designed video never worked and the agent kept falling back to ffmpeg for
# things that should have been HyperFrames compositions. Bind-mounting a directory from the
# big ext4 root over /tmp gives the renderer real disk (19 GB here) instead of RAM, which
# matters because tmpfs space is memory the browser needs.
TMP_FREE_MB=$(df -Pk /tmp 2>/dev/null | awk 'NR==2{print int($4/1024)}')
if [ "\${TMP_FREE_MB:-0}" -lt 3000 ]; then
  mkdir -p /home/user/hf-tmp
  if sudo -n mount --bind /home/user/hf-tmp /tmp 2>/dev/null || mount --bind /home/user/hf-tmp /tmp 2>/dev/null; then
    # A bind mount inherits the source directory's permissions, and /tmp must stay 1777 or every
    # package install in the image (apt writes temp files there) starts failing with exit 100.
    sudo -n chmod 1777 /tmp 2>/dev/null || chmod 1777 /tmp 2>/dev/null
    echo "render-tmp: bind-mounted disk-backed /home/user/hf-tmp over /tmp ($(df -Pk /tmp | awk 'NR==2{print int($4/1024)}')MB free)"
  elif sudo -n mount -o remount,size=6G /tmp 2>/dev/null; then
    echo "render-tmp: remounted /tmp at 6G ($(df -Pk /tmp | awk 'NR==2{print int($4/1024)}')MB free)"
  else
    echo "render-tmp: WARNING could not enlarge /tmp (still \${TMP_FREE_MB:-0}MB free) — the render may refuse"
  fi
else
  echo "render-tmp: /tmp already has \${TMP_FREE_MB}MB free"
fi
# Belt and braces: whatever produced the current /tmp, it has to be world-writable.
sudo -n chmod 1777 /tmp 2>/dev/null || chmod 1777 /tmp 2>/dev/null

cd /home/user
if [ ! -x /home/user/.nobohf/node_modules/.bin/hyperframes ]; then
  echo "installing hyperframes CLI (one time)…"
  cd /home/user/.nobohf && npm init -y >/dev/null 2>&1 && npm install hyperframes@latest --no-audit --no-fund 2>&1 | tail -5
fi
cd /home/user/${o.projectDir}
if [ ! -f index.html ]; then
  echo "ERROR: no index.html in /home/user/${o.projectDir}."
  echo "Write the composition with sandbox_write_file first, then call this tool"
  echo "again without htmlContent — or pass the full HTML in htmlContent."
  exit 2
fi
HF=/home/user/.nobohf/node_modules/.bin/hyperframes
[ -x "$HF" ] || HF="npx -y hyperframes@latest"

# Render cost tuning. E2B bills per second of sandbox time, so wall clock is
# money: frames (= duration x fps) dominate, and HyperFrames falls back to a
# deliberately safe profile (single worker, screenshot capture, ~470ms/frame)
# on machines with 8GB RAM or less — which is what the stock 512MiB sandbox is.
# Only reach for the fast path when the machine genuinely has the memory, so
# this cannot regress today's sandbox and improves by itself on a bigger image.
MEM_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
CPUS=$(nproc)
HF_FLAGS=""
WORKERS=1
CAPTURE=screenshot
if [ "$MEM_MB" -ge 3000 ]; then
  W=$(( MEM_MB / 700 ))
  [ "$W" -gt "$CPUS" ] && W=$CPUS
  [ "$W" -gt 4 ] && W=4
  [ "$W" -lt 1 ] && W=1
  HF_FLAGS="--no-low-memory-mode --workers $W"
  WORKERS=$W
  CAPTURE=auto
fi
echo "render-plan: mem=\${MEM_MB}MB cpu=\${CPUS} frames=$(( ${o.durationSeconds} * ${fps ?? 30} )) fps=${fps ?? 'authored'} quality=${quality} workers=\${WORKERS} capture=\${CAPTURE}"

# ── chunked, resumable rendering ──────────────────────────────────────────────
# One command must never be the whole job. A single agent turn is bounded (one HTTP request,
# so a few minutes), while a film can be an hour long. Rendering in independent spans and
# stitching them afterwards means:
#   - each render process is short, so nothing depends on one long call surviving;
#   - finished spans are kept on the sandbox disk, so a later call RESUMES instead of restarting;
#   - total length is limited by the pipeline, not by a request timeout.
# This replaced a fixed 300s ceiling that made anything past ~20s of footage impossible.
CHUNK_SECONDS=\${HF_CHUNK_SECONDS:-20}
BUDGET_SECONDS=\${HF_BUDGET_SECONDS:-0}
mkdir -p parts
TOTAL_CHUNKS=${chunks.length}
echo "render-chunks: \${TOTAL_CHUNKS} span(s) of \${CHUNK_SECONDS}s, slice budget \${BUDGET_SECONDS}s"
echo "HF-SPANS: ${chunks.map((c) => `${c.index}:${c.start}-${c.end}`).join(',')}"

render_chunk() {
  local idx="$1" start="$2" end="$3"
  local out="parts/part_$(printf '%04d' "$idx").mp4"
  if [ -f "$out" ]; then echo "HF-PART: $idx cached"; return 0; fi
  echo "HF-CHUNK: $idx $start-$end"
  $HF render --output "$out" --fps ${fps ?? 30} --quality ${quality} --start "$start" --end "$end" $HF_FLAGS
  local rc=$?
  if [ "$rc" -ne 0 ] || [ ! -f "$out" ]; then
    echo "HF-CHUNK-FAILED: $idx rc=$rc"
    rm -f "$out"
    return 1
  fi
  echo "HF-PART: $idx done $(stat -c%s "$out" 2>/dev/null || echo '?') bytes"
  return 0
}

DONE=0
FAILED=0
for i in $(seq 0 $((TOTAL_CHUNKS - 1))); do
  start=$(( i * CHUNK_SECONDS ))
  end=$(( start + CHUNK_SECONDS ))
  [ "$end" -gt ${o.durationSeconds} ] && end=${o.durationSeconds}
  # Stop starting new chunks when the slice's time is nearly gone; the next call continues.
  if [ "$BUDGET_SECONDS" -gt 0 ]; then
    ELAPSED=$(( $(date +%s) - LOOP_START ))
    if [ "$ELAPSED" -ge "$BUDGET_SECONDS" ]; then
      echo "HF-BUDGET: out of slice time after $DONE chunk(s)"
      break
    fi
  fi
  render_chunk "$i" "$start" "$end" || FAILED=1
  [ -f "parts/part_$(printf '%04d' "$i").mp4" ] && DONE=$((DONE + 1))
done

HAVE=$(ls parts/part_*.mp4 2>/dev/null | wc -l | tr -d ' ')
echo "HF-PARTS: \${HAVE}/\${TOTAL_CHUNKS}"

if [ "$HAVE" -eq "$TOTAL_CHUNKS" ] && [ "$TOTAL_CHUNKS" -gt 0 ]; then
  echo "HF-STITCHING: \${HAVE} spans → out.mp4"
  : > parts/list.txt
  # Absolute paths on purpose: ffmpeg resolves concat entries relative to the LIST file, so
  # relative entries became parts/parts/part_0000.mp4 and the stitch failed after every frame
  # had already been rendered and paid for.
  for f in $(ls parts/part_*.mp4 | sort); do printf "file '%s'\\n" "/home/user/${o.projectDir}/$f" >> parts/list.txt; done
  ffmpeg -y -v error -f concat -safe 0 -i parts/list.txt -c copy out.mp4
  STITCH_RC=$?
  if [ "$STITCH_RC" -ne 0 ] || [ ! -f out.mp4 ]; then
    # Stream-copy concat can fail when spans disagree on parameters — re-encode as a fallback
    # rather than failing the whole film after all the frames have already been paid for.
    echo "HF-STITCH-RETRY: re-encoding"
    ffmpeg -y -v error -f concat -safe 0 -i parts/list.txt -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p out.mp4
    STITCH_RC=$?
  fi
  if [ "$STITCH_RC" -eq 0 ] && [ -f out.mp4 ]; then
    echo "HF-STITCHED: yes"
    ls -l out.mp4
    ffprobe -v error -show_entries format=duration,size -of default=nw=1 out.mp4 2>/dev/null || true
  else
    echo "HF-STITCHED: failed rc=\${STITCH_RC}"
    exit 1
  fi
else
  echo "HF-STITCHED: no (film incomplete — call again to continue)"
  exit 0
fi
  `.trim();

  if (!o.audioUrl) return script;

  // `--start/--end` renders a span starting at 0, so a full-length track would
  // desync against it; only mux audio for whole-film renders.
  if (typeof o.startSeconds === 'number') return script;

  return (
    script +
    '\n' +
    `
curl -fsSL "${o.audioUrl}" -o audio_track.mp3 || true
if [ -f audio_track.mp3 ]; then
  ffmpeg -y -i out.mp4 -i audio_track.mp3 -c:v copy -c:a aac -b:a 192k -shortest final.mp4
  mv -f final.mp4 out.mp4
fi
    `.trim()
  );
}
