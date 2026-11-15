/**
 * The reverse skill, as the agent can reach it.
 *
 * WHAT THIS ADDS, AND WHY IN TWO HALVES
 * Reversing a reference video is two jobs with different needs:
 *
 *   MEASURE   ffprobe + ffmpeg over the file. Needs a sandbox, because ffmpeg is not
 *             in the Next runtime. This file ships `sandboxAnalysisTools(run)` — a real
 *             implementation of the skill's `AnalysisTools` seam over an injected
 *             command runner — so the measurement can run inside E2B with nothing but an
 *             `exec` function. It is gated with a fake runner that records the command
 *             shapes, so the ffmpeg invocation cannot silently rot.
 *
 *   PLAN      measurement -> SPEC + beats + timing + emitted project. Completely pure:
 *             no process, no network, no bytes. This is `reverse_plan`, the tool the
 *             agent calls.
 *
 * WHY THE TOOL IS THE PURE HALF
 * A tool that says "analyse this video" but has no sandbox handle would either fail or,
 * worse, quietly do something else. So the tool takes an ANALYSIS — the thing a
 * measurement produces — and does the part that cannot be done wrongly: rebuild it,
 * prove the spec invented nothing, compare the runtime, and list every question a human
 * must answer. That is exactly what the agent needs in order to tell an owner what it can
 * and cannot do with their reference.
 */

import { tool } from 'ai';
import { z } from 'zod';
import {
  analyseVideo,
  audioFilterArgs,
  frameArgs,
  logFilterArgs,
  probeArgs,
  type AnalysisTools,
  type ReverseAnalysis,
} from './skills/reverse/analyse';
import { auditSpec, emitSpec } from './skills/reverse/spec';
import { beatsJsonText, rebuildFromAnalysis } from './skills/reverse/rebuild';
import { compareBeats, compareRuntime } from './skills/reverse/compare';
import { estimateReverseCredits, openQuestions } from './skills/reverse/index';

/** The one thing the measurement needs from a sandbox: run a command, get its output. */
export interface CommandRunner {
  run(command: string): Promise<{ stdout: string; stderr?: string; exitCode?: number }>;
}

const quote = (value: string): string => `'${String(value).replace(/'/g, `'\\''`)}'`;

/**
 * The skill's process seams, over a command runner.
 *
 * Frames come back as BASE64 of raw rgb24 rather than a file: the analyser wants bytes,
 * a shell hands back text, and base64 is the only bridge that needs no image decoder and
 * no binary file API. `-f rawvideo -pix_fmt rgb24 -` is the exact layout it expects.
 */
export function sandboxAnalysisTools(runner: CommandRunner): AnalysisTools {
  return {
    async probeJson(file) {
      const result = await runner.run(`ffprobe ${probeArgs(file).map(quote).join(' ')}`);
      return result.stdout;
    },
    async log(file, filter, kind) {
      const args = kind === 'audio' ? audioFilterArgs(file, filter) : logFilterArgs(file, filter);
      // ffmpeg writes its report to stderr; take both, because the parser reads the
      // whole log and does not care which stream a line arrived on.
      const result = await runner.run(
        `ffmpeg ${args.map(quote).join(' ')} 2>&1`,
      );
      return `${result.stdout ?? ''}${result.stderr ?? ''}`;
    },
    async frameRgb(file, at, width, height) {
      const args = frameArgs(file, at, width, height, '-');
      const result = await runner.run(
        `ffmpeg ${args.map(quote).join(' ')} -f rawvideo -pix_fmt rgb24 - | base64 -w0`,
      );
      const encoded = String(result.stdout ?? '').trim();
      if (!encoded) {
        throw new Error(
          `analyse: ffmpeg returned no frame bytes at ${at}s — the frame extraction is not working in this sandbox`,
        );
      }
      return new Uint8Array(Buffer.from(encoded, 'base64'));
    },
  };
}

/** Measure a reference film through a sandbox. Thin wrapper, so the seam is obvious. */
export async function measureReference(file: string, runner: CommandRunner): Promise<ReverseAnalysis> {
  return analyseVideo(file, sandboxAnalysisTools(runner));
}

export interface PlanReverseResult {
  success: boolean;
  /** One line for the owner. */
  briefing?: string;
  runtime?: { referenceSeconds: number; rebuildSeconds: number; driftSeconds: number; withinTolerance: boolean };
  beats?: { referenceBeats: number; rebuildBeats: number; equal: boolean };
  scenes?: number;
  plates?: number;
  credits?: { media: number; render: number; total: number };
  /** The SPEC as text, so the agent can save or quote it. */
  spec?: string;
  /** Did the SPEC print any figure the measurement cannot account for? */
  specAudit?: { ok: boolean; figures: number; invented: number[] };
  beatsJson?: string;
  /** Everything a human must answer before this is a film. */
  questions?: string[];
  notes?: string[];
  error?: string;
}

/**
 * Turn a MEASUREMENT into a rebuild plan. Pure — this is what the tool does.
 *
 * `analysis` is the JSON a measurement produces. It is validated by the skill's own code
 * as it goes: `rebuildFromAnalysis` refuses a measurement it cannot build, and
 * `auditSpec` refuses a spec that states a figure the analysis does not have.
 */
export function planReverse(analysis: ReverseAnalysis): PlanReverseResult {
  try {
    if (!analysis || typeof analysis !== 'object' || !analysis.facts) {
      return {
        success: false,
        error:
          'this is not a measurement: pass the analysis object a reverse produces ' +
          '(it has facts, shots, film, vo and alignment). Measure the file first.',
      };
    }

    const rebuild = rebuildFromAnalysis(analysis);
    const spec = emitSpec(analysis, {});
    const audit = auditSpec(spec, analysis);
    const runtime = compareRuntime(analysis.facts.durationSeconds, rebuild.timing.total);
    const spoken = rebuild.beats.beats.filter((beat) => beat.vo.length > 0).length;
    const beats = compareBeats(analysis.vo.spans.length, spoken);
    const credits = estimateReverseCredits();

    return {
      success: true,
      briefing:
        `${analysis.facts.basename}: ${analysis.facts.durationSeconds}s, ${analysis.film.shotCount} shots, ` +
        `${analysis.vo.spans.length} spoken line(s) → ${rebuild.beats.beats.length} readable beat(s), ` +
        `rebuild ${rebuild.timing.total}s (${runtime.driftSeconds}s drift)`,
      runtime: {
        referenceSeconds: runtime.referenceSeconds,
        rebuildSeconds: runtime.rebuildSeconds,
        driftSeconds: runtime.driftSeconds,
        withinTolerance: runtime.withinTolerance,
      },
      beats: { referenceBeats: beats.referenceBeats, rebuildBeats: beats.rebuildBeats, equal: beats.equal },
      scenes: rebuild.beats.scenes.length,
      plates: rebuild.beats.plates.length,
      credits: { media: credits.media, render: credits.render, total: credits.total },
      spec,
      specAudit: { ok: audit.ok, figures: audit.figures, invented: audit.invented },
      beatsJson: beatsJsonText(rebuild),
      questions: openQuestions(analysis),
      notes: rebuild.notes,
    };
  } catch (error: any) {
    return { success: false, error: String(error?.message ?? error) };
  }
}

export function createReverseSkillTools() {
  return {
    reverse_plan: tool({
      description:
        'Turn a MEASURED reference video into an editable rebuild: a spec, a beats file, the timing, and ' +
        'the list of questions a human must answer. Pass the analysis object a measurement produces. ' +
        'It refuses to state any figure the measurement does not have, and it tells you how many spoken ' +
        'lines became how many readable beats. Read get_skill("nobogent-reference-video") first: the ' +
        'on-screen copy comes back as WORD blanks and you must NOT fill them with anything you invented.',
      inputSchema: z.object({
        analysis: z
          .record(z.string(), z.any())
          .describe('The measurement: { facts, shots, film, vo, alignment, ... }'),
      }),
      execute: async (input: any) => planReverse(input?.analysis),
    }),
  };
}
