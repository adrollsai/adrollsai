/**
 * The real attachment probe: `ffprobe` inside the sandbox, and the vision pass injected.
 *
 * WHY IT LIVES IN THE SANDBOX
 * `ffprobe` does not exist in a Vercel function, so probing on the request path is not an option.
 * This repo already runs media commands in an E2B sandbox (`lib/agent/sandbox/e2b.ts`), which does
 * have ffmpeg, so the adapter downloads the attachment there, probes it, and returns only the facts.
 *
 * WHAT IT DOES NOT DO
 * It never guesses. A download that fails, a probe that exits non-zero, or output that does not
 * parse all produce `null`, and `buildInventoryItem` turns that into a row marked unusable WITH a
 * reason. Silence is the one outcome that would be dishonest.
 *
 * The vision description is an injected callback because describing a frame needs a model call, and
 * this module must stay callable from a test with no vendor.
 */

import { shellQuote, type AgentSandbox } from './sandbox/e2b';
import {
  inventoryAttachments,
  parseFfprobeJson,
  type AttachmentSource,
  type InventoryDeps,
  type MediaProbe,
  type VisionNote,
} from './attachment-inventory';
import type { AttachmentInventoryItem } from './video-plan';

/** Working directory inside the sandbox. `/tmp` is the template's tmpfs. */
export const PROBE_DIR = '/tmp/nobo-attachments';

/** Only http(s) is ever fetched, and the URL is quoted, so a crafted name cannot become a command. */
export function isFetchableUrl(url: string): boolean {
  return /^https?:\/\//i.test(String(url ?? '').trim());
}

export function downloadCommand(url: string, destPath: string): string {
  // -L follows redirects (R2 presigned URLs redirect), --fail makes a 4xx/5xx exit non-zero
  // instead of writing an HTML error page into a file named .mp4.
  return `curl -sSL --fail --max-time 120 -o ${shellQuote(destPath)} ${shellQuote(url)}`;
}

export function ffprobeJsonCommand(filePath: string): string {
  return `ffprobe -v error -print_format json -show_streams -show_format ${shellQuote(filePath)}`;
}

const stdoutOf = (result: unknown): string => {
  const r = result as { stdout?: unknown; output?: unknown } | null;
  if (typeof r?.stdout === 'string') return r.stdout;
  if (typeof r?.output === 'string') return r.output;
  return '';
};

const exitCodeOf = (result: unknown): number => {
  const r = result as { exitCode?: unknown; exit_code?: unknown } | null;
  const raw = r?.exitCode ?? r?.exit_code;
  return typeof raw === 'number' ? raw : 0;
};

/** A stable, filesystem-safe basename for one attachment. */
export function probeFileName(id: string, url: string): string {
  const clean = String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'attachment';
  const ext = (String(url).match(/\.(mp4|mov|webm|mkv|m4v|jpg|jpeg|png|webp)(?:\?|$)/i)?.[1] ?? 'mp4').toLowerCase();
  return `${clean}.${ext}`;
}

/**
 * Download one URL into the sandbox and probe it.
 *
 * Returns null on any failure — and the caller records why through `buildInventoryItem`.
 */
export async function probeWithSandbox(
  sandbox: AgentSandbox,
  url: string,
  options: { id?: string; timeoutMs?: number } = {},
): Promise<MediaProbe | null> {
  if (!isFetchableUrl(url)) return null;

  const timeoutMs = options.timeoutMs ?? 180_000;
  const name = probeFileName(options.id ?? 'attachment', url);
  const dir = `${PROBE_DIR}/${name.replace(/\.[^.]+$/, '')}`;
  const file = `${dir}/${name}`;

  try {
    await sandbox.exec(`mkdir -p ${shellQuote(dir)}`, { timeoutMs: 20_000 });

    const download = await sandbox.exec(downloadCommand(url, file), { timeoutMs });
    if (exitCodeOf(download) !== 0) return null;

    const probe = await sandbox.exec(ffprobeJsonCommand(file), { timeoutMs: 60_000 });
    if (exitCodeOf(probe) !== 0) return null;

    return parseFfprobeJson(stdoutOf(probe));
  } catch {
    return null;
  } finally {
    // Best effort: a leftover temp file must never fail the run.
    try {
      await sandbox.exec(`rm -rf ${shellQuote(dir)}`, { timeoutMs: 20_000 });
    } catch {
      /* ignore */
    }
  }
}

/**
 * The `InventoryDeps` a real run uses.
 *
 * `describe` is passed in rather than imported so this file stays vendor-free: the caller supplies
 * the vision call (the repo's `video_vision` tool) or omits it, in which case clips are inventoried
 * without a content description — still usable, just not citable by what they show.
 */
export function sandboxInventoryDeps(
  sandbox: AgentSandbox,
  describe?: (url: string) => Promise<VisionNote | null>,
): InventoryDeps {
  return {
    probe: (url) => probeWithSandbox(sandbox, url),
    ...(describe ? { describe } : {}),
  };
}

/** Probe + describe every source, using the sandbox. The one call a planning step needs. */
export async function inventoryFromSources(
  sandbox: AgentSandbox,
  sources: readonly AttachmentSource[],
  describe?: (url: string) => Promise<VisionNote | null>,
): Promise<AttachmentInventoryItem[]> {
  return inventoryAttachments(sources, sandboxInventoryDeps(sandbox, describe));
}
