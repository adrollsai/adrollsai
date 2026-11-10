import { Sandbox } from '@e2b/code-interpreter';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { remainingTurnBudgetMs } from './turn-limits';
import path from 'path';
import fs from 'fs';

/**
 * Never let a single command outlive the turn.
 *
 * The loop can only stop BETWEEN steps and the platform kills the request at
 * maxDuration, so a long render started near the end of a turn could take the
 * whole function down with it. Clamping here means such a command returns a
 * timeout instead, the loop stops cleanly, and the continuation run resumes from
 * the sandbox — which still holds the files.
 */
function clampToTurnBudget(requestedMs: number): number {
  const left = remainingTurnBudgetMs();
  if (!Number.isFinite(left)) return requestedMs;
  const usable = left - 12_000; // room to record the result and stop
  if (usable >= requestedMs) return requestedMs;
  return Math.max(15_000, usable);
}

function getE2BApiKey(): string {
  return (process.env.E2B_API_KEY || '').replace(/^["']|["']$/g, '').trim();
}

/**
 * Optional custom E2B template alias. When set, we assume the image already
 * contains ffmpeg / Node / the HyperFrames headless browser and skip runtime
 * provisioning entirely — which also removes the multi-minute first-call cost.
 * Unset today, so new sandboxes get the stock image and are provisioned below.
 */
function getE2BTemplate(): string | undefined {
  const tpl = (process.env.E2B_TEMPLATE || '').replace(/^["']|["']$/g, '').trim();
  return tpl || undefined;
}

/** What the sandbox actually has available. Probed, never assumed. */
export interface SandboxCapabilities {
  ffmpeg: boolean;
  node: boolean;
  browsers: boolean;
  /** Human-readable outcome of each provisioning step. */
  notes: string[];
  provisionedAt: string;
}

interface CachedSandbox {
  sandbox: Sandbox;
  lastUsed: number;
  timer: NodeJS.Timeout;
  capabilities?: SandboxCapabilities;
  /** In-flight command count. The idle timer must never pause mid-command. */
  busy: number;
}

// In-memory cache of active sandboxes by userId attached to globalThis
const globalCacheKey = '__e2bPersistentSandboxCache';
const sandboxCache: Map<string, CachedSandbox> = (globalThis as any)[globalCacheKey] || new Map<string, CachedSandbox>();
(globalThis as any)[globalCacheKey] = sandboxCache;

/**
 * How long a sandbox may sit unused before we stop paying for it.
 *
 * E2B bills per second of *running* time, so idle time is pure waste: a 15s
 * video finishes its render in ~3.5 minutes and the old 20-minute idle timer
 * then billed another ~$0.036 — over five times the render itself.
 *
 * The window must stay comfortably above the longest single command we run
 * (`sandbox_render_hyperframes` allows 300s) so a pause can never fire in the
 * middle of a render. Renders additionally pause the sandbox themselves the
 * moment the MP4 is safely in R2, which is where the real saving comes from.
 */
const SANDBOX_IDLE_PAUSE_MS = Number(process.env.SANDBOX_IDLE_PAUSE_MS || 6 * 60 * 1000);
const CACHE_DIR = path.join(process.cwd(), '.nobogent');
const CACHE_FILE = path.join(CACHE_DIR, 'e2b_sandboxes.json');

/**
 * Take a sandbox out of the billing loop while keeping its filesystem.
 *
 * A paused sandbox stops compute billing but retains its state, so the next
 * request resumes it through `Sandbox.connect()` in about a second instead of
 * paying a fresh ~2-4 minute provisioning run. Killing was strictly worse on
 * both axes: it kept billing until the timer fired and then threw away
 * everything we had installed.
 */
async function retireSandbox(userId: string, sandbox: Sandbox): Promise<void> {
  try {
    await sandbox.pause();
  } catch (e) {
    // Some images cannot pause (or the sandbox already went away). Fall back to
    // a kill so a doomed sandbox can never be left running and billing.
    try {
      await sandbox.kill();
    } catch (inner) {}
  }
  sandboxCache.delete(userId);
}

/** Arm (or re-arm) the idle timer for a cached sandbox. */
function armIdleTimer(userId: string, sandbox: Sandbox): NodeJS.Timeout {
  const timer = setTimeout(() => {
    const entry = sandboxCache.get(userId);
    if (entry && entry.busy > 0) {
      // A long command (matte pass, encode, render) is still in flight. Pausing
      // now would kill it mid-run, so check back rather than interrupting.
      if (entry) entry.timer = armIdleTimer(userId, sandbox);
      return;
    }
    void retireSandbox(userId, sandbox);
  }, SANDBOX_IDLE_PAUSE_MS);
  // Never hold the process open just to pause a sandbox.
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

function readDiskCache(): Record<string, { sandboxId: string; lastUsed: number }> {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function writeDiskCache(cache: Record<string, { sandboxId: string; lastUsed: number }>) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {}
}

export async function getOrCreateSandbox(userId: string = 'default', apiKey?: string, timeoutMs: number = 300_000): Promise<Sandbox> {
  const resolvedKey = apiKey || getE2BApiKey();
  if (!resolvedKey) {
    throw new Error('E2B_API_KEY is not configured in environment variables.');
  }

  // 1. Check in-memory cache
  const existing = sandboxCache.get(userId);
  if (existing) {
    try {
      clearTimeout(existing.timer);
      existing.lastUsed = Date.now();
      existing.timer = armIdleTimer(userId, existing.sandbox);
      return existing.sandbox;
    } catch (e) {
      sandboxCache.delete(userId);
    }
  }

  // 2. Check disk cache across Next.js restarts
  const diskCache = readDiskCache();
  const diskEntry = diskCache[userId];
  if (diskEntry?.sandboxId) {
    try {
      const reconnected = await Sandbox.connect(diskEntry.sandboxId, { apiKey: resolvedKey });
      const ping = await reconnected.commands.run('echo "alive"', { timeoutMs: 5000 });
      if (ping.exitCode === 0) {
        const timer = armIdleTimer(userId, reconnected);

        // A reconnected sandbox was already provisioned, but we lost the
        // in-memory report. Re-probe cheaply; only reinstall if something is
        // genuinely missing.
        const capabilities = await provisionSandbox(reconnected, { skipped: Boolean(getE2BTemplate()) });

        sandboxCache.set(userId, {
          sandbox: reconnected,
          lastUsed: Date.now(),
          timer,
          capabilities,
      busy: 0,
        });
        return reconnected;
      }
    } catch (e) {
      // Previous sandbox died or expired
      delete diskCache[userId];
      writeDiskCache(diskCache);
    }
  }

  // 3. Create fresh persistent sandbox.
  //    No template => the stock E2B image, which does NOT ship ffmpeg/Chrome,
  //    so provisioning below is mandatory until E2B_TEMPLATE is set.
  const template = getE2BTemplate();
  const sandbox = await Sandbox.create({
    apiKey: resolvedKey,
    // Hard backstop for when this Node process disappears (dev restart,
    // serverless freeze) and our own idle timer never gets to run: pause rather
    // than leave the sandbox running and billing forever.
    timeoutMs: Math.max(timeoutMs, 900_000),
    lifecycle: { onTimeout: { action: 'pause' }, autoResume: true },
    ...(template ? { template } : {}),
  });

  const capabilities = await provisionSandbox(sandbox, { skipped: Boolean(template) });

  const timer = armIdleTimer(userId, sandbox);

  sandboxCache.set(userId, {
    sandbox,
    lastUsed: Date.now(),
    timer,
    capabilities,
      busy: 0,
  });

  diskCache[userId] = { sandboxId: sandbox.sandboxId, lastUsed: Date.now() };
  writeDiskCache(diskCache);

  return sandbox;
}

/**
 * Installs/verifies the tooling the agent's tools assume exists.
 *
 * Every step is probed and its real outcome recorded. The previous version
 * piped everything through `|| true` inside a single `try { } catch { }`, so a
 * failed install was indistinguishable from a successful one — the render
 * failed later with "did not produce output" and no way to tell why.
 */
async function provisionSandbox(
  sandbox: Sandbox,
  opts: { skipped?: boolean } = {}
): Promise<SandboxCapabilities> {
  const notes: string[] = [];

  if (opts.skipped) {
    const caps: SandboxCapabilities = {
      ffmpeg: true,
      node: true,
      browsers: true,
      notes: ['E2B_TEMPLATE is set — assuming the image is pre-provisioned, skipped.'],
      provisionedAt: new Date().toISOString(),
    };
    console.log('[E2B Sandbox] Provisioning skipped (custom template).');
    return caps;
  }

  const step = async (label: string, cmd: string, timeoutMs: number): Promise<boolean> => {
    try {
      const res = await sandbox.commands.run(cmd, { timeoutMs });
      const ok = res.exitCode === 0;
      const detail = ok
        ? (res.stdout || '').trim().split('\n').slice(-1)[0]?.slice(0, 120) || 'ok'
        : (res.stderr || res.stdout || '').trim().split('\n').slice(-1)[0]?.slice(0, 160) || `exit ${res.exitCode}`;
      notes.push(`${ok ? 'ok' : 'FAILED'} — ${label}: ${detail}`);
      console.log(`[E2B Sandbox] ${label} → ${ok ? 'ok' : 'FAILED'} (${detail})`);
      return ok;
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 160);
      notes.push(`FAILED — ${label}: ${msg}`);
      console.error(`[E2B Sandbox] ${label} threw: ${msg}`);
      return false;
    }
  };

  // ffmpeg — required by every media tool.
  const hasFfmpeg = await step('ffmpeg present', 'command -v ffmpeg', 20_000);
  const ffmpeg = hasFfmpeg || (await step(
    'install ffmpeg',
    'sudo apt-get update -qq && sudo apt-get install -y -qq ffmpeg && command -v ffmpeg',
    150_000
  ));

  // Node 22+ — HyperFrames hard-refuses to run on older Node. The stock E2B
  // image ships Node 20, which is why the render step failed with
  // "sandbox is missing hyperframes-browser": the CLI exited before it could
  // install the browser. This check must match HyperFrames' real requirement.
  const NODE_MAJOR = 22;
  const nodeOk = async (cmd: string, timeoutMs: number) =>
    step(`node >= ${NODE_MAJOR}`, cmd, timeoutMs);

  let node = await nodeOk(
    `node -e "process.exit(Number(process.versions.node.split('.')[0]) >= ${NODE_MAJOR} ? 0 : 1)"`,
    20_000
  );

  if (!node) {
    console.log(`[E2B Sandbox] installing Node ${NODE_MAJOR} (HyperFrames requires it)…`);
    node = await step(
      `install Node ${NODE_MAJOR}`,
      [
        `NODE_VER=$(curl -fsSL https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/ | grep -o 'node-v${NODE_MAJOR}[0-9.]*-linux-x64.tar.xz' | head -1)`,
        `[ -n "$NODE_VER" ] || NODE_VER=node-v${NODE_MAJOR}.12.0-linux-x64.tar.xz`,
        `curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/$NODE_VER" -o /tmp/node.tar.xz`,
        `sudo mkdir -p /opt/node${NODE_MAJOR}`,
        `sudo tar -xJf /tmp/node.tar.xz -C /opt/node${NODE_MAJOR} --strip-components=1`,
        // /usr/local/bin precedes /usr/bin on PATH, so these win over the image's Node.
        `sudo ln -sf /opt/node${NODE_MAJOR}/bin/node /usr/local/bin/node`,
        `sudo ln -sf /opt/node${NODE_MAJOR}/bin/npm /usr/local/bin/npm`,
        `sudo ln -sf /opt/node${NODE_MAJOR}/bin/npx /usr/local/bin/npx`,
        `rm -f /tmp/node.tar.xz`,
        `node -v`,
      ].join(' && '),
      240_000
    );
    // Re-verify after the install.
    node = node && (await nodeOk(`node -e "process.exit(Number(process.versions.node.split('.')[0]) >= ${NODE_MAJOR} ? 0 : 1)"`, 20_000));
  }

  // HyperFrames CLI — probe it by actually running it, not by asking PATH.
  const hfVersion = await step('hyperframes CLI', 'npx -y hyperframes@latest --version', 300_000);

  // Chrome's shared-library dependencies. The headless shell downloads fine but
  // cannot launch without these, and HyperFrames fails the render with
  // "Chrome cannot launch (missing system libraries)". List comes from
  // HyperFrames' own diagnostic.
  const chromeLibs = await step(
    'chrome system libraries',
    'sudo apt-get update -qq && sudo apt-get install -y -qq ' +
      'libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 ' +
      'libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 ' +
      'libpango-1.0-0 libcairo2 libasound2 fonts-liberation',
    240_000
  );

  // Headless browser that HyperFrames renders with.
  const browsers = chromeLibs && hfVersion && (await step('hyperframes browser', 'npx -y hyperframes@latest browser ensure', 420_000));

  // Reclaim disk; non-fatal, so not part of the capability signal.
  await step('cleanup apt cache', 'sudo apt-get clean && sudo rm -rf /var/lib/apt/lists/* /tmp/npm-*', 60_000);

  const caps: SandboxCapabilities = {
    ffmpeg,
    node,
    browsers: Boolean(browsers),
    notes,
    provisionedAt: new Date().toISOString(),
  };

  const missing = ([
    !ffmpeg && 'ffmpeg',
    !node && `node>=${NODE_MAJOR}`,
    !chromeLibs && 'chrome-system-libs',
    !browsers && 'hyperframes-browser',
  ] as (string | false)[]).filter(Boolean);

  if (missing.length) {
    console.error(
      `[E2B Sandbox] Provisioning incomplete — missing: ${missing.join(', ')}. ` +
      `Media tools will fail until this is resolved. Set E2B_TEMPLATE to a pre-built image to remove runtime provisioning.`
    );
  } else {
    console.log('[E2B Sandbox] Provisioning complete — ffmpeg, node and browser ready.');
  }

  return caps;
}

/** Capabilities of a live sandbox, or undefined if it was never provisioned. */
export function getSandboxCapabilities(userId: string = 'default'): SandboxCapabilities | undefined {
  return sandboxCache.get(userId)?.capabilities;
}

/**
 * Pause the sandbox for this user immediately, if one is cached.
 *
 * Called once a render has been uploaded, because from that moment the sandbox
 * is only holding the project files — it should not be billing compute while
 * the user watches the result. Returns true when a sandbox was retired.
 */
export async function pauseSandbox(userId: string = 'default'): Promise<boolean> {
  const cached = sandboxCache.get(userId);
  if (!cached) return false;
  // Never pause out from under a running command.
  if (cached.busy > 0) return false;
  clearTimeout(cached.timer);
  await retireSandbox(userId, cached.sandbox);
  console.log(`[E2B Sandbox] Paused idle sandbox for ${userId} — compute billing stopped, filesystem kept.`);
  return true;
}

/**
 * Push the idle-pause deadline out for callers running a long job that does not
 * go through executeInE2BSandbox (matte passes, encodes, chunked renders).
 * `extendMs` is a window measured from now, not an increment.
 */
export function touchSandbox(userId: string = 'default', extendMs?: number): void {
  const entry = sandboxCache.get(userId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.lastUsed = Date.now();

  if (extendMs && extendMs > SANDBOX_IDLE_PAUSE_MS) {
    const timer = setTimeout(() => {
      const current = sandboxCache.get(userId);
      if (current && current.busy > 0) {
        if (current) current.timer = armIdleTimer(userId, current.sandbox);
        return;
      }
      void retireSandbox(userId, entry.sandbox);
    }, extendMs);
    if (typeof timer.unref === 'function') timer.unref();
    entry.timer = timer;
    return;
  }
  entry.timer = armIdleTimer(userId, entry.sandbox);
}

/** Mark a command as in flight so the idle timer cannot pause underneath it. */
export function beginSandboxCommand(userId: string = 'default'): void {
  const entry = sandboxCache.get(userId);
  if (entry) entry.busy += 1;
}

export function endSandboxCommand(userId: string = 'default'): void {
  const entry = sandboxCache.get(userId);
  if (entry) entry.busy = Math.max(0, entry.busy - 1);
}

/**
 * Uploads raw buffer or byte array to Cloudflare R2 and returns the public CDN URL.
 */
export async function uploadBufferToR2(fileBytes: Uint8Array | Buffer, fileName: string, userId: string = 'common'): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase() || 'bin';
  const contentType =
    ext === 'mp4' ? 'video/mp4' :
    ext === 'webm' ? 'video/webm' :
    ext === 'mov' ? 'video/quicktime' :
    ext === 'mp3' ? 'audio/mpeg' :
    ext === 'wav' ? 'audio/wav' :
    ext === 'm4a' ? 'audio/mp4' :
    ext === 'gif' ? 'image/gif' :
    ext === 'png' ? 'image/png' :
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
    ext === 'webp' ? 'image/webp' :
    ext === 'svg' ? 'image/svg+xml' :
    ext === 'json' ? 'application/json' :
    'application/octet-stream';

  const baseName = path.basename(fileName);
  const key = `agent_sandbox/${userId}/${Date.now()}_${baseName}`;

  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: Buffer.from(fileBytes),
    ContentType: contentType,
  }));

  return `${R2_PUBLIC_URL}/${key}`;
}

export interface SandboxExecResult {
  success: boolean;
  exitCode?: number;
  stdout: string;
  stderr: string;
  error?: string;
  /** Sandbox path → public URL, for every file passed in `readFiles`. */
  uploadedFiles: Record<string, string>;
}

/**
 * Creates or runs code in an isolated, persistent E2B Cloud Sandbox.
 * Gives the agent a full Ubuntu/Linux MicroVM with root terminal access,
 * npm, pip, Python, Node, FFmpeg, and yt-dlp capability.
 * Keeps session files alive across tool calls so scripts, assets, and packages persist.
 * If `readFiles` are specified, it automatically uploads generated artifacts
 * (e.g. rendered videos/images) to Cloudflare R2 and returns real public URLs.
 */
export async function executeInE2BSandbox(options: {
  command?: string;
  files?: Array<{ path: string; content: string }>;
  readFiles?: string[];
  userId?: string;
  timeoutMs?: number;
}): Promise<SandboxExecResult> {
  const apiKey = getE2BApiKey();
  if (!apiKey) {
    throw new Error('E2B_API_KEY is not configured in environment variables.');
  }

  const { command, files = [], readFiles = [], userId = 'default', timeoutMs = 120_000 } = options;

  try {
    const sandbox = await getOrCreateSandbox(userId, apiKey, timeoutMs);
    // Write any provided code or assets into the sandbox
    for (const file of files) {
      if (file.path.includes('/')) {
        const dir = path.dirname(file.path);
        try {
          await sandbox.commands.run(`mkdir -p "${dir}"`);
        } catch (e) { }
      }
      await sandbox.files.write(file.path, file.content);
    }

    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let error: string | undefined;

    if (command) {
      // Hold the sandbox open for at least as long as the command may take, so
      // a long render/matte pass can never be paused out from under itself.
      // The timeout is then clamped so the command cannot outlive the turn.
      const effectiveTimeoutMs = clampToTurnBudget(timeoutMs);
      touchSandbox(userId, effectiveTimeoutMs + 120_000);
      beginSandboxCommand(userId);
      let result: any;
      try {
        result = await sandbox.commands.run(command, {
          timeoutMs: effectiveTimeoutMs,
        });
      } finally {
        endSandboxCommand(userId);
        touchSandbox(userId);
      }
      stdout = result.stdout || '';
      stderr = result.stderr || '';
      exitCode = result.exitCode;
      if (result.error) {
        error = String(result.error);
      }
    }

    // Read requested output files and upload to Cloudflare R2
    const uploadedFiles: Record<string, string> = {};
    if (readFiles.length > 0) {
      for (const filePath of readFiles) {
        try {
          let fileBytes: any = null;
          const candidatePaths = [
            filePath,
            filePath.startsWith('/') ? filePath : `/home/user/${filePath}`,
            filePath.replace(/^\/home\/user\//, ''),
          ];

          for (const cand of candidatePaths) {
            try {
              const bytes = await sandbox.files.read(cand, { format: 'bytes' });
              if (bytes && bytes.length > 0) {
                fileBytes = bytes;
                break;
              }
            } catch (e) { }
          }

          if (fileBytes && fileBytes.length > 0) {
            const ext = filePath.split('.').pop()?.toLowerCase() || 'bin';
            const contentType =
              ext === 'mp4' ? 'video/mp4' :
                ext === 'png' ? 'image/png' :
                  ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                    ext === 'webp' ? 'image/webp' :
                      'application/octet-stream';

            const baseName = path.basename(filePath);
            const key = `agent_sandbox/${userId || 'common'}/${Date.now()}_${baseName}`;

            await r2.send(new PutObjectCommand({
              Bucket: R2_BUCKET,
              Key: key,
              Body: Buffer.from(fileBytes),
              ContentType: contentType,
            }));

            uploadedFiles[filePath] = `${R2_PUBLIC_URL}/${key}`;
          }
        } catch (readErr: any) {
          console.warn(`[E2B Sandbox] Could not extract artifact ${filePath}:`, readErr.message);
        }
      }
    }

    return {
      success: exitCode === 0,
      exitCode,
      stdout,
      stderr,
      error,
      uploadedFiles,
    };
  } catch (err: any) {
    const msg = String(err?.message || '').toLowerCase();
    // Only delete from cache if the sandbox connection itself is dead
    if (msg.includes('closed') || msg.includes('killed') || msg.includes('econnreset') || msg.includes('not running')) {
      if (sandboxCache.has(userId)) {
        const entry = sandboxCache.get(userId);
        if (entry) {
          clearTimeout(entry.timer);
        }
        sandboxCache.delete(userId);
      }
    }

    return {
      success: false,
      error: err.message || 'Error executing command in E2B sandbox',
      stdout: err.stdout || err.result?.stdout || '',
      stderr: err.stderr || err.result?.stderr || '',
      uploadedFiles: {},
    };
  }
}

export async function writeSandboxFile(filePath: string, content: string, userId?: string) {
  const apiKey = getE2BApiKey();
  const sandbox = await getOrCreateSandbox(userId, apiKey);
  const resolved = filePath.startsWith('/') ? filePath : `/home/user/${filePath}`;
  const dir = path.dirname(resolved);
  try {
    await sandbox.commands.run(`mkdir -p "${dir}"`);
  } catch (e) {}
  await sandbox.files.write(resolved, content);
  return { success: true, path: resolved };
}

export async function readSandboxFile(filePath: string, userId?: string, maxLines: number = 300) {
  const apiKey = getE2BApiKey();
  const sandbox = await getOrCreateSandbox(userId, apiKey);
  const resolved = filePath.startsWith('/') ? filePath : `/home/user/${filePath}`;
  const content = await sandbox.files.read(resolved);
  const lines = content.split('\n');
  const truncated = lines.length > maxLines;
  return {
    success: true,
    path: resolved,
    content: truncated ? lines.slice(0, maxLines).join('\n') + `\n... [truncated ${lines.length - maxLines} lines]` : content,
    totalLines: lines.length,
    truncated,
  };
}

export async function listSandboxDir(dirPath: string = '.', userId?: string) {
  const apiKey = getE2BApiKey();
  const sandbox = await getOrCreateSandbox(userId, apiKey);
  const target = dirPath.startsWith('/') ? dirPath : `/home/user/${dirPath}`;
  const result = await sandbox.commands.run(`ls -la "${target}"`);
  return {
    success: result.exitCode === 0,
    output: result.stdout || result.stderr || '',
    exitCode: result.exitCode,
  };
}

export async function uploadSandboxArtifactToR2(filePath: string, userId: string = 'common') {
  const apiKey = getE2BApiKey();
  const sandbox = await getOrCreateSandbox(userId, apiKey);
  const candidatePaths = [
    filePath,
    filePath.startsWith('/') ? filePath : `/home/user/${filePath}`,
    filePath.replace(/^\/home\/user\//, ''),
  ];

  let fileBytes: any = null;
  for (const cand of candidatePaths) {
    try {
      const bytes = await sandbox.files.read(cand, { format: 'bytes' });
      if (bytes && bytes.length > 0) {
        fileBytes = bytes;
        break;
      }
    } catch (e) {}
  }

  if (!fileBytes || fileBytes.length === 0) {
    throw new Error(`File not found in sandbox: ${filePath}`);
  }

  const url = await uploadBufferToR2(fileBytes, path.basename(filePath), userId);
  return url;
}
