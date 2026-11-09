/**
 * Builds the shell script that renders a HyperFrames composition inside E2B.
 *
 * This lives in its own module because render wall clock is billed directly:
 * E2B charges per second of sandbox time, so every flag below is a cost lever,
 * and the tuning has to stay identical between the production tool and the
 * measurement harness (`scripts/measure-render-cost.ts`). Duplicating it made
 * the measurement lie about what production actually runs.
 */

export type RenderQuality = 'draft' | 'looks' | 'delivery';

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

  const script = `
export PATH=/usr/local/bin:$PATH
mkdir -p /home/user/tmp /home/user/.nobohf
export TMPDIR=/home/user/tmp
cd /home/user
if [ ! -x /home/user/.nobohf/node_modules/.bin/hyperframes ]; then
  echo "installing hyperframes CLI (one time)…"
  cd /home/user/.nobohf && npm init -y >/dev/null 2>&1 && npm install hyperframes@latest --no-audit --no-fund 2>&1 | tail -5
fi
cd /home/user/${o.projectDir}
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
RENDER_START=$(date +%s)
$HF render --output out.mp4${fpsFlag} --quality ${quality}${span} $HF_FLAGS
RENDER_RC=$?
RENDER_END=$(date +%s)
echo "render-seconds: $(( RENDER_END - RENDER_START ))"
echo "render-exit: \${RENDER_RC}"
if [ -f out.mp4 ]; then
  ls -l out.mp4
  ffprobe -v error -show_entries format=duration,size -of default=nw=1 out.mp4 2>/dev/null || true
fi
[ "$RENDER_RC" -eq 0 ] || exit $RENDER_RC
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
