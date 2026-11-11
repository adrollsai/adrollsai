/**
 * Adapt a compiled spec to the footage you actually have.
 *
 * This is the answer to "I like this style but my clips don't match it". The
 * honest split is:
 *
 *   the STYLE is portable  — type treatment, colour, pacing, copy rhythm, the
 *                            order of information, the shape of the hook and CTA
 *   the TECHNIQUE is not  — a gimbal walk-and-talk cannot be derived from a
 *                            locked-off tripod take, and no amount of editing
 *                            invents camera movement that was never filmed
 *
 * So adaptation does not try to fake the missing footage. It keeps every portable
 * decision, swaps each operation for the closest one the assets can actually
 * support, and records exactly what changed and why — so the result is a deliberate
 * lighter version of the reference rather than a failed copy of it.
 */
import type { AssetRequirement, Spec, SpecSegment, Operation } from './schema';

export interface AssetInventory {
  /** 'motion' = presenter walking/moving on camera, 'static' = locked-off, 'none'. */
  presenter: 'motion' | 'static' | 'none';
  /** Real video of the subject, stills only, or nothing. */
  footage: 'video' | 'stills' | 'none';
}

export interface AdaptationChange {
  at: number;
  from: Operation;
  to: Operation;
  why: string;
}

export interface AdaptationResult {
  spec: Spec;
  changes: AdaptationChange[];
  /** Matters that cannot be fixed by adaptation, stated plainly. */
  unavoidable: string[];
}

const MATTE_OPS: Operation[] = ['matte_behind', 'matte_focus'];

export function adaptSpec(spec: Spec, inv: AssetInventory): AdaptationResult {
  const changes: AdaptationChange[] = [];
  const unavoidable: string[] = [];

  const segments: SpecSegment[] = spec.segments.map((seg) => {
    const original = seg.operation;
    let next: Operation = original;
    let why = '';

    if (MATTE_OPS.includes(original)) {
      if (inv.presenter === 'none') {
        // No presenter at all: the occlusion effect has nothing to hide behind.
        next = 'type_display';
        why = 'no presenter available, so the type cannot sit behind a person';
      } else if (inv.presenter === 'static') {
        // Keep the effect, but be honest that it will be still.
        why = 'presenter is locked-off: occlusion works, but the moving silhouette does not';
        if (!unavoidable.some((u) => u.includes('locked-off'))) {
          unavoidable.push(
            'The reference relies on a presenter walking toward camera. A locked-off take keeps the ' +
              'text-behind-subject effect but loses the movement that gives the reference its energy.'
          );
        }
      }
    } else if (original === 'clip_window' && inv.footage !== 'video') {
      next = 'cover';
      why = 'clip_window needs real wide video to travel across; stills cannot supply it';
    } else if ((original === 'cover' || original === 'clip_window') && inv.footage === 'none') {
      next = 'plate';
      why = 'no real footage, so every frame is generated and sits in a plate';
    }

    if (next !== original) {
      changes.push({ at: seg.start, from: original, to: next, why });
      return { ...seg, operation: next, params: { ...seg.params, note: `${seg.params?.note || ''} [adapted: ${why}]`.trim() } };
    }
    return seg;
  });

  // Text that was occluded by a person can no longer be, so it moves in front
  // rather than silently rendering behind nothing.
  const textEvents = spec.textEvents.map((t) => {
    if (t.behindSubject && inv.presenter === 'none') {
      return { ...t, behindSubject: false };
    }
    return t;
  });

  // Requirements become what we can now honour.
  const requires: AssetRequirement[] = [];
  if (inv.presenter === 'motion') requires.push('presenter_motion');
  else if (inv.presenter === 'static') requires.push('presenter_static');
  if (inv.footage === 'video') requires.push('broll_video');
  else if (inv.footage === 'stills') requires.push('stills');
  else requires.push('graphics_only');

  if (inv.footage === 'stills' && spec.requires.includes('broll_video')) {
    unavoidable.push(
      'The reference cuts fast between moving shots. With stills only, the same cut rate reads as a ' +
        'slideshow — expect to slow the cuts or add generated motion.'
    );
  }

  return {
    spec: { ...spec, segments, textEvents, requires },
    changes,
    unavoidable,
  };
}

/** Parse `--adapt presenter=static,footage=video`. */
export function parseInventory(text: string): AssetInventory {
  const parts = Object.fromEntries(
    (text || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [k, v] = p.split('=');
        return [String(k).trim(), String(v || '').trim()];
      })
  );
  const presenter = ['motion', 'static', 'none'].includes(parts.presenter) ? parts.presenter : 'static';
  const footage = ['video', 'stills', 'none'].includes(parts.footage) ? parts.footage : 'stills';
  return { presenter: presenter as AssetInventory['presenter'], footage: footage as AssetInventory['footage'] };
}
