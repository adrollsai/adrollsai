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
  return lines.slice(-14).join(' | ').slice(0, 1200);
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
