/**
 * Compile any reference video into an executable spec.
 *
 * Design changed after reading the HyperFrames `reverse-any-video` skill: our first
 * version asked a video model for the beat map, and the model invented 15 segments
 * for a reference that actually has 6 shots — because it was segmenting by text
 * element, not by picture. Measured against the real edit, 13 of those 14 cuts did
 * not exist.
 *
 * So the order is inverted. The MEASUREMENT decides the frame boundaries, exactly
 * as the original does. The model is then only asked to do what a model is good at:
 * classify each already-measured shot into our operation vocabulary, and read off
 * the on-screen text with its timings. Its numbers can no longer move the cut list.
 */
import { analyzeVideoWithGemini } from '@/utils/gemini-video-analysis';
import { measureReference, diffSpec, type Measurement } from './measure';
import {
  ASSET_REQUIREMENTS,
  MOTIONS,
  OPERATIONS,
  TRANSITIONS,
  validateSpec,
  type Spec,
  type SpecSegment,
  type SpecTextEvent,
} from './schema';

export interface CompileResult {
  spec: Spec;
  problems: string[];
  model: string;
  measurement: Measurement;
  rawJson?: string;
}

function buildPrompt(m: Measurement): string {
  const shotLines = m.shots
    .map((s, i) => `  shot ${i}: ${s.start.toFixed(3)}s - ${s.end.toFixed(3)}s (${s.frames} frames)`)
    .join('\n');

  return `A reference video has ALREADY been measured. These shot boundaries are facts taken from the file — do not change, merge, split or re-time them:

GEOMETRY: ${m.width}x${m.height}, ${m.fps.toFixed(3)} fps, ${m.durationSec.toFixed(3)}s, ${m.frameCount} frames
SHOTS:
${shotLines}

Your job is to CLASSIFY these shots and read off the text. Return ONLY JSON:

{
  "requires": [<one or more of: ${ASSET_REQUIREMENTS.join(', ')}>],
  "style": {
    "palette": ["#rrggbb", ...],
    "typeFamily": "e.g. ultra-bold condensed sans",
    "typeCase": "upper" | "title" | "mixed",
    "typeTexture": "flat" | "gradient" | "metallic" | "grain",
    "grain": "none" | "fine" | "heavy",
    "grade": "colour and contrast in a phrase",
    "focus": "camera and focus behaviour, naming any rack focus and its timestamp"
  },
  "shots": [
    {
      "index": <the shot index above>,
      "operation": <one of: ${OPERATIONS.join(', ')}>,
      "params": {
        "motion": <one of: ${MOTIONS.join(', ')}> (optional),
        "transition": <one of: ${TRANSITIONS.join(', ')}>,
        "travel": [<0..1>, <0..1>] (only for clip_window),
        "subject": "presenter" | "none" (optional),
        "note": "what is on screen, one short clause"
      }
    }
  ],
  "textEvents": [
    {
      "start": <seconds>, "end": <seconds>,
      "lines": ["EXACT WORDS", ...],
      "role": "hook" | "supporting" | "spec" | "cta",
      "behindSubject": true | false,
      "sizeHint": "huge" | "medium" | "small"
    }
  ],
  "audio": {
    "vo": {"present": true, "language": "...", "wordsPerSecond": <number>, "delivery": "..."} | null,
    "music": {"present": true, "genre": "...", "bpm": <number>, "energy": "..."} | null,
    "sfx": ["...", ...]
  }
}

RULES:
1. One entry in "shots" per measured shot, same index. Every index must appear exactly once.
2. Text events are SEPARATE from shots. A single shot can hold many text events — that is normal and expected. Do not turn a text change into a shot change.
3. Use "matte_behind" only where display type is genuinely occluded by a person. Type in front of them is "type_display" with behindSubject false.
4. Use "clip_window" only where real wide video is travelled by a 9:16 window.
5. Use "plate" where source material is low-resolution or a different aspect and must sit inside a blurred backdrop.
6. Text "lines" must be VERBATIM as on screen; use "[unclear]" for anything unreadable. Capture every element including small spoken captions (role "supporting", sizeHint "small").
7. "requires" must be honest about the footage this reference itself had. A presenter walking while the camera follows is "presenter_motion".
8. All text timings must fall inside 0..${m.durationSec.toFixed(2)}.`;
}

function extractJson(text: string): any | null {
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  return tryParse(cleaned) || (() => {
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    return a >= 0 && b > a ? tryParse(cleaned.slice(a, b + 1)) : null;
  })();
}

/** Assign a fallback operation when the model omits a shot. */
function fallbackOperation(i: number, total: number): { operation: string; params: any } {
  if (i === total - 1 && total > 1) return { operation: 'end_card', params: { transition: 'fade_black', note: 'closing slate' } };
  return { operation: 'cover', params: { motion: 'push', transition: 'cut', note: 'unclassified shot' } };
}

export async function compileSpec(opts: {
  referenceUrl: string;
  threshold?: number;
}): Promise<CompileResult> {
  // 1. Measure first. This, not the model, decides the timeline.
  const measurement = await measureReference(opts.referenceUrl, { threshold: opts.threshold });

  // 2. Ask the model to classify the measured shots and read the text.
  const analysis = await analyzeVideoWithGemini({
    videoUrl: opts.referenceUrl,
    prompt: buildPrompt(measurement),
  });
  const parsed = extractJson(analysis.analysis);
  if (!parsed) {
    return {
      spec: buildSpec(measurement, {}, new Map(), opts.referenceUrl),
      problems: ['model did not return parseable JSON'],
      model: analysis.model,
      measurement,
      rawJson: analysis.analysis.slice(0, 4000),
    };
  }

  const byIndex = new Map<number, any>();
  if (Array.isArray(parsed.shots)) {
    for (const s of parsed.shots) {
      if (typeof s?.index === 'number') byIndex.set(s.index, s);
    }
  }

  const spec = buildSpec(measurement, parsed, byIndex, opts.referenceUrl);

  // 3. Verify the result against the measurement. With measured boundaries this
  //    should always be a match — if it is not, the compiler has a bug, and saying
  //    so is better than shipping a spec nobody checked.
  const d = diffSpec(spec.segments, measurement);
  spec.verification = {
    verdict: d.verdict,
    summary: d.summary,
    missingCuts: d.missingCuts,
    extraCuts: d.extraCuts,
    durationDelta: d.durationDelta,
  };

  return { spec, problems: validateSpec(spec), model: analysis.model, measurement, rawJson: analysis.analysis.slice(0, 4000) };
}

function buildSpec(m: Measurement, parsed: any, byIndex: Map<number, any>, url: string): Spec {
  const segments: SpecSegment[] = m.shots.map((shot, i) => {
    const classified = byIndex.get(i);
    const fb = fallbackOperation(i, m.shots.length);
    return {
      start: shot.start,
      end: shot.end,
      operation: (classified?.operation as any) || (fb.operation as any),
      params: { ...fb.params, ...(classified?.params || {}) },
      frames: shot.frames,
    };
  });

  const textEvents: SpecTextEvent[] = (Array.isArray(parsed?.textEvents) ? parsed.textEvents : [])
    .filter((t: any) => Array.isArray(t?.lines) && t.lines.length && Number.isFinite(Number(t?.start)))
    .map((t: any) => ({
      start: Math.max(0, Math.min(m.durationSec, Number(t.start))),
      end: Math.max(0, Math.min(m.durationSec, Number(t.end) || Number(t.start) + 1)),
      lines: t.lines.map((l: any) => String(l)),
      role: ['hook', 'supporting', 'spec', 'cta'].includes(t?.role) ? t.role : 'supporting',
      behindSubject: Boolean(t?.behindSubject),
      sizeHint: ['huge', 'medium', 'small'].includes(t?.sizeHint) ? t.sizeHint : 'medium',
    }))
    .sort((a: SpecTextEvent, b: SpecTextEvent) => a.start - b.start);

  return {
    version: 1,
    compiledFrom: {
      referenceUrl: url,
      durationSec: m.durationSec,
      aspect: `${m.width}:${m.height}`,
      fps: m.fps,
      frameCount: m.frameCount,
      compiledAt: new Date().toISOString(),
    },
    requires: Array.isArray(parsed?.requires) ? parsed.requires : [],
    style: {
      palette: Array.isArray(parsed?.style?.palette) ? parsed.style.palette : [],
      typeFamily: String(parsed?.style?.typeFamily || ''),
      typeCase: parsed?.style?.typeCase || 'upper',
      typeTexture: parsed?.style?.typeTexture || 'flat',
      grain: parsed?.style?.grain || 'none',
      grade: String(parsed?.style?.grade || ''),
      focus: String(parsed?.style?.focus || ''),
    },
    segments,
    textEvents,
    audio: {
      vo: parsed?.audio?.vo ?? null,
      music: parsed?.audio?.music ?? null,
      sfx: Array.isArray(parsed?.audio?.sfx) ? parsed.audio.sfx : [],
    },
  };
}
