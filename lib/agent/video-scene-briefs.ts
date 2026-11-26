/**
 * WHICH LINE DOES THIS SHOT SAY, AND WHAT SHOULD IT SHOW?
 *
 * WHY THIS FILE EXISTS
 * The owner's report: "when it was talking about meta ads, video generations etc, it should've shown
 * something related to that, so that should've been in the prompt".
 *
 * The legacy generator built one prompt per 15-second clip, but it took the scene for clip `i` with
 * `scenes[i % scenes.length]`. A script with no `scenes` array — the common case, because the script
 * endpoint returns one `dialogue` string and one `visuals` string — therefore gave EVERY clip the same
 * dialogue and the same visual brief, repeated by index. So the words said "your ads now report back to
 * you" while the picture stayed on the same lobby shot, and a viewer could not tell which sentence the
 * scene was about. Wrapping by modulo also silently repeated a two-scene script across four clips.
 *
 * The fix is to bind each shot to an actual line: split the spoken script into as many beats as there
 * are clips, keep them in order, and make each shot's visual brief carry that beat. A line is the only
 * honest source for what a shot is about — it is what the viewer hears while looking at it.
 *
 * Pure, so `scripts/verify-avatar-video.ts` can prove the allocation with no model and no network.
 */

export interface SceneBrief {
  /** The exact words this shot is heard saying. */
  dialogue: string;
  /** What the shot must show: the script's own visual direction, plus the subject of this line. */
  visuals: string;
  /** 1-based, for logs and for the prompt text. */
  index: number;
  /** Where the beat came from, so a repeated or invented brief is visible rather than silent. */
  source: 'script-scene' | 'dialogue-split' | 'dialogue-chunk';
}

/**
 * Split spoken script into beats.
 *
 * Sentence punctuation first, then line breaks, then a hard comma clause split for a single long
 * sentence — a 4-clip script written as one 60-word sentence still has to become four shots. Short
 * fragments are merged rather than dropped: a beat must never be empty, because an empty beat is a shot
 * with nothing to say and the model fills that gap with generic footage.
 */
export function splitDialogueBeats(dialogue: string, target: number): string[] {
  const wanted = Math.max(1, Math.floor(Number(target) || 1));
  const text = String(dialogue || '').trim();
  if (!text) return [];

  const bySentence = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let beats = bySentence.length > 1 ? bySentence : text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (beats.length <= 1) beats = text.split(/(?<=[,;—–])\s+/).map((s) => s.trim()).filter(Boolean);
  if (!beats.length) beats = [text];

  // Too few beats for the number of shots: split the longest sentence at word boundaries so every shot
  // still gets its own words instead of every shot getting all of them.
  while (beats.length < wanted) {
    let longest = 0;
    for (let i = 1; i < beats.length; i++) if (beats[i].length > beats[longest].length) longest = i;
    const words = beats[longest].split(/\s+/);
    if (words.length < 4) break;
    const half = Math.ceil(words.length / 2);
    const a = words.slice(0, half).join(' ');
    const b = words.slice(half).join(' ');
    beats.splice(longest, 1, a, b);
  }

  // Too many beats for the number of shots: group neighbours so no words are lost.
  if (beats.length > wanted) {
    const perShot = Math.ceil(beats.length / wanted);
    const grouped: string[] = [];
    for (let i = 0; i < beats.length; i += perShot) grouped.push(beats.slice(i, i + perShot).join(' '));
    beats = grouped;
  }

  return beats.map((b) => b.trim()).filter(Boolean);
}

/** The subject a line is about, in a form a video prompt can use: the line itself, minus stage directions. */
export function subjectOfLine(line: string): string {
  return String(line || '')
    .replace(/^\s*[-•*]\s*/, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:[^)]*)\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One brief per clip, always with a line to say.
 *
 * Rules, in order:
 *   1. A script that already has per-scene dialogue uses those scenes, in order, one clip each.
 *   2. A script with FEWER scenes than clips does not repeat a scene by modulo — the remaining clips
 *      take the remaining beats of the dialogue, so no shot is a copy of the one before it.
 *   3. A script with no scenes at all is split into one beat per clip.
 * A beat's visual brief always carries its own line, so a shot about the ads report cannot be rendered
 * as generic architectural footage.
 */
export function allocateSceneBriefs(input: {
  /** The script's per-scene directions, when it has them. */
  scenes?: Array<{ dialogue?: string; visuals?: string }> | null;
  /** The whole spoken script, used to fill the shots the scenes do not cover. */
  dialogue?: string | null;
  /** The script's global visual direction, when it has one. */
  visuals?: string | null;
  /** How many clips are being rendered. */
  clips: number;
}): SceneBrief[] {
  const clips = Math.max(1, Math.floor(Number(input.clips) || 1));
  const globalVisuals = String(input.visuals || '').trim();
  const scriptScenes = (Array.isArray(input.scenes) ? input.scenes : [])
    .map((s) => ({
      dialogue: String(s?.dialogue || '').trim(),
      visuals: String(s?.visuals || '').trim(),
    }))
    .filter((s) => s.dialogue || s.visuals);

  const briefs: SceneBrief[] = [];
  const usedDialogue = new Set<string>();

  for (const scene of scriptScenes) {
    if (briefs.length >= clips) break;
    const line = scene.dialogue;
    if (line) usedDialogue.add(line);
    briefs.push({
      index: briefs.length + 1,
      dialogue: line,
      visuals: composeVisuals(scene.visuals || globalVisuals, line),
      source: 'script-scene',
    });
  }

  if (briefs.length < clips) {
    // Whatever the scenes did not cover has to come from the script's own words.
    const remainingScript = String(input.dialogue || '').trim();
    const needed = clips - briefs.length;
    const beats = splitDialogueBeats(remainingScript, needed);
    for (let i = 0; i < needed; i++) {
      const line = beats[i] || beats[beats.length - 1] || '';
      briefs.push({
        index: briefs.length + 1,
        dialogue: line,
        visuals: composeVisuals(globalVisuals, line),
        source: beats.length >= needed ? 'dialogue-split' : 'dialogue-chunk',
      });
    }
  }

  return briefs.slice(0, clips);
}

/** The visual direction for one shot: the script's direction, anchored on the subject of its own line. */
function composeVisuals(visuals: string, line: string): string {
  const subject = subjectOfLine(line);
  const base = String(visuals || '').trim();
  if (!subject) return base;
  // Explicitly bind the picture to the words, which is the whole point: a shot about ads looks like ads.
  return base ? `${base}. The shot illustrates exactly this line: "${subject}"` : `The shot illustrates exactly this line: "${subject}"`;
}
