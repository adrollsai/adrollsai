/**
 * Compile any reference video into an executable spec.
 *
 * This is the piece that turns "make it like this reference" from an improvisation
 * into a repeatable build. It exists because two honest attempts at matching a
 * reference cost ~₹190 and produced work I would not ship, and the causes were not
 * effort — they were constraints rediscovered from scratch each time (ffmpeg
 * cannot animate a crop's own size; Grok ignores the aspect you ask for; a
 * feathered matte shows a bright halo behind type; cheap CDNs only publish 380px
 * thumbnails). Those belong in a compiled artefact, not in a model's luck.
 *
 * The compile is deliberately strict: the model may only emit operations from the
 * closed vocabulary in schema.ts, and the result is validated before it is trusted.
 */
import { analyzeVideoWithGemini } from '@/utils/gemini-video-analysis';
import {
  ASSET_REQUIREMENTS,
  MOTIONS,
  OPERATIONS,
  TRANSITIONS,
  type Spec,
} from './schema';

const SPEC_VERSION = 1;

function buildPrompt(durationHint: string) {
  return `You are compiling a reference video into an executable edit spec. Another engine will rebuild this edit on different footage, so the output must be machine-executable, not descriptive.

VIDEO LENGTH: ${durationHint}

Return ONLY valid JSON, no prose, no markdown fences, matching exactly this shape:

{
  "durationSec": <number>,
  "aspect": "9:16",
  "requires": [<one or more of: ${ASSET_REQUIREMENTS.join(', ')}>],
  "style": {
    "palette": ["#rrggbb", ...],
    "typeFamily": "e.g. ultra-bold condensed sans",
    "typeCase": "upper" | "title" | "mixed",
    "typeTexture": "flat" | "gradient" | "metallic" | "grain",
    "grain": "none" | "fine" | "heavy",
    "grade": "short description of colour and contrast",
    "focus": "camera and focus behaviour, e.g. locked-off, continuous AF, shallow DOF, one rack focus at 21.6s"
  },
  "segments": [
    {
      "start": <number>, "end": <number>,
      "operation": <one of: ${OPERATIONS.join(', ')}>,
      "params": {
        "motion": <one of: ${MOTIONS.join(', ')}> (optional),
        "transition": <one of: ${TRANSITIONS.join(', ')}>,
        "travel": [<0..1>, <0..1>] (optional, only for clip_window),
        "subject": "presenter" | "none" (optional),
        "note": "what happens on screen, one short clause"
      },
      "text": null | {
        "lines": ["EXACT WORDS", ...],
        "role": "hook" | "supporting" | "spec" | "cta",
        "behindSubject": true | false,
        "sizeHint": "huge" | "medium" | "small"
      }
    }
  ],
  "audio": {
    "vo": {"present": true, "language": "...", "wordsPerSecond": <number>, "delivery": "..."} | null,
    "music": {"present": true, "genre": "...", "bpm": <number>, "energy": "..."} | null,
    "sfx": ["e.g. whoosh on every type entry", ...]
  }
}

RULES — these matter more than completeness:
1. Segments must tile the timeline in order with no overlaps and no gaps.
2. Use "matte_behind" ONLY where display type is genuinely occluded by a person. If the type is in front of the person, use "type_display" with behindSubject false.
3. Use "clip_window" only where the source is real wide video that a 9:16 window travels across.
4. Use "plate" where the source material is low-resolution or a different aspect and would have to be shown inside a blurred backdrop.
5. Text lines must be VERBATIM what appears on screen. If you cannot read a word, use "[unclear]".
6. Capture EVERY text element with its real timings, including small spoken captions (those are "subtitle_chunk", role "supporting", sizeHint "small").
7. "requires" must be honest about the footage the reference itself had. If the presenter walks and the camera follows, that is "presenter_motion".
8. Include the end card if there is one, as "end_card".`;
}

export interface CompileResult {
  spec: Spec;
  problems: string[];
  model: string;
  rawAnalysisChars: number;
  /** Rejected candidate output, kept so a failure is diagnosable. */
  rawJson?: string;
}

function extractJson(text: string): any | null {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const direct = tryParse(cleaned);
  if (direct) return direct;
  // Fall back to the outermost braces, which survives a stray preamble.
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) return tryParse(cleaned.slice(first, last + 1));
  return null;
}

/** Force the shape we need even if the model omits optional corners. */
function normalise(raw: any, referenceUrl: string): Spec {
  const segments = Array.isArray(raw?.segments) ? raw.segments : [];
  return {
    version: SPEC_VERSION,
    compiledFrom: {
      referenceUrl,
      durationSec: Number(raw?.durationSec) || segments[segments.length - 1]?.end || 0,
      aspect: String(raw?.aspect || '9:16'),
      compiledAt: new Date().toISOString(),
    },
    requires: Array.isArray(raw?.requires) ? raw.requires : [],
    style: {
      palette: Array.isArray(raw?.style?.palette) ? raw.style.palette : [],
      typeFamily: String(raw?.style?.typeFamily || ''),
      typeCase: raw?.style?.typeCase || 'upper',
      typeTexture: raw?.style?.typeTexture || 'flat',
      grain: raw?.style?.grain || 'none',
      grade: String(raw?.style?.grade || ''),
      focus: String(raw?.style?.focus || ''),
    },
    segments: segments.map((s: any) => ({
      start: Number(s?.start) || 0,
      end: Number(s?.end) || 0,
      operation: s?.operation,
      params: s?.params || {},
      text:
        s?.text && Array.isArray(s.text.lines) && s.text.lines.length
          ? {
              lines: s.text.lines.map((l: any) => String(l)),
              role: s.text.role || 'supporting',
              behindSubject: Boolean(s.text.behindSubject),
              sizeHint: s.text.sizeHint || 'medium',
            }
          : null,
    })),
    audio: {
      vo: raw?.audio?.vo ?? null,
      music: raw?.audio?.music ?? null,
      sfx: Array.isArray(raw?.audio?.sfx) ? raw.audio.sfx : [],
    },
  };
}

export async function compileSpec(opts: {
  referenceUrl: string;
  durationHint?: string;
}): Promise<CompileResult> {
  const prompt = buildPrompt(opts.durationHint || 'unknown — read it from the video');

  const analysis = await analyzeVideoWithGemini({ videoUrl: opts.referenceUrl, prompt });
  const parsed = extractJson(analysis.analysis);
  if (!parsed) {
    return {
      spec: normalise({}, opts.referenceUrl),
      problems: ['model did not return parseable JSON'],
      model: analysis.model,
      rawAnalysisChars: analysis.analysis.length,
      rawJson: analysis.analysis.slice(0, 4000),
    };
  }

  const spec = normalise(parsed, opts.referenceUrl);
  const { validateSpec } = await import('./schema');
  return {
    spec,
    problems: validateSpec(spec),
    model: analysis.model,
    rawAnalysisChars: analysis.analysis.length,
    rawJson: analysis.analysis.slice(0, 4000),
  };
}
